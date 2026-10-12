import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { weatherForecast, type WeatherAttemptStatus } from '@/db/schema';
import { weatherConfig } from '@/lib/env';
import { log } from '@/lib/log';
import type { UserActor } from '@/trust/actor';
import { forecastAge } from '../engines/weather';
import { NotPermittedError } from '../common/errors';
import { assertCanWrite, assertFamilyWritesOpen } from '../common/guards';
import { auditedWrite, type DomainAudit, type Deps } from '../common/write';
import {
  WEATHER_FAILURE_CODES,
  WeatherProviderError,
  fromStoredHour,
  storedHoursSchema,
  toStoredHour,
  wellFormedHours,
  type ForecastHour,
  type WeatherFailureCode,
  type WeatherProvider,
} from './provider';
import { RETENTION_HOURS, locationMismatch, refreshDue } from './rules';

// The forecast service (M7 contract §3.5, §5.1; ADR 0011 §14–§16). One
// household-level row, `weather_forecast`, read by any adult as themselves
// and refreshed on use.
//
// Reading: one query, never the network. The configured location is
// recognised by its keyed fingerprint (computed in env.ts); a row for any
// other location, elevation or key is no forecast at all.
//
// Refreshing, request-bound and in exactly this order (contract §5.1):
//   1. the gate, then the actor, then the configuration, before any query;
//   2. outside any transaction, read the row: not due is `not_due`;
//   3. one transaction: statement_timeout 5 s, idle_in_transaction_session_
//      timeout 25 s, then pg_try_advisory_xact_lock on home:weather_forecast
//      (not acquired: `busy`, nothing written); due again, inside the lock;
//   4. the provider fetch, inside that transaction, so the lock covers it;
//   5. the row and its one audit row, written after the fetch, then commit.
// Nothing is written before the fetch, so a request stopped at any point
// before commit leaves nothing behind, and the transaction-level lock goes
// with the transaction.
//
// Errors are codes: the provider's closed set, or `unexpected` (a rolled-back
// transaction), which is logged and never stored. No coordinate, request
// URL, key, canonical string or fingerprint is logged, returned or audited.

const PROVIDER = 'open_meteo';
const LOCK_KEY = 'home:weather_forecast';
const HOUR_MS = 3_600_000;

export type ForecastFreshness = 'fresh' | 'older' | 'unusable' | 'none';

export type ForecastRead =
  /** No location, or no valid location key: nothing read, no words, no refresh. */
  | { configured: false }
  | {
      configured: true;
      freshness: ForecastFreshness;
      /** The stored hours, only when they are this location's and usable (fresh or older). */
      hours: ForecastHour[];
      /** The stored hours' span, `[from, to)`, when they are this location's. */
      span: { from: Date; to: Date } | null;
      /** The last successful fetch for this location; null when there is none. */
      fetchedAt: Date | null;
      lastAttempt: { at: Date; status: WeatherAttemptStatus } | null;
      /** Whether the page should ask for a refresh after render (the service decides again). */
      refreshDue: boolean;
    };

const rowColumns = {
  id: weatherForecast.id,
  fetchedAt: weatherForecast.fetchedAt,
  hours: weatherForecast.hours,
  locationFingerprint: weatherForecast.locationFingerprint,
  firstHour: weatherForecast.firstHour,
  lastHour: weatherForecast.lastHour,
  lastAttemptAt: weatherForecast.lastAttemptAt,
  lastAttemptStatus: weatherForecast.lastAttemptStatus,
};

type Row = {
  id: string;
  fetchedAt: Date | null;
  hours: unknown;
  locationFingerprint: string | null;
  firstHour: Date | null;
  lastHour: Date | null;
  lastAttemptAt: Date | null;
  lastAttemptStatus: string | null;
};

async function readRow(db: DbOrTx): Promise<Row | null> {
  const [row] = await db
    .select(rowColumns)
    .from(weatherForecast)
    .where(eq(weatherForecast.provider, PROVIDER))
    .limit(1);
  return row ?? null;
}

const assertActor = (actor: UserActor) => {
  if ((actor as { kind?: string } | null)?.kind !== 'user')
    throw new NotPermittedError('not_a_user');
};

/**
 * The household's forecast, as this adult reads it (contract §5.1): one
 * query, no network, no write. `none` when there is no row or it is for
 * another location; `unusable` when it is this location's but over 12 hours
 * old or its hours were cleared; otherwise `fresh` or `older` with the hours.
 */
export async function readForecast(
  actor: UserActor,
  opts: { now?: Date } = {},
  deps: Deps = {},
): Promise<ForecastRead> {
  assertActor(actor);
  const config = weatherConfig();
  if (config.status !== 'set') return { configured: false };
  const now = opts.now ?? new Date();
  const row = await readRow(deps.db ?? getDb());
  const lastAttempt =
    row?.lastAttemptAt && row.lastAttemptStatus
      ? { at: row.lastAttemptAt, status: row.lastAttemptStatus as WeatherAttemptStatus }
      : null;
  const due = refreshDue(row, config.fingerprint, now);
  const none = {
    configured: true as const,
    freshness: 'none' as const,
    hours: [],
    span: null,
    fetchedAt: null,
    lastAttempt,
    refreshDue: due,
  };
  // Another location's (or another key's) row, or no forecast at all.
  if (!row || row.locationFingerprint !== config.fingerprint || !row.fetchedAt) return none;
  const parsed = row.hours === null ? null : storedHoursSchema.safeParse(row.hours);
  const hours = parsed?.success ? parsed.data.map(fromStoredHour) : null;
  const age = forecastAge(row.fetchedAt, now);
  if (!hours || age === 'unusable')
    return { ...none, freshness: 'unusable', fetchedAt: row.fetchedAt };
  return {
    ...none,
    freshness: age,
    hours,
    span: {
      from: hours[0]!.start,
      to: new Date(hours.at(-1)!.start.getTime() + HOUR_MS),
    },
    fetchedAt: row.fetchedAt,
  };
}

