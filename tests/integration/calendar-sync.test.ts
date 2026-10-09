import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { calendarSource, event, eventPerson, note } from '@/db/schema';
import {
  connectCalendar,
  disconnectCalendar,
  reconnectCalendar,
  getCalendar,
  listCalendars,
  updateCalendar,
} from '@/domain/calendar/service';
import { CalendarCanReconnectError, CalendarUnexpectedError } from '@/domain/calendar/errors';
import { refreshCalendar } from '@/domain/calendar/sync';
import { auditedWrite } from '@/domain/common/write';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import { getEvent, listEventPeople, setEventPerson, updateEvent } from '@/domain/events/service';
import { createNote, listNotes } from '@/domain/notes/service';
import { archivePerson, createPerson, updatePerson } from '@/domain/people/service';
import { exportFor } from '@/domain/export/service';
import { fakeProvider, type FakeStep } from '@/integrations/calendar/fake';
import { listAudit } from '@/trust/audit';
import { SYNTHETIC_ADDRESS, googleFeed, nzEvent, vevent } from '../fixtures/calendars/google';
import { SEQUENCES, TODAY } from '../fixtures/calendars/sequences';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// M4 Package 4b sync scenarios (contract §3.3, §8.4; ADR 0007 §13, §36–37),
// as home_app, with the fake provider replaying synthetic Google-shaped
// feeds: no network, no real calendar, no real credential.

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
let h: Household;

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
  await admin.close();
});

let n = 0;
/** A fresh synthetic secret address per calendar, so fingerprints never collide by accident. */
const nextAddress = () =>
  SYNTHETIC_ADDRESS.replace(
    'private-0123456789abcdef0123456789abcdef',
    `private-${(++n).toString(16).padStart(8, '0')}${'ab'.repeat(12)}`,
  );
const provider = (feeds: readonly string[] | readonly FakeStep[]) =>
  fakeProvider(
    feeds.map((f) => (typeof f === 'string' ? { ics: f } : f)),
    { homeTimeZone: ZONE },
  );
const connect = async (
  actor = h.sam,
  extra: Partial<Parameters<typeof connectCalendar>[1]> = {},
  address = nextAddress(),
) => {
  const r = await connectCalendar(
    actor,
    { address, name: 'Family', visibility: 'household', ...extra },
    deps,
  );
  return { ...r, address };
};
const refresh = (id: string, p: ReturnType<typeof provider>, actor = h.sam) =>
  refreshCalendar(actor, id, p, { today: TODAY }, deps);

const countsOf = (o: Awaited<ReturnType<typeof refresh>>) => ('counts' in o ? o.counts : null);

type Row = typeof event.$inferSelect;
const rowsOf = async (sourceId: string): Promise<Row[]> =>
  admin.db
    .select()
    .from(event)
    .where(eq(event.calendarSourceId, sourceId))
    .orderBy(asc(event.externalUid), asc(sql`coalesce(${event.recurrenceOriginal}, '')`));
const live = (rows: Row[]) => rows.filter((r) => r.archivedAt === null);
const byUid = (rows: Row[], uid: string) => rows.filter((r) => r.externalUid === uid);
const syncRows = async (sourceId: string) =>
  (
    await admin.db.execute<{ meta: Record<string, unknown> }>(
      sql`select meta from audit_log where event = 'calendar.sync' and subject_id = ${sourceId} order by at`,
    )
  ).rows.map((r) => r.meta);

const SWIM = 'swim-series-7c1@example.test';
const DENTIST = 'dentist-91a@example.test';

describe('first connect and refresh', () => {
  it('1. mirrors the feed as the owner’s synced events, via sync, with the source’s visibility', async () => {
    const { calendarId } = await connect(h.sam, { defaultKind: 'activity' });
    const out = await refresh(calendarId, provider(SEQUENCES.initial));
    expect(out).toEqual({
      status: 'ok',
      unchanged: false,
      counts: { added: 5, changed: 0, archived: 0, restored: 0, skipped: 0 },
    });
    const rows = await rowsOf(calendarId);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.source).toBe('synced');
      expect(r.createdBy).toBe(h.sam.userId);
      expect(r.createdVia).toBe('sync');
      expect(r.visibility).toBe('household');
      expect(r.kind).toBe('activity');
      expect(r.archivedAt).toBeNull();
      expect(r.externalEtag).toMatch(/^e1:[0-9a-f]{64}$/);
    }
    expect(byUid(rows, SWIM)[0]?.rrule).toBe('FREQ=WEEKLY;BYDAY=WE');
    // No attendee or organiser identity anywhere in what was stored.
    expect(JSON.stringify(rows)).not.toMatch(/mailto|guest\.parent|organiser@/);
    const cal = await getCalendar(h.sam, calendarId, {}, deps);
    expect(cal.lastSyncStatus).toBe('ok');
    expect(cal.lastSyncedAt).toBeInstanceOf(Date);
    expect(cal.lastSkippedCount).toBe(0);
    expect(await syncRows(calendarId)).toEqual([
      {
        status: 'ok',
        unchanged: false,
        added: 5,
        changed: 0,
        archived: 0,
        restored: 0,
        skipped: 0,
      },
    ]);
  });
});

