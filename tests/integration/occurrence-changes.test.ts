import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, event } from '@/db/schema';
import { connectCalendar } from '@/domain/calendar/service';
import { refreshCalendar } from '@/domain/calendar/sync';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import { agenda } from '@/domain/engines/agenda';
import { regularWeek } from '@/domain/engines/profile';
import {
  hiddenOccurrenceChanges,
  isOccurrenceChange,
  overriddenOriginals,
  recurringWithOverrides,
} from '@/domain/events/occurrences';
import {
  archiveEvent,
  changeEventOccurrence,
  createEvent,
  editEventWithPeople,
  getEvent,
  listEventPeople,
  listEvents,
  listOccurrenceChanges,
  restoreEvent,
  returnOccurrenceToSeries,
  setEventPeople,
  setEventPerson,
  skipEventOccurrence,
  updateEvent,
  type Event,
} from '@/domain/events/service';
import { effectivePeople, occurrenceChangePeople } from '@/domain/events/who';
import { createNote, listNotes } from '@/domain/notes/service';
import { createPerson, listPeople } from '@/domain/people/service';
import { fakeProvider } from '@/integrations/calendar/fake';
import type { UserActor } from '@/trust/actor';
import { auditRowColumns } from '@/trust/audit';
import { SYNTHETIC_ADDRESS, googleFeed, nzEvent } from '../fixtures/calendars/google';
import { TODAY } from '../fixtures/calendars/sequences';
import { testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// Package 8a (M4 contract §3.7, ADR 0007 §46): one occurrence of a
// repeating manual event, changed on its own, through the domain services
// as each adult. The agenda is composed exactly as the loader composes it.
// Synthetic data only.

const { db, close } = testDb();
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
});

// Wednesday swimming, 15:30 in Auckland, from 14 October 2026.
const WED_14 = '2026-10-14T02:30:00Z';
const WED_21 = '2026-10-21T02:30:00Z';
const WED_28 = '2026-10-28T02:30:00Z';
let n = 0;
const weekly = (actor: UserActor, extra: Record<string, unknown> = {}) =>
  createEvent(
    actor,
    {
      title: `Swimming 8a-${++n}`,
      description: 'Bring the blue towel',
      location: 'The pool on Example Road',
      kind: 'activity',
      time: {
        allDay: false,
        startsAt: '2026-10-14T15:30:00+13:00',
        endsAt: '2026-10-14T16:15:00+13:00',
        timeZone: ZONE,
      },
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
      ...extra,
    } as Parameters<typeof createEvent>[1],
    deps,
  );
const at = (iso: string, minutes = 45) => ({
  allDay: false as const,
  startsAt: iso,
  endsAt: new Date(new Date(iso).getTime() + minutes * 60_000).toISOString(),
  timeZone: ZONE,
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: unknown) =>
      e instanceof NotPermittedError
        ? e.code
        : e instanceof NotFoundError
          ? 'not_found'
          : `threw: ${String(e)}`,
  );

/** The manual change rows of a series, live and archived, straight from the table. */
const changesOf = (seriesId: string) =>
  db
    .select()
    .from(event)
    .where(and(eq(event.recurrenceParentId, seriesId), eq(event.source, 'manual')))
    .orderBy(event.createdAt);
const liveChangesOf = (seriesId: string) =>
  db
    .select()
    .from(event)
    .where(and(eq(event.recurrenceParentId, seriesId), isNull(event.archivedAt)));
const auditsOf = (id: string) =>
  db.select(auditRowColumns).from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.at);

/** The series row, minus nothing: it must not change when one occurrence does. */
const rowOf = async (id: string) =>
  (await db.select().from(event).where(eq(event.id, id)))[0] as Event;

