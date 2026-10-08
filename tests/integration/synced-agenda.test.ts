import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { event } from '@/db/schema';
import {
  connectCalendar,
  disconnectCalendar,
  getCalendar,
  reconnectCalendar,
} from '@/domain/calendar/service';
import { refreshCalendar } from '@/domain/calendar/sync';
import { NotFoundError } from '@/domain/common/errors';
import { agenda, type AgendaItem } from '@/domain/engines/agenda';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import { getEvent, listEventPeople, listEvents, setEventPerson } from '@/domain/events/service';
import { createNote, listNotes } from '@/domain/notes/service';
import { createPerson } from '@/domain/people/service';
import type { UserActor } from '@/trust/actor';
import { fakeProvider, type FakeStep } from '@/integrations/calendar/fake';
import {
  SYNTHETIC_ADDRESS,
  allDayEvent,
  googleFeed,
  nzEvent,
  vevent,
} from '../fixtures/calendars/google';
import { TODAY } from '../fixtures/calendars/sequences';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// Synced events on the agenda (M4 contract §5.2, ADR 0007 §13, §14, §42;
// Package 6): real synthetic feeds through the sync service, then exactly
// the composition the agenda loader does (the domain reads as the actor,
// override suppression, the calendar's usual people), into the agenda
// engine. No screen, no provider of HOME's own, no real calendar.

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

let n = 100;
const nextAddress = () =>
  SYNTHETIC_ADDRESS.replace(
    'private-0123456789abcdef0123456789abcdef',
    `private-${(++n).toString(16).padStart(8, '0')}${'cd'.repeat(12)}`,
  );
const provider = (feeds: readonly (string | FakeStep)[]) =>
  fakeProvider(
    feeds.map((f) => (typeof f === 'string' ? { ics: f } : f)),
    { homeTimeZone: ZONE },
  );
const connect = async (
  actor: UserActor = h.sam,
  extra: Partial<Parameters<typeof connectCalendar>[1]> = {},
) => {
  const address = nextAddress();
  const r = await connectCalendar(
    actor,
    { address, name: 'Sam’s work', visibility: 'household', ...extra },
    deps,
  );
  return { ...r, address };
};
const refresh = (id: string, p: ReturnType<typeof provider>, actor: UserActor = h.sam) =>
  refreshCalendar(actor, id, p, { today: TODAY }, deps);

/**
 * The loader's composition, as the actor: what Today, Forward and Coming up
 * would show (readAgendaInputs, the domain's own composition since M5
 * Package 1). Narrowed to one calendar's events when asked, since every test
 * here connects a calendar of its own in the same household.
 */
async function agendaFor(actor: UserActor, from: string, to: string, calendarId?: string) {
  const [inputs, events] = await Promise.all([
    readAgendaInputs(actor, deps),
    listEvents(actor, {}, deps),
  ]);
  const mine = new Set(
    events.filter((e) => !calendarId || e.calendarSourceId === calendarId).map((e) => e.id),
  );
  return agenda({
    from,
    to,
    timeZone: ZONE,
    events: inputs.events.filter((e) => mine.has(e.id)),
  });
}
const eventsOn = async (actor: UserActor, date: string, calendarId?: string) =>
  (await agendaFor(actor, date, date, calendarId))
    .flatMap((d) => d.items)
    .filter((i): i is Extract<AgendaItem, { kind: 'event' }> => i.kind === 'event');
const summary = (i: Extract<AgendaItem, { kind: 'event' }>) =>
  i.allDay ? `${i.title} all day` : `${i.title} ${i.startsAt.toISOString()}`;

const SWIM = 'swim-p6@example.test';
const swim = (extra: Partial<Parameters<typeof nzEvent>[0]> = {}) =>
  nzEvent({
    uid: SWIM,
    start: '20261014T153000',
    end: '20261014T163000',
    rrule: 'FREQ=WEEKLY;BYDAY=WE',
    summary: 'Swimming',
    ...extra,
  });
// Wednesday 4 November 15:30 NZDT (02:30Z), moved to 17:00 that day.
const movedSwim = nzEvent({
  uid: SWIM,
  recurrenceId: '20261104T153000',
  start: '20261104T170000',
  end: '20261104T180000',
  summary: 'Swimming',
  sequence: 1,
});
const brokenSwim = vevent({ UID: SWIM, DTSTART: ';VALUE=DATE:20261332', SUMMARY: 'Swimming' });

