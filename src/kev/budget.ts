import 'server-only';
import type { KevTier } from '@/domain/kev-bookkeeping/schema';
import { isLiveReservation, type Reservation } from '@/domain/kev-bookkeeping/service';
import { costUsdMicros, perCallMaxUsdMicros } from '@/trust/usage';
import { GEO_MULTIPLIER, LIMITS, TIERS } from './config';
import type { CallUsage, StopCode, ProviderErrorCode } from './providers/types';

// The per-attempt budget (M8 contract §4.2, §4.4 `TurnBudget`, §13.4,
// §13.6). One per attempt, opened only on a live reservation (minted by the
// bookkeeping path's reserveAttempt and revoked when the attempt settles),
// so no provider call can be made without one. It checks before every call
// that the call's maximum still fits the attempt's remaining reservation and
// the turn's US$1.50 ceiling (L6), and that the turn has time for it; it
// counts model calls (a retry is one), tool rounds and tool calls; and it
// holds the attempt's per-call record for settlement. No loop is unbounded:
// every bound here is tested to its limit (tests/unit/kev-budget.test.ts).

export type BudgetRefusal =
  | 'calls_exhausted'
  | 'reservation_exhausted'
  | 'turn_ceiling'
  | 'too_little_time'
  | 'reservation_closed';

/** One provider call, as settlement will record it. */
export type CallRecord = Readonly<{
  tier: KevTier;
  model: string;
  /** null: the provider reported nothing, so the call is charged at the per-call maximum. */
  usage: CallUsage | null;
  costUsdMicros: bigint;
  ms: number;
  stop: StopCode | 'refusal' | 'error';
  errorCode: ProviderErrorCode | null;
}>;

type Ticket = { readonly id: number; readonly startedAt: number; done: boolean };

export class TurnBudget {
  readonly attemptId: string;
  readonly tier: KevTier;
  readonly reservedUsdMicros: bigint;
  readonly perCallMaxUsdMicros: bigint;
  readonly deadline: number;
  readonly turnSettledUsdMicros: bigint;
  #modelCalls = 0;
  #toolRounds = 0;
  #toolCalls = 0;
  #inFlight = new Map<number, Ticket>();
  #records: CallRecord[] = [];
  #next = 1;
  readonly #reservation: Reservation;

  private constructor(reservation: Reservation, deadline: number, turnSettled: bigint) {
    this.#reservation = reservation;
    this.attemptId = reservation.attemptId;
    this.tier = reservation.tier;
    this.reservedUsdMicros = reservation.reservedUsdMicros;
    this.deadline = deadline;
    this.turnSettledUsdMicros = turnSettled;
    const t = TIERS[reservation.tier];
    this.perCallMaxUsdMicros = perCallMaxUsdMicros(
      t.model.prices,
      t.maxTokens,
      LIMITS.inputTokensPerCall,
      GEO_MULTIPLIER,
    );
  }

  /**
   * Opens the attempt's budget on a live reservation. `deadline` is the
   * turn's deadline (epoch ms); `turnSettledUsdMicros` what the turn's
   * earlier attempt (before an escalation) settled.
   */
  static open(
    reservation: Reservation,
    opts: { deadline: number; turnSettledUsdMicros?: bigint },
  ): TurnBudget {
    if (!isLiveReservation(reservation))
      throw new Error('a budget opens only on a live reservation');
    return new TurnBudget(reservation, opts.deadline, opts.turnSettledUsdMicros ?? 0n);
  }

  get modelCalls(): number {
    return this.#modelCalls;
  }
  get toolRounds(): number {
    return this.#toolRounds;
  }
  get toolCalls(): number {
    return this.#toolCalls;
  }

