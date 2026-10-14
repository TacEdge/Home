import http from 'node:http';
import https from 'node:https';
import { inspect } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ev,
  messageEnd,
  messageStart,
  okStream,
  startStub,
  status,
  textBlock,
  toolBlock,
  type Stub,
} from './kev-stub';

// The Anthropic adapter against a local stub (M8 contract §5.1, §5.4; matrix
// rows N4, N6, N7, N8, N13, N16, S12, S14; gates G5, G6, G20's stub part).
// The SDK runs for real; only the connection is the test seam's. No test
// reaches the network: the global fetch and Node's https.request are trapped.

const liveSet = new WeakSet<object>();
vi.mock('@/domain/kev-bookkeeping/service', () => ({
  isLiveReservation: (r: unknown) => typeof r === 'object' && r !== null && liveSet.has(r),
}));

const { TurnBudget } = await import('@/kev/budget');
const { TIERS } = await import('@/kev/config');
const { createProviderFetchForTests, PROVIDER_FETCH_LIMITS } =
  await import('@/kev/providers/fetch');
const {
  anthropicClientOptions,
  buildAnthropicProvider,
  createAnthropicProvider,
  messagesParams,
  retryDelayMs,
} = await import('@/kev/providers/anthropic');
const { ProviderError } = await import('@/kev/providers/types');
const { createLogger } = await import('@/lib/log');

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
});

function budget(tier: 'fast' | 'deep' = 'fast', deadlineMs = 55_000) {
  const r = Object.freeze({
    reservationId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    userId: 'u',
    tier,
    reservedUsdMicros: tier === 'fast' ? 665_280n : 1_500_000n,
  });
  liveSet.add(r);
  return TurnBudget.open(r, { deadline: Date.now() + deadlineMs });
}
const provider = (limits = {}) =>
  buildAnthropicProvider(KEY, createProviderFetchForTests(KEY, { stubPort: stub.port, limits }));
const request = (over: Record<string, unknown> = {}) =>
  ({
    tier: 'fast',
    system: 'You are a test.',
    tools: [],
    toolChoice: 'auto',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic question.' }] }],
    ...over,
  }) as Parameters<ReturnType<typeof provider>['run']>[0];
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    throw new Error('expected a ProviderError');
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    return e;
  }
};