/** This adult's agenda for the series' rows, as `loadAgenda` composes it. */
async function agendaFor(actor: UserActor, ids: string[], from: string, to: string) {
  const [events, people] = await Promise.all([
    listEvents(actor, {}, deps),
    listPeople(actor, {}, deps),
  ]);
  const visible = new Set(people.map((p) => p.id));
  const mine = events.filter((e) => ids.includes(e.id) || ids.includes(e.recurrenceParentId!));
  const hidden = hiddenOccurrenceChanges(events);
  const shown = mine.filter((e) => !hidden.has(e.id));
  const overridden = overriddenOriginals(events);
  const annotations = new Map<string, { personId: string; role: 'attending' | 'responsible' }[]>();
  for (const e of shown)
    annotations.set(
      e.id,
      (await listEventPeople(actor, e.id, {}, deps)).map((a) => ({
        personId: a.personId,
        role: a.role as 'attending' | 'responsible',
      })),
    );
  const inputs = shown.map((e) => ({
    ...recurringWithOverrides(e, overridden),
    id: e.id,
    title: e.title,
    people: (isOccurrenceChange(e)
      ? occurrenceChangePeople(
          annotations.get(e.id) ?? [],
          annotations.get(e.recurrenceParentId!) ?? [],
          visible,
        )
      : effectivePeople(annotations.get(e.id) ?? [], undefined, visible)
    ).people,
  }));
  return {
    inputs,
    rows: agenda({ from, to, timeZone: ZONE, events: inputs }).flatMap((d) =>
      d.items.flatMap((i) =>
        i.kind === 'event'
          ? [`${d.date} ${i.allDay ? 'all day' : i.startsAt.toISOString()} ${i.title}`]
          : [],
      ),
    ),
  };
}
const showing = async (actor: UserActor, ids: string[], from: string, to: string) =>
  (await agendaFor(actor, ids, from, to)).rows;

