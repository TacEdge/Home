import { afterEach, describe, expect, it, vi } from 'vitest';

// The provider's composition root and the scripted provider (M8 contract
// §5.4, §14; matrix rows N2, N3, S10). The SDK's constructor is counted: it
// must never run when Kev is off, gated or has no key, and not even when Kev
// is on until a call is made.

const constructed = vi.hoisted(() => ({ n: 0 }));
vi.mock('@anthropic-ai/sdk', async (orig) => {
  const real = (await orig()) as { default: new (...a: unknown[]) => unknown };
  class Counted extends (real.default as new (...a: unknown[]) => object) {
    constructor(...a: unknown[]) {
      constructed.n += 1;
      super(...a);
    }
  }
  return { ...real, default: Counted };
});
const liveSet = new WeakSet<object>();
vi.mock('@/domain/kev-bookkeeping/service', () => ({
  isLiveReservation: (r: unknown) => typeof r === 'object' && r !== null && liveSet.has(r),
}));

const { selectKevProvider } = await import('@/kev/providers/select');
const { createScriptedProvider } = await import('@/kev/providers/scripted');
const { TurnBudget, BudgetExhausted } = await import('@/kev/budget');
const { createProviderFetchForTests } = await import('@/kev/providers/fetch');
const { ProviderError } = await import('@/kev/providers/types');

const KEY = 'test-only-not-a-key';
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
const req = {
  tier: 'fast' as const,
  system: 's',
  tools: [],
  toolChoice: 'auto' as const,
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'q' }] }],
};

describe('selectKevProvider', () => {
  it('N2: HOME_KEV=on, no HOME_KEV_PROVIDER_KEY, ANTHROPIC_API_KEY set: no provider, the SDK never constructed', () => {
    const s = selectKevProvider({ HOME_KEV: 'on', ANTHROPIC_API_KEY: KEY });
    expect(s).toEqual({ status: 'no key', provider: null });
    expect(constructed.n).toBe(0);
  });

  it('S10: Production, gate closed, HOME_KEV=on, a key: no provider, no call possible', () => {
    const s = selectKevProvider({
      VERCEL_ENV: 'production',
      HOME_KEV: 'on',
      HOME_KEV_PROVIDER_KEY: KEY,
    });
    expect(s).toEqual({ status: 'off (gate closed)', provider: null });
    expect(constructed.n).toBe(0);
  });

  it('I6: a malformed key: `invalid key`, no provider, the SDK never constructed, the key never echoed', () => {
    for (const bad of [`${KEY}\n`, `${KEY}\x01`, `${KEY}\0`, 'test only key value', `${KEY}é`]) {
      const s = selectKevProvider({ HOME_KEV: 'on', HOME_KEV_PROVIDER_KEY: bad });
      expect(s).toEqual({ status: 'invalid key', provider: null });
      expect(JSON.stringify(s)).not.toContain('test');
    }
    expect(constructed.n).toBe(0);
  });

  it('off: no provider', () => {
    expect(selectKevProvider({ HOME_KEV_PROVIDER_KEY: KEY })).toEqual({
      status: 'off',
      provider: null,
    });
  });

  it('scripted locally; never anywhere deployed (N3)', () => {
    expect(selectKevProvider({ HOME_KEV: 'on', HOME_TEST_KEV: 'scripted' }).provider?.kind).toBe(
      'scripted',
    );
    expect(
      selectKevProvider({ HOME_KEV: 'on', HOME_TEST_KEV: 'scripted', VERCEL_ENV: 'preview' }),
    ).toEqual({ status: 'off', provider: null });
  });

  it('on: the Anthropic provider, constructed lazily (no SDK client until a call)', () => {
    const s = selectKevProvider({ HOME_KEV: 'on', HOME_KEV_PROVIDER_KEY: KEY });
    expect(s.status).toBe('on');
    expect(s.provider?.kind).toBe('anthropic');
    expect(JSON.stringify(s)).not.toContain(KEY);
    expect(constructed.n).toBe(0);
  });
});

