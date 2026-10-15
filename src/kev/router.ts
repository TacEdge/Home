import 'server-only';
import type { KevTier } from '@/domain/kev-bookkeeping/schema';
import {
  attemptReservationUsdMicros,
  capState,
  monthlyCapUsdMicros,
  perCallMaxUsdMicros,
  type CapState,
} from '@/trust/usage';
import { DEFAULT_MONTHLY_CAP_NZD, GEO_MULTIPLIER, LIMITS, NZD_PER_USD, TIERS } from './config';

// Routing (M8 contract §4.2, §5.3; KEV-AGENT-MODEL §5; ADR 0012 §11, §35).
// Code asks for a tier, never a model. Pure decisions only: the turn that
// uses them is Package 3's. In M8 every turn starts on `fast`; `deep` runs
// only by escalation (the model's `escalate`, or the validator failing twice
// on fast), once per turn, with at least 30 seconds left and the month
// under 80% of the cap. An escalated attempt reserves afresh, bounded by the
// turn's US$1.50 ceiling less what the fast attempt settled (L18).

/** M8 has one intent, `chat`, and it starts on the fast tier. */
export function initialTier(intent: 'chat' = 'chat'): KevTier {
  void intent;
  return 'fast';
}

/** One call's maximum permitted exposure on a tier (contract §13.6). */
export function perCallMax(tier: KevTier): bigint {
  const t = TIERS[tier];
  return perCallMaxUsdMicros(
    t.model.prices,
    t.maxTokens,
    LIMITS.inputTokensPerCall,
    GEO_MULTIPLIER,
  );
}

/** An attempt's reservation on a tier, given what the turn has already settled (§13.6, L18). */
export function attemptReservation(tier: KevTier, turnSettledUsdMicros = 0n): bigint {
  return attemptReservationUsdMicros({
    perCallMax: perCallMax(tier),
    calls: LIMITS.modelCallsPerAttempt,
    turnCeiling: LIMITS.turnCeilingUsdMicros,
    turnSettled: turnSettledUsdMicros,
  });
}

/** The household's monthly cap in µ$ from the validated setting (unset: NZ$100). */
export function monthlyCap(capNzd: number | undefined): bigint {
  return monthlyCapUsdMicros(capNzd ?? DEFAULT_MONTHLY_CAP_NZD, NZD_PER_USD);
}

/** Where the month stands, given what the cap counts (settled plus counted reservations). */
export function monthState(countedUsdMicros: bigint, capUsdMicros: bigint): CapState {
  return capState({
    counted: countedUsdMicros,
    cap: capUsdMicros,
    nextFastReservation: attemptReservation('fast'),
    deepWithdrawnAtPercent: LIMITS.deepWithdrawnAtPercent,
  });
}

/**
 * Whether an attempt on this tier offers the model `escalate` (§6.2, L7): on
 * fast only, and only while the month is under 80%. Decided when the attempt
 * starts, so the tool list never changes within it (§4.2).
 */
export function offersEscalate(tier: KevTier, month: CapState): boolean {
  return tier === 'fast' && month === 'open';
}

/**
 * Whether a fast attempt that asked to escalate (or failed the validator
 * twice) may re-run the turn on deep (§4.2, N11): once per turn, with at
 * least 30 seconds left, the month under 80%.
 */
export function mayEscalate(input: {
  tier: KevTier;
  escalationsSoFar: number;
  remainingMs: number;
  month: CapState;
}): boolean {
  return (
    input.tier === 'fast' &&
    input.escalationsSoFar < LIMITS.escalationsPerTurn &&
    input.remainingMs >= LIMITS.escalateMinRemainingMs &&
    input.month === 'open'
  );
}