describe('the scenarios', () => {
  it('2. an unchanged feed moves only the freshness: no event is written', async () => {
    const { calendarId } = await connect();
    const p = provider(SEQUENCES.unchanged);
    await refresh(calendarId, p);
    const before = await rowsOf(calendarId);
    const sourceBefore = await getCalendar(h.sam, calendarId, {}, deps);
    p.advance();
    const out = await refresh(calendarId, p);
    expect(out).toMatchObject({ status: 'ok', unchanged: true });
    expect(await rowsOf(calendarId)).toEqual(before); // updated_at untouched too
    const after = await getCalendar(h.sam, calendarId, {}, deps);
    expect(after.lastAttemptAt!.getTime()).toBeGreaterThan(sourceBefore.lastAttemptAt!.getTime());
    expect((await syncRows(calendarId)).at(-1)).toMatchObject({ unchanged: true, added: 0 });
  });

  it('3. an added event is added', async () => {
    const { calendarId } = await connect();
    const p = provider(SEQUENCES.added);
    await refresh(calendarId, p);
    p.advance();
    expect(countsOf(await refresh(calendarId, p))).toMatchObject({ added: 1, changed: 0 });
    expect(live(await rowsOf(calendarId))).toHaveLength(6);
  });

  it('4. a changed event is updated in place: same row, new content', async () => {
    const { calendarId } = await connect();
    const p = provider(SEQUENCES.changed);
    await refresh(calendarId, p);
    const [before] = byUid(await rowsOf(calendarId), DENTIST);
    p.advance();
    expect(countsOf(await refresh(calendarId, p))).toMatchObject({ added: 0, changed: 1 });
    const [after] = byUid(await rowsOf(calendarId), DENTIST);
    expect(after?.id).toBe(before?.id);
    expect(after?.title).toBe('Dentist (check-up)');
    expect(after?.location).toBe('2 Example Street');
    expect(after?.externalEtag).not.toBe(before?.externalEtag);
  });

  it('5. a moved event keeps its row', async () => {
    const { calendarId } = await connect();
    const p = provider(SEQUENCES.moved);
    await refresh(calendarId, p);
    const [before] = byUid(await rowsOf(calendarId), DENTIST);
    p.advance();
    await refresh(calendarId, p);
    const [after] = byUid(await rowsOf(calendarId), DENTIST);
    expect(after?.id).toBe(before?.id);
    expect(after?.startsAt?.toISOString()).toBe('2026-10-23T01:00:00.000Z'); // 14:00 NZDT
  });

  it('6. a cancelled occurrence becomes an exdate of its series, not an event', async () => {
    const { calendarId } = await connect();
    const p = provider(SEQUENCES.cancelledOccurrence);
    await refresh(calendarId, p);
    p.advance();
    await refresh(calendarId, p);
    const swim = byUid(await rowsOf(calendarId), SWIM);
    expect(swim).toHaveLength(1);
    expect(swim[0]?.exdates).toEqual(['2026-10-28T02:30:00Z']);
  });

  it('7–8. a removed event is archived (never deleted), and returning restores the same row', async () => {
    const { calendarId } = await connect();
    const p = provider(SEQUENCES.returning);
    await refresh(calendarId, p);
    const [first] = byUid(await rowsOf(calendarId), DENTIST);
    p.advance();
    expect(countsOf(await refresh(calendarId, p))).toMatchObject({ archived: 1 });
    const [gone] = byUid(await rowsOf(calendarId), DENTIST);
    expect(gone?.id).toBe(first?.id);
    expect(gone?.archivedAt).toBeInstanceOf(Date);
    await expect(getEvent(h.sam, first!.id, {}, deps)).rejects.toBeInstanceOf(NotFoundError);
    p.advance();
    expect(countsOf(await refresh(calendarId, p))).toMatchObject({ restored: 1, added: 0 });
    const [back] = byUid(await rowsOf(calendarId), DENTIST);
    expect(back?.id).toBe(first?.id);
    expect(back?.archivedAt).toBeNull();
  });

  it('9. recreated with a new UID is a new event; the old one is archived', async () => {
    const { calendarId } = await connect();
    const p = provider(SEQUENCES.recreatedNewUid);
    await refresh(calendarId, p);
    p.advance();
    expect(countsOf(await refresh(calendarId, p))).toMatchObject({ added: 1, archived: 1 });
    const rows = await rowsOf(calendarId);
    expect(byUid(rows, DENTIST)[0]?.archivedAt).toBeInstanceOf(Date);
    expect(byUid(rows, 'dentist-recreated-2d4@example.test')[0]?.archivedAt).toBeNull();
  });

  it('10. a series with overrides: each override its own row, pointing at its series', async () => {
    const { calendarId } = await connect();
    await refresh(calendarId, provider(SEQUENCES.seriesWithOverrides));
    const swim = byUid(await rowsOf(calendarId), SWIM);
    const series = swim.find((r) => r.recurrenceOriginal === null)!;
    const overrides = swim.filter((r) => r.recurrenceOriginal !== null);
    expect(overrides.map((o) => o.recurrenceOriginal)).toEqual([
      '2026-11-04T02:30:00Z',
      '2026-11-11T02:30:00Z',
    ]);
    for (const o of overrides) {
      expect(o.recurrenceParentId).toBe(series.id);
      expect(o.rrule).toBeNull();
    }
    expect(series.exdates).toEqual([
      '2026-10-21T02:30:00Z',
      '2026-11-04T02:30:00Z',
      '2026-11-11T02:30:00Z',
      '2026-11-18T02:30:00Z',
    ]);
  });

  it('11–12. an orphan override is stored without a parent; its series arriving later links it, identity unchanged', async () => {
    const moved = nzEvent({
      uid: 'orphan-series@example.test',
      recurrenceId: '20261021T100000',
      start: '20261021T120000',
      end: '20261021T130000',
      summary: 'Moved one',
    });
    const series = nzEvent({
      uid: 'orphan-series@example.test',
      start: '20261014T100000',
      end: '20261014T110000',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
      summary: 'Weekly',
    });
    const { calendarId } = await connect();
    const p = provider([googleFeed([moved]), googleFeed([series, moved])]);
    await refresh(calendarId, p);
    const [orphan] = await rowsOf(calendarId);
    expect(orphan?.recurrenceOriginal).toBe('2026-10-20T21:00:00Z');
    expect(orphan?.recurrenceParentId).toBeNull();
    p.advance();
    await refresh(calendarId, p);
    const rows = await rowsOf(calendarId);
    const master = rows.find((r) => r.recurrenceOriginal === null)!;
    const linked = rows.find((r) => r.recurrenceOriginal !== null)!;
    expect(linked.id).toBe(orphan?.id);
    expect(linked.recurrenceOriginal).toBe(orphan?.recurrenceOriginal);
    expect(linked.recurrenceParentId).toBe(master.id);
    // The series leaving again: the override stays, unlinked, still itself.
    p.goTo(0);
    await refresh(calendarId, p);
    const again = await rowsOf(calendarId);
    expect(again.find((r) => r.id === master.id)?.archivedAt).toBeInstanceOf(Date);
    const kept = again.find((r) => r.id === orphan?.id)!;
    expect(kept.archivedAt).toBeNull();
    expect(kept.recurrenceParentId).toBeNull();
  });

  it('20. a UID over 512 UTF-8 bytes is skipped and counted, never fatal, never truncated', async () => {
    const hostile = Array.from({ length: 1000 }, (_, i) =>
      String.fromCodePoint(0x4e00 + ((i * 7919) % 20000)),
    ).join('');
    const { calendarId } = await connect();
    const base = (
      await provider(SEQUENCES.initial).fetchEvents(
        { kind: 'ics', address: SYNTHETIC_ADDRESS },
        { id: 'default', name: null },
        { from: '2026-09-14', to: '2027-11-18' },
      )
    ).events;
    const p = provider([{ events: [...base, { ...base[0]!, uid: hostile, recurrenceId: null }] }]);
    const out = await refresh(calendarId, p);
    expect(out).toMatchObject({ status: 'partial', counts: { added: 5, skipped: 1 } });
    const rows = await rowsOf(calendarId);
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => (r.externalUid ?? '').startsWith(hostile.slice(0, 10)))).toBe(false);
    expect((await getCalendar(h.sam, calendarId, {}, deps)).lastSkippedCount).toBe(1);
  });

  it('a malformed UID (a lone surrogate, a control character) never reaches the database, and refreshing again still works', async () => {
    const { calendarId } = await connect();
    const base = (
      await provider(SEQUENCES.initial).fetchEvents(
        { kind: 'ics', address: SYNTHETIC_ADDRESS },
        { id: 'default', name: null },
        { from: '2026-09-14', to: '2027-11-18' },
      )
    ).events;
    const odd = [
      { ...base[0]!, uid: 'odd-\uD800-uid', recurrenceId: null },
      { ...base[0]!, uid: 'bell-\u0007-uid', recurrenceId: null },
    ];
    const p = provider([{ events: [...base, ...odd] }, { events: [...base, ...odd] }]);
    expect(await refresh(calendarId, p)).toMatchObject({
      status: 'partial',
      counts: { added: 5, skipped: 2 },
    });
    p.advance();
    expect(await refresh(calendarId, p)).toMatchObject({ status: 'partial' });
    const rows = await rowsOf(calendarId);
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => /odd-|bell-/.test(r.externalUid ?? ''))).toBe(false);
  });

  it('23. the same UID in two different sources stays two events', async () => {
    const a = await connect();
    const b = await connect();
    await refresh(a.calendarId, provider(SEQUENCES.initial));
    await refresh(b.calendarId, provider(SEQUENCES.initial));
    const [inA] = byUid(await rowsOf(a.calendarId), DENTIST);
    const [inB] = byUid(await rowsOf(b.calendarId), DENTIST);
    expect(inA && inB && inA.id !== inB.id).toBe(true);
  });
});