describe('changing one occurrence', () => {
  it('the first change makes one override from the occurrence, and leaves the series exactly as it was', async () => {
    const swim = await weekly(h.sam);
    const before = await rowOf(swim.id);
    const changed = await changeEventOccurrence(
      h.sam,
      swim.id,
      WED_21,
      { time: at('2026-10-21T16:00:00+13:00') },
      deps,
    );
    expect(await rowOf(swim.id)).toEqual(before); // updatedAt included
    expect(changed).toMatchObject({
      source: 'manual',
      recurrenceParentId: swim.id,
      recurrenceOriginal: WED_21,
      rrule: null,
      exdates: null,
      title: swim.title,
      description: 'Bring the blue towel',
      location: 'The pool on Example Road',
      kind: 'activity',
      allDay: false,
      timeZone: ZONE,
      visibility: 'household',
      createdBy: h.sam.userId,
      createdVia: 'ui',
      calendarSourceId: null,
      archivedAt: null,
    });
    expect(changed.startsAt).toEqual(new Date('2026-10-21T03:00:00Z'));
    expect(await showing(h.sam, [swim.id], '2026-10-14', '2026-10-28')).toEqual([
      `2026-10-14 2026-10-14T02:30:00.000Z ${swim.title}`,
      `2026-10-21 2026-10-21T03:00:00.000Z ${swim.title}`,
      `2026-10-28 2026-10-28T02:30:00.000Z ${swim.title}`,
    ]);
  });

  it('starts from the occurrence’s own time when only its details change', async () => {
    const swim = await weekly(h.sam);
    const c = await changeEventOccurrence(h.sam, swim.id, WED_28, { title: 'Swim gala' }, deps);
    expect(c.startsAt).toEqual(new Date(WED_28));
    expect(c.endsAt).toEqual(new Date('2026-10-28T03:15:00Z'));
    expect(await showing(h.sam, [swim.id], '2026-10-28', '2026-10-28')).toEqual([
      '2026-10-28 2026-10-28T02:30:00.000Z Swim gala',
    ]);
  });

  it('changing the same occurrence again updates the same row, never a second one', async () => {
    const swim = await weekly(h.sam);
    const first = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'A' }, deps);
    const second = await changeEventOccurrence(
      h.alex,
      swim.id,
      WED_21,
      { location: 'The other pool', time: at('2026-10-21T17:00:00+13:00') },
      deps,
    );
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ title: 'A', location: 'The other pool' });
    expect(await changesOf(swim.id)).toHaveLength(1);
    // Still Sam's, as the series is, though Alex changed it.
    expect(second.createdBy).toBe(h.sam.userId);
  });

  it('moves to another date: gone from the original day, once on the new one', async () => {
    const swim = await weekly(h.sam);
    await changeEventOccurrence(
      h.sam,
      swim.id,
      WED_21,
      { time: at('2026-10-23T09:00:00+13:00') },
      deps,
    );
    expect(await showing(h.sam, [swim.id], '2026-10-21', '2026-10-23')).toEqual([
      `2026-10-23 2026-10-22T20:00:00.000Z ${swim.title}`,
    ]);
  });

  it('timed to all-day, and an all-day series’ occurrence to timed', async () => {
    const swim = await weekly(h.sam);
    await changeEventOccurrence(
      h.sam,
      swim.id,
      WED_21,
      { time: { allDay: true, startDate: '2026-10-21', endDate: '2026-10-22' } },
      deps,
    );
    expect(await showing(h.sam, [swim.id], '2026-10-21', '2026-10-21')).toEqual([
      `2026-10-21 all day ${swim.title}`,
    ]);
    const bins = await createEvent(
      h.sam,
      {
        title: 'Bins 8a',
        kind: 'other',
        time: { allDay: true, startDate: '2026-10-13', endDate: '2026-10-14' },
        rrule: 'FREQ=WEEKLY',
      },
      deps,
    );
    expect(
      await code(
        changeEventOccurrence(h.sam, bins.id, '2026-10-20T00:00:00Z', { title: 'x' }, deps),
      ),
    ).toBe('not_an_occurrence');
    await changeEventOccurrence(
      h.sam,
      bins.id,
      '2026-10-20',
      { time: at('2026-10-20T07:00:00+13:00', 15) },
      deps,
    );
    expect(await showing(h.sam, [bins.id], '2026-10-20', '2026-10-27')).toEqual([
      '2026-10-20 2026-10-19T18:00:00.000Z Bins 8a',
      '2026-10-27 all day Bins 8a',
    ]);
  });

  it('several occurrences change independently', async () => {
    const swim = await weekly(h.sam);
    await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'One' }, deps);
    await changeEventOccurrence(h.sam, swim.id, WED_28, { title: 'Two' }, deps);
    expect(await liveChangesOf(swim.id)).toHaveLength(2);
    await returnOccurrenceToSeries(h.sam, swim.id, WED_21, deps);
    expect(await showing(h.sam, [swim.id], '2026-10-21', '2026-10-28')).toEqual([
      `2026-10-21 2026-10-21T02:30:00.000Z ${swim.title}`,
      '2026-10-28 2026-10-28T02:30:00.000Z Two',
    ]);
  });
});