describe('override suppression', () => {
  it('a moved occurrence shows once at its new time even while the series lacks its EXDATE (a partial refresh)', async () => {
    const { calendarId } = await connect();
    const p = provider([
      googleFeed([swim()]),
      // The series is unreadable this time (its UID still known), the override readable.
      googleFeed([brokenSwim, movedSwim]),
    ]);
    await refresh(calendarId, p);
    expect((await eventsOn(h.sam, '2026-11-04', calendarId)).map(summary)).toEqual([
      'Swimming 2026-11-04T02:30:00.000Z',
    ]);
    p.advance();
    expect(await refresh(calendarId, p)).toMatchObject({ status: 'partial' });
    const rows = await admin.db.select().from(event).where(eq(event.calendarSourceId, calendarId));
    const series = rows.find((r) => r.recurrenceOriginal === null)!;
    const override = rows.find((r) => r.recurrenceOriginal !== null)!;
    expect(series.exdates).toBeNull(); // the partial state ADR 0007 §42 describes
    expect(override.recurrenceParentId).toBeNull(); // not linked either: identity (source, UID) does the work
    // One row that day, the moved one; the week before and after untouched.
    expect((await eventsOn(h.sam, '2026-11-04', calendarId)).map(summary)).toEqual([
      'Swimming 2026-11-04T04:00:00.000Z',
    ]);
    expect((await eventsOn(h.sam, '2026-10-28', calendarId)).map(summary)).toEqual([
      'Swimming 2026-10-28T02:30:00.000Z',
    ]);
    expect((await eventsOn(h.sam, '2026-11-11', calendarId)).map(summary)).toEqual([
      'Swimming 2026-11-11T02:30:00.000Z',
    ]);
  });

  it('the series repairing its EXDATE later changes nothing: still one; a cancelled occurrence stays absent', async () => {
    const { calendarId } = await connect();
    const p = provider([
      googleFeed([brokenSwim, movedSwim]),
      googleFeed([swim({ exdate: ['20261104T153000', '20261118T153000'] }), movedSwim]),
    ]);
    await refresh(calendarId, p);
    p.advance();
    await refresh(calendarId, p);
    expect((await eventsOn(h.sam, '2026-11-04', calendarId)).map(summary)).toEqual([
      'Swimming 2026-11-04T04:00:00.000Z',
    ]);
    expect(await eventsOn(h.sam, '2026-11-18', calendarId)).toEqual([]);
  });

  it('an override that goes away (archived) no longer suppresses: the regular occurrence is back', async () => {
    const { calendarId } = await connect();
    const p = provider([googleFeed([swim(), movedSwim]), googleFeed([swim()])]);
    await refresh(calendarId, p);
    expect((await eventsOn(h.sam, '2026-11-04', calendarId)).map(summary)).toEqual([
      'Swimming 2026-11-04T04:00:00.000Z',
    ]);
    p.advance();
    await refresh(calendarId, p);
    const rows = await admin.db.select().from(event).where(eq(event.calendarSourceId, calendarId));
    expect(rows.find((r) => r.recurrenceOriginal !== null)?.archivedAt).toBeInstanceOf(Date);
    expect((await eventsOn(h.sam, '2026-11-04', calendarId)).map(summary)).toEqual([
      'Swimming 2026-11-04T02:30:00.000Z',
    ]);
  });

  it('an orphan override (its series gone) is its own event at its moved time, once', async () => {
    const { calendarId } = await connect();
    const p = provider([googleFeed([swim(), movedSwim]), googleFeed([movedSwim])]);
    await refresh(calendarId, p);
    p.advance();
    await refresh(calendarId, p);
    expect((await eventsOn(h.sam, '2026-11-04', calendarId)).map(summary)).toEqual([
      'Swimming 2026-11-04T04:00:00.000Z',
    ]);
    expect(await eventsOn(h.sam, '2026-11-11', calendarId)).toEqual([]);
  });
});