describe('a partial feed never proves a removal (ADR 0007 §42)', () => {
  const dentist = (summary = 'Dentist') =>
    nzEvent({ uid: DENTIST, start: '20261022T100000', end: '20261022T110000', summary });
  const brokenDentist = vevent({
    UID: DENTIST,
    DTSTART: ';VALUE=DATE:20261332',
    SUMMARY: 'Dentist',
  });
  const noUid = vevent({ DTSTART: ';VALUE=DATE:20261332', SUMMARY: 'No UID at all' });
  const swim = (summary = 'Swimming') =>
    nzEvent({ uid: SWIM, start: '20261014T153000', end: '20261014T163000', summary });
  const football = nzEvent({
    uid: 'football-p@example.test',
    start: '20261017T090000',
    end: '20261017T100000',
    summary: 'Football',
  });

  it('an existing event that becomes unreadable stays live, keeps its people, and is updated in place when readable again; the rest of the feed still applies', async () => {
    const { calendarId } = await connect();
    const p = provider([
      googleFeed([dentist(), swim(), football]),
      googleFeed([brokenDentist, swim('Swimming (pool B)')]),
      googleFeed([dentist('Dentist (moved room)'), swim('Swimming (pool B)')]),
    ]);
    await refresh(calendarId, p);
    const [before] = byUid(await rowsOf(calendarId), DENTIST);
    const kid = await createPerson(
      h.sam,
      { name: 'Partial kid', role: 'child', visibility: 'household' },
      deps,
    );
    await setEventPerson(h.sam, { eventId: before!.id, personId: kid.id, role: 'attending' }, deps);
    p.advance();
    const partial = await refresh(calendarId, p);
    expect(partial).toMatchObject({
      status: 'partial',
      counts: { skipped: 1, changed: 1, archived: 1 },
    });
    const rows = await rowsOf(calendarId);
    expect(byUid(rows, DENTIST)[0]?.archivedAt).toBeNull(); // skipped, not removed
    expect(byUid(rows, SWIM)[0]?.title).toBe('Swimming (pool B)'); // the valid rest applied
    // Only the skipped UID is protected: Football, genuinely gone, is archived.
    expect(byUid(rows, 'football-p@example.test')[0]?.archivedAt).toBeInstanceOf(Date);
    expect(await listEventPeople(h.sam, before!.id, {}, deps)).toHaveLength(1);
    p.advance();
    await refresh(calendarId, p);
    const [after] = byUid(await rowsOf(calendarId), DENTIST);
    expect(after?.id).toBe(before!.id);
    expect(after?.title).toBe('Dentist (moved room)');
    expect(await listEventPeople(h.sam, before!.id, {}, deps)).toHaveLength(1);
  });

  it('a skipped event whose UID cannot be read means nothing is archived on that refresh', async () => {
    const { calendarId } = await connect();
    const p = provider([
      googleFeed([dentist(), swim(), football]),
      googleFeed([noUid, swim('Swimming (late)')]),
    ]);
    await refresh(calendarId, p);
    p.advance();
    expect(await refresh(calendarId, p)).toMatchObject({
      status: 'partial',
      counts: { archived: 0, changed: 1, skipped: 1 },
    });
    expect(live(await rowsOf(calendarId))).toHaveLength(3);
  });

  it('any provider: a fake provider’s skipped UIDs protect the same way, and an unidentified skip blocks removals', async () => {
    const { calendarId } = await connect();
    const events = (
      await provider(SEQUENCES.initial).fetchEvents(
        { kind: 'ics', address: SYNTHETIC_ADDRESS },
        { id: 'default', name: null },
        { from: '2026-09-14', to: '2027-11-18' },
      )
    ).events;
    const withoutDentist = events.filter((e) => e.uid !== DENTIST);
    const p = provider([
      { events },
      { events: withoutDentist, skippedUids: [DENTIST] },
      { events: withoutDentist, skipped: 1 },
      { events: withoutDentist },
    ]);
    await refresh(calendarId, p);
    for (let i = 0; i < 2; i++) {
      p.advance();
      expect(countsOf(await refresh(calendarId, p))).toMatchObject({ archived: 0 });
      expect(byUid(await rowsOf(calendarId), DENTIST)[0]?.archivedAt).toBeNull();
    }
    p.advance();
    expect(countsOf(await refresh(calendarId, p))).toMatchObject({ archived: 1 });
  });
});

