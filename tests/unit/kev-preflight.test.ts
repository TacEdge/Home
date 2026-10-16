import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countJson, okStream, startStub, status, type Stub } from './kev-stub';

// G22, the preflight token count (owner decision, 2026-10-15; contract §2.2,
// §5.4, §13.4), through the real adapter and HOME's fetch against a local
// stub, never the provider: before every model call the complete assembled
// input is counted on POST /v1/messages/count_tokens, for the same model,
// system prompt, tools, `tool_choice`, thinking configuration and
// `output_config`; a count above 32,000 tokens refuses the call; any
// failure to count fails closed. Either way no model call is made, nothing
// is charged and the attempt's five calls are untouched. Synthetic only.

const liveSet = new WeakSet<object>();
vi.mock('@/domain/kev-bookkeeping/service', () => ({
  isLiveReservation: (r: unknown) => typeof r === 'object' && r !== null && liveSet.has(r),
}));

const { TurnBudget, BudgetExhausted } = await import('@/kev/budget');
const { TIERS, COUNT_TOKENS_COST_USD_MICROS, LIMITS } = await import('@/kev/config');
const { createProviderFetchForTests } = await import('@/kev/providers/fetch');
const { buildAnthropicProvider, countParams, messagesParams } =
  await import('@/kev/providers/anthropic');
const { ProviderError } = await import('@/kev/providers/types');

const KEY = 'test-only-not-a-key';
const FAST = TIERS.fast.model.id;
let stub: Stub;
beforeAll(async () => {
  stub = await startStub();
});
afterAll(() => stub.close());
beforeEach(() => {
  stub.seen.length = 0;
  stub.queue.length = 0;
  stub.counts.length = 0;
  stub.countQueue.length = 0;
  stub.defaultCount = 1_234;
});

function budget(deadlineMs = 55_000) {
  const r = Object.freeze({
    reservationId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    userId: 'u',
    tier: 'fast' as const,
    reservedUsdMicros: 665_280n,
  });
  liveSet.add(r);
  return TurnBudget.open(r, { deadline: Date.now() + deadlineMs });
}
const provider = () =>
  buildAnthropicProvider(KEY, createProviderFetchForTests(KEY, { stubPort: stub.port }));
const TOOLS = [
  {
    name: 'get_today',
    description: 'Today.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];
const FORMAT = {
  type: 'object',
  properties: { say: { type: 'string' } },
  required: ['say'],
  additionalProperties: false,
};
const request = (over: Record<string, unknown> = {}) =>
  ({
    tier: 'fast',
    system: 'You are a test.',
    tools: TOOLS,
    toolChoice: 'auto',
    outputFormat: FORMAT,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic question.' }] }],
    ...over,
  }) as Parameters<ReturnType<typeof provider>['run']>[0];
async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProviderError) return e;
    throw e;
  }
  throw new Error('expected a ProviderError');
}
/** No model call was made and nothing was charged. */
function noCall(b: ReturnType<typeof TurnBudget.open>) {
  expect(stub.seen).toHaveLength(0);
  expect(b.modelCalls).toBe(0);
  expect(b.calls).toEqual([]);
  expect(b.committedUsdMicros).toBe(0n);
}

