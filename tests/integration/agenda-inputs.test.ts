import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectCalendar, listCalendars } from '@/domain/calendar/service';
import { refreshCalendar } from '@/domain/calendar/sync';
import { agenda, type AgendaItem } from '@/domain/engines/agenda';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import { isOccurrenceChange } from '@/domain/events/occurrences';
import {
  archiveEvent,
  changeEventOccurrence,
  createEventWithPeople,
  listEventPeople,
  listEventPeopleFor,
  listEvents,
  setEventPerson,
} from '@/domain/events/service';
import { effectivePeople, occurrenceChangePeople } from '@/domain/events/who';
import { createPerson, listPeople } from '@/domain/people/service';
import type { UserActor } from '@/trust/actor';
import { fakeProvider } from '@/integrations/calendar/fake';
import { FAMILY_EVENTS, FAMILY_PEOPLE } from '../fixtures/family';
import { SYNTHETIC_ADDRESS, googleFeed, nzEvent } from '../fixtures/calendars/google';
import { TODAY } from '../fixtures/calendars/sequences';
import { testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// What the agenda is given (M5 Package 1, ADR 0008 §7): the domain's
// composition with every event's people read at once. Proves it says
// exactly what the per-event reads said (roles, calendar defaults, a changed
// occurrence's series people), that the batched read gives nothing of an
// event or person the reader cannot see, that the other adult's private
// records change nothing in what a reader is given, and that the number of
// queries does not grow with the number of events. Synthetic only.

const { db, pool, close } = testDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';

// Every statement the application role sends, counted.
let queries = 0;
const send = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof send>) => {
  queries++;
  return send(...args);
}) as typeof pool.query;
const counted = async <T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> => {
  const before = queries;
  const result = await fn();
  return { result, queries: queries - before };
};

let h: Household;
type Ids = Record<
  | 'milo'
  | 'isla'
  | 'samSecret'
  | 'alexSecret'
  | 'swim'
  | 'change21'
  | 'change28'
  | 'late'
  | 'samPrivate'
  | 'archived'
  | 'calendar'
  | 'syncedDefault'
  | 'syncedOwn',
  string
>;
const id = {} as Ids;
const WED_21 = '2026-10-21T02:30:00Z';
const WED_28 = '2026-10-28T02:30:00Z';
// Tuesday 13 October 23:00 to Wednesday 14 October 01:00 NZDT.
const overnight = (title: string, visibility: 'household' | 'private' = 'household') => ({
  title,
  kind: 'social' as const,
  domain: 'family' as const,
  visibility,
  time: {
    allDay: false as const,
    startsAt: '2026-10-13T23:00:00+13:00',
    endsAt: '2026-10-14T01:00:00+13:00',
    timeZone: ZONE,
  },
});

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  id.milo = (await createPerson(h.sam, { ...FAMILY_PEOPLE.milo, name: 'Milo AI' }, deps)).id;
  id.isla = (await createPerson(h.sam, { ...FAMILY_PEOPLE.isla, name: 'Isla AI' }, deps)).id;
  id.samSecret = (
    await createPerson(h.sam, { name: 'Sam secret AI', role: 'other', visibility: 'private' }, deps)
  ).id;
  id.alexSecret = (
    await createPerson(
      h.alex,
      { name: 'Alex secret AI', role: 'other', visibility: 'private' },
      deps,
    )
  ).id;

  // A manual series, one change with no people of its own, one with its own.
  id.swim = (
    await createEventWithPeople(
      h.sam,
      FAMILY_EVENTS.swimming,
      [
        { personId: id.milo, role: 'attending' },
        { personId: id.isla, role: 'responsible' },
      ],
      deps,
    )
  ).id;
  id.change21 = (
    await changeEventOccurrence(h.sam, id.swim, WED_21, { title: 'Swim gala' }, deps)
  ).id;
  id.change28 = (await changeEventOccurrence(h.sam, id.swim, WED_28, { title: 'Swim' }, deps)).id;
  await setEventPerson(h.sam, { eventId: id.change28, personId: id.isla, role: 'attending' }, deps);

  // Overnight: a household one, and Sam's private one naming Sam's private
  // person (a household event may not name a private person: references_private).
  id.late = (
    await createEventWithPeople(
      h.sam,
      overnight('Late one'),
      [{ personId: id.milo, role: 'attending' }],
      deps,
    )
  ).id;
  id.samPrivate = (
    await createEventWithPeople(
      h.sam,
      overnight('Sam private overnight', 'private'),
      [
        { personId: id.isla, role: 'attending' },
        { personId: id.samSecret, role: 'attending' },
      ],
      deps,
    )
  ).id;
  id.archived = (
    await createEventWithPeople(
      h.sam,
      { ...overnight('Archived one'), kind: 'other' },
      [{ personId: id.milo, role: 'attending' }],
      deps,
    )
  ).id;
  await archiveEvent(h.sam, id.archived, deps);

  // A household calendar whose usual person is Milo: one event with no
  // people of its own (shows Milo, derived), one with Isla of its own.
  const cal = await connectCalendar(
    h.sam,
    {
      address: SYNTHETIC_ADDRESS,
      name: 'Sam’s work',
      visibility: 'household',
      defaultPersonIds: [id.milo],
    },
    deps,
  );
  id.calendar = cal.calendarId;
  const p = fakeProvider(
    [
      {
        ics: googleFeed([
          nzEvent({
            uid: 'a-ai@example.test',
            start: '20261014T090000',
            end: '20261014T100000',
            summary: 'Synced default',
          }),
          nzEvent({
            uid: 'b-ai@example.test',
            start: '20261014T110000',
            end: '20261014T120000',
            summary: 'Synced own',
          }),
        ]),
      },
    ],
    { homeTimeZone: ZONE },
  );
  await refreshCalendar(h.sam, id.calendar, p, { today: TODAY }, deps);
  const synced = (await listEvents(h.sam, {}, deps)).filter(
    (e) => e.calendarSourceId === id.calendar,
  );
  id.syncedDefault = synced.find((e) => e.title === 'Synced default')!.id;
  id.syncedOwn = synced.find((e) => e.title === 'Synced own')!.id;
  await setEventPerson(
    h.sam,
    { eventId: id.syncedOwn, personId: id.isla, role: 'attending' },
    deps,
  );
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
});

