// Kev's money arithmetic (M8 contract §13.1, §13.4, §13.6; ADR 0012 §35).
// Pure: no database, no clock, no configuration of its own. The prices, the
// exchange rate and the limits are Kev's (src/kev/config.ts) and are passed
// in, so this file states only the rules. Integers only: bigint
// micro-US-dollars (µ$) for money and nano-US-dollars per token (n$/token,
// US$1 per million tokens = 1,000 n$ per token) for prices, never a float.
//
// Rounding: every division that can leave a remainder rounds UP (towards
// charging and reserving more), except the cap's NZ$ → US$ conversion, which
// rounds to the nearest micro-dollar as the contract's figures do (NZ$100 →
// 55,555,556 µ$; a strict floor would be 55,555,555 µ$, one micro-dollar
// lower). That is the only rounding that can favour spending, and it is at
// most half a micro-dollar per month.

export type Fraction = Readonly<{ num: bigint; den: bigint }>;

/** n$ per token for each kind of token HOME is billed for. */
export type TokenPrices = Readonly<{
  input: bigint;
  cacheWrite5m: bigint;
  cacheRead: bigint;
  output: bigint;
}>;

/** One provider call's reported usage, in tokens. */
export type TokenUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}>;

const NANO_PER_MICRO = 1_000n;

function assertCount(n: number, what: string): bigint {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${what} must be a whole count`);
  return BigInt(n);
}

/** ⌈a / b⌉ for a ≥ 0, b > 0. */
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (a < 0n || b <= 0n) throw new RangeError('ceilDiv needs a ≥ 0 and b > 0');
  return (a + b - 1n) / b;
}

/**
 * What one call cost, in µ$ (contract §13.1): every category of token at its
 * price, times the inference-geo multiplier, rounded up to the micro-dollar.
 * Cache writes are priced at the 5-minute rate: HOME never asks for the
 * 1-hour cache.
 */
export function costUsdMicros(usage: TokenUsage, prices: TokenPrices, geo: Fraction): bigint {
  const nano =
    assertCount(usage.inputTokens, 'inputTokens') * prices.input +
    assertCount(usage.outputTokens, 'outputTokens') * prices.output +
    assertCount(usage.cacheWriteTokens, 'cacheWriteTokens') * prices.cacheWrite5m +
    assertCount(usage.cacheReadTokens, 'cacheReadTokens') * prices.cacheRead;
  return ceilDiv(nano * geo.num, geo.den * NANO_PER_MICRO);
}

/**
 * One call's maximum permitted exposure (contract §13.6): every one of the
 * call's input tokens at the cache-write price (the highest input-side price
 * a call can incur) plus `max_tokens` of output, times the geo multiplier,
 * rounded up.
 */
export function perCallMaxUsdMicros(
  prices: TokenPrices,
  maxTokens: number,
  inputTokensCap: number,
  geo: Fraction,
): bigint {
  const nano =
    assertCount(inputTokensCap, 'inputTokensCap') * prices.cacheWrite5m +
    assertCount(maxTokens, 'maxTokens') * prices.output;
  return ceilDiv(nano * geo.num, geo.den * NANO_PER_MICRO);
}

/**
 * An attempt's reservation (contract §13.6): min(calls × the per-call
 * maximum, the turn ceiling − what the turn has already settled), never
 * below zero. Calls × the rounded per-call maximum, so that every one of the
 * attempt's calls passes the budget's per-call check (for Haiku 5.5 that is
 * 33,265 µ$, one more than the contract's 5 × 6,652.8).
 */
export function attemptReservationUsdMicros(input: {
  perCallMax: bigint;
  calls: number;
  turnCeiling: bigint;
  turnSettled: bigint;
}): bigint {
  const full = input.perCallMax * assertCount(input.calls, 'calls');
  const left = input.turnCeiling - input.turnSettled;
  const r = full < left ? full : left;
  return r > 0n ? r : 0n;
}

/**
 * The household's monthly cap in µ$ (contract §13.4, L10): whole NZ dollars
 * at the fixed rate, to the nearest micro-dollar (half up). NZ$100 at 1.80 is
 * 55,555,556 µ$; NZ$120 is 66,666,667 µ$; NZ$0 is 0 (Kev paused).
 */
export function monthlyCapUsdMicros(nzd: number, nzdPerUsd: Fraction): bigint {
  const n = assertCount(nzd, 'nzd');
  // µ$ = nzd × 10^6 × den / num, rounded to nearest, half up.
  const numerator = n * 1_000_000n * nzdPerUsd.den;
  return (2n * numerator + nzdPerUsd.num) / (2n * nzdPerUsd.num);
}

/** µ$ as whole NZ dollars at the fixed rate, to the nearest dollar: "about NZ$…" (L10). */
export function aboutNzdWhole(usdMicros: bigint, nzdPerUsd: Fraction): bigint {
  if (usdMicros < 0n) throw new RangeError('usdMicros must not be negative');
  const numerator = usdMicros * nzdPerUsd.num;
  const denominator = 1_000_000n * nzdPerUsd.den;
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Where the month stands (contract §13.4, §13.6, D19):
 * - `paused`: the cap is 0, the counted total has reached it, or the next
 *   fast reservation would not fit (Kev pauses slightly before the cap, at
 *   the cost of at most one reservation's worth of unused budget);
 * - `deep_withdrawn`: at or above 80% of the cap (no escalation);
 * - `open`: otherwise.
 * `counted` is settled usage plus every reservation the cap counts.
 */
export type CapState = 'open' | 'deep_withdrawn' | 'paused';

export function capState(input: {
  counted: bigint;
  cap: bigint;
  nextFastReservation: bigint;
  deepWithdrawnAtPercent: number;
}): CapState {
  const { counted, cap, nextFastReservation } = input;
  if (cap <= 0n || counted >= cap || counted + nextFastReservation > cap) return 'paused';
  const pct = BigInt(input.deepWithdrawnAtPercent);
  if (counted * 100n >= cap * pct) return 'deep_withdrawn';
  return 'open';
}

/**
 * The per-adult turn limits (contract §9.6, L11): with `lastMinute` and
 * `today` the adult's turns already counted (from audit rows), may one more
 * start? The day is the home zone's.
 */
export type RateVerdict = 'ok' | 'per_minute' | 'per_day';

export function rateVerdict(input: {
  lastMinute: number;
  today: number;
  perMinute: number;
  perDay: number;
}): RateVerdict {
  if (input.today >= input.perDay) return 'per_day';
  if (input.lastMinute >= input.perMinute) return 'per_minute';
  return 'ok';
}