describe('failures keep the last-known events', () => {
  it.each(['unreachable', 'address_rejected', 'not_a_calendar', 'too_large'] as const)(
    '17. a %s fetch changes no event and records the status',
    async (code) => {
      const { calendarId } = await connect();
      const p = provider([...SEQUENCES.initial.map((ics) => ({ ics })), { fail: code }]);
      await refresh(calendarId, p);
      const before = await rowsOf(calendarId);
      p.advance();
      expect(await refresh(calendarId, p)).toMatchObject({ status: code });
      expect(await rowsOf(calendarId)).toEqual(before);
      const cal = await getCalendar(h.sam, calendarId, {}, deps);
      expect(cal.lastSyncStatus).toBe(code);
      expect(cal.lastSyncErrorCode).toBe(code);
      expect(cal.connection?.lastErrorCode).toBe(code);
      expect((await syncRows(calendarId)).at(-1)).toMatchObject({ status: code, archived: 0 });
    },
  );

  it('18. a feed that cannot be parsed changes nothing; the next good feed recovers', async () => {
    const { calendarId } = await connect();
    const p = provider([
      ...SEQUENCES.initial,
      'BEGIN:VCALENDAR\r\nnot a calendar',
      ...SEQUENCES.initial,
    ]);
    await refresh(calendarId, p);
    const before = await rowsOf(calendarId);
    p.advance();
    expect(await refresh(calendarId, p)).toMatchObject({ status: 'not_a_calendar' });
    expect(await rowsOf(calendarId)).toEqual(before);
    p.advance();
    expect(await refresh(calendarId, p)).toMatchObject({ status: 'ok' });
    expect((await getCalendar(h.sam, calendarId, {}, deps)).lastSyncErrorCode).toBeNull();
  });
});

describe('one refresh at a time per source', () => {
  it('19. a second refresh while one is running returns busy at once and writes nothing', async () => {
    const { calendarId } = await connect();
    const p = provider(SEQUENCES.initial);
    const held = p.hold();
    const first = refresh(calendarId, p);
    await held.reached;
    // The first holds the source's advisory lock, inside its transaction.
    expect(await refresh(calendarId, p, h.alex)).toEqual({ status: 'busy' });
    held.release();
    expect(await first).toMatchObject({ status: 'ok', counts: { added: 5 } });
    expect(await rowsOf(calendarId)).toHaveLength(5);
    expect(await syncRows(calendarId)).toHaveLength(1);
    // Afterwards the lock is free again.
    expect(await refresh(calendarId, p)).toMatchObject({ unchanged: true });
  });

  it('two different sources refresh side by side', async () => {
    const a = await connect();
    const b = await connect();
    const pa = provider(SEQUENCES.initial);
    const held = pa.hold();
    const first = refresh(a.calendarId, pa);
    await held.reached;
    expect(await refresh(b.calendarId, provider(SEQUENCES.initial))).toMatchObject({
      status: 'ok',
    });
    held.release();
    expect(await first).toMatchObject({ status: 'ok' });
  });
});