describe('G22: the count covers the complete request the call will send', () => {
  it('same model, system (with its breakpoint), tools, tool_choice, output_config and messages; no thinking in either', async () => {
    stub.queue.push(okStream(FAST));
    const b = budget();
    const result = await provider().run(request({ toolChoice: 'none' }), { budget: b });
    expect(stub.counts).toHaveLength(1);
    expect(stub.seen).toHaveLength(1);
    const counted = JSON.parse(stub.counts[0]!.body) as Record<string, unknown>;
    const sent = JSON.parse(stub.seen[0]!.body) as Record<string, unknown>;
    // Everything the call sends is counted, byte for byte, except what the
    // counting endpoint does not take.
    const { max_tokens, inference_geo, stream, ...rest } = sent;
    expect([max_tokens, inference_geo, stream]).toEqual([4_096, 'us', true]);
    expect(JSON.stringify(counted)).toBe(JSON.stringify(rest));
    expect(counted).toMatchObject({
      model: FAST,
      tool_choice: { type: 'none' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: FORMAT } },
    });
    expect(counted).not.toHaveProperty('thinking');
    expect(sent).not.toHaveProperty('thinking');
    expect(result.countedInputTokens).toBe(1_234);
    // The pure builder agrees with what went on the wire.
    expect(JSON.stringify(countParams(request({ toolChoice: 'none' })))).toBe(JSON.stringify(rest));
    expect(Object.keys(messagesParams(request()))).toContain('max_tokens');
  });

  it('the count passes the same header allow-list: the key, the version, no beta, no platform headers', async () => {
    stub.queue.push(okStream(FAST));
    await provider().run(request(), { budget: budget() });
    const h = stub.counts[0]!.headers;
    expect(h['x-api-key']).toBe(KEY);
    expect(h['anthropic-version']).toBe('2023-06-01');
    for (const k of Object.keys(h))
      expect([
        'x-api-key',
        'anthropic-version',
        'accept',
        'accept-encoding',
        'content-type',
        'content-length',
        'user-agent',
        'host',
        'connection',
      ]).toContain(k);
  });
});

describe('G22: under, at and over 32,000 tokens', () => {
  it.each([
    [31_999, true],
    [LIMITS.inputTokensPerCall, true],
    [32_001, false],
    [1_000_000, false],
  ])('a count of %i: the call is made = %s', async (n, made) => {
    stub.countQueue.push(countJson({ input_tokens: n }));
    if (made) stub.queue.push(okStream(FAST));
    const b = budget();
    if (made) {
      const r = await provider().run(request(), { budget: b });
      expect(r.countedInputTokens).toBe(n);
      expect(stub.seen).toHaveLength(1);
      expect(b.modelCalls).toBe(1);
    } else {
      const e = await failure(provider().run(request(), { budget: b }));
      expect(e.code).toBe('too_large');
      expect(e.detail.preflight).toBe('over_cap');
      noCall(b);
    }
    expect(stub.counts).toHaveLength(1);
  });
});

