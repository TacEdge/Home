import http from 'node:http';
import https from 'node:https';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ev,
  messageEnd,
  messageStart,
  okStream,
  startStub,
  textBlock,
  toolBlock,
  type Handler,
  type Stub,
} from './kev-stub';

// The live verification runner's probe gateway (M8 live-verification plan
// §5, §7; owner decision 2, 2026-10-16), against a local stub through the
// real adapter and HOME's provider test fetch: G1's Models API read, Haiku
// 5.5 on a fast budget, G1's `low` effort, G8's system message, G20's abort,
// and the per-call evidence. Every model call is counted first (G22) and
// checked for US inference. And the probe path is unreachable from Kev:
// the production provider ignores probe options, nothing in src/ but the
// adapter names the gateway, and it refuses to exist when deployed. No test
// reaches the network.

const liveSet = new WeakSet<object>();
vi.mock('@/domain/kev-bookkeeping/service', () => ({
  isLiveReservation: (r: unknown) => typeof r === 'object' && r !== null && liveSet.has(r),
}));

const { TurnBudget } = await import('@/kev/budget');
const { MODELS, TIERS } = await import('@/kev/config');
const { perCallMax } = await import('@/kev/router');
const { createProviderFetchForTests } = await import('@/kev/providers/fetch');
const {
  buildAnthropicProvider,
  buildProbeGateway,
  createAnthropicProvider,
  createProbeGateway,
  probeParams,
} = await import('@/kev/providers/anthropic');
const { ProviderError } = await import('@/kev/providers/types');

const KEY = 'test-only-not-a-key';
const FAST = TIERS.fast.model.id;
const DEEP = TIERS.deep.model.id;
const HAIKU = MODELS.haiku55.id;
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

function budget(tier: 'fast' | 'deep' = 'fast') {
  const r = Object.freeze({
    reservationId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    userId: 'u',
    tier,
    reservedUsdMicros: tier === 'fast' ? 665_280n : 1_500_000n,
  });
  liveSet.add(r);
  return TurnBudget.open(r, { deadline: Date.now() + 55_000 });
}
const testFetch = () => createProviderFetchForTests(KEY, { stubPort: stub.port });
const gateway = () => buildProbeGateway(KEY, testFetch(), {});
const user = (t: string) => ({
  role: 'user' as const,
  content: [{ type: 'text' as const, text: t }],
});
const request = (over: Record<string, unknown> = {}) =>
  ({
    tier: 'fast',
    system: 'You are a test.',
    tools: [],
    toolChoice: 'auto',
    messages: [user('Synthetic question.')],
    ...over,
  }) as Parameters<ReturnType<typeof gateway>['run']>[0];
const body = (s: { body: string }) => JSON.parse(s.body) as Record<string, unknown>;
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    throw new Error('expected a ProviderError');
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    return e;
  }
};

/** A streamed answer with a request id header. */
const withId =
  (id: string, model: string, usage: Record<string, unknown> = {}): Handler =>
  (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': id });
    res.end(messageStart(model, usage) + textBlock(0, 'Synthetic reply.') + messageEnd('end_turn'));
  };