  /** What the attempt has committed: finished calls at cost, calls in flight at their maximum. */
  get committedUsdMicros(): bigint {
    let sum = 0n;
    for (const r of this.#records) sum += r.costUsdMicros;
    return sum + BigInt(this.#inFlight.size) * this.perCallMaxUsdMicros;
  }

  /**
   * Whether one more call of the attempt's tier may start at `now`, and its
   * timeout: min(the tier's timeout, the time left − 5 s). Refused once five
   * calls have been made, when the call's maximum would pass the remaining
   * reservation (L6) or the turn ceiling (L6, L18), when fewer than 8 s
   * (fast) or 20 s (deep) are left (L5), or once the reservation has settled.
   */
  canCall(now: number): { ok: true; timeoutMs: number } | { ok: false; reason: BudgetRefusal } {
    if (!isLiveReservation(this.#reservation)) return { ok: false, reason: 'reservation_closed' };
    if (this.#modelCalls >= LIMITS.modelCallsPerAttempt)
      return { ok: false, reason: 'calls_exhausted' };
    const next = this.committedUsdMicros + this.perCallMaxUsdMicros;
    if (next > this.reservedUsdMicros) return { ok: false, reason: 'reservation_exhausted' };
    if (this.turnSettledUsdMicros + next > LIMITS.turnCeilingUsdMicros)
      return { ok: false, reason: 'turn_ceiling' };
    const left = this.deadline - now;
    const tier = TIERS[this.tier];
    if (left < tier.minStartMs) return { ok: false, reason: 'too_little_time' };
    return { ok: true, timeoutMs: Math.min(tier.callTimeoutMs, left - LIMITS.callTimeoutMarginMs) };
  }

  /** Starts a call: checks canCall, counts it, and commits its maximum until it ends. */
  beginCall(now: number): { ticket: Ticket; timeoutMs: number } {
    const check = this.canCall(now);
    if (!check.ok) throw new BudgetExhausted(check.reason);
    const ticket: Ticket = { id: this.#next++, startedAt: now, done: false };
    this.#modelCalls += 1;
    this.#inFlight.set(ticket.id, ticket);
    return { ticket, timeoutMs: check.timeoutMs };
  }

  /**
   * Ends a call. `usage` null means unknown (charged at the per-call
   * maximum, L16). `notSent`: HOME refused the request before any byte left
   * (a destination, size or address refusal), so it is no provider call: it
   * is not recorded and costs nothing, though it still counted as a call.
   */
  endCall(
    ticket: Ticket,
    outcome: {
      model: string;
      usage: CallUsage | null;
      ms: number;
      stop: CallRecord['stop'];
      errorCode?: ProviderErrorCode | null;
      notSent?: boolean;
    },
  ): CallRecord | null {
    if (ticket.done || !this.#inFlight.has(ticket.id)) throw new Error('call already ended');
    ticket.done = true;
    this.#inFlight.delete(ticket.id);
    if (outcome.notSent) return null;
    const prices = TIERS[this.tier].model.prices;
    const record: CallRecord = Object.freeze({
      tier: this.tier,
      model: outcome.model,
      usage: outcome.usage,
      costUsdMicros: outcome.usage
        ? costUsdMicros(outcome.usage, prices, GEO_MULTIPLIER)
        : this.perCallMaxUsdMicros,
      ms: Math.max(0, Math.round(outcome.ms)),
      stop: outcome.stop,
      errorCode: outcome.errorCode ?? null,
    });
    this.#records.push(record);
    return record;
  }

  /** Every call of the attempt so far, for settlement. A call still in flight is not here. */
  get calls(): readonly CallRecord[] {
    return [...this.#records];
  }

  /** Calls in flight (settlement in a `finally` charges each at the per-call maximum). */
  get callsInFlight(): number {
    return this.#inFlight.size;
  }

  /** Whether another tool round may run (L2): at most three per attempt. */
  canToolRound(): boolean {
    return this.#toolRounds < LIMITS.toolRoundsPerAttempt;
  }

  /**
   * Records a tool round of `requested` calls and returns how many may run
   * (L3): at most eight tool calls per attempt, parallel calls counting each;
   * the rest are refused with a budget code by the caller.
   */
  takeToolRound(requested: number): number {
    if (!Number.isSafeInteger(requested) || requested < 0) throw new RangeError('requested');
    if (!this.canToolRound()) return 0;
    this.#toolRounds += 1;
    const allowed = Math.min(requested, LIMITS.toolCallsPerAttempt - this.#toolCalls);
    this.#toolCalls += allowed;
    return allowed;
  }
}

/** A call the budget does not allow; the turn ends with the fallback (§13.4). */
export class BudgetExhausted extends Error {
  constructor(readonly reason: BudgetRefusal) {
    super(reason);
    this.name = 'BudgetExhausted';
  }
}