describe('N4, G5: every request goes through HOME’s fetch, and streams through it', () => {
  it('a turn through the real adapter: the global fetch and https.request are never used', async () => {
    const realFetch = globalThis.fetch;
    let globalCalls = 0;
    globalThis.fetch = (() => {
      globalCalls += 1;
      throw new Error('the global fetch must not be used');
    }) as typeof fetch;
    const httpsSpy = vi.spyOn(https, 'request');
    const httpSpy = vi.spyOn(http, 'request');
    try {
      stub.queue.push(okStream(FAST, { text: 'Kia ora.' }));
      const b = budget();
      const result = await provider().run(request(), { budget: b });
      expect(result).toMatchObject({ stop: 'end_turn', text: ['Kia ora.'], retried: false });
      // Usage read from the stream: message_start's input, message_delta's output.
      expect(result.usage).toEqual({
        inputTokens: 4_100,
        outputTokens: 450,
        cacheReadTokens: 0,
        cacheWriteTokens: 5_000,
        inferenceGeo: 'us',
      });
      expect(b.calls).toHaveLength(1);
      expect(b.calls[0]?.costUsdMicros).toBe(27_720n); // N12 through the adapter
      expect(globalCalls).toBe(0);
      expect(httpsSpy).not.toHaveBeenCalled();
      // One request, made by HOME's fetch, reached the stub.
      expect(httpSpy).toHaveBeenCalledTimes(1);
      expect(stub.seen).toHaveLength(1);
      expect(stub.seen[0]).toMatchObject({ method: 'POST', url: '/v1/messages' });
    } finally {
      globalThis.fetch = realFetch;
      httpsSpy.mockRestore();
      httpSpy.mockRestore();
    }
  });

  it('the request: streamed, US inference, effort, max_tokens, strict tools, never a forced tool or sampling knob', async () => {
    stub.queue.push(okStream(FAST));
    const tools = [
      {
        name: 'get_today',
        description: 'Today.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    ];
    await provider().run(request({ tools, toolChoice: 'none' }), { budget: budget() });
    const body = JSON.parse(stub.seen[0]!.body);
    expect(body).toMatchObject({
      model: FAST,
      max_tokens: 4_096,
      stream: true,
      inference_geo: 'us',
      output_config: { effort: 'medium' },
      tool_choice: { type: 'none' },
      tools: [{ name: 'get_today', strict: true }],
      system: [{ type: 'text', text: 'You are a test.', cache_control: { type: 'ephemeral' } }],
    });
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'fallbacks', 'metadata'])
      expect(body, k).not.toHaveProperty(k);
    expect(messagesParams(request({ tools, toolChoice: 'auto' })).tool_choice).toEqual({
      type: 'auto',
    });
  });

  it('a tool call comes back with a sealed id that can answer it, and nothing provider-shaped serialises (N13)', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        messageStart(FAST) +
          toolBlock(0, 'toolu_synthetic_1', 'get_today', {}) +
          messageEnd('tool_use', 30),
      );
    });
    stub.queue.push(okStream(FAST, { text: 'Done.' }));
    const p = provider();
    const b = budget();
    const first = await p.run(request(), { budget: b });
    expect(first.stop).toBe('tool_use');
    expect(first.toolUses).toHaveLength(1);
    expect(first.toolUses[0]?.name).toBe('get_today');
    expect(() => JSON.stringify(first)).toThrow(/never leaves its attempt/);
    expect(() => JSON.stringify(first.toolUses[0]?.ref)).toThrow();
    expect(inspect(first.replay)).not.toContain('toolu_synthetic_1');
    await p.run(
      request({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Synthetic question.' }] },
          { role: 'assistant', replay: first.replay },
          {
            role: 'user',
            content: [{ type: 'tool_result', toolUse: first.toolUses[0]!.ref, content: '{}' }],
          },
        ],
      }),
      { budget: b },
    );
    const second = JSON.parse(stub.seen[1]!.body);
    expect(second.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_synthetic_1', name: 'get_today', input: {} }],
    });
    expect(second.messages[2].content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_synthetic_1',
    });
  });

  it('max_tokens is its own stop code; an unknown stop is `other`', async () => {
    stub.queue.push(okStream(FAST, { stop: 'max_tokens' }));
    expect((await provider().run(request(), { budget: budget() })).stop).toBe('max_tokens');
    stub.queue.push(okStream(FAST, { stop: 'something_new' }));
    expect((await provider().run(request(), { budget: budget() })).stop).toBe('other');
  });
});

describe('N8: the SDK’s options', () => {
  it('maxRetries 0, HOME’s timeout, the key passed explicitly, every implicit source neutralised', () => {
    const f = createProviderFetchForTests(KEY, { stubPort: stub.port });
    const o = anthropicClientOptions(KEY, f);
    expect(o).toMatchObject({
      apiKey: KEY,
      authToken: null,
      baseURL: 'https://api.anthropic.com',
      webhookKey: null,
      maxRetries: 0,
      timeout: PROVIDER_FETCH_LIMITS.maxCallMs,
      logLevel: 'off',
      dangerouslyAllowBrowser: false,
    });
    expect(o.fetch).toBe(f);
    expect(() => anthropicClientOptions(KEY, (() => undefined) as never)).toThrow(/HOME/);
  });

  it('the production constructor takes the key and nothing else', () => {
    expect(() =>
      createAnthropicProvider({ apiKey: KEY, fetch: () => undefined } as unknown as {
        apiKey: string;
      }),
    ).toThrow(/nothing else/);
    expect(() =>
      createAnthropicProvider({ apiKey: KEY, baseURL: 'http://x' } as unknown as {
        apiKey: string;
      }),
    ).toThrow(/nothing else/);
    expect(createAnthropicProvider({ apiKey: KEY }).kind).toBe('anthropic');
    expect(() => buildAnthropicProvider(KEY, globalThis.fetch as never)).toThrow(/HOME/);
  });
});