type Ref = { personId: string; role: string };
const named = (refs: readonly Ref[]) =>
  refs
    .map(
      (r) =>
        `${(Object.keys(id) as (keyof Ids)[]).find((k) => id[k] === r.personId) ?? 'someone'}:${r.role}`,
    )
    .sort();

/** The composition as the loader did it before Package 1: one read per event. */
async function perEvent(actor: UserActor): Promise<Map<string, string[]>> {
  const [events, people, calendars] = await Promise.all([
    listEvents(actor, {}, deps),
    listPeople(actor, {}, deps),
    listCalendars(actor, {}, deps),
  ]);
  const visible = new Set(people.map((p) => p.id));
  const defaults = new Map(calendars.map((c) => [c.id, c.defaultPersonIds]));
  const own = new Map(
    await Promise.all(
      events.map(async (e) => [e.id, await listEventPeople(actor, e.id, {}, deps)] as const),
    ),
  );
  const refs = (eid: string) =>
    (own.get(eid) ?? []).map((a) => ({ personId: a.personId, role: a.role as 'attending' }));
  return new Map(
    events.map((e) => [
      e.id,
      named(
        (isOccurrenceChange(e)
          ? occurrenceChangePeople(refs(e.id), refs(e.recurrenceParentId!), visible)
          : effectivePeople(
              refs(e.id),
              e.calendarSourceId ? defaults.get(e.calendarSourceId) : undefined,
              visible,
            )
        ).people,
      ),
    ]),
  );
}
const batched = async (actor: UserActor) =>
  new Map((await readAgendaInputs(actor, deps)).events.map((e) => [e.id, named(e.people ?? [])]));

describe('the batched composition', () => {
  it('says exactly what the per-event reads said, for each adult', async () => {
    for (const actor of [h.sam, h.alex])
      expect(await batched(actor)).toEqual(await perEvent(actor));
  });

  it('keeps roles, calendar defaults, own people over defaults, and a change’s series people', async () => {
    const sam = await batched(h.sam);
    expect(sam.get(id.swim)).toEqual(['isla:responsible', 'milo:attending']);
    expect(sam.get(id.change21)).toEqual(['isla:responsible', 'milo:attending']); // the series'
    expect(sam.get(id.change28)).toEqual(['isla:attending']); // its own replace the series'
    expect(sam.get(id.syncedDefault)).toEqual(['milo:attending']); // the calendar's usual person
    expect(sam.get(id.syncedOwn)).toEqual(['isla:attending']); // its own replace the defaults
    expect(sam.get(id.late)).toEqual(['milo:attending']);
    expect(sam.get(id.samPrivate)).toEqual(['isla:attending', 'samSecret:attending']);
    expect(sam.has(id.archived)).toBe(false);
  });

  it('gives the other adult nothing of a private event or a private person', async () => {
    const alex = await batched(h.alex);
    expect(alex.has(id.samPrivate)).toBe(false);
    expect(alex.get(id.late)).toEqual(['milo:attending']);
    const read = await listEventPeopleFor(
      h.alex,
      [id.samPrivate, id.archived, id.late, 'not-an-id', crypto.randomUUID()],
      {},
      deps,
    );
    expect([...read.keys()]).toEqual([id.late]);
    expect(read.get(id.late)!.map((a) => a.personId)).toEqual([id.milo]);
    // Archived only when asked for, and still only what the reader may see.
    const withArchived = await listEventPeopleFor(
      h.sam,
      [id.archived],
      { includeArchived: true },
      deps,
    );
    expect(withArchived.get(id.archived)!.map((a) => a.personId)).toEqual([id.milo]);
    expect(await listEventPeopleFor(h.sam, [], {}, deps)).toEqual(new Map());
  });
});