describe('what can be changed', () => {
  it('only a real occurrence of the current rule, proved by the engine; nothing is written otherwise', async () => {
    const swim = await weekly(h.sam);
    for (const value of [
      '2026-10-21T03:00:00Z', // a plausible time the rule does not reach
      '2026-10-22T02:30:00Z', // a plausible day it does not reach
      '2026-10-07T02:30:00Z', // before it began
      '2026-10-21', // a date, for a timed series
      '2026-10-21T15:30:00+13:00', // not the stored form
      '../../etc',
      '',
    ])
      expect(
        await code(changeEventOccurrence(h.sam, swim.id, value, { title: 'x' }, deps)),
        value,
      ).toBe('not_an_occurrence');
    expect(await changesOf(swim.id)).toEqual([]);
  });

  it('refuses a one-off event, a skipped occurrence, an empty change and a change row itself', async () => {
    const once = await createEvent(
      h.sam,
      { title: 'Once 8a', kind: 'other', time: at('2026-10-21T15:30:00+13:00') },
      deps,
    );
    expect(await code(changeEventOccurrence(h.sam, once.id, WED_21, { title: 'x' }, deps))).toBe(
      'not_recurring',
    );
    const swim = await weekly(h.sam);
    await skipEventOccurrence(h.sam, swim.id, '2026-10-21', deps);
    expect(await code(changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'x' }, deps))).toBe(
      'occurrence_skipped',
    );
    expect(await code(changeEventOccurrence(h.sam, swim.id, WED_28, {}, deps))).toMatch(/threw/);
    expect(
      await code(
        changeEventOccurrence(
          h.sam,
          swim.id,
          WED_28,
          { title: 'x', visibility: 'private' } as never,
          deps,
        ),
      ),
    ).toMatch(/threw/); // visibility is the series’, never an input
    const c = await changeEventOccurrence(h.sam, swim.id, WED_28, { title: 'x' }, deps);
    expect(await code(changeEventOccurrence(h.sam, c.id, WED_28, { title: 'y' }, deps))).toBe(
      'occurrence_change',
    );
    // Edited only as an occurrence: never through the whole-event edit.
    expect(await code(updateEvent(h.sam, c.id, { title: 'y' }, deps))).toBe('occurrence_change');
    expect(await code(updateEvent(h.sam, c.id, { rrule: 'FREQ=DAILY' }, deps))).toBe(
      'occurrence_change',
    );
    expect(await code(editEventWithPeople(h.sam, c.id, { visibility: 'private' }, [], deps))).toBe(
      'occurrence_change',
    );
    expect(await code(skipEventOccurrence(h.sam, c.id, '2026-10-28', deps))).toBe('not_recurring');
    expect(await changesOf(swim.id)).toHaveLength(1);
  });

  it('refuses a synced series: the calendar owns it', async () => {
    const cal = await connectCalendar(
      h.sam,
      { address: SYNTHETIC_ADDRESS, name: 'Synced 8a', visibility: 'household' },
      deps,
    );
    await refreshCalendar(
      h.sam,
      cal.calendarId,
      fakeProvider(
        [
          {
            ics: googleFeed([
              nzEvent({
                uid: 'p8a-synced@example.test',
                start: '20261014T153000',
                end: '20261014T161500',
                rrule: 'FREQ=WEEKLY;BYDAY=WE',
                summary: 'Synced swim 8a',
              }),
            ]),
          },
        ],
        { homeTimeZone: ZONE },
      ),
      { today: TODAY },
      deps,
    );
    const [synced] = (await listEvents(h.sam, {}, deps)).filter(
      (e) => e.title === 'Synced swim 8a',
    );
    expect(synced?.source).toBe('synced');
    expect(await code(changeEventOccurrence(h.sam, synced!.id, WED_21, { title: 'x' }, deps))).toBe(
      'synced_event',
    );
    expect(await code(returnOccurrenceToSeries(h.sam, synced!.id, WED_21, deps))).toBe(
      'synced_event',
    );
    expect(await db.select().from(event).where(eq(event.recurrenceParentId, synced!.id))).toEqual(
      [],
    );
  });
});