describe('N7: HOME’s one retry', () => {
  it('the rule: only a retryable failure, only before any response byte, after 1 s or retry-after ≤ 2 s', () => {
    const m = (retryable: boolean, retryAfterMs: number | null = null) => ({
      code: 'overloaded' as const,
      retryable,
      notSent: false,
      retryAfterMs,
    });
    expect(retryDelayMs(m(true), false)).toBe(1_000);
    expect(retryDelayMs(m(true), true)).toBeNull(); // after the first byte: never
    expect(retryDelayMs(m(false), false)).toBeNull();
    expect(retryDelayMs(m(true, 0), false)).toBe(0);
    expect(retryDelayMs(m(true, 2_000), false)).toBe(2_000);
    expect(retryDelayMs(m(true, 2_001), false)).toBeNull();
    expect(retryDelayMs(m(true, Number.POSITIVE_INFINITY), false)).toBeNull();
  });

  it('529 before any byte: one retry after 1 s, and it counts as a model call', async () => {
    stub.queue.push(status(529, 'overloaded_error'));
    stub.queue.push(okStream(FAST));
    const b = budget();
    const t0 = Date.now();
    const result = await provider().run(request(), { budget: b });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(950);
    expect(result.retried).toBe(true);
    expect(b.modelCalls).toBe(2);
    expect(b.calls.map((c) => c.stop)).toEqual(['error', 'end_turn']);
    // The failed call's usage is unknown: charged at the per-call maximum (L16).
    expect(b.calls[0]?.costUsdMicros).toBe(133_056n);
    expect(stub.seen).toHaveLength(2);
  });

  it('529 then 529 again: the error state after exactly one retry', async () => {
    stub.queue.push(status(529, 'overloaded_error'), status(529, 'overloaded_error'));
    const b = budget();
    const e = await failure(provider().run(request(), { budget: b }));
    expect(e.code).toBe('overloaded');
    expect(e.detail.retried).toBe(true);
    expect(b.modelCalls).toBe(2);
    expect(stub.seen).toHaveLength(2);
  });

  it('500 after bytes (an error inside a stream that had begun): no retry', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(messageStart(FAST) + ev('error', { error: { type: 'api_error', message: 'x' } }));
    });
    const b = budget();
    const e = await failure(provider().run(request(), { budget: b }));
    expect(e.code).toBe('bad_response');
    expect(stub.seen).toHaveLength(1);
    // Known partial usage (input from message_start) is kept for settlement (G20).
    expect(e.detail.partialUsage).toMatchObject({ inputTokens: 4_100, cacheWriteTokens: 5_000 });
    expect(b.calls[0]?.usage).toMatchObject({ inputTokens: 4_100 });
  });

  it('an overloaded error inside a begun stream is `overloaded`, not retried', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        messageStart(FAST) + ev('error', { error: { type: 'overloaded_error', message: 'x' } }),
      );
    });
    const e = await failure(provider().run(request(), { budget: budget() }));
    expect(e.code).toBe('overloaded');
    expect(stub.seen).toHaveLength(1);
  });

  it('429 with retry-after: 5 is not retried; with retry-after: 1 it is, after a second', async () => {
    stub.queue.push(status(429, 'rate_limit_error', { 'retry-after': '5' }));
    const e = await failure(provider().run(request(), { budget: budget() }));
    expect(e.code).toBe('rate_limited');
    expect(stub.seen).toHaveLength(1);
    stub.seen.length = 0;
    stub.queue.push(status(429, 'rate_limit_error', { 'retry-after': '1' }), okStream(FAST));
    expect((await provider().run(request(), { budget: budget() })).retried).toBe(true);
    expect(stub.seen).toHaveLength(2);
  });

  it('the provider’s spend cap (429 enforced_spend_limit_reached) is never retried', async () => {
    stub.queue.push(
      status(
        429,
        'rate_limit_error',
        {},
        { details: { error_code: 'enforced_spend_limit_reached' } },
      ),
    );
    const e = await failure(provider().run(request(), { budget: budget() }));
    expect(e.code).toBe('rate_limited');
    expect(stub.seen).toHaveLength(1);
  });

  it('a workspace spend limit (400 invalid_request_error) is bad_response, not retried', async () => {
    stub.queue.push(status(400, 'invalid_request_error'));
    const e = await failure(provider().run(request(), { budget: budget() }));
    expect(e.code).toBe('bad_response');
    expect(stub.seen).toHaveLength(1);
  });

  it('each status maps to its closed code', async () => {
    const cases: [number, string, string][] = [
      [401, 'authentication_error', 'auth'],
      [403, 'permission_error', 'auth'],
      [404, 'not_found_error', 'bad_response'],
      [413, 'request_too_large', 'too_large'],
    ];
    for (const [code, type, expected] of cases) {
      stub.queue.push(status(code, type));
      expect(
        (await failure(provider().run(request(), { budget: budget() }))).code,
        String(code),
      ).toBe(expected);
    }
    stub.queue.push(status(500, 'api_error'), status(503, 'api_error'));
    const e = await failure(provider().run(request(), { budget: budget() }));
    expect(e.code).toBe('unreachable');
    expect(e.detail.retried).toBe(true);
  });

  it('a connection reset before any response: one retry', async () => {
    stub.queue.push((req) => req.socket.destroy(), okStream(FAST));
    expect((await provider().run(request(), { budget: budget() })).retried).toBe(true);
  });

  it('a connection reset mid-stream: no retry (`unreachable`), partial usage kept', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(messageStart(FAST));
      setTimeout(() => res.socket?.destroy(), 30);
    });
    const e = await failure(provider().run(request(), { budget: budget() }));
    expect(e.code).toBe('unreachable');
    expect(e.detail.retried).toBe(false);
    expect(e.detail.partialUsage?.inputTokens).toBe(4_100);
    expect(stub.seen).toHaveLength(1);
  });

  it('retry exhaustion of the budget: no retry when the budget no longer allows a call', async () => {
    stub.queue.push(status(529, 'overloaded_error'));
    // Room for exactly one fast call (133,056 µ$).
    const r = Object.freeze({
      reservationId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      userId: 'u',
      tier: 'fast' as const,
      reservedUsdMicros: 133_056n,
    });
    liveSet.add(r);
    const b = TurnBudget.open(r, { deadline: Date.now() + 55_000 });
    const e = await failure(provider().run(request(), { budget: b }));
    expect(e.code).toBe('overloaded');
    expect(e.detail.retried).toBe(false);
    expect(stub.seen).toHaveLength(1);
  });
});