describe('ownership and visibility', () => {
  it('13. a private calendar’s events are its owner’s alone; a household one is both adults’', async () => {
    const priv = await connect(h.alex, { visibility: 'private', name: 'Alex private' });
    await refresh(priv.calendarId, provider(SEQUENCES.initial), h.alex);
    const rows = await rowsOf(priv.calendarId);
    expect(rows.every((r) => r.visibility === 'private' && r.createdBy === h.alex.userId)).toBe(
      true,
    );
    for (const r of rows) {
      await expect(getEvent(h.sam, r.id, {}, deps)).rejects.toBeInstanceOf(NotFoundError);
      expect((await getEvent(h.alex, r.id, {}, deps)).id).toBe(r.id);
    }
    expect((await listCalendars(h.sam, {}, deps)).map((c) => c.id)).not.toContain(priv.calendarId);
    await expect(getCalendar(h.sam, priv.calendarId, {}, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // Sam cannot even cause it to refresh.
    await expect(
      refresh(priv.calendarId, provider(SEQUENCES.initial), h.sam),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a household calendar: the other adult sees and may refresh it, writes are still the owner’s, and only the owner may change it', async () => {
    const { calendarId } = await connect(h.alex);
    const out = await refresh(calendarId, provider(SEQUENCES.initial), h.sam);
    expect(out).toMatchObject({ status: 'ok' });
    for (const r of await rowsOf(calendarId)) expect(r.createdBy).toBe(h.alex.userId);
    const [syncRow] = (
      await admin.db.execute<{ actor_user_id: string; actor_via: string }>(
        sql`select actor_user_id, actor_via from audit_log where event = 'calendar.sync' and subject_id = ${calendarId}`,
      )
    ).rows;
    expect(syncRow).toEqual({ actor_user_id: h.alex.userId, actor_via: 'sync' });
    const asSam = await getCalendar(h.sam, calendarId, {}, deps);
    expect(asSam.isOwner).toBe(false);
    expect(asSam.connection).toBeNull(); // connection metadata is owner-only
    expect((await getCalendar(h.alex, calendarId, {}, deps)).connection?.status).toBe('active');
    const refused = async (p: Promise<unknown>) =>
      (
        (await p.then(
          () => null,
          (e: unknown) => e,
        )) as NotPermittedError
      ).code;
    expect(await refused(updateCalendar(h.sam, calendarId, { name: 'Mine now' }, deps))).toBe(
      'not_owner',
    );
    expect(await refused(disconnectCalendar(h.sam, calendarId, deps))).toBe('not_owner');
    // Provider-owned fields stay read-only to people.
    const [any] = await rowsOf(calendarId);
    expect(await refused(updateEvent(h.alex, any!.id, { title: 'x' }, deps))).toBe('synced_event');
  });

  it('a calendar made private takes its events with it, at once', async () => {
    const { calendarId } = await connect(h.sam);
    await refresh(calendarId, provider(SEQUENCES.initial));
    await updateCalendar(h.sam, calendarId, { visibility: 'private', defaultKind: 'work' }, deps);
    for (const r of await rowsOf(calendarId)) {
      expect(r.visibility).toBe('private');
      expect(r.kind).toBe('work');
      await expect(getEvent(h.alex, r.id, {}, deps)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it('cannot become private while household notes point at its events', async () => {
    const { calendarId } = await connect(h.sam);
    await refresh(calendarId, provider(SEQUENCES.initial));
    const [e] = await rowsOf(calendarId);
    await createNote(
      h.alex,
      { body: 'Bring the form', subject: { type: 'event', id: e!.id }, visibility: 'household' },
      deps,
    );
    const err = await updateCalendar(h.sam, calendarId, { visibility: 'private' }, deps).catch(
      (x: unknown) => x,
    );
    expect((err as NotPermittedError).code).toBe('referenced_by_household');
  });
});

describe('disconnect and reconnect', () => {
  it('14–16. disconnect archives, keeps annotations and the fingerprint; reconnecting reuses the same rows and restores the events', async () => {
    const { calendarId, address } = await connect(h.sam);
    const p = provider(SEQUENCES.changed);
    await refresh(calendarId, p);
    const [dentist] = byUid(await rowsOf(calendarId), DENTIST);
    const milo = await createPerson(
      h.sam,
      { name: 'Milo', role: 'child', visibility: 'household' },
      deps,
    );
    await setEventPerson(
      h.sam,
      { eventId: dentist!.id, personId: milo.id, role: 'attending' },
      deps,
    );
    const kept = await createNote(
      h.alex,
      {
        body: 'Ask about the brace',
        subject: { type: 'event', id: dentist!.id },
        visibility: 'household',
      },
      deps,
    );
    // 16a: an update keeps them.
    p.advance();
    await refresh(calendarId, p);
    expect(await listEventPeople(h.sam, dentist!.id, {}, deps)).toHaveLength(1);

    // 14: disconnect.
    const [connBefore] = (
      await admin.db.execute<{ id: string; address_fingerprint: string }>(
        sql`select c.id, c.address_fingerprint from calendar_connection c join calendar_source s on s.connection_id = c.id where s.id = ${calendarId}`,
      )
    ).rows;
    await disconnectCalendar(h.sam, calendarId, deps);
    const [conn] = (
      await admin.db.execute<Record<string, unknown>>(
        sql`select status, credentials_encrypted, credentials_key_id, address_fingerprint, disconnected_at from calendar_connection where id = ${connBefore!.id}`,
      )
    ).rows;
    expect(conn).toMatchObject({
      status: 'disconnected',
      credentials_encrypted: null,
      credentials_key_id: null,
      address_fingerprint: connBefore!.address_fingerprint,
    });
    expect(conn?.disconnected_at).toBeTruthy();
    const rows = await rowsOf(calendarId);
    expect(rows.length).toBe(5);
    expect(rows.every((r) => r.archivedAt !== null)).toBe(true);
    expect(
      await admin.db.select().from(eventPerson).where(eq(eventPerson.eventId, dentist!.id)),
    ).toHaveLength(1);
    expect(await admin.db.select().from(note).where(eq(note.id, kept.id))).toHaveLength(1);
    expect((await listCalendars(h.sam, {}, deps)).map((c) => c.id)).not.toContain(calendarId);
    await expect(refresh(calendarId, p)).rejects.toBeInstanceOf(NotFoundError);

    // 15: connecting the same address is not reconnecting: refused, nothing changes.
    const refused = await connectCalendar(
      h.sam,
      { address, name: 'New name', visibility: 'private' },
      deps,
    ).catch((e: unknown) => e);
    expect((refused as NotPermittedError).code).toBe('calendar_can_reconnect');
    // The refusal names the calendar to go back to (its own record id, nothing else).
    expect(refused).toBeInstanceOf(CalendarCanReconnectError);
    expect((refused as CalendarCanReconnectError).calendarId).toBe(calendarId);
    expect(Object.keys(refused as object).sort()).toEqual(['calendarId', 'code', 'name']);
    expect(
      (await getCalendar(h.sam, calendarId, { includeArchived: true }, deps)).archivedAt,
    ).not.toBeNull();
    // Reconnecting takes the address only (another spelling): the same rows return.
    const settings = await reconnectCalendar(
      h.sam,
      calendarId,
      { address, name: 'x' } as never,
      deps,
    ).catch((e: unknown) => e);
    expect(settings).toBeInstanceOf(ZodError);
    const again = await reconnectCalendar(
      h.sam,
      calendarId,
      { address: address.replace('https://', 'webcal://') },
      deps,
    );
    expect(again).toEqual({ calendarId });
    const view = await getCalendar(h.sam, calendarId, {}, deps);
    expect({ name: view.name, visibility: view.visibility }).toEqual({
      name: 'Family',
      visibility: 'household',
    });
    const connections = (
      await admin.db.execute(
        sql`select id from calendar_connection where address_fingerprint = ${connBefore!.address_fingerprint}`,
      )
    ).rows;
    expect(connections).toHaveLength(1);
    expect(countsOf(await refresh(calendarId, p))).toMatchObject({ restored: 5, added: 0 });
    const [restored] = byUid(await rowsOf(calendarId), DENTIST);
    expect(restored?.id).toBe(dentist!.id);
    expect(restored?.archivedAt).toBeNull();
    // 16: annotations and notes survived it all.
    expect((await listEventPeople(h.sam, dentist!.id, {}, deps)).map((a) => a.personId)).toEqual([
      milo.id,
    ]);
    expect((await listNotes(h.sam, {}, deps)).map((x) => x.id)).toContain(kept.id);
  });

  it('22. an exact duplicate of a live address is refused, whoever connects it', async () => {
    const { address } = await connect(h.sam);
    for (const who of [h.sam, h.alex]) {
      const err = await connect(who, {}, address.replace('https://', 'webcal://')).catch(
        (e: unknown) => e,
      );
      expect((err as NotPermittedError).code).toBe('calendar_already_connected');
    }
  });

  it('the other adult connecting an address you disconnected gets a new connection, never yours', async () => {
    const mine = await connect(h.sam);
    await disconnectCalendar(h.sam, mine.calendarId, deps);
    // Alex cannot reconnect Sam's calendar, even with the right address.
    const err = await reconnectCalendar(
      h.alex,
      mine.calendarId,
      { address: mine.address },
      deps,
    ).catch((e: unknown) => e);
    expect((err as NotPermittedError).code).toBe('not_owner');
    const theirs = await connect(h.alex, {}, mine.address);
    expect(theirs.calendarId).not.toBe(mine.calendarId);
    // Sam's calendar stays disconnected and Sam's own.
    const [row] = (
      await admin.db.execute<{ status: string; owner: string }>(
        sql`select c.status, c.owner_user_id as owner from calendar_connection c join calendar_source s on s.connection_id = c.id where s.id = ${mine.calendarId}`,
      )
    ).rows;
    expect(row).toEqual({ status: 'disconnected', owner: h.sam.userId });
  });

  it('21. rotating HOME_CREDENTIALS_KEY never changes the fingerprint: a calendar disconnected before the rotation is still recognised after it', async () => {
    const saved = {
      current: process.env.HOME_CREDENTIALS_KEY,
      previous: process.env.HOME_CREDENTIALS_KEY_PREVIOUS,
    };
    try {
      const live = await connect(h.sam);
      await refresh(live.calendarId, provider(SEQUENCES.initial));
      const gone = await connect(h.sam);
      await disconnectCalendar(h.sam, gone.calendarId, deps);
      // Rotate: a new current key, the old one as previous; then retire the old one.
      process.env.HOME_CREDENTIALS_KEY_PREVIOUS = saved.current;
      process.env.HOME_CREDENTIALS_KEY = Buffer.from('home-test-rotated-cred-key-32byt').toString(
        'base64',
      );
      // A credential sealed with the previous key still opens, and is
      // resealed with the current key on that refresh.
      const keyIdOf = async () =>
        (
          await admin.db.execute<{ k: string }>(
            sql`select c.credentials_key_id as k from calendar_connection c join calendar_source s on s.connection_id = c.id where s.id = ${live.calendarId}`,
          )
        ).rows[0]?.k;
      const oldKeyId = await keyIdOf();
      expect(await refresh(live.calendarId, provider(SEQUENCES.unchanged))).toMatchObject({
        status: 'ok',
      });
      expect(await keyIdOf()).not.toBe(oldKeyId);
      delete process.env.HOME_CREDENTIALS_KEY_PREVIOUS;
      // With the previous key gone, the resealed credential still opens.
      expect(await refresh(live.calendarId, provider(SEQUENCES.unchanged))).toMatchObject({
        status: 'ok',
      });
      const back = await reconnectCalendar(h.sam, gone.calendarId, { address: gone.address }, deps);
      expect(back).toEqual({ calendarId: gone.calendarId });
      const err = await connect(h.alex, {}, live.address).catch((e: unknown) => e);
      expect((err as NotPermittedError).code).toBe('calendar_already_connected');
    } finally {
      process.env.HOME_CREDENTIALS_KEY = saved.current;
      if (saved.previous === undefined) delete process.env.HOME_CREDENTIALS_KEY_PREVIOUS;
      else process.env.HOME_CREDENTIALS_KEY_PREVIOUS = saved.previous;
    }
  });

  it('a missing or invalid fingerprint key refuses connecting; HOME carries on', async () => {
    const saved = process.env.HOME_FINGERPRINT_KEY;
    try {
      for (const value of [undefined, 'not-a-key', process.env.HOME_CREDENTIALS_KEY]) {
        if (value === undefined) delete process.env.HOME_FINGERPRINT_KEY;
        else process.env.HOME_FINGERPRINT_KEY = value;
        const err = await connect(h.sam).catch((e: unknown) => e);
        expect((err as NotPermittedError).code).toBe('calendar_keys_unavailable');
      }
      expect(Array.isArray(await listCalendars(h.sam, {}, deps))).toBe(true);
    } finally {
      process.env.HOME_FINGERPRINT_KEY = saved;
    }
  });

  it('refuses an address that is not Google’s secret iCal address, before anything is stored', async () => {
    const count = async () =>
      (await admin.db.execute(sql`select count(*)::int as n from calendar_connection`)).rows[0];
    const before = await count();
    for (const address of [
      'https://example.test/calendar.ics',
      'http://calendar.google.com/calendar/ical/x%40example.test/private-0123456789abcdef/basic.ics',
      'https://calendar.google.com/calendar/ical/x%40example.test/public/basic.ics',
    ]) {
      const err = await connect(h.sam, {}, address).catch((e: unknown) => e);
      expect((err as NotPermittedError).code).toBe('address_not_accepted');
    }
    expect(await count()).toEqual(before);
  });
});

describe('a disconnected calendar’s settings can be changed without reconnecting (ADR 0007 §42)', () => {
  const connectionOf = async (calendarId: string) =>
    (
      await admin.db.execute<Record<string, unknown>>(
        sql`select c.status, c.credentials_encrypted, c.credentials_key_id, c.address_fingerprint, c.disconnected_at, c.updated_at
            from calendar_connection c join calendar_source s on s.connection_id = c.id where s.id = ${calendarId}`,
      )
    ).rows[0];

  it('recovery: a person a disconnected household calendar names can be made private once the owner lets them go', async () => {
    const personA = await createPerson(
      h.sam,
      { name: 'Person A', role: 'child', visibility: 'household' },
      deps,
    );
    const { calendarId } = await connect(h.sam, { defaultPersonIds: [personA.id] });
    const p = provider(SEQUENCES.initial);
    await refresh(calendarId, p);
    await disconnectCalendar(h.sam, calendarId, deps);
    const connBefore = await connectionOf(calendarId);
    const refused = await updatePerson(h.sam, personA.id, { visibility: 'private' }, deps).catch(
      (e: unknown) => e,
    );
    expect((refused as NotPermittedError).code).toBe('referenced_by_household');

    const view = await updateCalendar(h.sam, calendarId, { defaultPersonIds: [] }, deps);
    expect(view.defaultPersonIds).toEqual([]);
    // Still disconnected: archived, the connection untouched, its events archived, nothing fetched.
    expect(view.archivedAt).not.toBeNull();
    expect(view.connection?.status).toBe('disconnected');
    expect(await connectionOf(calendarId)).toEqual(connBefore);
    expect(live(await rowsOf(calendarId))).toHaveLength(0);
    expect(p.calls).toBe(1);

    const done = await updatePerson(h.sam, personA.id, { visibility: 'private' }, deps);
    expect(done.visibility).toBe('private');
    for (const c of await listCalendars(h.alex, { includeArchived: true }, deps))
      expect(c.defaultPersonIds).not.toContain(personA.id);
    expect(JSON.stringify(await exportFor(h.alex, {}, deps))).not.toContain(personA.id);

    const [audit] = (
      await admin.db.execute<{ meta: Record<string, unknown> }>(
        sql`select meta from audit_log where event = 'calendar_source.update' and subject_id = ${calendarId} order by at desc limit 1`,
      )
    ).rows;
    expect(audit?.meta).toEqual({ fields: ['defaultPersonIds'], disconnected: true });
  });

  it('only the owner, by hand: the other adult, Kev, the system and a forged sync actor are refused', async () => {
    const { calendarId } = await connect(h.sam);
    await disconnectCalendar(h.sam, calendarId, deps);
    const priv = await connect(h.sam, { visibility: 'private' });
    await disconnectCalendar(h.sam, priv.calendarId, deps);
    const codeOf = async (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: unknown) => (e as NotPermittedError).code ?? (e as Error).name,
      );
    expect(await codeOf(updateCalendar(h.alex, calendarId, { name: 'x' }, deps))).toBe('not_owner');
    expect(await codeOf(updateCalendar(h.alex, priv.calendarId, { name: 'x' }, deps))).toBe(
      'NotFoundError',
    );
    expect(await codeOf(updateCalendar(h.samViaKev, calendarId, { name: 'x' }, deps))).toBe(
      'kev_cannot_write',
    );
    expect(
      await codeOf(
        updateCalendar({ kind: 'system', via: 'system' } as never, calendarId, { name: 'x' }, deps),
      ),
    ).toBe('not_a_user');
    expect(
      await codeOf(
        updateCalendar({ ...h.sam, via: 'sync' as const }, calendarId, { name: 'x' }, deps),
      ),
    ).toBe('sync_actor');
    expect((await getCalendar(h.sam, calendarId, { includeArchived: true }, deps)).name).toBe(
      'Family',
    );
  });

  it('a disconnected calendar’s visibility change obeys the same rules, and reconnecting afterwards still needs the address', async () => {
    const kid = await createPerson(
      h.sam,
      { name: 'Private kid', role: 'child', visibility: 'private' },
      deps,
    );
    const { calendarId, address } = await connect(h.sam, {
      visibility: 'private',
      defaultPersonIds: [kid.id],
    });
    await refresh(calendarId, provider(SEQUENCES.initial));
    await disconnectCalendar(h.sam, calendarId, deps);
    // Private → household with a private default person: refused, so the id never reaches the other adult.
    const err = await updateCalendar(h.sam, calendarId, { visibility: 'household' }, deps).catch(
      (e: unknown) => e,
    );
    expect((err as NotPermittedError).code).toBe('references_private');
    await expect(
      getCalendar(h.alex, calendarId, { includeArchived: true }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Allowed once the private person is gone; the archived events follow.
    await updateCalendar(
      h.sam,
      calendarId,
      { visibility: 'household', defaultPersonIds: [], name: 'Shared' },
      deps,
    );
    for (const r of await rowsOf(calendarId)) {
      expect(r.visibility).toBe('household');
      expect(r.archivedAt).not.toBeNull();
    }
    expect((await getCalendar(h.alex, calendarId, { includeArchived: true }, deps)).name).toBe(
      'Shared',
    );
    // Still disconnected: a refresh is refused, and reconnecting needs the address.
    await expect(refresh(calendarId, provider(SEQUENCES.initial))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await reconnectCalendar(h.sam, calendarId, { address }, deps)).toEqual({ calendarId });
  });
});

describe('reconnect proves identity (ADR 0007 §42)', () => {
  it('the wrong address is refused; a live calendar is not reconnected; concurrent reconnects never duplicate', async () => {
    const { calendarId, address } = await connect(h.sam);
    const live = await reconnectCalendar(h.sam, calendarId, { address }, deps).catch(
      (e: unknown) => e,
    );
    expect((live as NotPermittedError).code).toBe('calendar_already_connected');
    await disconnectCalendar(h.sam, calendarId, deps);
    const wrong = await reconnectCalendar(
      h.sam,
      calendarId,
      { address: nextAddress() },
      deps,
    ).catch((e: unknown) => e);
    expect((wrong as NotPermittedError).code).toBe('calendar_address_mismatch');
    const both = await Promise.all(
      [1, 2].map(() =>
        reconnectCalendar(h.sam, calendarId, { address }, deps).then(
          () => 'ok',
          (e: unknown) => (e as NotPermittedError).code,
        ),
      ),
    );
    expect(both.sort()).toEqual(['calendar_already_connected', 'ok']);
    const rows = (
      await admin.db.execute(
        sql`select c.id from calendar_connection c where c.owner_user_id = ${h.sam.userId} and c.status = 'active' and c.id = (select connection_id from calendar_source where id = ${calendarId})`,
      )
    ).rows;
    expect(rows).toHaveLength(1);
  });
});

describe('default people are references (ADR 0007 §42)', () => {
  it('a person a household calendar names cannot be made private until the calendar lets them go', async () => {
    const kid = await createPerson(
      h.sam,
      { name: 'Default kid', role: 'child', visibility: 'household' },
      deps,
    );
    const { calendarId } = await connect(h.sam, { defaultPersonIds: [kid.id] });
    const refused = await updatePerson(h.sam, kid.id, { visibility: 'private' }, deps).catch(
      (e: unknown) => e,
    );
    expect((refused as NotPermittedError).code).toBe('referenced_by_household');
    // Disconnected (archived) calendars still count: they can come back.
    await disconnectCalendar(h.sam, calendarId, deps);
    expect(
      (
        (await updatePerson(h.sam, kid.id, { visibility: 'private' }, deps).catch(
          (e: unknown) => e,
        )) as NotPermittedError
      ).code,
    ).toBe('referenced_by_household');
  });

  it('after the calendar drops them, the change goes ahead; a private calendar never blocks it', async () => {
    const kid = await createPerson(
      h.sam,
      { name: 'Freed kid', role: 'child', visibility: 'household' },
      deps,
    );
    const hh = await connect(h.sam, { defaultPersonIds: [kid.id] });
    const priv = await connect(h.sam, { visibility: 'private', defaultPersonIds: [kid.id] });
    await updateCalendar(h.sam, hh.calendarId, { defaultPersonIds: [] }, deps);
    const done = await updatePerson(h.sam, kid.id, { visibility: 'private' }, deps);
    expect(done.visibility).toBe('private');
    expect((await getCalendar(h.sam, priv.calendarId, {}, deps)).defaultPersonIds).toEqual([
      kid.id,
    ]);
    // And the other adult never sees the id, in a read or the export.
    for (const c of await listCalendars(h.alex, { includeArchived: true }, deps))
      expect(c.defaultPersonIds).not.toContain(kid.id);
    const exported = JSON.stringify(await exportFor(h.alex, {}, deps));
    expect(exported).not.toContain(kid.id);
  });

  it('reconnecting checks the default people again and drops any that can no longer be named', async () => {
    const kid = await createPerson(
      h.sam,
      { name: 'Archived kid', role: 'child', visibility: 'household' },
      deps,
    );
    const keep = await createPerson(
      h.sam,
      { name: 'Kept kid', role: 'child', visibility: 'household' },
      deps,
    );
    const { calendarId, address } = await connect(h.sam, { defaultPersonIds: [kid.id, keep.id] });
    await disconnectCalendar(h.sam, calendarId, deps);
    await archivePerson(h.sam, kid.id, deps);
    await reconnectCalendar(h.sam, calendarId, { address }, deps);
    expect((await getCalendar(h.sam, calendarId, {}, deps)).defaultPersonIds).toEqual([keep.id]);
    const [row] = (
      await admin.db.execute<{ meta: Record<string, unknown> }>(
        sql`select meta from audit_log where event = 'calendar_source.restore' and subject_id = ${calendarId} order by at desc limit 1`,
      )
    ).rows;
    expect(row?.meta).toEqual({ defaultPeopleDropped: 1 });
  });
});

describe('errors crossing the calendar boundary are structural (ADR 0007 §42)', () => {
  it('a persistence failure carrying a sealed credential and fingerprint surfaces as a code only', async () => {
    // A real failure inside the connect transaction: the insert of the
    // connection (whose parameters are the sealed credential and the
    // fingerprint) is refused by a temporary constraint.
    await admin.db.execute(
      sql`alter table calendar_connection add constraint zz_probe_refuse check (status <> 'active') not valid`,
    );
    const address = nextAddress();
    let err: unknown;
    try {
      err = await connectCalendar(h.sam, { address, name: 'Doomed' }, deps).catch(
        (e: unknown) => e,
      );
    } finally {
      await admin.db.execute(sql`alter table calendar_connection drop constraint zz_probe_refuse`);
    }
    expect(err).toBeInstanceOf(CalendarUnexpectedError);
    expect(err).toMatchObject({ operation: 'connectCalendar', sqlState: '23514' });
    expect((err as Error).cause).toBeUndefined();
    const text = [
      String(err),
      (err as Error).stack ?? '',
      JSON.stringify(err),
      JSON.stringify(
        Object.getOwnPropertyNames(err as object).map((k) => (err as Record<string, unknown>)[k]),
      ),
    ].join('\n');
    for (const secret of ['hc1.', 'fp2.', address, 'private-', 'Failed query', 'params'])
      expect(text, secret).not.toContain(secret);
  });

  it('a hand-made sync actor cannot write through auditedWrite', async () => {
    const forged = { ...h.sam, via: 'sync' as const };
    const err = await auditedWrite(forged, deps, async () => ({ result: 1, audit: null })).catch(
      (e: unknown) => e,
    );
    expect((err as NotPermittedError).code).toBe('sync_actor');
  });
});

describe('who may connect and refresh', () => {
  it('Kev, the system and a hand-made sync actor cannot connect, change, disconnect or refresh', async () => {
    const { calendarId } = await connect(h.sam);
    const forged = { ...h.sam, via: 'sync' as const };
    const sys = { kind: 'system', via: 'system' } as never;
    for (const actor of [h.samViaKev, forged, sys]) {
      for (const op of [
        connectCalendar(actor, { address: nextAddress(), name: 'x' }, deps),
        updateCalendar(actor, calendarId, { name: 'x' }, deps),
        disconnectCalendar(actor, calendarId, deps),
        reconnectCalendar(actor, calendarId, { address: nextAddress() }, deps),
        refreshCalendar(actor, calendarId, provider(SEQUENCES.initial), { today: TODAY }, deps),
      ]) {
        const err = await op.then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(NotPermittedError);
      }
    }
    expect(await rowsOf(calendarId)).toHaveLength(0);
  });

  it('a stored source row always names its owner, as connected', async () => {
    const { calendarId } = await connect(h.alex);
    const [row] = await admin.db
      .select({ createdBy: calendarSource.createdBy, createdVia: calendarSource.createdVia })
      .from(calendarSource)
      .where(and(eq(calendarSource.id, calendarId)));
    expect(row).toEqual({ createdBy: h.alex.userId, createdVia: 'ui' });
  });
});

describe('audit', () => {
  it('one structural row per refresh; nothing provider-written, secret or per-event', async () => {
    const before = (await admin.db.execute(sql`select count(*)::int as n from audit_log`))
      .rows[0] as { n: number };
    const { calendarId, address } = await connect(h.sam);
    const p = provider(SEQUENCES.added);
    await refresh(calendarId, p);
    p.advance();
    await refresh(calendarId, p);
    const rows = (
      await admin.db.execute<{
        event: string;
        subject_type: string;
        meta: unknown;
        summary: string | null;
      }>(
        // Rows written in one transaction share its instant, and audit ids are random, so
        // `at` alone leaves their order to the database: `event` breaks the tie (connect,
        // then its source, as the expectation lists them).
        sql`select event, subject_type, meta, summary from audit_log order by at, event offset ${before.n}`,
      )
    ).rows;
    expect(rows.map((r) => r.event)).toEqual([
      'calendar.connect',
      'calendar_source.create',
      'calendar.sync',
      'calendar.sync',
    ]);
    const text = JSON.stringify(rows);
    for (const forbidden of [
      address,
      'private-',
      'calendar.google.com',
      'hc1.',
      'fp2.',
      'Swimming',
      'Dentist',
      'Synthetic Aquatic Centre',
      SWIM,
    ])
      expect(text, forbidden).not.toContain(forbidden);
    // Activity follows the calendar: the connection row is the owner's alone.
    const [{ id: connectionId } = { id: '' }] = (
      await admin.db.execute<{ id: string }>(
        sql`select connection_id as id from calendar_source where id = ${calendarId}`,
      )
    ).rows;
    const about = async (actor: typeof h.sam) =>
      (await listAudit(actor, { limit: 200 }, deps)).rows
        .filter((r) => r.subjectId === calendarId || r.subjectId === connectionId)
        .map((r) => r.event)
        .sort();
    expect(await about(h.alex)).toEqual([
      'calendar.sync',
      'calendar.sync',
      'calendar_source.create',
    ]);
    expect(await about(h.sam)).toEqual([
      'calendar.connect',
      'calendar.sync',
      'calendar.sync',
      'calendar_source.create',
    ]);
  });
});
