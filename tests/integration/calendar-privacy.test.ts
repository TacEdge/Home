import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getCalendar,
  listCalendars,
  connectCalendar,
  disconnectCalendar,
  reconnectCalendar,
  updateCalendar,
} from '@/domain/calendar/service';
import { refreshCalendar, refreshStaleCalendars } from '@/domain/calendar/sync';
import type { NotPermittedError } from '@/domain/common/errors';
import { NotFoundError } from '@/domain/common/errors';
import { getEvent, listEvents } from '@/domain/events/service';
import { exportFor } from '@/domain/export/service';
import { env } from '@/lib/env';
import { fakeProvider } from '@/integrations/calendar/fake';
import type { UserActor } from '@/trust/actor';
import { listAudit } from '@/trust/audit';
import { SYNTHETIC_ADDRESS } from '../fixtures/calendars/google';
import { SEQUENCES, TODAY } from '../fixtures/calendars/sequences';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// The two-adult privacy sweep for calendars (M4 contract §4.1, §4.6, §8.4,
// §10 items 5–6, 10; ADR 0007 §8, §37). Each adult connects a private and a
// household calendar of synthetic events. Then, as each adult:
//   - the other adult's private calendar, its events, its Activity and its
//     connection are nowhere: not in a read, not in Activity, not in export;
//   - household calendars and their events follow the household rules;
//   - connection metadata is the owner's alone;
//   - no address, sealed credential, key id or fingerprint reaches a read,
//     Activity, the export, a log line or an error;
//   - while the real-data gate is closed in Production, every calendar
//     write is refused and reads stay safe.

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
let h: Household;
type Adult = 'sam' | 'alex';
const ADULTS: Adult[] = ['sam', 'alex'];
const OTHER: Record<Adult, Adult> = { sam: 'alex', alex: 'sam' };
const actor = (a: Adult): UserActor => h[a];

const address = (tag: string) =>
  SYNTHETIC_ADDRESS.replace(
    'private-0123456789abcdef0123456789abcdef',
    `private-${tag.padEnd(32, '0')}`,
  );
const ADDRESSES: Record<Adult, { private: string; household: string }> = {
  sam: { private: address('5a5a1'), household: address('5a5a2') },
  alex: { private: address('a1e11'), household: address('a1e12') },
};
const cal: Record<Adult, { private: string; household: string }> = {
  sam: { private: '', household: '' },
  alex: { private: '', household: '' },
};
const provider = () =>
  fakeProvider([{ ics: SEQUENCES.initial[0] }], { homeTimeZone: 'Pacific/Auckland' });

// Everything secret about every connection, collected after connecting.
const secrets: string[] = [];
const logged: string[] = [];

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  // Capture every console line and stdout/stderr write while calendars work.
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const)
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  // HOME's logger (src/lib/log.ts) writes JSON lines to stdout and stderr.
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      logged.push(String(chunk));
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write);
  }
  for (const a of ADULTS) {
    const p = await connectCalendar(
      actor(a),
      { address: ADDRESSES[a].private, name: `${a} private`, visibility: 'private' },
      deps,
    );
    const hh = await connectCalendar(
      actor(a),
      { address: ADDRESSES[a].household, name: `${a} household`, visibility: 'household' },
      deps,
    );
    cal[a] = { private: p.calendarId, household: hh.calendarId };
    for (const id of [p.calendarId, hh.calendarId])
      await refreshCalendar(actor(a), id, provider(), { today: TODAY }, deps);
  }
  const rows = (
    await admin.db.execute<{ c: string | null; k: string | null; f: string }>(
      sql`select credentials_encrypted as c, credentials_key_id as k, address_fingerprint as f from calendar_connection`,
    )
  ).rows;
  for (const r of rows) secrets.push(...[r.c, r.k, r.f].filter((x): x is string => !!x));
  for (const a of ADULTS) secrets.push(ADDRESSES[a].private, ADDRESSES[a].household);
  secrets.push('private-5a5a1', 'private-a1e11', 'calendar.google.com');
});
afterEach(() => {
  // A leak check runs over whatever was logged so far, by every test.
  const text = logged.join('\n');
  for (const s of secrets) expect(text, 'a log line carried a secret').not.toContain(s);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await clearDomainRows(db);
  await close();
  await admin.close();
});

const eventIdsOf = async (sourceId: string) =>
  (
    await admin.db.execute<{ id: string }>(
      sql`select id from event where calendar_source_id = ${sourceId}`,
    )
  ).rows.map((r) => r.id);
const connectionOf = async (sourceId: string) =>
  (
    await admin.db.execute<{ id: string }>(
      sql`select connection_id as id from calendar_source where id = ${sourceId}`,
    )
  ).rows[0]!.id;
const noSecrets = (label: string, value: unknown) => {
  const text = JSON.stringify(value);
  for (const s of secrets) expect(text, `${label} carried a secret`).not.toContain(s);
  expect(text, label).not.toMatch(
    /"(credentialsEncrypted|credentialsKeyId|addressFingerprint|feedHash|connectionId)"/,
  );
};

