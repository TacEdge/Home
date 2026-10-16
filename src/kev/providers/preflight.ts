import 'server-only';
import { ProviderError, type ProviderErrorCode } from './types';

// The preflight token count (G22; owner decision, 2026-10-15; contract
// §2.2, §5.4, §13.4): shared by the Anthropic adapter and the scripted
// provider, so both stop a call the same way. Before every model call the
// complete input is counted for the same model and configuration; a count
// above 32,000 tokens refuses the call, and any failure to count fails
// closed. No model call is made in either case, and nothing is charged.
//
// What the count is, and is not (the provider's token-counting page, read
// 2026-10-15): "The token count is an estimate. In some cases, the actual
// number of input tokens used when creating a message might differ by a
// small amount", and it "may include tokens added automatically by
// Anthropic for system optimizations", which are not billed. So it is a
// preflight, not an authoritative bound: the provider's own input count at
// `message_start` (ADR 0012 §43, I4) stays the backstop that ends a call
// over the cap, charged conservatively (I2).

/** A count the provider returned: a non-negative safe integer `input_tokens`, or null (malformed). */
export function validCount(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const n = (raw as { input_tokens?: unknown }).input_tokens;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** The closed error a preflight stop raises: no key, header, body or count text. */
export function preflightError(
  code: ProviderErrorCode,
  attemptId: string,
  ms: number,
  preflight: 'failed' | 'over_cap',
): ProviderError {
  return new ProviderError(code, {
    attemptId,
    ms: Math.max(0, Math.round(ms)),
    partialUsage: null,
    retried: false,
    preflight,
  });
}