describe('time zones and all-day series', () => {
  it('all-day series, a UTC event, another zone’s event landing on a different HOME date, and both NZ DST changes', async () => {
    const { calendarId } = await connect();
    await refresh(
      calendarId,
      provider([
        googleFeed([
          allDayEvent({
            uid: 'bins@example.test',
            start: '20261014',
            end: '20261015',
            summary: 'Bins out',
            rrule: 'FREQ=WEEKLY',
          }),
          // 12:00Z on the 15th is 01:00 NZDT on the 16th.
          vevent({
            UID: 'utc@example.test',
            DTSTART: '20261015T120000Z',
            DTEND: '20261015T130000Z',
            SUMMARY: 'Call (UTC)',
          }),
          // 09:00 in New York on Sunday 25 Oct (EDT) is 02:00 NZDT on Monday 26 Oct;
          // a week later New York has fallen back, so 09:00 EST is 03:00 NZDT.
          vevent({
            UID: 'ny@example.test',
            DTSTART: ';TZID=America/New_York:20261025T090000',
            DTEND: ';TZID=America/New_York:20261025T100000',
            RRULE: 'FREQ=WEEKLY;COUNT=2',
            SUMMARY: 'New York call',
          }),
          nzEvent({
            uid: 'gap@example.test',
            start: '20260927T023000',
            end: '20260927T033000',
            summary: 'In the gap',
          }),
          nzEvent({
            uid: 'overlap@example.test',
            start: '20270404T023000',
            end: '20270404T033000',
            summary: 'In the overlap',
          }),
          nzEvent({
            uid: 'run@example.test',
            start: '20260920T060000',
            end: '20260920T070000',
            rrule: 'FREQ=WEEKLY;BYDAY=SU;COUNT=40',
            summary: 'Early run',
          }),
        ]),
      ]),
    );
    expect((await eventsOn(h.sam, '2026-10-21', calendarId)).map(summary)).toEqual([
      'Bins out all day',
    ]);
    expect((await eventsOn(h.sam, '2026-10-16', calendarId)).map(summary)).toEqual([
      'Call (UTC) 2026-10-15T12:00:00.000Z',
    ]);
    expect((await eventsOn(h.sam, '2026-10-26', calendarId)).map(summary)).toEqual([
      'New York call 2026-10-25T13:00:00.000Z',
    ]);
    expect((await eventsOn(h.sam, '2026-11-02', calendarId)).map(summary)).toEqual([
      'New York call 2026-11-01T14:00:00.000Z',
    ]);
    // Spring forward: 02:30 does not exist; the event lands after the gap, on the 27th.
    const gap = (await eventsOn(h.sam, '2026-09-27', calendarId)).find(
      (i) => i.title === 'In the gap',
    )!;
    expect(gap.allDay ? null : gap.startsAt.toISOString()).toBe('2026-09-26T14:30:00.000Z');
    // Autumn back: 02:30 happens twice; one occurrence, on the 4th.
    expect(
      (await eventsOn(h.sam, '2027-04-04', calendarId)).filter((i) => i.title === 'In the overlap'),
    ).toHaveLength(1);
    // The early run keeps 06:00 on the wall clock on both sides of the change.
    const before = (await eventsOn(h.sam, '2026-09-20', calendarId)).find(
      (i) => i.title === 'Early run',
    )!;
    const after = (await eventsOn(h.sam, '2026-10-04', calendarId)).find(
      (i) => i.title === 'Early run',
    )!;
    expect([before, after].map((i) => (i.allDay ? null : i.startsAt.toISOString()))).toEqual([
      '2026-09-19T18:00:00.000Z',
      '2026-10-03T17:00:00.000Z',
    ]);
  });
});