describe('back to the series', () => {
  it('archives the change (never deletes it), keeps its people and notes on it, and the original returns', async () => {
    const swim = await weekly(h.sam);
    const kid = await createPerson(h.sam, { name: 'Kid 8a', role: 'child' }, deps);
    const c = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'Moved' }, deps);
    await setEventPerson(h.sam, { eventId: c.id, personId: kid.id, role: 'attending' }, deps);
    const note = await createNote(
      h.sam,
      { body: 'Only this week', subject: { type: 'event', id: c.id } },
      deps,
    );
    const before = await rowOf(swim.id);
    const back = await returnOccurrenceToSeries(h.sam, swim.id, WED_21, deps);
    expect(back.id).toBe(c.id);
    expect(back.archivedAt).not.toBeNull();
    expect(await rowOf(swim.id)).toEqual(before);
    expect(await changesOf(swim.id)).toHaveLength(1); // still there, archived
    expect(
      (await listEventPeople(h.sam, c.id, { includeArchived: true }, deps)).map((a) => a.personId),
    ).toEqual([kid.id]);
    expect(
      (
        await listNotes(
          h.sam,
          { subject: { type: 'event', id: c.id }, includeArchived: true },
          deps,
        )
      ).map((x) => x.id),
    ).toEqual([note.id]);
    expect(await showing(h.sam, [swim.id], '2026-10-21', '2026-10-21')).toEqual([
      `2026-10-21 2026-10-21T02:30:00.000Z ${swim.title}`,
    ]);
    expect(await code(returnOccurrenceToSeries(h.sam, swim.id, WED_21, deps))).toBe('not_changed');
    expect(await code(returnOccurrenceToSeries(h.sam, swim.id, 'nonsense', deps))).toBe(
      'not_changed',
    );
  });

  it('a new change after going back is a new row; the old one cannot be restored beside it', async () => {
    const swim = await weekly(h.sam);
    const old = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'Old' }, deps);
    await returnOccurrenceToSeries(h.sam, swim.id, WED_21, deps);
    const fresh = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'New' }, deps);
    expect(fresh.id).not.toBe(old.id);
    expect(await code(restoreEvent(h.sam, old.id, deps))).toBe('occurrence_already_changed');
    expect(await liveChangesOf(swim.id)).toHaveLength(1);
    // Once the new one goes back, the old one may return.
    await returnOccurrenceToSeries(h.sam, swim.id, WED_21, deps);
    const restored = await restoreEvent(h.sam, old.id, deps);
    expect(restored.archivedAt).toBeNull();
    expect(await showing(h.sam, [swim.id], '2026-10-21', '2026-10-21')).toEqual([
      '2026-10-21 2026-10-21T02:30:00.000Z Old',
    ]);
  });

  it('archiving the change directly is the same as going back', async () => {
    const swim = await weekly(h.sam);
    const c = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'Moved' }, deps);
    await archiveEvent(h.sam, c.id, deps);
    expect(await liveChangesOf(swim.id)).toEqual([]);
    const again = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'Again' }, deps);
    expect(again.id).not.toBe(c.id);
  });
});

describe('when the series changes', () => {
  it('archived: its changes are not shown, cannot be made or restored, and come back with it', async () => {
    const swim = await weekly(h.sam);
    const c = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'Moved' }, deps);
    const spare = await changeEventOccurrence(h.sam, swim.id, WED_28, { title: 'Spare' }, deps);
    await returnOccurrenceToSeries(h.sam, swim.id, WED_28, deps);
    await archiveEvent(h.sam, swim.id, deps);
    expect(await showing(h.sam, [swim.id], '2026-10-14', '2026-10-28')).toEqual([]);
    expect((await getEvent(h.sam, c.id, {}, deps)).archivedAt).toBeNull(); // nothing was written to it
    expect(await code(changeEventOccurrence(h.sam, swim.id, WED_14, { title: 'x' }, deps))).toBe(
      'not_found',
    );
    expect(await code(restoreEvent(h.sam, spare.id, deps))).toBe('series_archived');
    await restoreEvent(h.sam, swim.id, deps);
    expect(await showing(h.sam, [swim.id], '2026-10-21', '2026-10-21')).toEqual([
      '2026-10-21 2026-10-21T02:30:00.000Z Moved',
    ]);
  });

  it('a new rule keeps the changes it still reaches and archives the rest, never re-keying them', async () => {
    const swim = await weekly(h.sam);
    const kept = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'Kept' }, deps);
    const lost = await changeEventOccurrence(h.sam, swim.id, WED_28, { title: 'Lost' }, deps);
    // Until the 21st, then over.
    await updateEvent(
      h.sam,
      swim.id,
      { rrule: 'FREQ=WEEKLY;BYDAY=WE;UNTIL=20261022T000000Z' },
      deps,
    );
    expect((await rowOf(kept.id)).archivedAt).toBeNull();
    const gone = await rowOf(lost.id);
    expect(gone.archivedAt).not.toBeNull();
    expect(gone.recurrenceOriginal).toBe(WED_28); // never re-keyed
    expect((await auditsOf(lost.id)).at(-1)).toMatchObject({
      event: 'event.archive',
      meta: { seriesId: swim.id, reason: 'series_changed' },
    });
    // It cannot be restored into a rule that no longer reaches it.
    expect(await code(restoreEvent(h.sam, lost.id, deps))).toBe('not_an_occurrence');
    expect(await showing(h.sam, [swim.id], '2026-10-14', '2026-10-28')).toEqual([
      `2026-10-14 2026-10-14T02:30:00.000Z ${swim.title}`,
      '2026-10-21 2026-10-21T02:30:00.000Z Kept',
    ]);
  });

  it('a new time for the whole series is a new rule too: timed changes it no longer reaches are archived', async () => {
    const swim = await weekly(h.sam);
    const c = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'Gala' }, deps);
    await updateEvent(h.sam, swim.id, { time: at('2026-10-14T16:00:00+13:00') }, deps);
    expect((await rowOf(c.id)).archivedAt).not.toBeNull();
    // A title-only edit of the series keeps every change.
    const d = await changeEventOccurrence(
      h.sam,
      swim.id,
      '2026-10-21T03:00:00Z',
      { title: 'Gala' },
      deps,
    );
    await updateEvent(h.sam, swim.id, { title: 'Renamed 8a' }, deps);
    expect((await rowOf(d.id)).archivedAt).toBeNull();
  });
});