describe.each(ADULTS)('as %s', (a) => {
  const other = () => OTHER[a];

  it('reads: the other adult’s private calendar and its events are nowhere', async () => {
    const mine = await listCalendars(actor(a), {}, deps);
    const ids = mine.map((c) => c.id).sort();
    expect(ids).toEqual([cal[a].private, cal[a].household, cal[other()].household].sort());
    noSecrets('listCalendars', mine);
    await expect(getCalendar(actor(a), cal[other()].private, {}, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const theirs = await eventIdsOf(cal[other()].private);
    expect(theirs.length).toBe(5);
    for (const id of theirs)
      await expect(getEvent(actor(a), id, { includeArchived: true }, deps)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    const visible = new Set(
      (await listEvents(actor(a), { includeArchived: true }, deps)).map((e) => e.id),
    );
    for (const id of theirs) expect(visible.has(id)).toBe(false);
    for (const id of [
      ...(await eventIdsOf(cal[a].private)),
      ...(await eventIdsOf(cal[a].household)),
      ...(await eventIdsOf(cal[other()].household)),
    ])
      expect(visible.has(id), 'own and household synced events are visible').toBe(true);
  });

  it('connection metadata is the owner’s alone', async () => {
    expect((await getCalendar(actor(a), cal[a].household, {}, deps)).connection?.status).toBe(
      'active',
    );
    const theirs = await getCalendar(actor(a), cal[other()].household, {}, deps);
    expect(theirs.connection).toBeNull();
    expect(theirs.isOwner).toBe(false);
  });

  it('Activity: nothing about the other adult’s private calendar or either of their connections', async () => {
    const rows = (await listAudit(actor(a), { limit: 200 }, deps)).rows;
    const forbidden = new Set([
      cal[other()].private,
      await connectionOf(cal[other()].private),
      await connectionOf(cal[other()].household),
      ...(await eventIdsOf(cal[other()].private)),
    ]);
    for (const r of rows) expect(forbidden.has(r.subjectId ?? ''), r.event).toBe(false);
    // The household calendar's refreshes are shared.
    expect(
      rows.some((r) => r.event === 'calendar.sync' && r.subjectId === cal[other()].household),
    ).toBe(true);
    noSecrets('Activity', rows);
  });

  it('export: only what this adult may see, and never a secret', async () => {
    const e = await exportFor(actor(a), {}, deps);
    const ids = e.records.calendars.map((c) => c.id).sort();
    expect(ids).toEqual([cal[a].private, cal[a].household, cal[other()].household].sort());
    const events = new Set(e.records.events.map((x) => x.id));
    for (const id of await eventIdsOf(cal[other()].private)) expect(events.has(id)).toBe(false);
    for (const id of await eventIdsOf(cal[a].private)) expect(events.has(id)).toBe(true);
    noSecrets('export', e);
  });

  it('refusals are fixed codes: an error never carries the address', async () => {
    const errs: unknown[] = [];
    errs.push(
      await connectCalendar(
        actor(a),
        { address: ADDRESSES[a].household, name: 'again' },
        deps,
      ).catch((x: unknown) => x),
      await connectCalendar(
        actor(a),
        { address: `${ADDRESSES[a].household}x`, name: 'bad' },
        deps,
      ).catch((x: unknown) => x),
      await updateCalendar(actor(a), cal[other()].household, { name: 'x' }, deps).catch(
        (x: unknown) => x,
      ),
    );
    expect(errs.map((e) => (e as NotPermittedError).code)).toEqual([
      'calendar_already_connected',
      'address_not_accepted',
      'not_owner',
    ]);
    for (const e of errs) {
      const text = `${String(e)} ${(e as Error).stack ?? ''} ${JSON.stringify(e)}`;
      for (const s of secrets) expect(text).not.toContain(s);
    }
  });
});

describe('the real-data gate in Production', () => {
  const saved = { VERCEL_ENV: process.env.VERCEL_ENV, HOME_REAL_DATA: process.env.HOME_REAL_DATA };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  it('refuses connect, reconnect, change, disconnect and refresh; nothing is written; reads stay safe', async () => {
    const count = async () =>
      (
        await admin.db.execute<{ a: number; c: number; e: number }>(
          sql`select (select count(*)::int from audit_log) as a,
                     (select count(*)::int from calendar_connection) as c,
                     (select count(*)::int from event) as e`,
        )
      ).rows[0];
    // A disconnected calendar to try reconnecting.
    const gone = await connectCalendar(h.sam, { address: address('d15c0'), name: 'gone' }, deps);
    await disconnectCalendar(h.sam, gone.calendarId, deps);
    const before = await count();
    void env.HOME_TIMEZONE;
    process.env.VERCEL_ENV = 'production';
    delete process.env.HOME_REAL_DATA;
    const p = provider();
    try {
      const code = async (op: Promise<unknown>) =>
        (
          (await op.then(
            () => null,
            (e: unknown) => e,
          )) as NotPermittedError
        )?.code;
      expect(
        await code(connectCalendar(h.sam, { address: address('9a7e0'), name: 'new' }, deps)),
      ).toBe('real_data_closed');
      expect(
        await code(reconnectCalendar(h.sam, gone.calendarId, { address: address('d15c0') }, deps)),
      ).toBe('real_data_closed');
      expect(await code(updateCalendar(h.sam, cal.sam.household, { name: 'x' }, deps))).toBe(
        'real_data_closed',
      );
      expect(await code(disconnectCalendar(h.sam, cal.sam.household, deps))).toBe(
        'real_data_closed',
      );
      expect(await code(refreshCalendar(h.sam, cal.sam.household, p, { today: TODAY }, deps))).toBe(
        'real_data_closed',
      );
      expect(await code(refreshStaleCalendars(h.alex, p, { today: TODAY }, deps))).toBe(
        'real_data_closed',
      );
      expect(p.calls, 'no calendar was fetched').toBe(0);
      // Reads stay safe and work.
      expect((await listCalendars(h.sam, {}, deps)).length).toBeGreaterThan(0);
      expect((await getCalendar(h.alex, cal.sam.household, {}, deps)).connection).toBeNull();
    } finally {
      restore();
    }
    expect(await count()).toEqual(before);
  });
});