describe('who an event is for, and what survives', () => {
  it('a calendar’s usual people show where an event has none of its own; an annotation of its own wins; a private person is never a household calendar’s usual person', async () => {
    const milo = await createPerson(h.sam, { name: 'Milo P6', role: 'child' }, deps);
    const isla = await createPerson(h.sam, { name: 'Isla P6', role: 'child' }, deps);
    const secret = await createPerson(
      h.sam,
      { name: 'Private P6', role: 'other', visibility: 'private' },
      deps,
    );
    // The reference rule (ADR 0007 §42) refuses a private person as a household calendar's usual person.
    await expect(connect(h.sam, { defaultPersonIds: [secret.id] })).rejects.toMatchObject({
      code: 'references_private',
    });
    const { calendarId } = await connect(h.sam, { defaultPersonIds: [milo.id] });
    await refresh(calendarId, provider([googleFeed([swim()])]));
    const [row] = await listEvents(h.sam, {}, deps).then((es) =>
      es.filter((e) => e.calendarSourceId === calendarId),
    );
    for (const who of [h.sam, h.alex])
      expect((await eventsOn(who, '2026-10-14', calendarId))[0]!.people).toEqual([
        { personId: milo.id, role: 'attending' },
      ]);
    // An annotation of its own replaces the usual people, for both adults.
    await setEventPerson(h.sam, { eventId: row!.id, personId: isla.id, role: 'responsible' }, deps);
    for (const who of [h.sam, h.alex])
      expect((await eventsOn(who, '2026-10-14', calendarId))[0]!.people).toEqual([
        { personId: isla.id, role: 'responsible' },
      ]);
    // A private calendar may name a private person; only its owner sees either.
    const mine = await connect(h.sam, { visibility: 'private', defaultPersonIds: [secret.id] });
    await refresh(
      mine.calendarId,
      provider([googleFeed([swim({ uid: 'swim-private@example.test' })])]),
    );
    expect((await eventsOn(h.sam, '2026-10-14', mine.calendarId))[0]!.people).toEqual([
      { personId: secret.id, role: 'attending' },
    ]);
    expect(await eventsOn(h.alex, '2026-10-14', mine.calendarId)).toEqual([]);
  });

  it('a provider update keeps the same row, its people and its notes', async () => {
    const kid = await createPerson(h.sam, { name: 'Kid P6', role: 'child' }, deps);
    const { calendarId } = await connect();
    const p = provider([
      googleFeed([swim()]),
      googleFeed([swim({ summary: 'Swimming (lane 4)', sequence: 2 })]),
    ]);
    await refresh(calendarId, p);
    const [before] = (await listEvents(h.sam, {}, deps)).filter(
      (e) => e.calendarSourceId === calendarId,
    );
    await setEventPerson(h.sam, { eventId: before!.id, personId: kid.id, role: 'attending' }, deps);
    await createNote(h.sam, { body: 'Goggles', subject: { type: 'event', id: before!.id } }, deps);
    p.advance();
    await refresh(calendarId, p);
    const after = await getEvent(h.sam, before!.id, {}, deps);
    expect(after.title).toBe('Swimming (lane 4)');
    expect((await eventsOn(h.sam, '2026-10-14', calendarId)).map((i) => i.title)).toEqual([
      'Swimming (lane 4)',
    ]);
    expect(await listEventPeople(h.sam, before!.id, {}, deps)).toHaveLength(1);
    expect(
      await listNotes(h.sam, { subject: { type: 'event', id: before!.id } }, deps),
    ).toHaveLength(1);
  });

  it('disconnecting takes the events off the agenda through the ordinary read; reconnecting brings the same rows back with their people', async () => {
    const kid = await createPerson(h.sam, { name: 'Kid P6b', role: 'child' }, deps);
    const { calendarId, address } = await connect();
    const p = provider([googleFeed([swim()])]);
    await refresh(calendarId, p);
    const [row] = (await listEvents(h.sam, {}, deps)).filter(
      (e) => e.calendarSourceId === calendarId,
    );
    await setEventPerson(h.sam, { eventId: row!.id, personId: kid.id, role: 'attending' }, deps);
    await disconnectCalendar(h.sam, calendarId, deps);
    expect(await eventsOn(h.sam, '2026-10-14', calendarId)).toEqual([]);
    expect(await eventsOn(h.alex, '2026-10-14', calendarId)).toEqual([]);
    await reconnectCalendar(h.sam, calendarId, { address }, deps);
    await refresh(calendarId, p);
    const back = await eventsOn(h.sam, '2026-10-14', calendarId);
    expect(back.map((i) => i.eventId)).toEqual([row!.id]);
    expect(back[0]!.people).toEqual([{ personId: kid.id, role: 'attending' }]);
  });

  it('a failed refresh leaves the last-known events on the agenda', async () => {
    const { calendarId } = await connect();
    const p = provider([googleFeed([swim()]), { fail: 'unreachable' }]);
    await refresh(calendarId, p);
    p.advance();
    expect(await refresh(calendarId, p)).toMatchObject({ status: 'unreachable' });
    expect((await eventsOn(h.sam, '2026-10-14', calendarId)).map((i) => i.title)).toEqual([
      'Swimming',
    ]);
    expect((await getCalendar(h.sam, calendarId, {}, deps)).lastSyncStatus).toBe('unreachable');
  });
});

describe('privacy', () => {
  it('a private calendar’s events are on its owner’s agenda only; the event, like the calendar, is not found for the other adult', async () => {
    const { calendarId } = await connect(h.alex, { name: 'Alex only', visibility: 'private' });
    await refresh(
      calendarId,
      provider([
        googleFeed([
          nzEvent({
            uid: 'alex-private@example.test',
            start: '20261015T120000',
            end: '20261015T130000',
            summary: 'Alex’s private thing',
          }),
        ]),
      ]),
      h.alex,
    );
    const mine = await eventsOn(h.alex, '2026-10-15', calendarId);
    expect(mine.map((i) => i.title)).toEqual(['Alex’s private thing']);
    expect((await eventsOn(h.sam, '2026-10-15')).map((i) => i.title)).not.toContain(
      'Alex’s private thing',
    );
    await expect(getEvent(h.sam, mine[0]!.eventId, {}, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCalendar(h.sam, calendarId, {}, deps)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a household calendar’s events are on both agendas; the other adult reads the calendar’s name and freshness, never its connection', async () => {
    const { calendarId } = await connect(h.sam, { name: 'Sam’s work' });
    await refresh(calendarId, provider([googleFeed([swim()])]));
    expect((await eventsOn(h.alex, '2026-10-14', calendarId)).map((i) => i.title)).toContain(
      'Swimming',
    );
    const seen = await getCalendar(h.alex, calendarId, {}, deps);
    expect(seen.name).toBe('Sam’s work');
    expect(seen.lastSyncedAt).toBeInstanceOf(Date);
    expect(seen.isOwner).toBe(false);
    expect(seen.connection).toBeNull();
  });
});