describe('privacy', () => {
  it('the other adult can neither see nor change one occurrence of a private series', async () => {
    const mine = await weekly(h.alex, { visibility: 'private' });
    expect(await code(changeEventOccurrence(h.sam, mine.id, WED_21, { title: 'x' }, deps))).toBe(
      'not_found',
    );
    const c = await changeEventOccurrence(h.alex, mine.id, WED_21, { title: 'Alex only' }, deps);
    expect(c).toMatchObject({ visibility: 'private', createdBy: h.alex.userId });
    expect(await code(returnOccurrenceToSeries(h.sam, mine.id, WED_21, deps))).toBe('not_found');
    expect(await code(restoreEvent(h.sam, c.id, deps))).toBe('not_found');
    expect(await code(listOccurrenceChanges(h.sam, mine.id, deps))).toBe('not_found');
    expect((await listEvents(h.sam, {}, deps)).map((e) => e.id)).not.toContain(c.id);
    expect(await showing(h.sam, [mine.id], '2026-10-21', '2026-10-21')).toEqual([]);
  });

  it('a household series: either adult changes an occurrence, which stays the series’ (owner and visibility)', async () => {
    const swim = await weekly(h.sam);
    const c = await changeEventOccurrence(
      h.alex,
      swim.id,
      WED_21,
      { title: 'Alex moved it' },
      deps,
    );
    expect(c).toMatchObject({ visibility: 'household', createdBy: h.sam.userId });
    expect((await listOccurrenceChanges(h.alex, swim.id, deps)).map((x) => x.id)).toEqual([c.id]);
    const [row] = await auditsOf(c.id);
    expect(row).toMatchObject({ event: 'event.occurrence_change', actorUserId: h.alex.userId });
  });

  it('the series’ visibility carries its changes with it, archived ones too', async () => {
    const swim = await weekly(h.sam);
    const live = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'Live' }, deps);
    const old = await changeEventOccurrence(h.sam, swim.id, WED_28, { title: 'Old' }, deps);
    await returnOccurrenceToSeries(h.sam, swim.id, WED_28, deps);
    await updateEvent(h.sam, swim.id, { visibility: 'private' }, deps);
    expect((await rowOf(live.id)).visibility).toBe('private');
    expect((await rowOf(old.id)).visibility).toBe('private');
    expect(await code(getEvent(h.alex, live.id, {}, deps))).toBe('not_found');
    expect(await code(restoreEvent(h.alex, old.id, deps))).toBe('not_found');
    expect(await showing(h.alex, [swim.id], '2026-10-21', '2026-10-28')).toEqual([]);
    await updateEvent(h.sam, swim.id, { visibility: 'household' }, deps);
    expect((await rowOf(live.id)).visibility).toBe('household');
    // Only the series' creator changes who sees it, as for any event.
    expect(await code(updateEvent(h.alex, swim.id, { visibility: 'private' }, deps))).toBe(
      'not_creator',
    );
  });

  it('a change cannot bring in a private person, or keep a series private-only by the back door', async () => {
    const swim = await weekly(h.sam);
    const secret = await createPerson(
      h.sam,
      { name: 'Secret 8a', role: 'other', visibility: 'private' },
      deps,
    );
    const c = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'x' }, deps);
    expect(
      await code(
        setEventPerson(h.sam, { eventId: c.id, personId: secret.id, role: 'attending' }, deps),
      ),
    ).toBe('references_private');
    // A private series whose change names a private person cannot become household.
    const priv = await weekly(h.sam, { visibility: 'private' });
    const pc = await changeEventOccurrence(h.sam, priv.id, WED_21, { title: 'x' }, deps);
    await setEventPerson(h.sam, { eventId: pc.id, personId: secret.id, role: 'attending' }, deps);
    expect(await code(updateEvent(h.sam, priv.id, { visibility: 'household' }, deps))).toBe(
      'references_private',
    );
    expect((await rowOf(priv.id)).visibility).toBe('private');
    expect((await rowOf(pc.id)).visibility).toBe('private');
    // A household note on a household change keeps the series household.
    await createNote(h.sam, { body: 'x', subject: { type: 'event', id: c.id } }, deps);
    expect(await code(updateEvent(h.sam, swim.id, { visibility: 'private' }, deps))).toBe(
      'referenced_by_household',
    );
  });

  it('crafted ids: an archived series, another adult’s private change, nonsense', async () => {
    const swim = await weekly(h.sam);
    await archiveEvent(h.sam, swim.id, deps);
    expect(await code(changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'x' }, deps))).toBe(
      'not_found',
    );
    expect(
      await code(changeEventOccurrence(h.sam, 'not-a-uuid', WED_21, { title: 'x' }, deps)),
    ).toBe('not_found');
    expect(
      await code(changeEventOccurrence(h.sam, crypto.randomUUID(), WED_21, { title: 'x' }, deps)),
    ).toBe('not_found');
  });
});

