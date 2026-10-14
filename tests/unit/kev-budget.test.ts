import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The per-attempt budget (M8 contract §4.4, §13.4, §13.6): every bound
// driven to its limit, ±1. Live reservations are minted by the bookkeeping
// path against the database (tests/integration/kev-bookkeeping.test.ts);
// here a stand-in marks which objects count as live.
const liveSet = new WeakSet<object>();
vi.mock('@/domain/kev-bookkeeping/service', () => ({
  isLiveReservation: (r: unknown) => typeof r === 'object' && r !== null && liveSet.has(r),
}));

const { TurnBudget, BudgetExhausted } = await import('@/kev/budget');
const { LIMITS } = await import('@/kev/config');

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
      b.endCall(ticket, { model: 'm', usage, ms: 1, stop: 'end_turn' });
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
    b.endCall(a.ticket, { model: 'm', usage, ms: 1, stop: 'end_turn' });
    expect(b.canCall(NOW).ok).toBe(true);
    b.endCall(c.ticket, { model: 'm', usage: null, ms: 1, stop: 'error', errorCode: 'timeout' });
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
    b.endCall(ticket, { model: 'm', usage: null, ms: 0, stop: 'error', notSent: true });
    expect(b.calls).toEqual([]);
    expect(b.committedUsdMicros).toBe(0n);
    expect(() => b.endCall(ticket, { model: 'm', usage, ms: 0, stop: 'end_turn' })).toThrow();
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
      model: 'm',
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
    const r = b.endCall(ticket, { model: 'm', usage: big, ms: 5, stop: 'error', partial: true });
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
      b.endCall(ticket, { model: 'm', usage: partial, ms: 1, stop: 'error', partial: true });
    }
    expect(b.calls.map((c) => c.costUsdMicros)).toEqual([133_056n, 133_056n]);
    // Priced as final (2 × 2,112 µ$), a third call would have fitted.
    expect(b.canCall(NOW)).toEqual({ ok: false, reason: 'reservation_exhausted' });
  });

  it('a final report is charged at its cost, as before', () => {
    const b = TurnBudget.open(reservation('fast', 665_280n), { deadline: NOW + 55_000 });
    const { ticket } = b.beginCall(NOW);
    expect(b.endCall(ticket, { model: 'm', usage, ms: 1, stop: 'end_turn' })?.costUsdMicros).toBe(
      3_300n,
    );
  });
});

describe('I4: reported input over the 32,000-token cap halts the attempt', () => {
  it('counts uncached, cache-read and cache-write input together; one over the cap halts', () => {
    const b = TurnBudget.open(reservation('fast', 665_280n), { deadline: NOW + 55_000 });
    const at = { ...usage, inputTokens: 10_000, cacheReadTokens: 12_000, cacheWriteTokens: 10_000 };
    let t = b.beginCall(NOW).ticket;
    b.endCall(t, { model: 'm', usage: at, ms: 1, stop: 'end_turn' });
    expect(b.canCall(NOW).ok).toBe(true); // exactly 32,000: allowed
    t = b.beginCall(NOW).ticket;
    b.endCall(t, {
      model: 'm',
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