const countWithId =
  (id: string, n = 1_234): Handler =>
  (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': id });
    res.end(JSON.stringify({ input_tokens: n }));
  };

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('the probe path is unreachable from Kev', () => {
  it('nothing in src/ but the adapter (and its types) names the probe gateway or its options', () => {
    const NAMES =
      /\b(buildProbeGateway|createProbeGateway|ProbeGateway|probeParams|ProbeOptions|ProbeEvidence)\b/;
    const users = walk('src')
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => NAMES.test(readFileSync(f, 'utf8')));
    expect(users.sort()).toEqual(
      [join('src/kev/providers/anthropic.ts'), join('src/kev/providers/types.ts')].sort(),
    );
  });

  it('the production provider is { kind, run } only, and its run ignores anything past the request and options', async () => {
    for (const p of [
      buildAnthropicProvider(KEY, testFetch()),
      createAnthropicProvider({ apiKey: KEY }),
    ])
      expect(Object.keys(p).sort()).toEqual(['kind', 'run']);
    stub.queue.push(okStream(FAST));
    const p = buildAnthropicProvider(KEY, testFetch());
    const run = p.run as unknown as (...a: unknown[]) => Promise<unknown>;
    const b = budget();
    await run(
      request(),
      { budget: b },
      {
        probeModel: 'haiku55',
        effort: 'low',
        systemMessage: 'Reply in lower case.',
        abortAfterFirstEvent: true,
      },
    );
    const sent = body(stub.seen[0]!);
    expect(sent.model).toBe(FAST);
    expect(sent.output_config).toEqual({ effort: TIERS.fast.effort });
    expect((sent.messages as { role: string }[]).map((m) => m.role)).toEqual(['user']);
    expect(body(stub.counts[0]!).model).toBe(FAST);
    expect(b.calls[0]).toMatchObject({ model: FAST, stop: 'end_turn' });
  });

  it('the gateway refuses to exist on a deployed process, whatever the source says', () => {
    for (const source of [{ VERCEL: '1' }, { VERCEL_ENV: 'preview' }, { NODE_ENV: 'production' }]) {
      expect(() => buildProbeGateway(KEY, testFetch(), source)).toThrow(/never deployed/);
      expect(() => createProbeGateway({ apiKey: KEY }, source)).toThrow(/never deployed/);
    }
    const f = testFetch();
    vi.stubEnv('VERCEL_ENV', 'preview');
    try {
      expect(() => buildProbeGateway(KEY, f, {})).toThrow(/never deployed/);
      expect(() => createProbeGateway({ apiKey: KEY }, {})).toThrow(/never deployed/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('createProbeGateway takes the key and nothing else; a malformed key is refused', () => {
    expect(() =>
      createProbeGateway({ apiKey: KEY, fetch: testFetch() } as unknown as { apiKey: string }, {}),
    ).toThrow(/key and nothing else/);
    expect(() => buildProbeGateway('short', testFetch(), {})).toThrow(/well-formed/);
    expect(() => buildProbeGateway(KEY, (async () => new Response()) as never, {})).toThrow(
      /HOME’s provider fetch/,
    );
  });
});

describe('G1: the Models API read', () => {
  it('GET /v1/models/{id} through HOME’s fetch: no count, no budget, the limits and the request id recorded', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_models_1' });
      res.end(
        JSON.stringify({
          id: HAIKU,
          type: 'model',
          display_name: 'Synthetic',
          created_at: '2026-01-01T00:00:00Z',
          capabilities: null,
          max_input_tokens: 1_000_000,
          max_tokens: 128_000,
        }),
      );
    });
    const g = gateway();
    const e = await g.models(HAIKU);
    expect(e).toMatchObject({
      kind: 'models',
      model: HAIKU,
      status: 200,
      requestId: 'req_models_1',
      outcome: 'ok',
      id: HAIKU,
      maxInputTokens: 1_000_000,
      maxTokens: 128_000,
    });
    expect(stub.counts).toHaveLength(0);
    expect(stub.seen[0]).toMatchObject({ method: 'GET', url: `/v1/models/${HAIKU}` });
    expect(stub.seen[0]!.headers['anthropic-beta']).toBeUndefined();
    expect(stub.seen[0]!.headers['x-api-key']).toBe(KEY);
    expect(g.evidence()).toEqual([e]);
  });

  it('an id config.ts does not know is refused before any request; an error status is a closed code', async () => {
    const g = gateway();
    await expect(g.models('claude-unknown-1')).rejects.toThrow(/config.ts/);
    expect(stub.seen).toHaveLength(0);
    stub.queue.push((_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json', 'request-id': 'req_404' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'x' } }));
    });
    const e = await g.models(DEEP);
    expect(e).toMatchObject({
      outcome: 'bad_response',
      status: 404,
      requestId: 'req_404',
      id: null,
    });
  });
});