export type RefreshStatus = 'ok' | WeatherFailureCode | 'busy' | 'not_due' | 'not_configured';
export type WeatherRefreshOutcome = { status: RefreshStatus; changed: boolean };

/** An unforeseen failure: the transaction rolled back. No message, cause or parameters. */
export class WeatherUnexpectedError extends Error {
  constructor() {
    super('weather_unexpected');
    this.name = 'WeatherUnexpectedError';
  }
}

const isFailureCode = (code: unknown): code is WeatherFailureCode =>
  (WEATHER_FAILURE_CODES as readonly unknown[]).includes(code);

/**
 * Refresh the forecast if it is due (contract §5.1), as the adult whose
 * visit asked. Gated; never Kev; single-flight across servers; every write
 * after the fetch, in one transaction with its one audit row. Returns the
 * outcome and whether anything a page shows may have changed. Throws
 * NotPermittedError for the gate or the actor, and WeatherUnexpectedError
 * (after logging `unexpected`) for anything else; nothing else escapes.
 */
export async function refreshForecast(
  actor: UserActor,
  provider: WeatherProvider,
  opts: { now?: Date } = {},
  deps: Deps = {},
): Promise<WeatherRefreshOutcome> {
  assertFamilyWritesOpen();
  assertActor(actor);
  assertCanWrite(actor);
  const config = weatherConfig();
  if (config.status !== 'set') return { status: 'not_configured', changed: false };
  const now = opts.now ?? new Date();
  let outcome: WeatherRefreshOutcome;
  try {
    const db = deps.db ?? getDb();
    if (!refreshDue(await readRow(db), config.fingerprint, now))
      return { status: 'not_due', changed: false };
    outcome = await auditedWrite<WeatherRefreshOutcome>(actor, { db }, async (tx) => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      await tx.execute(sql`set local idle_in_transaction_session_timeout = '25s'`);
      const lock = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) as ok`,
      );
      if (lock.rows[0]?.ok !== true)
        return { result: { status: 'busy', changed: false }, audit: null };
      const row = await readRow(tx);
      if (!refreshDue(row, config.fingerprint, now))
        return { result: { status: 'not_due', changed: false }, audit: null };

      // The fetch: inside the transaction and the lock, before any write.
      let hours: ForecastHour[] | null = null;
      let failure: WeatherFailureCode | null = null;
      try {
        hours = await provider.fetchForecast(config.point);
        if (!wellFormedHours(hours)) {
          hours = null;
          failure = 'bad_response';
        }
      } catch (e) {
        if (!(e instanceof WeatherProviderError) || !isFailureCode(e.code)) throw e;
        failure = e.code;
      }

      const attempt = {
        lastAttemptAt: now,
        lastAttemptStatus: (failure ?? 'ok') as WeatherAttemptStatus,
        updatedAt: now,
      };
      let values: Partial<typeof weatherForecast.$inferInsert>;
      let changed: boolean;
      if (hours) {
        values = {
          ...attempt,
          hours: hours.map(toStoredHour),
          locationFingerprint: config.fingerprint,
          fetchedAt: now,
          firstHour: hours[0]!.start,
          lastHour: hours.at(-1)!.start,
        };
        changed = true;
      } else if (locationMismatch(row, config.fingerprint)) {
        // The first attempt after a location (or key) change clears the old
        // forecast, whatever its outcome.
        values = {
          ...attempt,
          hours: null,
          locationFingerprint: null,
          fetchedAt: null,
          firstHour: null,
          lastHour: null,
        };
        // The old hours were never shown (a mismatch reads as no forecast).
        changed = false;
      } else if (
        row?.fetchedAt &&
        row.hours !== null &&
        now.getTime() - row.fetchedAt.getTime() > RETENTION_HOURS * HOUR_MS
      ) {
        // Retention: a failure once the last success is over 24 hours old
        // clears the hours; the fetch time (and its location) stay, for the
        // stale line.
        values = { ...attempt, hours: null, firstHour: null, lastHour: null };
        changed = true;
      } else {
        // Any other failure keeps the last good forecast.
        values = attempt;
        changed = false;
      }
      const [written] = await tx
        .insert(weatherForecast)
        .values({ provider: PROVIDER, ...values })
        .onConflictDoUpdate({ target: weatherForecast.provider, set: values })
        .returning({ id: weatherForecast.id });
      if (!written) throw new Error('weather: upsert returned no row');
      const audit: DomainAudit = {
        event: 'weather.refresh',
        subjectType: 'weather_forecast',
        subjectId: written.id,
        meta: { status: failure ?? 'ok', hours: hours?.length ?? 0 },
        // Visible only to the adult whose visit triggered it (D4): a household
        // row would tell one adult when the other opened HOME.
        record: { visibility: 'private', createdBy: actor.userId },
      };
      return { result: { status: failure ?? 'ok', changed }, audit };
    });
  } catch {
    // Unforeseen: the transaction has rolled back and nothing was recorded.
    // Only the fixed code is logged; the error itself goes nowhere.
    log.error('weather_refresh_failed', { code: 'unexpected' });
    throw new WeatherUnexpectedError();
  }
  if (isFailureCode(outcome.status)) log.warn('weather_refresh_failed', { code: outcome.status });
  return outcome;
}