describe('people and notes on a changed occurrence', () => {
  it('with none of its own it shows the series’ people; its own replace them for that one only', async () => {
    const swim = await weekly(h.sam);
    const kid = await createPerson(h.sam, { name: 'Kid people 8a', role: 'child' }, deps);
    const other = await createPerson(h.sam, { name: 'Other people 8a', role: 'child' }, deps);
    await setEventPeople(
      h.sam,
      swim.id,
      [
        { personId: kid.id, role: 'attending' },
        { personId: kid.id, role: 'responsible' },
      ],
      deps,
    );
    const c = await changeEventOccurrence(
      h.sam,
      swim.id,
      WED_21,
      { time: at('2026-10-21T16:00:00+13:00') },
      deps,
    );
    // Nothing copied.
    expect(await listEventPeople(h.sam, c.id, {}, deps)).toEqual([]);
    const peopleOn = async () =>
      (await agendaFor(h.sam, [swim.id], '2026-10-21', '2026-10-21')).inputs.find(
        (i) => i.id === c.id,
      )!.people;
    expect(await peopleOn()).toEqual([
      { personId: kid.id, role: 'attending' },
      { personId: kid.id, role: 'responsible' },
    ]);
    await setEventPeople(h.sam, c.id, [{ personId: other.id, role: 'attending' }], deps);
    expect(await peopleOn()).toEqual([{ personId: other.id, role: 'attending' }]);
    // The series keeps its own.
    expect((await listEventPeople(h.sam, swim.id, {}, deps)).map((a) => a.personId)).toContain(
      kid.id,
    );
  });

  it('the series’ notes stay on the series; a note on the change is the change’s', async () => {
    const swim = await weekly(h.sam);
    await createNote(h.sam, { body: 'Series note', subject: { type: 'event', id: swim.id } }, deps);
    const c = await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'x' }, deps);
    expect(await listNotes(h.sam, { subject: { type: 'event', id: c.id } }, deps)).toEqual([]);
    await createNote(h.sam, { body: 'Change note', subject: { type: 'event', id: c.id } }, deps);
    expect(
      (await listNotes(h.sam, { subject: { type: 'event', id: swim.id } }, deps)).map(
        (x) => x.body,
      ),
    ).toEqual(['Series note']);
  });
});