describe('the scripted provider', () => {
  it('N3: refused anywhere deployed', () => {
    for (const source of [{ VERCEL_ENV: 'preview' }, { VERCEL: '1' }, { NODE_ENV: 'production' }])
      expect(() => createScriptedProvider([], {}, source)).toThrow(/local and CI/);
  });

  it('answers, fails, refuses, reports geo and partial usage, held to the same budget', async () => {
    const p = createScriptedProvider(
      [
        {
          kind: 'answer',
          text: ['One.'],
          usage: { inputTokens: 4_100, outputTokens: 450, cacheWriteTokens: 5_000 },
        },
        { kind: 'error', code: 'overloaded', partialUsage: { inputTokens: 10 } },
        { kind: 'refusal' },
        { kind: 'answer', usage: { inferenceGeo: 'global' } },
        { kind: 'error', code: 'timeout', partialUsage: null },
      ],
      {},
      {},
    );
    const b = budget();
    expect((await p.run(req, { budget: b })).text).toEqual(['One.']);
    const codes = [];
    for (let i = 0; i < 4; i++)
      codes.push(
        await p.run(req, { budget: b }).then(
          () => 'ok',
          (e: unknown) => (e instanceof ProviderError ? e.code : String(e)),
        ),
      );
    expect(codes).toEqual(['overloaded', 'refusal', 'bad_response', 'timeout']);
    // A failure with partial usage, and a geo refusal (found at
    // message_start), are charged conservatively (I2); a refusal's usage is
    // final; no usage at all is the per-call maximum.
    expect(b.calls.map((c) => c.costUsdMicros)).toEqual([
      27_720n,
      133_056n,
      3_300n,
      133_056n,
      133_056n,
    ]);
    expect(b.calls.map((c) => c.stop)).toEqual([
      'end_turn',
      'partial',
      'refusal',
      'partial',
      'error',
    ]);
    // The reported tokens are kept as evidence.
    expect(b.calls[1]?.usage?.inputTokens).toBe(10);
    expect(b.modelCalls).toBe(5);
    await expect(p.run(req, { budget: b })).rejects.toThrow(/calls_exhausted/);
  });

  it('a stall past the call’s timeout is `timeout`', async () => {
    const p = createScriptedProvider([{ kind: 'stall', ms: 60_000 }], {}, {});
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await expect(p.run(req, { budget: budget(), signal: ac.signal })).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});

describe('I4 with the scripted provider: reported input over the cap', () => {
  it('ends the call `too_large`, charged in full, and the attempt makes no further call', async () => {
    const p = createScriptedProvider(
      [
        { kind: 'answer', text: ['Too big.'], usage: { inputTokens: 50_000, outputTokens: 3 } },
        { kind: 'answer', text: ['Never reached.'] },
      ],
      {},
      {},
    );
    const b = budget();
    const e = await p.run(req, { budget: b }).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(ProviderError);
    expect((e as InstanceType<typeof ProviderError>).code).toBe('too_large');
    // 50,000 input priced in full with 4,096 output: 155,056 µ$ (> 133,056).
    expect(b.calls.map((c) => [c.stop, c.costUsdMicros])).toEqual([['partial', 155_056n]]);
    await expect(p.run(req, { budget: b })).rejects.toBeInstanceOf(BudgetExhausted);
    await expect(p.run(req, { budget: b })).rejects.toThrow(/input_limit/);
    expect(b.modelCalls).toBe(1);
  });
});

describe('minor 8: only the attempt’s live TurnBudget can carry a call', () => {
  it('a duck-typed budget, or one whose reservation has settled, is refused before anything runs', async () => {
    const p = createScriptedProvider([{ kind: 'answer' }, { kind: 'answer' }], {}, {});
    const real = budget();
    const duck = {
      tier: 'fast',
      attemptId: real.attemptId,
      live: true,
      modelCalls: 0,
      beginCall: () => ({ ticket: { id: 1, startedAt: 0, done: false }, timeoutMs: 20_000 }),
      endCall: () => null,
      canCall: () => ({ ok: true, timeoutMs: 20_000 }),
    };
    await expect(p.run(req, { budget: duck as never })).rejects.toThrow(/live TurnBudget/);
    expect(p.requests).toHaveLength(0);
    const { buildAnthropicProvider } = await import('@/kev/providers/anthropic');
    const a = buildAnthropicProvider(KEY, createProviderFetchForTests(KEY, { stubPort: 9 }));
    await expect(a.run(req, { budget: duck as never })).rejects.toThrow(/live TurnBudget/);
  });
});

describe('minor 1: every test seam checks the process’s own environment, whatever `source` says', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['VERCEL', '1'],
    ['VERCEL_ENV', 'preview'],
    ['NODE_ENV', 'production'],
  ])('with %s=%s in process.env and a benign source: each seam refuses', (k, v) => {
    vi.stubEnv(k, v);
    expect(() => createScriptedProvider([], {}, {})).toThrow(/local and CI/);
    expect(() => createProviderFetchForTests(KEY, { stubPort: 9 }, {})).toThrow(/local and CI/);
    expect(() => selectKevProvider({ HOME_KEV: 'on', HOME_TEST_KEV: 'scripted' })).toThrow(
      /local and CI/,
    );
    expect(() => selectKevProvider({ HOME_KEV: 'on', HOME_KEV_PROVIDER_KEY: KEY })).toThrow(
      /local and CI/,
    );
  });
});
