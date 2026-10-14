// Constants the bookkeeping path enforces in SQL (M8 contract §7.2, §9.6,
// §13.6). Pure; src/kev/config.ts re-exports the ones it lists as limits.

/**
 * An `open` reservation older than this is marked `unreconciled` by the next
 * reservation, and an `unreconciled` reservation created this long before a
 * month began still counts in that month (contract §13.6, "Which reservations
 * count"): the turn route's `maxDuration` (90 s) plus 30 seconds.
 */
export const RESERVATION_STALE_SECONDS = 120;

/** Each message expires this many days after its `created_at` (O6, contract §7.2). */
export const MESSAGE_RETENTION_DAYS = 90;

/** A person's message this recent with no Kev reply means a turn is in flight (contract §7.2). */
export const TURN_IN_FLIGHT_SECONDS = 70;

/** Per adult, counted from append-only audit rows (contract §9.6). */
export const TURNS_PER_MINUTE = 6;
export const TURNS_PER_DAY = 60;

/** The daily cleanup's bounds (contract §7.2): rows per statement, statements per run. */
export const PURGE_BATCH_ROWS = 1_000;
export const PURGE_MAX_BATCHES = 20;

/** The person's words, at most (contract §13.4). */
export const INPUT_TEXT_MAX_CHARS = 2_000;
