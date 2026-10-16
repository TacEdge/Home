import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The per-attempt budget (M8 contract §4.4, §13.4, §13.6): every bound
// driven to its limit, ±1. Live reservations are minted by the bookkeeping
// path against the database (tests/integration/kev-bookkeeping.test.ts);
// here a stand-in marks which objects count as live.
const liveSet = new WeakSet<object>();
vi.mock('@/domain/kev-bookkeeping/service', () => ({
  isLiveReservation: (r: unknown) => typeof r === 'object' && r !== null && liveSet.has(r),
}));

const { TurnBudget, BudgetExhausted, recordedPrices } = await import('@/kev/budget');
const { GEO_MULTIPLIER, LIMITS, MODELS, TIERS } = await import('@/kev/config');
const { costUsdMicros } = await import('@/trust/usage');
const { attemptReservation, perCallMax } = await import('@/kev/router');
/** The model a fast call is made on (a call is recorded at its model's prices). */
const FAST = TIERS.fast.model.id;
const HAIKU = MODELS.haiku55.id;

// The application's clock is pinned at NOW: TurnBudget.open checks its
// deadline against Date.now() (no caller-supplied time).
const NOW = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});
function reservation(tier: 'fast' | 'deep', reservedUsdMicros: bigint) {
  const r = Object.freeze({
    reservationId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    userId: 'u',
    tier,
    reservedUsdMicros,
  });
  liveSet.add(r);
  return r;
}
const usage = {
  inputTokens: 1_000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  inferenceGeo: 'us',
};