describe('probe calls: the production path, changed only as the probe names', () => {
  it('Haiku 5.5 on a fast budget: counted (G22) and called on Haiku, max_tokens the fast tier’s, charged at the fast tier’s prices', async () => {
    stub.countQueue.push(countWithId('req_count_h', 900));
    stub.queue.push(
      withId('req_msg_h', HAIKU, { input_tokens: 900, cache_creation_input_tokens: 0 }),
    );
    const g = gateway();
    const b = budget('fast');
    const r = await g.run(request(), { budget: b }, { probeModel: 'haiku55' });
    expect(r.stop).toBe('end_turn');
    expect(body(stub.counts[0]!).model).toBe(HAIKU);
    const sent = body(stub.seen[0]!);
    expect(sent.model).toBe(HAIKU);
    expect(sent.max_tokens).toBe(TIERS.fast.maxTokens);
    expect(sent.inference_geo).toBe('us');
    // 900 input at Sonnet's 2,000 n$ + 450 output at 10,000 n$, × 1.1: conservative for Haiku.
    expect(b.calls[0]).toMatchObject({ model: HAIKU, costUsdMicros: 6_930n });
    const ev2 = g.evidence();
    expect(ev2.map((e) => e.kind)).toEqual(['count', 'message']);
    expect(ev2[0]).toMatchObject({ requestId: 'req_count_h', counted: 900, model: HAIKU });
    expect(ev2[1]).toMatchObject({
      requestId: 'req_msg_h',
      model: HAIKU,
      outcome: 'ok',
      stop: 'end_turn',
      costUsdMicros: 6_930n,
      growOnly: null,
    });
  });

  it('Haiku’s prices are at most the fast tier’s in every category, so its per-call maximum bounds a Haiku call', () => {
    const h = MODELS.haiku55.prices;
    const s = TIERS.fast.model.prices;
    for (const k of ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output'] as const)
      expect(h[k] <= s[k], k).toBe(true);
    expect(perCallMax('fast')).toBe(133_056n);
  });

  it('a Haiku probe on a deep budget is refused before anything is sent', async () => {
    const g = gateway();
    await expect(
      g.run(request({ tier: 'deep' }), { budget: budget('deep') }, { probeModel: 'haiku55' }),
    ).rejects.toThrow(/fast budget only/);
    expect(stub.counts).toHaveLength(0);
    expect(stub.seen).toHaveLength(0);
  });

  it('effort low: the count and the call both carry it', async () => {
    stub.queue.push(okStream(DEEP));
    await gateway().run(request({ tier: 'deep' }), { budget: budget('deep') }, { effort: 'low' });
    expect((body(stub.counts[0]!).output_config as { effort: string }).effort).toBe('low');
    expect((body(stub.seen[0]!).output_config as { effort: string }).effort).toBe('low');
    expect(body(stub.seen[0]!).model).toBe(DEEP);
  });

  it('G8: one system message after the last user turn, in the count and the call', async () => {
    stub.queue.push(okStream(FAST));
    await gateway().run(request(), { budget: budget() }, { systemMessage: 'Reply in lower case.' });
    for (const s of [stub.counts[0]!, stub.seen[0]!]) {
      const msgs = body(s).messages as { role: string; content: unknown }[];
      expect(msgs.map((m) => m.role)).toEqual(['user', 'system']);
      expect(msgs[1]).toEqual({ role: 'system', content: 'Reply in lower case.' });
    }
  });

  it('G8’s message is refused unless it follows a user turn, and must be short', () => {
    const replayLess = request({
      messages: [user('q'), { role: 'assistant', content: [{ type: 'text', text: 'a' }] }],
    });
    expect(() => probeParams(replayLess, { systemMessage: 'x' })).toThrow(/follows a user turn/);
    expect(() => probeParams(request(), { systemMessage: 'x'.repeat(501) })).toThrow(/short/);
    expect(() => probeParams(request(), { systemMessage: '  ' })).toThrow(/short/);
    expect(() => probeParams(request(), { probeModel: 'opus' as unknown as 'haiku55' })).toThrow(
      /Haiku/,
    );
    expect(() => probeParams(request(), { effort: 'high' as unknown as 'low' })).toThrow(/low/);
  });

  it('G20: abort after the first event: a timeout, partial usage charged at least the per-call maximum, never retried', async () => {
    stub.queue.push(
      withId('req_abort', FAST, { input_tokens: 800, cache_creation_input_tokens: 0 }),
    );
    const g = gateway();
    const b = budget();
    const err = await failure(g.run(request(), { budget: b }, { abortAfterFirstEvent: true }));
    expect(err.code).toBe('timeout');
    expect(err.detail.partialUsage).toMatchObject({ inputTokens: 800, inferenceGeo: 'us' });
    expect(stub.seen).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]).toMatchObject({ stop: 'partial', costUsdMicros: perCallMax('fast') });
    const m = g.evidence().find((e) => e.kind === 'message');
    expect(m).toMatchObject({
      outcome: 'timeout',
      stop: 'partial',
      requestId: 'req_abort',
      costUsdMicros: perCallMax('fast'),
    });
  });

  it('G10: a response without US inference fails closed on the probe path too', async () => {
    stub.queue.push(withId('req_geo', FAST, { inference_geo: 'global' }));
    const g = gateway();
    const err = await failure(g.run(request(), { budget: budget() }));
    expect(err.code).toBe('bad_response');
    expect(g.evidence().find((e) => e.kind === 'message')).toMatchObject({
      outcome: 'bad_response',
      stop: 'partial',
      usage: expect.objectContaining({ inferenceGeo: 'global' }),
    });
  });

  it('G22: a failed count stops the probe call; the evidence holds the count only', async () => {
    stub.countQueue.push((_req, res) => {
      res.writeHead(500, { 'request-id': 'req_count_500' });
      res.end();
    });
    const g = gateway();
    const err = await failure(g.run(request(), { budget: budget() }, { probeModel: 'haiku55' }));
    expect(err.detail.preflight).toBe('failed');
    expect(stub.seen).toHaveLength(0);
    expect(g.evidence()).toEqual([
      expect.objectContaining({
        kind: 'count',
        status: 500,
        requestId: 'req_count_500',
        counted: null,
      }),
    ]);
  });

  it('only HOME’s fetch carries a probe: the global fetch and https.request are never used', async () => {
    const realFetch = globalThis.fetch;
    let globalCalls = 0;
    globalThis.fetch = (() => {
      globalCalls += 1;
      throw new Error('the global fetch must not be used');
    }) as typeof fetch;
    const httpsSpy = vi.spyOn(https, 'request');
    const httpSpy = vi.spyOn(http, 'request');
    try {
      stub.queue.push(okStream(HAIKU));
      stub.queue.push((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: FAST, max_input_tokens: 1, max_tokens: 1 }));
      });
      const g = gateway();
      await g.run(request(), { budget: budget() }, { probeModel: 'haiku55', systemMessage: 'x.' });
      await g.models(FAST);
      expect(globalCalls).toBe(0);
      expect(httpsSpy).not.toHaveBeenCalled();
      expect(httpSpy).toHaveBeenCalledTimes(3);
    } finally {
      globalThis.fetch = realFetch;
      httpsSpy.mockRestore();
      httpSpy.mockRestore();
    }
  });
});