describe('overnight, through the real composition', () => {
  const on = async (actor: UserActor, from: string, to: string) => {
    const inputs = await readAgendaInputs(actor, deps);
    return agenda({ from, to, timeZone: ZONE, events: inputs.events }).flatMap((d) =>
      d.items
        .filter(
          (i): i is Extract<AgendaItem, { kind: 'event'; allDay: false }> =>
            i.kind === 'event' && !i.allDay,
        )
        .filter((i) => [id.late, id.samPrivate].includes(i.eventId))
        .map((i) => `${d.date} ${i.title} ${i.day}/${i.days} ${i.eventKind}`),
    );
  };

  it('a household overnight event is on both days for both adults; a private one only for its owner', async () => {
    expect(await on(h.sam, '2026-10-13', '2026-10-14')).toEqual([
      '2026-10-13 Late one 1/2 social',
      '2026-10-13 Sam private overnight 1/2 social',
      '2026-10-14 Late one 2/2 social',
      '2026-10-14 Sam private overnight 2/2 social',
    ]);
    expect(await on(h.alex, '2026-10-13', '2026-10-14')).toEqual([
      '2026-10-13 Late one 1/2 social',
      '2026-10-14 Late one 2/2 social',
    ]);
  });
});

describe('the other adult’s private records change nothing a reader is given', () => {
  it('Alex’s agenda is identical before and after Sam adds private records', async () => {
    const alexAgenda = async () => {
      const inputs = await readAgendaInputs(h.alex, deps);
      return {
        days: agenda({
          from: '2026-10-12',
          to: '2026-10-29',
          timeZone: ZONE,
          events: inputs.events,
          people: inputs.people.map((p) => ({
            id: p.id,
            name: p.name,
            dateOfBirth: p.dateOfBirth,
          })),
          tasks: inputs.tasks,
          projects: inputs.projects,
        }),
        people: inputs.people.map((p) => p.id).sort(),
      };
    };
    const before = await alexAgenda();
    await createEventWithPeople(
      h.sam,
      { ...overnight('Another private overnight', 'private'), kind: 'appointment' },
      [
        { personId: id.milo, role: 'responsible' },
        { personId: id.samSecret, role: 'attending' },
      ],
      deps,
    );
    // More of Sam's private person on Sam's private event, and a new private person.
    await setEventPerson(
      h.sam,
      { eventId: id.samPrivate, personId: id.samSecret, role: 'responsible' },
      deps,
    );
    await createPerson(
      h.sam,
      {
        name: 'Sam secret two AI',
        role: 'child',
        visibility: 'private',
        dateOfBirth: '2018-10-20',
      },
      deps,
    );
    expect(await alexAgenda()).toEqual(before);
  });
});

describe('query count', () => {
  it('does not grow with the number of events; the per-event reads did', async () => {
    const batchedBefore = await counted(() => readAgendaInputs(h.sam, deps));
    const perEventBefore = await counted(() => perEvent(h.sam));
    const n = batchedBefore.result.events.length;
    for (let k = 0; k < 30; k++)
      await createEventWithPeople(
        h.sam,
        { ...FAMILY_EVENTS.swimming, title: `Extra ${k}`, rrule: undefined },
        [{ personId: id.milo, role: 'attending' }],
        deps,
      );
    const batchedAfter = await counted(() => readAgendaInputs(h.sam, deps));
    const perEventAfter = await counted(() => perEvent(h.sam));
    expect(batchedAfter.result.events.length).toBe(n + 30);
    expect(batchedAfter.queries).toBe(batchedBefore.queries);
    expect(perEventAfter.queries).toBeGreaterThan(perEventBefore.queries + 30);
    // Reported in the PR: events, then queries batched and per event.
    console.info(
      `agenda inputs: ${n} events → ${batchedBefore.queries} queries batched, ${perEventBefore.queries} per event; ` +
        `${n + 30} events → ${batchedAfter.queries} batched, ${perEventAfter.queries} per event`,
    );
  });
});