describe('N6, G6: time and abort', () => {
  it('a call stalled after message_start ends at its signal (`timeout`), with partial usage (G20)', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(messageStart(FAST, { input_tokens: 777 }));
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const b = budget();
    const t0 = Date.now();
    const e = await failure(provider().run(request(), { budget: b, signal: ac.signal }));
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(e.code).toBe('timeout');
    expect(e.detail.partialUsage?.inputTokens).toBe(777);
    expect(b.calls[0]?.usage?.inputTokens).toBe(777);
  });

  it('a fast call ends at its own per-call timeout: min(20 s, time left − 5 s)', async () => {
    stub.queue.push(() => undefined); // never answers
    // 8.4 s left: the call's timeout is 3.4 s.
    const b = budget('fast', 8_400);
    const t0 = Date.now();
    const e = await failure(provider().run(request(), { budget: b }));
    const took = Date.now() - t0;
    expect(e.code).toBe('timeout');
    expect(took).toBeGreaterThanOrEqual(3_300);
    expect(took).toBeLessThan(5_000);
    expect(b.calls[0]?.costUsdMicros).toBe(133_056n); // unknown usage: the per-call maximum
  }, 10_000);

  it('no bytes for the idle limit is `timeout`; a response over 2 MiB is `too_large`', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(messageStart(FAST));
    });
    expect(
      (await failure(provider({ idleMs: 150 }).run(request(), { budget: budget() }))).code,
    ).toBe('timeout');
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(messageStart(FAST));
      res.end(textBlock(0, 'x'.repeat(4096)));
    });
    expect(
      (await failure(provider({ maxResponseBytes: 2_048 }).run(request(), { budget: budget() })))
        .code,
    ).toBe('too_large');
  });

  it('a malformed or truncated stream is `bad_response`, logged nowhere', async () => {
    const consoleSpies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      stub.queue.push((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(messageStart(FAST) + 'event: content_block_start\ndata: {not json\n\n');
      });
      expect((await failure(provider().run(request(), { budget: budget() }))).code).toBe(
        'bad_response',
      );
      stub.queue.push((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(messageStart(FAST) + textBlock(0, 'Half'));
      });
      expect((await failure(provider().run(request(), { budget: budget() }))).code).toBe(
        'bad_response',
      );
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });
});