describe('TurnBudget', () => {
  it('opens only on a live reservation', () => {
    const dead = { ...reservation('fast', 665_280n) };
    expect(() => TurnBudget.open(dead as never, { deadline: NOW + 55_000 })).toThrow(/live/);
  });

  it('five model calls per attempt (L1), the sixth refused', () => {
    const b = TurnBudget.open(reservation('fast', 665_280n), { deadline: NOW + 55_000 });
    for (let i = 0; i < LIMITS.modelCallsPerAttempt; i++) {
      const { ticket } = b.beginCall(NOW);
      b.endCall(ticket, { model: FAST, usage, ms: 1, stop: 'end_turn' });
    }
    expect(b.modelCalls).toBe(5);
    expect(b.canCall(NOW)).toEqual({ ok: false, reason: 'calls_exhausted' });
    expect(() => b.beginCall(NOW)).toThrow(BudgetExhausted);
  });

  it('L6: a call whose maximum would pass the remaining reservation is not made', () => {
    // Room for two per-call maxima (2 × 133,056) and 10,000 µ$ more: what a
    // fast attempt may reserve once the turn has settled 1,223,888 µ$.
    const b = TurnBudget.open(reservation('fast', 276_112n), {
      deadline: NOW + 55_000,
      turnSettledUsdMicros: 1_223_888n,
    });
    const a = b.beginCall(NOW);
    const c = b.beginCall(NOW);
    expect(b.canCall(NOW)).toEqual({ ok: false, reason: 'reservation_exhausted' });
    // Ending a call at its real cost (3,300 µ$) frees the rest of its maximum.
    b.endCall(a.ticket, { model: FAST, usage, ms: 1, stop: 'end_turn' });
    expect(b.canCall(NOW).ok).toBe(true);
    b.endCall(c.ticket, { model: FAST, usage: null, ms: 1, stop: 'error', errorCode: 'timeout' });
    expect(b.calls.at(-1)?.costUsdMicros).toBe(133_056n); // unknown usage: the per-call maximum
  });

  it('L6, L18: the turn’s US$1.50 ceiling bounds a deep attempt after a settled fast one', () => {
    const b = TurnBudget.open(reservation('deep', 1_420_000n), {
      deadline: NOW + 55_000,
      turnSettledUsdMicros: 80_000n,
    });
    for (let i = 0; i < 3; i++) b.beginCall(NOW);
    expect(b.canCall(NOW)).toEqual({ ok: false, reason: 'reservation_exhausted' });
    // A reservation larger than the ceiling allows never opens a budget.
    expect(() =>
      TurnBudget.open(reservation('deep', 1_500_000n), {
        deadline: NOW + 55_000,
        turnSettledUsdMicros: 1_200_000n,
      }),
    ).toThrow(/reservation its tier allows/);
  });

  it('L5: no fast call with < 8 s left, no deep call with < 20 s; timeout = min(tier, left − 5 s)', () => {
    const fast = TurnBudget.open(reservation('fast', 665_280n), { deadline: NOW + 8_000 });
    expect(fast.canCall(NOW)).toEqual({ ok: true, timeoutMs: 3_000 });
    expect(fast.canCall(NOW + 1)).toEqual({ ok: false, reason: 'too_little_time' });
    expect(fast.canCall(NOW - 50_000)).toEqual({ ok: true, timeoutMs: 20_000 });
    const deep = TurnBudget.open(reservation('deep', 1_500_000n), { deadline: NOW + 20_000 });
    expect(deep.canCall(NOW)).toEqual({ ok: true, timeoutMs: 15_000 });
    expect(deep.canCall(NOW + 1)).toEqual({ ok: false, reason: 'too_little_time' });
    expect(deep.canCall(NOW - 50_000)).toEqual({ ok: true, timeoutMs: 40_000 });
  });

  it('L2, L3: three tool rounds; eight tool calls, parallel ones counting each', () => {
    const b = TurnBudget.open(reservation('fast', 665_280n), { deadline: NOW + 55_000 });
    expect(b.takeToolRound(3)).toBe(3);
    expect(b.takeToolRound(4)).toBe(4);
    expect(b.takeToolRound(2)).toBe(1); // the ninth is refused
    expect(b.toolCalls).toBe(8);
    expect(b.canToolRound()).toBe(false);
    expect(b.takeToolRound(1)).toBe(0);
  });

  it('a call refused before any byte was sent costs nothing and is not recorded', () => {
    const b = TurnBudget.open(reservation('fast', 665_280n), { deadline: NOW + 55_000 });
    const { ticket } = b.beginCall(NOW);
    expect(b.committedUsdMicros).toBe(133_056n);
    b.endCall(ticket, { model: FAST, usage: null, ms: 0, stop: 'error', notSent: true });
    expect(b.calls).toEqual([]);
    expect(b.committedUsdMicros).toBe(0n);
    expect(() => b.endCall(ticket, { model: FAST, usage, ms: 0, stop: 'end_turn' })).toThrow();
  });

  it('a settled (revoked) reservation allows no further call', () => {
    const r = reservation('fast', 665_280n);
    const b = TurnBudget.open(r, { deadline: NOW + 55_000 });
    liveSet.delete(r);
    expect(b.canCall(NOW)).toEqual({ ok: false, reason: 'reservation_closed' });
  });
});

describe('opening a budget (ADR 0012 §43, minors 5 and 6)', () => {
  it('the reservation must be exactly what the tier allows: no more, no less', () => {
    for (const [tier, amount, settled] of [
      ['fast', 665_281n, 0n],
      ['fast', 665_279n, 0n],
      ['fast', 1_500_000n, 0n],
      ['deep', 1_500_001n, 0n],
      ['deep', 1_420_001n, 80_000n],
    ] as const)
      expect(
        () =>
          TurnBudget.open(reservation(tier, amount), {
            deadline: NOW + 55_000,
            turnSettledUsdMicros: settled,
          }),
        `${tier} ${amount}`,
      ).toThrow(/reservation its tier allows/);
    expect(() =>
      TurnBudget.open(reservation('fast', 665_280n), {
        deadline: NOW + 55_000,
        turnSettledUsdMicros: -1n,
      }),
    ).toThrow(RangeError);
  });

  it('the deadline is in the future and no further ahead than the turn’s 55 s', () => {
    const open = (deadline: number) => TurnBudget.open(reservation('fast', 665_280n), { deadline });
    expect(() => open(NOW + LIMITS.turnDeadlineMs)).not.toThrow();
    expect(() => open(NOW + 1)).not.toThrow();
    for (const bad of [
      NOW + LIMITS.turnDeadlineMs + 1,
      NOW + 86_400_000,
      NOW,
      NOW - 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])
      expect(() => open(bad), String(bad)).toThrow(/deadline/);
  });
});