describe('the gateway’s KevProvider (G9, G21 through kev.handle())', () => {
  it('sends production bodies, records evidence, block types and whether each body extends the last', async () => {
    const sig = (index: number) =>
      ev('content_block_start', {
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      }) +
      ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig' } }) +
      ev('content_block_stop', { index });
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        messageStart(FAST) +
          sig(0) +
          toolBlock(1, 'toolu_probe_1', 'get_today', {}) +
          messageEnd('tool_use', 50),
      );
    });
    stub.queue.push(okStream(FAST));
    const g = gateway();
    const p = g.provider();
    expect(Object.keys(p).sort()).toEqual(['kind', 'run']);
    const b = budget();
    const tools = [
      {
        name: 'get_today',
        description: 'Today.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    ];
    const first = await p.run(request({ tools }), { budget: b });
    const second = await p.run(
      request({
        tools,
        messages: [
          user('Synthetic question.'),
          { role: 'assistant', replay: first.replay },
          {
            role: 'user',
            content: [{ type: 'tool_result', toolUse: first.toolUses[0]!.ref, content: '{}' }],
          },
        ],
      }),
      { budget: b },
    );
    expect(second.stop).toBe('end_turn');
    const msgs = g.evidence().filter((e) => e.kind === 'message');
    expect(msgs[0]).toMatchObject({ growOnly: null, blocks: { thinking: 1, tool_use: 1 } });
    expect(msgs[1]).toMatchObject({ growOnly: true, blocks: { text: 1 } });
    expect(body(stub.seen[0]!).model).toBe(FAST);
  });

  it('a request that rewrites the attempt’s history is reported as not grow-only', async () => {
    stub.queue.push(okStream(FAST), okStream(FAST));
    const g = gateway();
    const p = g.provider();
    const b = budget();
    await p.run(request({ messages: [user('First version.')] }), { budget: b });
    await p.run(request({ messages: [user('Edited version.')] }), { budget: b });
    const msgs = g.evidence().filter((e) => e.kind === 'message');
    expect(msgs[1]).toMatchObject({ growOnly: false });
  });

  it('the evidence never carries a body: no prompt, answer, tool input or key', async () => {
    const CANARY = 'canary-probe-body-91e2';
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        messageStart(FAST) +
          textBlock(0, `${CANARY} answer`) +
          toolBlock(1, 'toolu_c', 'get_today', { q: CANARY }) +
          messageEnd('tool_use'),
      );
    });
    const g = gateway();
    await g.run(request({ system: CANARY, messages: [user(CANARY)] }), { budget: budget() });
    const text = JSON.stringify(g.evidence(), (_k, v) => (typeof v === 'bigint' ? String(v) : v));
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(KEY);
  });
});