describe('concurrency', () => {
  it('two changes of one occurrence at once: one row, made by one and updated by the other', async () => {
    const swim = await weekly(h.sam);
    const results = await Promise.all([
      changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'Sam' }, deps),
      changeEventOccurrence(h.alex, swim.id, WED_21, { location: 'Alex' }, deps),
      changeEventOccurrence(h.sam, swim.id, WED_21, { kind: 'other' }, deps),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const rows = await changesOf(swim.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Sam', location: 'Alex', kind: 'other' });
    const made = (await auditsOf(rows[0]!.id)).map((a) => (a.meta as { created: boolean }).created);
    expect(made.sort()).toEqual([false, false, true]);
  });

  it('a change and a return at once never leave two live changes or a half state', async () => {
    const swim = await weekly(h.sam);
    await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'First' }, deps);
    const [a, b] = await Promise.all([
      code(changeEventOccurrence(h.alex, swim.id, WED_21, { title: 'Second' }, deps)),
      code(returnOccurrenceToSeries(h.sam, swim.id, WED_21, deps)),
    ]);
    expect([a, b]).toContain('resolved');
    expect((await liveChangesOf(swim.id)).length).toBeLessThanOrEqual(1);
  });
});

describe('audit', () => {
  it('structural only: series, occurrence, field names; never a title, details, place or name', async () => {
    const swim = await weekly(h.sam);
    const c = await changeEventOccurrence(
      h.sam,
      swim.id,
      WED_21,
      {
        title: 'Canary title 8a',
        description: 'Canary details 8a',
        location: 'Canary place 8a',
        time: at('2026-10-21T16:00:00+13:00'),
      },
      deps,
    );
    await changeEventOccurrence(h.sam, swim.id, WED_21, { kind: 'other' }, deps);
    await returnOccurrenceToSeries(h.sam, swim.id, WED_21, deps);
    const rows = await auditsOf(c.id);
    expect(rows.map((r) => [r.event, r.meta])).toEqual([
      [
        'event.occurrence_change',
        {
          seriesId: swim.id,
          occurrence: WED_21,
          fields: ['description', 'location', 'time', 'title'],
          created: true,
        },
      ],
      [
        'event.occurrence_change',
        { seriesId: swim.id, occurrence: WED_21, fields: ['kind'], created: false },
      ],
      ['event.occurrence_return', { seriesId: swim.id, occurrence: WED_21 }],
    ]);
    const snapshots = await db
      .select({ visibility: auditLog.visibility })
      .from(auditLog)
      .where(eq(auditLog.subjectId, c.id));
    expect(snapshots.map((r) => r.visibility)).toEqual(['household', 'household', 'household']);
    expect(JSON.stringify(rows)).not.toMatch(/Canary|Swimming|towel|Example Road/);
  });
});

describe('the regular week', () => {
  it('a moved occurrence, and putting it back, leave Usually as it was', async () => {
    const swim = await weekly(h.sam);
    const kid = await createPerson(h.sam, { name: 'Kid usual 8a', role: 'child' }, deps);
    await setEventPerson(h.sam, { eventId: swim.id, personId: kid.id, role: 'attending' }, deps);
    const usual = async () =>
      regularWeek((await agendaFor(h.sam, [swim.id], '2026-10-14', '2026-11-13')).inputs, kid.id, {
        today: '2026-10-14',
        timeZone: ZONE,
      });
    const before = await usual();
    expect(before).toHaveLength(1);
    await changeEventOccurrence(
      h.sam,
      swim.id,
      WED_14,
      { time: at('2026-10-16T10:00:00+13:00') },
      deps,
    );
    await changeEventOccurrence(h.sam, swim.id, WED_21, { title: 'Gala' }, deps);
    expect(await usual()).toEqual(before);
    await returnOccurrenceToSeries(h.sam, swim.id, WED_14, deps);
    expect(await usual()).toEqual(before);
  });
});