describe('I2: a call without the provider’s final usage is charged conservatively', () => {
  const partial = { ...usage, inputTokens: 900, outputTokens: 12 };

  it('never less than the per-call maximum; the reported tokens are kept; stop `partial`', () => {
    const b = TurnBudget.open(reservation('fast', 665_280n), { deadline: NOW + 55_000 });
    const { ticket } = b.beginCall(NOW);
    const r = b.endCall(ticket, {
      model: FAST,
      usage: partial,
      ms: 5,
      stop: 'error',
      errorCode: 'unreachable',
      partial: true,
    });
    // Priced as final it would be 2,112 µ$; partial, it is the maximum.
    expect(r).toMatchObject({ costUsdMicros: 133_056n, stop: 'partial', usage: partial });
    expect(b.committedUsdMicros).toBe(133_056n);
  });

  it('more than the maximum when the reported input with max_tokens of output prices higher', () => {
    const b = TurnBudget.open(reservation('fast', 665_280n), { deadline: NOW + 55_000 });
    const { ticket } = b.beginCall(NOW);
    // 50,000 input × 2,000 n$ + 4,096 output × 10,000 n$ = 140,960,000 n$, × 1.1.
    const big = { ...usage, inputTokens: 50_000, outputTokens: 3 };
    const r = b.endCall(ticket, { model: FAST, usage: big, ms: 5, stop: 'error', partial: true });
    expect(r?.costUsdMicros).toBe(155_056n);
  });

  it('the reservation’s remaining authority falls by the conservative figure, so no “released” room is reused', () => {
    // Room for exactly two per-call maxima.
    const b = TurnBudget.open(reservation('fast', 266_112n), {
      deadline: NOW + 55_000,
      turnSettledUsdMicros: 1_233_888n,
    });
    for (let i = 0; i < 2; i++) {
      const { ticket } = b.beginCall(NOW);
      b.endCall(ticket, { model: FAST, usage: partial, ms: 1, stop: 'error', partial: true });
    }
    expect(b.calls.map((c) => c.costUsdMicros)).toEqual([133_056n, 133_056n]);
    // Priced as final (2 × 2,112 µ$), a third call would have fitted.
    expect(b.canCall(NOW)).toEqual({ ok: false, reason: 'reservation_exhausted' });
  });

  it('a final report is charged at its cost, as before', () => {
    const b = TurnBudget.open(reservation('fast', 665_280n), { deadline: NOW + 55_000 });
    const { ticket } = b.beginCall(NOW);
    expect(b.endCall(ticket, { model: FAST, usage, ms: 1, stop: 'end_turn' })?.costUsdMicros).toBe(
      3_300n,
    );
  });
});

describe('I4: reported input over the 32,000-token cap halts the attempt', () => {
  it('counts uncached, cache-read and cache-write input together; one over the cap halts', () => {
    const b = TurnBudget.open(reservation('fast', 665_280n), { deadline: NOW + 55_000 });
    const at = { ...usage, inputTokens: 10_000, cacheReadTokens: 12_000, cacheWriteTokens: 10_000 };
    let t = b.beginCall(NOW).ticket;
    b.endCall(t, { model: FAST, usage: at, ms: 1, stop: 'end_turn' });
    expect(b.canCall(NOW).ok).toBe(true); // exactly 32,000: allowed
    t = b.beginCall(NOW).ticket;
    b.endCall(t, {
      model: FAST,
      usage: { ...at, inputTokens: 10_001 },
      ms: 1,
      stop: 'error',
      errorCode: 'too_large',
      partial: true,
    });
    expect(b.halted).toBe('input_limit');
    expect(b.canCall(NOW)).toEqual({ ok: false, reason: 'input_limit' });
    expect(() => b.beginCall(NOW)).toThrow(BudgetExhausted);
  });
});

