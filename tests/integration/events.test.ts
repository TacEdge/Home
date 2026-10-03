import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { event } from '@/db/schema';
import type { NotPermittedError } from '@/domain/common/errors';
import {
  archiveEvent,
  createEvent,
  getEvent,
  listEvents,
  restoreEvent,
  updateEvent,
} from '@/domain/events/service';
import { FAMILY_EVENTS } from '../fixtures/family';
import { adminDb, testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// Event time handling (M2 contract §4.1): instants in UTC plus the zone they
// were made in; all-day as dates with an exclusive end; the input layer and
// the database agree on every rule. Manual events only; synced events (M4's
// sync path) are read-only. Recurrence is stored, never parsed.

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
let h: Household;
beforeAll(async () => {
  h = await ensureFixtureUsers(db);
});
afterAll(async () => {
  await close();
  await admin.close();
});

const rowOf = async (id: string) => (await db.select().from(event).where(eq(event.id, id)))[0];

describe('timed and all-day events', () => {
  it('a timed event stores UTC instants and its zone, and no dates', async () => {
    const e = await createEvent(h.sam, FAMILY_EVENTS.swimming, deps);
    expect(e).toMatchObject({
      allDay: false,
      startDate: null,
      endDate: null,
      timeZone: 'Pacific/Auckland',
    });
    expect(e.startsAt?.toISOString()).toBe('2026-10-14T02:30:00.000Z');
    expect(e.endsAt?.toISOString()).toBe('2026-10-14T03:15:00.000Z');
    expect(e.source).toBe('manual');
  });

  it('an all-day event stores dates with an exclusive end, and no instants or zone', async () => {
    const e = await createEvent(h.sam, FAMILY_EVENTS.nanaJoBirthday, deps);
    expect(e).toMatchObject({
      allDay: true,
      startDate: '2026-10-20',
      endDate: '2026-10-21',
      startsAt: null,
      endsAt: null,
      timeZone: null,
    });
  });

  it('instants keep their meaning across the NZ daylight-saving change', async () => {
    // 27 Sep 2026: 02:00 NZST jumps to 03:00 NZDT. An event from 01:30 NZST to
    // 03:30 NZDT lasts one hour of real time.
    const e = await createEvent(
      h.sam,
      {
        title: 'Across the change',
        kind: 'other',
        time: {
          allDay: false,
          startsAt: '2026-09-27T01:30:00+12:00',
          endsAt: '2026-09-27T03:30:00+13:00',
          timeZone: 'Pacific/Auckland',
        },
      },
      deps,
    );
    expect(e.startsAt?.toISOString()).toBe('2026-09-26T13:30:00.000Z');
    expect((e.endsAt?.getTime() ?? 0) - (e.startsAt?.getTime() ?? 0)).toBe(60 * 60 * 1000);
  });

  it('switching shape replaces the time wholesale, clearing the other shape', async () => {
    const e = await createEvent(h.sam, FAMILY_EVENTS.swimming, deps);
    const allDay = await updateEvent(
      h.sam,
      e.id,
      { time: { allDay: true, startDate: '2026-10-14', endDate: '2026-10-15' } },
      deps,
    );
    expect(allDay).toMatchObject({
      allDay: true,
      startsAt: null,
      endsAt: null,
      timeZone: null,
      startDate: '2026-10-14',
    });
    const timed = await updateEvent(h.sam, e.id, { time: FAMILY_EVENTS.football.time }, deps);
    expect(timed).toMatchObject({
      allDay: false,
      startDate: null,
      endDate: null,
      timeZone: 'Pacific/Auckland',
    });
  });

  it.each([
    [
      'an unknown time zone',
      {
        allDay: false,
        startsAt: '2026-10-14T02:30:00Z',
        endsAt: '2026-10-14T03:30:00Z',
        timeZone: 'Mars/Olympus',
      },
    ],
    [
      'a time zone with spaces',
      {
        allDay: false,
        startsAt: '2026-10-14T02:30:00Z',
        endsAt: '2026-10-14T03:30:00Z',
        timeZone: ' UTC',
      },
    ],
    [
      'a naive local time (no offset)',
      {
        allDay: false,
        startsAt: '2026-10-14T15:30:00',
        endsAt: '2026-10-14T16:30:00',
        timeZone: 'UTC',
      },
    ],
    [
      'an end before the start',
      {
        allDay: false,
        startsAt: '2026-10-14T03:30:00Z',
        endsAt: '2026-10-14T02:30:00Z',
        timeZone: 'UTC',
      },
    ],
    [
      'a timed event with dates too',
      {
        allDay: false,
        startsAt: '2026-10-14T02:30:00Z',
        endsAt: '2026-10-14T03:30:00Z',
        timeZone: 'UTC',
        startDate: '2026-10-14',
      },
    ],
    [
      'an all-day end equal to its start (the end is exclusive)',
      { allDay: true, startDate: '2026-10-14', endDate: '2026-10-14' },
    ],
    [
      'an all-day event with a zone',
      { allDay: true, startDate: '2026-10-14', endDate: '2026-10-15', timeZone: 'UTC' },
    ],
    ['an impossible date', { allDay: true, startDate: '2026-02-29', endDate: '2026-03-01' }],
  ])('refuses %s, before reaching the database', async (_label, time) => {
    await expect(
      createEvent(h.sam, { title: 'Bad', kind: 'other', time } as never, deps),
    ).rejects.toThrow();
    expect(await db.select().from(event).where(eq(event.title, 'Bad'))).toHaveLength(0);
  });

  it('the database enforces the same shape rules if anything bypasses the input layer', async () => {
    const bad = [
      sql`insert into event (created_via, title, kind, all_day, starts_at, ends_at) values ('ui','x','other',false,now(),now())`,
      sql`insert into event (created_via, title, kind, all_day, start_date, end_date) values ('ui','x','other',true,'2026-10-14','2026-10-14')`,
      sql`insert into event (created_via, title, kind, all_day, starts_at, ends_at, time_zone) values ('ui','x','other',false,'2026-10-14T03:00Z','2026-10-14T02:00Z','UTC')`,
    ];
    for (const q of bad) await expect(db.execute(q)).rejects.toThrow();
  });

  it('services never set source or sync fields', async () => {
    await expect(
      createEvent(
        h.sam,
        { ...FAMILY_EVENTS.swimming, source: 'synced', externalUid: 'x' } as never,
        deps,
      ),
    ).rejects.toThrow();
    await expect(
      updateEvent(
        h.sam,
        (await createEvent(h.sam, FAMILY_EVENTS.swimming, deps)).id,
        { calendarSourceId: crypto.randomUUID() } as never,
        deps,
      ),
    ).rejects.toThrow();
  });
});

describe('recurrence is stored, never parsed', () => {
  it('keeps RRULE and EXDATEs exactly as given', async () => {
    const e = await createEvent(
      h.sam,
      { ...FAMILY_EVENTS.swimming, exdates: ['2026-10-21T02:30:00Z', '2026-12-23'] },
      deps,
    );
    expect(e.rrule).toBe('FREQ=WEEKLY;BYDAY=WE');
    expect(e.exdates).toEqual(['2026-10-21T02:30:00Z', '2026-12-23']);
    const cleared = await updateEvent(h.sam, e.id, { rrule: null, exdates: null }, deps);
    expect(cleared).toMatchObject({ rrule: null, exdates: null });
  });

  it('refuses an EXDATE that is not an ISO date or instant', async () => {
    await expect(
      createEvent(h.sam, { ...FAMILY_EVENTS.swimming, exdates: ['next week'] }, deps),
    ).rejects.toThrow();
  });
});

describe('synced events are read-only here (M4 owns them)', () => {
  it('can be read like any household event, but not edited, archived or restored', async () => {
    const r = await admin.db.execute(sql`
      insert into event (created_via, title, kind, starts_at, ends_at, time_zone, source, calendar_source_id, external_uid)
      values ('sync', 'From a calendar', 'work', '2026-10-15T20:00:00Z', '2026-10-15T21:00:00Z', 'UTC', 'synced', gen_random_uuid(), 'uid-sync-1')
      returning id`);
    const id = r.rows[0]?.id as string;
    expect((await getEvent(h.alex, id, {}, deps)).source).toBe('synced');
    for (const op of [
      updateEvent(h.sam, id, { title: 'Edited' }, deps),
      archiveEvent(h.sam, id, deps),
    ]) {
      const e = await op.then(
        () => null,
        (x: unknown) => x,
      );
      expect((e as NotPermittedError).code).toBe('synced_event');
    }
    await admin.db.execute(sql`update event set archived_at = now() where id = ${id}::uuid`);
    const e = await restoreEvent(h.sam, id, deps).then(
      () => null,
      (x: unknown) => x,
    );
    expect((e as NotPermittedError).code).toBe('synced_event');
    expect((await rowOf(id))?.title).toBe('From a calendar');
  });
});

describe('listing', () => {
  it('orders all-day and timed events by their local date, then start', async () => {
    const before = new Set((await listEvents(h.sam, {}, deps)).map((e) => e.id));
    const b = await createEvent(
      h.sam,
      {
        title: 'L-birthday',
        kind: 'birthday',
        time: { allDay: true, startDate: '2030-01-02', endDate: '2030-01-03' },
      },
      deps,
    );
    // 23:30 on 1 Jan in Auckland is 1 Jan locally; all-day items lead their day.
    const late = await createEvent(
      h.sam,
      {
        title: 'L-late',
        kind: 'other',
        time: {
          allDay: false,
          startsAt: '2030-01-01T23:30:00+13:00',
          endsAt: '2030-01-01T23:45:00+13:00',
          timeZone: 'Pacific/Auckland',
        },
      },
      deps,
    );
    const early = await createEvent(
      h.sam,
      {
        title: 'L-early',
        kind: 'other',
        time: {
          allDay: false,
          startsAt: '2030-01-02T08:00:00+13:00',
          endsAt: '2030-01-02T09:00:00+13:00',
          timeZone: 'Pacific/Auckland',
        },
      },
      deps,
    );
    const order = (await listEvents(h.sam, {}, deps))
      .filter((e) => !before.has(e.id))
      .map((e) => e.title);
    expect(order).toEqual(['L-late', 'L-birthday', 'L-early']);
    expect([b, late, early]).toHaveLength(3);
  });
});
