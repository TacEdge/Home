import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDb } from './helpers';

// Synthetic calendars for the screen tests (M4 contract §6.1, §8.5). Feeds
// are files the dev server reads instead of fetching (HOME_TEST_CALENDAR_FEEDS,
// src/integrations/calendar/test-feeds.ts): one per secret-address token.
// Nothing here is a real calendar, address or credential.

export const FEED_DIR = join(tmpdir(), 'home-test-calendar-feeds');

/** A synthetic Google-shaped secret address for a token (16–128 alphanumerics). */
export const addressFor = (token: string) =>
  `https://calendar.google.com/calendar/ical/synthetic.family%40example.test/private-${token}/basic.ics`;

export function writeFeed(token: string, ics: string): void {
  mkdirSync(FEED_DIR, { recursive: true });
  writeFileSync(join(FEED_DIR, `${token}.ics`), ics);
}
/** The fetch for this token fails with a safe-fetch code until cleared. */
export function failFeed(token: string, code: string | null): void {
  mkdirSync(FEED_DIR, { recursive: true });
  const file = join(FEED_DIR, `${token}.status`);
  if (code === null) rmSync(file, { force: true });
  else writeFileSync(file, code);
}
/** Fetches for this token wait while held. */
export function holdFeed(token: string, held: boolean): void {
  mkdirSync(FEED_DIR, { recursive: true });
  const file = join(FEED_DIR, `${token}.hold`);
  if (held) writeFileSync(file, '');
  else rmSync(file, { force: true });
}

const SEALED = `hc1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`;

/**
 * A calendar written straight into the database for sweeps that only read
 * the screens: a sealed-looking credential that opens nothing, so Refresh
 * reads as "can't read this calendar's address" and never fetches.
 */
export async function seedCalendar(opts: {
  owner: 'fixture-sam' | 'fixture-alex';
  name: string;
  visibility: 'household' | 'private';
  disconnected?: boolean;
  fingerprintTag: string;
}): Promise<string> {
  return withDb(async (pool) => {
    const existing = await pool.query(`select id from calendar_source where name = $1`, [
      opts.name,
    ]);
    if (existing.rows[0]) return existing.rows[0].id as string;
    const fp = `fp2.${opts.fingerprintTag.padEnd(43, 'x')}`;
    const conn = opts.disconnected
      ? await pool.query(
          `insert into calendar_connection (owner_user_id, provider, status, disconnected_at, address_fingerprint)
           values ($1, 'ics', 'disconnected', now(), $2) returning id`,
          [opts.owner, fp],
        )
      : await pool.query(
          `insert into calendar_connection (owner_user_id, provider, credentials_encrypted, credentials_key_id, address_fingerprint)
           values ($1, 'ics', $2, '0123456789abcdef', $3) returning id`,
          [opts.owner, SEALED, fp],
        );
    const src = await pool.query(
      `insert into calendar_source (created_by, created_via, visibility, connection_id, external_calendar_id, name, archived_at, last_attempt_at, last_synced_at, last_sync_status)
       values ($1, 'ui', $2, $3, 'primary', $4, $5, now(), now(), 'ok') returning id`,
      [
        opts.owner,
        opts.visibility,
        conn.rows[0].id,
        opts.name,
        opts.disconnected ? new Date() : null,
      ],
    );
    return src.rows[0].id as string;
  });
}

/**
 * A synced event written straight into the database for the sweeps (M4
 * Package 6): one of a seeded calendar's mirrored events, as the sync would
 * have written it, so the agenda and event pages have a synced row to show
 * without any feed. Synthetic throughout; idempotent by its UID.
 */
export async function seedSyncedEvent(opts: {
  calendarId: string;
  owner: 'fixture-sam' | 'fixture-alex';
  visibility: 'household' | 'private';
  uid: string;
  title: string;
  /** An all-day event on this date (one day), or a timed one at these instants. */
  date?: string;
  startsAt?: string;
  endsAt?: string;
  kind?: string;
  archived?: boolean;
}): Promise<string> {
  return withDb(async (pool) => {
    const existing = await pool.query(
      `select id from event where calendar_source_id = $1 and external_uid = $2 and recurrence_original is null`,
      [opts.calendarId, opts.uid],
    );
    if (existing.rows[0]) return existing.rows[0].id as string;
    const allDay = opts.date !== undefined;
    const row = await pool.query(
      `insert into event (created_by, created_via, visibility, title, kind, source, calendar_source_id, external_uid,
         all_day, start_date, end_date, starts_at, ends_at, time_zone, archived_at)
       values ($1, 'sync', $2, $3, $4, 'synced', $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [
        opts.owner,
        opts.visibility,
        opts.title,
        opts.kind ?? 'activity',
        opts.calendarId,
        opts.uid,
        allDay,
        allDay ? opts.date : null,
        allDay ? nextDay(opts.date!) : null,
        allDay ? null : opts.startsAt,
        allDay ? null : opts.endsAt,
        allDay ? null : 'Pacific/Auckland',
        opts.archived ? new Date() : null,
      ],
    );
    return row.rows[0].id as string;
  });
}

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