describe('G22: every counting failure fails closed, with no model call', () => {
  const malformed: [string, unknown][] = [
    ['missing input_tokens', {}],
    ['a string count', { input_tokens: '12' }],
    ['a negative count', { input_tokens: -1 }],
    ['a fractional count', { input_tokens: 1.5 }],
    ['an unsafe integer', { input_tokens: 2 ** 60 }],
    ['null', { input_tokens: null }],
    ['an array body', [12]],
  ];
  it.each(malformed)('malformed: %s', async (_l, body) => {
    stub.countQueue.push(countJson(body));
    const b = budget();
    const e = await failure(provider().run(request(), { budget: b }));
    expect([e.code, e.detail.preflight]).toEqual(['bad_response', 'failed']);
    noCall(b);
  });

  it('a body that is not JSON', async () => {
    stub.countQueue.push((_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"input_tokens": 12');
    });
    const b = budget();
    const e = await failure(provider().run(request(), { budget: b }));
    expect(e.detail.preflight).toBe('failed');
    noCall(b);
  });

  it.each([
    [500, 'api_error', 'unreachable'],
    [529, 'overloaded_error', 'overloaded'],
    [429, 'rate_limit_error', 'rate_limited'],
    [401, 'authentication_error', 'auth'],
    [400, 'invalid_request_error', 'bad_response'],
  ])('an error status %i: %s → %s, never retried', async (code, type, mapped) => {
    stub.countQueue.push(status(code, type, { 'retry-after': '1' }));
    const b = budget();
    const e = await failure(provider().run(request(), { budget: b }));
    expect([e.code, e.detail.preflight]).toEqual([mapped, 'failed']);
    expect(stub.counts).toHaveLength(1); // no retry of a count
    noCall(b);
  });

  it('a redirect is refused by HOME’s fetch (refused_destination)', async () => {
    stub.countQueue.push((_q, res) => {
      res.writeHead(307, { location: 'https://api.anthropic.com/v1/messages' });
      res.end();
    });
    const b = budget();
    const e = await failure(provider().run(request(), { budget: b }));
    expect([e.code, e.detail.preflight]).toEqual(['refused_destination', 'failed']);
    noCall(b);
  });

  it('I-3: a count that never answers times out at its own bound (at most 5 s), never the call’s timeout', async () => {
    stub.countQueue.push(() => undefined);
    // 55 s left: the call's timeout would be 20 s; the count's is 5 s.
    const b = budget(55_000);
    const started = Date.now();
    const e = await failure(provider().run(request(), { budget: b }));
    expect([e.code, e.detail.preflight]).toEqual(['timeout', 'failed']);
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(LIMITS.preflightCountTimeoutMs - 100);
    expect(took).toBeLessThan(LIMITS.preflightCountTimeoutMs + 2_000);
    noCall(b);
  }, 15_000);

  it('I-3: near the deadline the count’s bound shrinks so the call could still start; past it, fail closed', async () => {
    stub.countQueue.push(() => undefined);
    // 9 s left on fast (8 s minimum start): the count may take at most 1 s.
    const b = budget(9_000);
    expect(b.countTimeoutMs(Date.now())).toMatchObject({ ok: true });
    const started = Date.now();
    const e = await failure(provider().run(request(), { budget: b }));
    expect([e.code, e.detail.preflight]).toEqual(['timeout', 'failed']);
    expect(Date.now() - started).toBeLessThan(1_800);
    noCall(b);
  });

  it('I-3: a slow but successful count is followed by a call that still starts', async () => {
    stub.countQueue.push((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 1_234 }));
      }, 600);
    });
    stub.queue.push(
      okStream(FAST, { usage: { input_tokens: 1_000, cache_creation_input_tokens: 0 } }),
    );
    const b = budget(9_300);
    const result = await provider().run(request(), { budget: b });
    expect(result.countedInputTokens).toBe(1_234);
    expect(b.modelCalls).toBe(1);
    expect(stub.seen).toHaveLength(1);
  });

  it('the turn’s signal ends a count in flight', async () => {
    stub.countQueue.push(() => undefined);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const b = budget();
    const e = await failure(provider().run(request(), { budget: b, signal: ac.signal }));
    expect([e.code, e.detail.preflight]).toEqual(['timeout', 'failed']);
    noCall(b);
  });

  it('no count is even attempted when the budget allows no call', async () => {
    const b = budget(7_000); // under the fast tier's 8 s
    await expect(provider().run(request(), { budget: b })).rejects.toBeInstanceOf(BudgetExhausted);
    expect(stub.counts).toHaveLength(0);
    noCall(b);
  });
});

describe('G22: accounting', () => {
  it('a count is free (the provider’s page, 2026-10-15), not a model call, and charges nothing', async () => {
    expect(COUNT_TOKENS_COST_USD_MICROS).toBe(0n);
    stub.queue.push(
      okStream(FAST, { usage: { input_tokens: 1_000, cache_creation_input_tokens: 0 } }),
    );
    const b = budget();
    await provider().run(request(), { budget: b });
    expect(b.modelCalls).toBe(1);
    expect(b.calls).toHaveLength(1); // the call only: no record for the count
  });

  it('HOME’s one retry re-sends the bytes already counted: one count, two calls', async () => {
    stub.queue.push(status(529, 'overloaded_error'), okStream(FAST));
    const b = budget();
    const r = await provider().run(request(), { budget: b });
    expect(r.retried).toBe(true);
    expect(stub.counts).toHaveLength(1);
    expect(stub.seen).toHaveLength(2);
    expect(stub.seen[0]!.body).toBe(stub.seen[1]!.body);
  });

  it('the message_start check (I4) stays: a count under the cap does not stop the provider’s own count from ending the call', async () => {
    stub.countQueue.push(countJson({ input_tokens: 31_000 }));
    stub.queue.push(
      okStream(FAST, { usage: { input_tokens: 32_001, cache_creation_input_tokens: 0 } }),
    );
    const b = budget();
    const e = await failure(provider().run(request(), { budget: b }));
    expect(e.code).toBe('too_large');
    expect(e.detail.preflight).toBeUndefined();
    expect(b.halted).toBe('input_limit');
    expect(b.calls[0]?.stop).toBe('partial');
  });

  it('the count goes over HOME’s fetch only: one http request each, no other transport', async () => {
    const spy = vi.spyOn(http, 'request');
    try {
      stub.queue.push(okStream(FAST));
      await provider().run(request(), { budget: budget() });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});
