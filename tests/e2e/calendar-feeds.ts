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
