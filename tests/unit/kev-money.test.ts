import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESERVATION_STALE_SECONDS } from '@/domain/kev-bookkeeping/constants';
import {
  DEFAULT_MONTHLY_CAP_NZD,
  GEO_MULTIPLIER,
  LIMITS,
  MODELS,
  NZD_PER_USD,
  TIERS,
  type PriceTable,
} from '@/kev/config';
import {
  attemptReservation,
  initialTier,
  mayEscalate,
  monthlyCap,
  monthState,
  offersEscalate,
  perCallMax,
} from '@/kev/router';
import {
  aboutNzdWhole,
  attemptReservationUsdMicros,
  capState,
  ceilDiv,
  costUsdMicros,
  monthlyCapUsdMicros,
  perCallMaxUsdMicros,
  rateVerdict,
} from '@/trust/usage';

// Kev's money and its configuration (M8 contract §5.3, §13.4, §13.6; ADR
// 0012 §35). Integer arithmetic only; every figure the contract states is
// reproduced exactly here.

describe('config.ts (N10, G2)', () => {
  it('N10: fast and deep map to exact ids and efforts; Haiku 5.5 is an evaluation entry only', () => {
    expect(TIERS.fast).toMatchObject({ effort: 'medium', maxTokens: 4_096, callTimeoutMs: 20_000 });
    expect(TIERS.fast.model.id).toBe('claude-sonnet-5-5');
    expect(TIERS.deep).toMatchObject({ effort: 'medium', maxTokens: 8_192, callTimeoutMs: 40_000 });
    expect(TIERS.deep.model.id).toBe('claude-opus-5-5');
    expect(Object.values(TIERS).map((t) => t.model.id)).not.toContain(MODELS.haiku55.id);
    expect(MODELS.opus55.retireNotBefore).toBe('2027-09-22');
    expect(MODELS.sonnet55.retireNotBefore).toBe('2027-09-28');
    expect(MODELS.haiku55.retireNotBefore).toBe('2027-10-07');
  });

  it('N10: no string matching `claude-` anywhere in src outside config.ts', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const offenders = walk('src')
      .filter((f) => /\.(ts|tsx|mts|js|mjs|json|css)$/.test(f))
      .filter((f) => f !== join('src/kev/config.ts'))
      .filter((f) => /claude-/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('G2: the price table equals the pricing page (US$ per MTok → n$ per token), 1.1× for `us`', () => {
    const usdPerMtok = (p: PriceTable) =>
      [p.input, p.cacheWrite5m, p.cacheWrite1h, p.cacheRead, p.output].map((x) => Number(x) / 1000);
    expect(usdPerMtok(MODELS.opus55.prices)).toEqual([4, 5, 8, 0.2, 20]);
    expect(usdPerMtok(MODELS.sonnet55.prices)).toEqual([2, 2.5, 4, 0.1, 10]);
    expect(usdPerMtok(MODELS.haiku55.prices)).toEqual([0.1, 0.125, 0.2, 0.01, 0.5]);
    expect(GEO_MULTIPLIER).toEqual({ num: 11n, den: 10n });
    expect(NZD_PER_USD).toEqual({ num: 9n, den: 5n });
  });

  it('every §13.4 limit, and the sweep window equal to maxDuration + 30 s', () => {
    expect(LIMITS).toMatchObject({
      modelCallsPerAttempt: 5,
      toolRoundsPerAttempt: 3,
      toolCallsPerAttempt: 8,
      escalationsPerTurn: 1,
      inputTokensPerCall: 32_000,
      turnDeadlineMs: 55_000,
      routeMaxDurationS: 90,
      escalateMinRemainingMs: 30_000,
      callTimeoutMarginMs: 5_000,
      idleMs: 15_000,
      turnCeilingUsdMicros: 1_500_000n,
      deepWithdrawnAtPercent: 80,
      inputTextMaxChars: 2_000,
      turnsPerMinute: 6,
      turnsPerDay: 60,
      turnInFlightSeconds: 70,
      windowHours: 12,
      windowExchanges: 10,
      windowTokens: 6_000,
    });
    expect(TIERS.fast.minStartMs).toBe(8_000);
    expect(TIERS.deep.minStartMs).toBe(20_000);
    expect(RESERVATION_STALE_SECONDS).toBe(LIMITS.routeMaxDurationS + 30);
    expect(LIMITS.reservationStaleSeconds).toBe(120);
  });
});

describe('usage.ts: cost, maximum exposure, reservations (N12, §13.6)', () => {
  it('N12: Sonnet 5.5 {in 4,100, out 450, write 5,000, read 0} with `us` costs exactly 27,720 µ$', () => {
    expect(
      costUsdMicros(
        { inputTokens: 4_100, outputTokens: 450, cacheWriteTokens: 5_000, cacheReadTokens: 0 },
        MODELS.sonnet55.prices,
        GEO_MULTIPLIER,
      ),
    ).toBe(27_720n);
  });

  it('the contract’s worked fast turn: (12,500 + 14,200 + 11,500) + (500 + 20,500 + 14,000) × 1.1', () => {
    const s = MODELS.sonnet55.prices;
    const call1 = costUsdMicros(
      { inputTokens: 7_100, cacheWriteTokens: 5_000, cacheReadTokens: 0, outputTokens: 1_150 },
      s,
      GEO_MULTIPLIER,
    );
    const call2 = costUsdMicros(
      { inputTokens: 10_250, cacheWriteTokens: 0, cacheReadTokens: 5_000, outputTokens: 1_400 },
      s,
      GEO_MULTIPLIER,
    );
    expect(call1 + call2).toBe(80_520n); // US$0.0805
  });

  it('rounds up, never down, to the micro-dollar', () => {
    // 1 output token of Haiku: 500 n$ × 1.1 = 550 n$ → 1 µ$.
    expect(
      costUsdMicros(
        { inputTokens: 0, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        MODELS.haiku55.prices,
        GEO_MULTIPLIER,
      ),
    ).toBe(1n);
    expect(
      costUsdMicros(
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        MODELS.haiku55.prices,
        GEO_MULTIPLIER,
      ),
    ).toBe(0n);
    expect(ceilDiv(10n, 5n)).toBe(2n);
    expect(ceilDiv(11n, 5n)).toBe(3n);
    expect(() =>
      costUsdMicros(
        { inputTokens: -1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        MODELS.haiku55.prices,
        GEO_MULTIPLIER,
      ),
    ).toThrow(RangeError);
    expect(() =>
      costUsdMicros(
        { inputTokens: 1.5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        MODELS.haiku55.prices,
        GEO_MULTIPLIER,
      ),
    ).toThrow(RangeError);
  });

  it('per-call maximum: Sonnet 133,056; Opus 356,224; Haiku 6,653 (6,652.8 rounded up)', () => {
    expect(perCallMax('fast')).toBe(133_056n);
    expect(perCallMax('deep')).toBe(356_224n);
    expect(
      perCallMaxUsdMicros(MODELS.haiku55.prices, 4_096, LIMITS.inputTokensPerCall, GEO_MULTIPLIER),
    ).toBe(6_653n);
  });

  it('attempt reservation: Sonnet 665,280; deep alone capped by the turn ceiling at 1,500,000', () => {
    expect(attemptReservation('fast')).toBe(665_280n);
    expect(attemptReservation('deep')).toBe(1_500_000n);
    // Haiku: 5 × 6,653, so every one of its five calls passes the budget check.
    expect(
      attemptReservationUsdMicros({
        perCallMax: 6_653n,
        calls: 5,
        turnCeiling: 1_500_000n,
        turnSettled: 0n,
      }),
    ).toBe(33_265n);
  });

  it('L18: after a fast attempt settled at US$0.08, the deep reservation is US$1.42 (three deep calls)', () => {
    const r = attemptReservation('deep', 80_000n);
    expect(r).toBe(1_420_000n);
    expect(r / perCallMax('deep')).toBe(3n);
  });

  it('a turn that has settled the whole ceiling reserves nothing more', () => {
    expect(attemptReservation('deep', 1_500_000n)).toBe(0n);
    expect(attemptReservation('deep', 2_000_000n)).toBe(0n);
  });
});

describe('the cap (L10) and its states (L7, L8, L9)', () => {
  it('L10: unset is NZ$100 = 55,555,556 µ$; NZ$120 = 66,666,667 µ$; NZ$0 = 0', () => {
    expect(DEFAULT_MONTHLY_CAP_NZD).toBe(100);
    expect(monthlyCap(undefined)).toBe(55_555_556n);
    expect(monthlyCap(120)).toBe(66_666_667n);
    expect(monthlyCap(0)).toBe(0n);
    expect(monthlyCap(300)).toBe(166_666_667n);
    // Nearest, half up (the contract's figures); a strict floor would be 55,555,555.
    expect(monthlyCapUsdMicros(100, NZD_PER_USD)).toBe(55_555_556n);
  });

  it('L10: the Usage line rounds to whole NZ dollars', () => {
    expect(aboutNzdWhole(55_555_556n, NZD_PER_USD)).toBe(100n);
    expect(aboutNzdWhole(47_270_000n, NZD_PER_USD)).toBe(85n);
    expect(aboutNzdWhole(0n, NZD_PER_USD)).toBe(0n);
  });

  it('L7: at 80% deep is withdrawn; below it the month is open', () => {
    const cap = 55_555_556n;
    const at80 = (cap * 80n + 99n) / 100n;
    expect(monthState(at80, cap)).toBe('deep_withdrawn');
    expect(monthState(at80 - 1n, cap)).toBe('open');
    expect(offersEscalate('fast', 'open')).toBe(true);
    expect(offersEscalate('fast', 'deep_withdrawn')).toBe(false);
    expect(offersEscalate('deep', 'open')).toBe(false);
  });

  it('L8, L9: at 100%, or when the next fast reservation would not fit, Kev pauses', () => {
    const cap = 55_555_556n;
    expect(monthState(cap, cap)).toBe('paused');
    expect(monthState(cap - attemptReservation('fast'), cap)).toBe('deep_withdrawn');
    expect(monthState(cap - attemptReservation('fast') + 1n, cap)).toBe('paused');
    expect(monthState(0n, 0n)).toBe('paused');
    expect(
      capState({ counted: 0n, cap: 0n, nextFastReservation: 1n, deepWithdrawnAtPercent: 80 }),
    ).toBe('paused');
  });

  it('L11: rate arithmetic (6 a minute, 60 a day)', () => {
    const v = (lastMinute: number, today: number) =>
      rateVerdict({ lastMinute, today, perMinute: 6, perDay: 60 });
    expect(v(5, 59)).toBe('ok');
    expect(v(6, 6)).toBe('per_minute');
    expect(v(0, 60)).toBe('per_day');
  });
});

describe('the router (N11’s decisions)', () => {
  it('every turn starts on fast', () => {
    expect(initialTier()).toBe('fast');
  });

  it('escalates once, from fast, with ≥ 30 s left and the month under 80%', () => {
    const base = {
      tier: 'fast' as const,
      escalationsSoFar: 0,
      remainingMs: 30_000,
      month: 'open' as const,
    };
    expect(mayEscalate(base)).toBe(true);
    expect(mayEscalate({ ...base, remainingMs: 29_999 })).toBe(false);
    expect(mayEscalate({ ...base, remainingMs: 25_000 })).toBe(false);
    expect(mayEscalate({ ...base, escalationsSoFar: 1 })).toBe(false);
    expect(mayEscalate({ ...base, tier: 'deep' })).toBe(false);
    expect(mayEscalate({ ...base, month: 'deep_withdrawn' })).toBe(false);
    expect(mayEscalate({ ...base, month: 'paused' })).toBe(false);
  });
});
