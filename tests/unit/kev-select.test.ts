import { describe, expect, it, vi } from 'vitest';

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
const { TurnBudget } = await import('@/kev/budget');
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
    expect(b.calls.map((c) => c.costUsdMicros)).toEqual([
      27_720n,
      1_122n,
      3_300n,
      3_300n,
      133_056n,
    ]);
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
