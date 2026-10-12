// When a forecast refresh is due (M7 contract §5.1; ADR 0011 §15). Pure, so
// the page (on the server, before render) and the refresh service (outside
// and again inside its lock) decide from the same rules and the same row.

/** At most one attempt per this many minutes, measured from the last attempt. */
export const REFRESH_INTERVAL_MINUTES = 60;
/** After a `rate_limited` attempt, the next waits this many hours, whatever else. */
export const RATE_LIMITED_WAIT_HOURS = 3;
/** A failed attempt clears the hours once the last success is more than this old. */
export const RETENTION_HOURS = 24;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** The parts of the stored row these rules read. */
export type AttemptState = {
  locationFingerprint: string | null;
  lastAttemptAt: Date | null;
  lastAttemptStatus: string | null;
};

/**
 * Whether the row's hours are for another location (or key): it carries a
 * fingerprint that is not the configured one. A null fingerprint is not a
 * mismatch: it carries no hours (the table's CHECK) and no location.
 */
export function locationMismatch(row: AttemptState | null, configured: string): boolean {
  return row !== null && row.locationFingerprint !== null && row.locationFingerprint !== configured;
}

/**
 * Due when there has been no attempt; never within 3 hours of a
 * `rate_limited` one; at once on a location mismatch; otherwise once the last
 * attempt is at least 60 minutes old.
 */
export function refreshDue(row: AttemptState | null, configured: string, now: Date): boolean {
  if (!row || !row.lastAttemptAt) return true;
  const since = now.getTime() - row.lastAttemptAt.getTime();
  if (row.lastAttemptStatus === 'rate_limited' && since < RATE_LIMITED_WAIT_HOURS * HOUR_MS)
    return false;
  if (locationMismatch(row, configured)) return true;
  return since >= REFRESH_INTERVAL_MINUTES * MINUTE_MS;
}