describe('N16 and refusals', () => {
  it('N16: a response whose usage.inference_geo is not `us` ends the attempt bad_response, usage kept', async () => {
    for (const geo of ['global', null, undefined]) {
      stub.queue.push(okStream(FAST, { usage: { inference_geo: geo } }));
      const b = budget();
      const e = await failure(provider().run(request(), { budget: b }));
      expect(e.code, String(geo)).toBe('bad_response');
      expect(b.calls).toHaveLength(1);
      expect(b.calls[0]?.usage?.inputTokens).toBe(4_100);
    }
  });

  it('a refusal ends the attempt `refusal`, with its reported usage recorded', async () => {
    stub.queue.push(okStream(FAST, { stop: 'refusal' }));
    const b = budget();
    const e = await failure(provider().run(request(), { budget: b }));
    expect(e.code).toBe('refusal');
    expect(b.calls[0]).toMatchObject({ stop: 'refusal', errorCode: 'refusal' });
    expect(b.calls[0]?.usage?.inputTokens).toBe(4_100);
  });
});

describe('S14 and the SDK’s environment', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it('every ANTHROPIC_* variable is ignored: requests still go only to api.anthropic.com with HOME’s key', async () => {
    Object.assign(process.env, {
      ANTHROPIC_BASE_URL: 'https://evil.example.test',
      ANTHROPIC_API_KEY: 'env-api-key-fragment',
      ANTHROPIC_AUTH_TOKEN: 'env-auth-token-fragment',
      ANTHROPIC_LOG: 'debug',
      ANTHROPIC_CUSTOM_HEADERS:
        'x-api-key: env-custom-key-fragment\nAuthorization: Bearer env-custom-bearer\nanthropic-version: 1999-01-01\nx-evil: 1',
      ANTHROPIC_PROFILE: 'synthetic',
      ANTHROPIC_CONFIG_DIR: '/nonexistent-home-config',
      ANTHROPIC_FEDERATION_RULE_ID: 'synthetic-rule',
      ANTHROPIC_ORGANIZATION_ID: 'synthetic-org',
      ANTHROPIC_IDENTITY_TOKEN_FILE: '/nonexistent-token',
      ANTHROPIC_WEBHOOK_SIGNING_KEY: 'env-webhook-fragment',
    });
    const consoleSpies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const reads: string[] = [];
    const realEnv = process.env;
    process.env = new Proxy(realEnv, {
      get(target, prop) {
        if (typeof prop === 'string' && prop.startsWith('ANTHROPIC_')) reads.push(prop);
        return Reflect.get(target, prop);
      },
    });
    try {
      stub.queue.push(okStream(FAST));
      await provider().run(request(), { budget: budget() });
    } finally {
      process.env = realEnv;
      for (const spy of consoleSpies) spy.mockRestore();
    }
    const seen = stub.seen[0]!;
    expect(seen.headers['x-api-key']).toBe(KEY);
    expect(seen.headers['anthropic-version']).toBe('2023-06-01');
    expect(seen.headers.authorization).toBeUndefined();
    expect(seen.headers['x-evil']).toBeUndefined();
    expect(seen.headers.host).toBe('api.anthropic.com');
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    // The SDK reads only ANTHROPIC_CUSTOM_HEADERS (client.ts:681), and HOME's
    // explicit headers and fetch allow-list neutralise it (above).
    expect([...new Set(reads)]).toEqual(['ANTHROPIC_CUSTOM_HEADERS']);
  });
});

describe('S12: secrets never travel', () => {
  it('a failed call’s error, its serialisation and every log line carry no key, header or body', async () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l) });
    stub.queue.push((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json', 'x-leaky': 'header-fragment' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: `bad key ${KEY} body-fragment` },
        }),
      );
    });
    const e = await failure(
      provider().run(
        request({
          messages: [{ role: 'user', content: [{ type: 'text', text: 'question-fragment' }] }],
        }),
        { budget: budget() },
      ),
    );
    log.error('kev_call', {
      code: e.code,
      error: e,
      detail: e.detail,
      apiKey: KEY,
      prompt: 'question-fragment',
    });
    const texts = [String(e), e.message, JSON.stringify(e), inspect(e, { depth: 5 }), ...lines];
    for (const t of texts)
      for (const s of [KEY, 'header-fragment', 'body-fragment', 'question-fragment'])
        expect(t, s).not.toContain(s);
    expect(e.code).toBe('auth');
  });
});
