import { describe, expect, it, vi } from 'vitest';

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

const NOW = 1_000_000;
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
    // Room for two per-call maxima (2 × 133,056) and 10,000 µ$ more.
    const b = TurnBudget.open(reservation('fast', 276_112n), { deadline: NOW + 55_000 });
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
    // And the ceiling alone, with a larger reservation than the ceiling allows:
    const c = TurnBudget.open(reservation('deep', 1_500_000n), {
      deadline: NOW + 55_000,
      turnSettledUsdMicros: 1_200_000n,
    });
    expect(c.canCall(NOW)).toEqual({ ok: false, reason: 'turn_ceiling' });
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
