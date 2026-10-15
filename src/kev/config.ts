import 'server-only';
import type { KevTier } from '@/domain/kev-bookkeeping/schema';
import {
  DEEP_WITHDRAWN_AT_PERCENT,
  DEFAULT_MONTHLY_CAP_NZD,
  INPUT_TEXT_MAX_CHARS,
  NZD_PER_USD,
  RESERVATION_STALE_SECONDS,
  TURN_CEILING_USD_MICROS,
  TURN_IN_FLIGHT_SECONDS,
  TURNS_PER_DAY,
  TURNS_PER_MINUTE,
} from '@/domain/kev-bookkeeping/constants';

// Kev's configuration (M8 contract §5.3, §13.4, §13.6; ADR 0012 §13, §35).
// Code asks for a tier, never a model: this file is the only place a model id
// appears (tests/unit/kev-money.test.ts, matrix row N10), and every limit a
// turn is held to lives here. A model change is a change here plus a live
// evaluation on both tiers and the owner's approval (CLAUDE.md, Kev
// specifics). Money is integers only: prices are nano-US-dollars per token
// (US$1 per million tokens = 1,000 n$ per token), costs micro-US-dollars.

/** Prices in nano-US-dollars per token (the pricing page, verified 2026-10-13; gate G2). */
export type PriceTable = Readonly<{
  input: bigint;
  cacheWrite5m: bigint;
  cacheWrite1h: bigint;
  cacheRead: bigint;
  output: bigint;
}>;

export type ModelEntry = Readonly<{
  /** The exact, pinned model id (never an alias). */
  id: string;
  /** The provider's retirement-not-before date (contract §5.1); a model review is planned before it. */
  retireNotBefore: string;
  prices: PriceTable;
}>;

/** Every model HOME knows. Haiku 5.5 is an evaluation entry only: no tier maps to it (D2, O5). */
export const MODELS = {
  opus55: Object.freeze({
    id: 'claude-opus-5-5',
    retireNotBefore: '2027-09-22',
    prices: Object.freeze({
      input: 4_000n,
      cacheWrite5m: 5_000n,
      cacheWrite1h: 8_000n,
      cacheRead: 200n,
      output: 20_000n,
    }),
  }),
  sonnet55: Object.freeze({
    id: 'claude-sonnet-5-5',
    retireNotBefore: '2027-09-28',
    prices: Object.freeze({
      input: 2_000n,
      cacheWrite5m: 2_500n,
      cacheWrite1h: 4_000n,
      cacheRead: 100n,
      output: 10_000n,
    }),
  }),
  // Evaluated before any substitution (Package 5); never mapped to a tier
  // without the owner's decision. Prompts over 100K tokens cost more
  // (0.50 / 0.625 / 1 / 0.05 / 2.50 US$ per MTok), but HOME's 32,000-token
  // cap per call keeps every call on these prices.
  haiku55: Object.freeze({
    id: 'claude-haiku-5-5',
    retireNotBefore: '2027-10-07',
    prices: Object.freeze({
      input: 100n,
      cacheWrite5m: 125n,
      cacheWrite1h: 200n,
      cacheRead: 10n,
      output: 500n,
    }),
  }),
} as const satisfies Record<string, ModelEntry>;

export type Effort = 'low' | 'medium';

export type TierConfig = Readonly<{
  model: ModelEntry;
  effort: Effort;
  /** Includes thinking (contract §5.3). */
  maxTokens: number;
  /** The tier's per-call timeout; never more than the time left − 5 s (contract §4.2). */
  callTimeoutMs: number;
  /** No call of this tier starts with less time than this left in the turn. */
  minStartMs: number;
}>;

/** Tier → model, effort, max_tokens and timeouts (D2, O5; contract §5.3). */
export const TIERS: Readonly<Record<KevTier, TierConfig>> = Object.freeze({
  fast: Object.freeze({
    model: MODELS.sonnet55,
    effort: 'medium',
    maxTokens: 4_096,
    callTimeoutMs: 20_000,
    minStartMs: 8_000,
  }),
  deep: Object.freeze({
    model: MODELS.opus55,
    effort: 'medium',
    maxTokens: 8_192,
    callTimeoutMs: 40_000,
    minStartMs: 20_000,
  }),
});

