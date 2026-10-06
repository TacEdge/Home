import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The calendar credential stays below the domain layer (M4 contract §4.1,
// ADR 0007 §33): the runtime role can read calendar_connection, so what keeps
// the sealed address, its key id and its fingerprint away from screens,
// exports, logs and Kev is that only the calendar domain module may touch
// that table or name those columns. A generic read cannot pick them up by
// selecting every column, because no other code can name the table at all.

const ALLOWED = [
  'src/db/schema/calendar.ts', // the definition
  'src/db/schema/index.ts', // re-exports it
  'src/domain/export/spec.ts', // names the secret columns to keep them out of the export
  'src/trust/credentials.ts', // seals, opens and fingerprints (Package 2); reads no table
];
const ALLOWED_DIR = 'src/domain/calendar/'; // the calendar service (Package 4b)
const TOUCHES =
  /\bcalendarConnection\b|calendar_connection|credentials_?encrypted|credentialsEncrypted|credentials_?key_?id|credentialsKeyId|address_?fingerprint|addressFingerprint/i;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('calendar credentials are reachable only through the calendar domain module', () => {
  it('no other source file names the connection table or its credential columns', () => {
    const offenders = walk('src')
      .filter((f) => /\.(ts|tsx|mts|js)$/.test(f))
      .filter((f) => !ALLOWED.includes(f) && !f.startsWith(ALLOWED_DIR))
      .filter((f) => TOUCHES.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the check finds a stray reference', () => {
    expect(TOUCHES.test('db.select().from(calendarConnection)')).toBe(true);
    expect(TOUCHES.test('sql`select credentials_encrypted from x`')).toBe(true);
    expect(TOUCHES.test('const c = { addressFingerprint }')).toBe(true);
    expect(TOUCHES.test('calendarSource.name')).toBe(false);
  });
});