describe('a call is recorded at the prices of the model actually called (owner decision, 2026-10-16)', () => {
  const open = (tier: 'fast' | 'deep') =>
    TurnBudget.open(reservation(tier, attemptReservation(tier)), { deadline: NOW + 55_000 });

  it('the tier’s own model at its prices; Haiku 5.5 on fast at Haiku’s; nothing else has a price', () => {
    expect(recordedPrices('fast', TIERS.fast.model.id)).toBe(TIERS.fast.model.prices);
    expect(recordedPrices('deep', TIERS.deep.model.id)).toBe(TIERS.deep.model.prices);
    expect(recordedPrices('fast', HAIKU)).toBe(MODELS.haiku55.prices);
    expect(recordedPrices('deep', HAIKU)).toBeNull();
    expect(recordedPrices('fast', TIERS.deep.model.id)).toBeNull();
    expect(recordedPrices('fast', 'claude-unknown')).toBeNull();
    // Haiku is cheaper than the fast tier in every category, so the fast
    // tier's per-call maximum bounds a Haiku call.
    const h = MODELS.haiku55.prices;
    const s = TIERS.fast.model.prices;
    for (const k of ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output'] as const)
      expect(h[k] < s[k]).toBe(true);
  });

  it('a completed Haiku call: recorded at Haiku’s prices; the reservation and per-call maximum stay the fast tier’s', () => {
    const b = open('fast');
    expect(b.reservedUsdMicros).toBe(attemptReservation('fast'));
    expect(b.perCallMaxUsdMicros).toBe(perCallMax('fast'));
    const { ticket } = b.beginCall(NOW);
    // Committed at the fast tier's maximum while in flight.
    expect(b.committedUsdMicros).toBe(perCallMax('fast'));
    const r = b.endCall(ticket, { model: HAIKU, usage, ms: 1, stop: 'end_turn' });
    // 1,000 × 100 n$ + 100 × 500 n$ = 150,000 n$ × 1.1 = 165 µ$ (Sonnet's: 3,300 µ$).
    expect(r?.costUsdMicros).toBe(165n);
    expect(r?.costUsdMicros).toBe(costUsdMicros(usage, MODELS.haiku55.prices, GEO_MULTIPLIER));
    expect(b.committedUsdMicros).toBe(165n);
  });

  it('a Haiku call never charged below the conservative figure: unknown usage at the per-call maximum, partial usage at the fast tier’s conservative charge', () => {
    const b = open('fast');
    const a = b.beginCall(NOW);
    const unknown = b.endCall(a.ticket, {
      model: HAIKU,
      usage: null,
      ms: 1,
      stop: 'error',
      errorCode: 'timeout',
    });
    expect(unknown?.costUsdMicros).toBe(perCallMax('fast'));
    const c = b.beginCall(NOW);
    const partial = b.endCall(c.ticket, {
      model: HAIKU,
      usage,
      ms: 1,
      stop: 'error',
      partial: true,
    });
    expect(partial?.costUsdMicros).toBe(b.conservativeCost(usage));
    expect(partial!.costUsdMicros >= perCallMax('fast')).toBe(true);
  });

  it('a model HOME has no verified price for, on that tier, is charged the per-call maximum', () => {
    for (const [tier, model] of [
      ['fast', 'claude-unknown'],
      ['fast', TIERS.deep.model.id],
      ['deep', HAIKU],
    ] as const) {
      const b = open(tier);
      const { ticket } = b.beginCall(NOW);
      const r = b.endCall(ticket, { model, usage, ms: 1, stop: 'end_turn' });
      expect(r?.costUsdMicros).toBe(perCallMax(tier));
    }
  });

  it('the tier’s own model is unchanged: its tokens at its prices', () => {
    for (const tier of ['fast', 'deep'] as const) {
      const b = open(tier);
      const { ticket } = b.beginCall(NOW);
      const r = b.endCall(ticket, { model: TIERS[tier].model.id, usage, ms: 1, stop: 'end_turn' });
      expect(r?.costUsdMicros).toBe(costUsdMicros(usage, TIERS[tier].model.prices, GEO_MULTIPLIER));
    }
  });
});