/**
 * What one preflight token count costs (G22): nothing. "Token counting is
 * free to use but subject to requests per minute rate limits" (the
 * provider's token-counting page, read 2026-10-15; its own limits, separate
 * from the Messages API's). Kept here so the accounting is explicit: a
 * count is charged nothing, writes no `kev_usage` row and is not one of an
 * attempt's five model calls. If the provider ever prices it, this changes
 * with G2's price check, and settlement must record it before any live call
 * (tests/unit/kev-money.test.ts holds it at zero until then).
 */
export const COUNT_TOKENS_COST_USD_MICROS = 0n;

/** Where inference runs, on every request (D3): `us`, which multiplies every price by 1.1. */
export const INFERENCE_GEO = 'us';
/** The `us` multiplier as an exact fraction: 11/10. */
export const GEO_MULTIPLIER = Object.freeze({ num: 11n, den: 10n });

/**
 * The fixed, deliberately conservative exchange rate: NZ$1.80 per US$1
 * (contract §13.1), as an exact fraction, reviewed by the owner each
 * quarter; and the NZ$100 default cap (O2). Defined by the bookkeeping path,
 * which derives the cap itself (ADR 0012 §43), and re-exported here.
 */
export { DEFAULT_MONTHLY_CAP_NZD, NZD_PER_USD };
/** The highest cap the setting accepts (contract §13.4). */
export const MAX_MONTHLY_CAP_NZD = 300;

/** Every hard limit a turn is held to (contract §13.4). No loop in Kev is unbounded. */
export const LIMITS = Object.freeze({
  /** Model calls per attempt, one regeneration and any retry included. */
  modelCallsPerAttempt: 5,
  toolRoundsPerAttempt: 3,
  /** Parallel calls count each. */
  toolCallsPerAttempt: 8,
  /** fast → deep, once. */
  escalationsPerTurn: 1,
  inputTokensPerCall: 32_000,
  /** The user-facing deadline of a turn. */
  turnDeadlineMs: 55_000,
  /** The turn route's `maxDuration` (G3 decides whether the plan allows it). */
  routeMaxDurationS: 90,
  /** Escalation only with at least this long left. */
  escalateMinRemainingMs: 30_000,
  /** A call's timeout is never more than the time left minus this. */
  callTimeoutMarginMs: 5_000,
  /** No byte for this long ends the call (`timeout`). */
  idleMs: 15_000,
  /** The turn's cost ceiling, US$1.50; it bounds the deep attempt's reservation (§13.6). */
  turnCeilingUsdMicros: TURN_CEILING_USD_MICROS,
  /** At this share of the cap, deep is withdrawn (D19). Percent. */
  deepWithdrawnAtPercent: DEEP_WITHDRAWN_AT_PERCENT,
  /**
   * An `open` reservation older than this is marked `unreconciled` and counted
   * in full: the route's `maxDuration` plus 30 seconds. Enforced in SQL by the
   * bookkeeping path, which defines it; tests/unit/kev-money.test.ts holds
   * the two equal.
   */
  reservationStaleSeconds: RESERVATION_STALE_SECONDS,
  // These four are enforced by the bookkeeping path, in the same transaction
  // that stores the person's words, so they are defined there.
  inputTextMaxChars: INPUT_TEXT_MAX_CHARS,
  turnsPerMinute: TURNS_PER_MINUTE,
  turnsPerDay: TURNS_PER_DAY,
  /** A person's message this recent with no reply means a turn is in flight. */
  turnInFlightSeconds: TURN_IN_FLIGHT_SECONDS,
  /** The conversation window (O3). */
  windowHours: 12,
  windowExchanges: 10,
  windowTokens: 6_000,
  /** The HOME retry (contract §5.1): after 1 s, or `retry-after` up to 2 s. */
  retryDelayMs: 1_000,
  retryAfterMaxMs: 2_000,
});

/** The per-call budget of a tier: its model's prices and its max_tokens. */
export function tierModel(tier: KevTier): ModelEntry {
  return TIERS[tier].model;
}
