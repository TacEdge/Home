import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectCalendar } from '@/domain/calendar/service';
import { refreshCalendar } from '@/domain/calendar/sync';
import { agenda } from '@/domain/engines/agenda';
import { conflicts } from '@/domain/engines/conflicts';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import { createEventWithPeople, listEvents, setEventPerson } from '@/domain/events/service';
import { createPerson } from '@/domain/people/service';
import type { UserActor } from '@/trust/actor';
import { fakeProvider } from '@/integrations/calendar/fake';
import { addDays, isoDateInZone } from '@/lib/dates';
import { SYNTHETIC_ADDRESS, googleFeed, nzEvent } from '../fixtures/calendars/google';
import { TODAY } from '../fixtures/calendars/sequences';
import { testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// Conflicts from a calendar's usual people (M6 Package 2; contract §2.2
// "default people", §5.6 "On an occurrence"; ADR 0007 §14). A synced event
// with no people of its own is on its calendar's usual people, as the shared
// read resolves them; the engine has no default-people logic of its own. A
// household calendar's conflict is both adults'; a private calendar's is its
// owner's alone. People recorded on the event replace the calendar's, never
// add to them. Through the real calendar, sync and event services. Synthetic.

const { db, close } = testDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
const NOW = new Date('2026-10-14T07:03:00+13:00');

let h: Household;
const id = { milo: '', isla: '', piano: '', art: '', club: '', privateClub: '' };

async function read(actor: UserActor) {
  const inputs = await readAgendaInputs(actor, deps);
  const from = isoDateInZone(NOW, ZONE);
  const to = addDays(from, 89);
  const days = agenda({ from, to, timeZone: ZONE, events: inputs.events });
  return conflicts({
    now: NOW,
    timeZone: ZONE,
    window: { from, to },
    days,
    coverage: { from, to },
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, inHousehold: p.inHousehold })),
  });
}

const timed = (start: string, end: string) => ({
  allDay: false as const,
  startsAt: start,
  endsAt: end,
  timeZone: ZONE,
});
const address = (tag: string) =>
  SYNTHETIC_ADDRESS.replace(/private-[0-9a-f]+/, `private-${tag.padEnd(32, '0')}`);

/** Connect a calendar whose usual person is Milo and bring in one timed event with no people of its own. */
async function syncedCalendar(
  visibility: 'household' | 'private',
  tag: string,
  event: { uid: string; start: string; end: string; summary: string },
): Promise<string> {
  const cal = await connectCalendar(
    h.sam,
    { address: address(tag), name: `Sam ${visibility}`, visibility, defaultPersonIds: [id.milo] },
    deps,
  );
  const feed = fakeProvider([{ ics: googleFeed([nzEvent(event)]) }], { homeTimeZone: ZONE });
  await refreshCalendar(h.sam, cal.calendarId, feed, { today: TODAY }, deps);
  const row = (await listEvents(h.sam, {}, deps)).find((e) => e.title === event.summary);
  return row!.id;
}

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  id.milo = (await createPerson(h.sam, { name: 'Milo DP', role: 'child' }, deps)).id;
  id.isla = (await createPerson(h.sam, { name: 'Isla DP', role: 'child' }, deps)).id;
  // Household events with Milo recorded on them.
  id.piano = (
    await createEventWithPeople(
      h.alex,
      {
        title: 'Piano',
        kind: 'activity',
        time: timed('2026-10-21T16:00:00+13:00', '2026-10-21T17:00:00+13:00'),
      },
      [{ personId: id.milo, role: 'attending' }],
      deps,
    )
  ).id;
  id.art = (
    await createEventWithPeople(
      h.alex,
      {
        title: 'Art',
        kind: 'activity',
        time: timed('2026-10-22T16:00:00+13:00', '2026-10-22T17:00:00+13:00'),
      },
      [{ personId: id.milo, role: 'attending' }],
      deps,
    )
  ).id;
  // Synced events with no people of their own, on calendars whose usual person is Milo.
  id.club = await syncedCalendar('household', 'dphouse', {
    uid: 'club-dp@example.test',
    start: '20261021T163000',
    end: '20261021T173000',
    summary: 'Club',
  });
  id.privateClub = await syncedCalendar('private', 'dpprivate', {
    uid: 'private-club-dp@example.test',
    start: '20261022T163000',
    end: '20261022T173000',
    summary: 'Private club',
  });
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
});

const clubKey = () =>
  `conflict.overlap:${id.milo}:${[id.club, id.piano].sort().join('.')}:20261021T0330Z-20261021T0400Z`;

describe('a calendar’s usual people (through the real calendar, sync and event services)', () => {
  it('a household synced event with no people of its own is on its calendar’s usual person: both adults see the conflict', async () => {
    for (const actor of [h.sam, h.alex]) {
      const club = (await read(actor)).find((c) => c.key === clubKey());
      expect(club, actor === h.sam ? 'Sam' : 'Alex').toBeDefined();
      expect(club!).toMatchObject({
        rule: 'conflict.overlap',
        identity: 'occurrence',
        person: { id: id.milo, name: 'Milo DP' },
        when: '2026-10-21',
        overlap: {
          from: new Date('2026-10-21T16:30:00+13:00'),
          to: new Date('2026-10-21T17:00:00+13:00'),
        },
      });
      expect(club!.occurrences.map((o) => [o.title, o.role])).toEqual([
        ['Piano', 'attending'],
        ['Club', 'attending'],
      ]);
      expect(club!.facts).toEqual([
        { kind: 'person', id: id.milo },
        { kind: 'event', id: id.piano, occurrenceDate: '2026-10-21' },
        { kind: 'event', id: id.club, occurrenceDate: '2026-10-21' },
      ]);
      expect(club!.text).toBe(
        'Milo DP has Piano and Club at the same time on Wednesday 21 October, 16:30–17:00.',
      );
    }
  });

  it('a private calendar’s usual person makes a conflict for its owner only', async () => {
    const isPrivate = (c: Awaited<ReturnType<typeof read>>[number]) =>
      c.occurrences.some((o) => o.eventId === id.privateClub);
    const sam = (await read(h.sam)).filter(isPrivate);
    expect(sam.map((c) => c.key)).toEqual([
      `conflict.overlap:${id.milo}:${[id.art, id.privateClub].sort().join('.')}:20261022T0330Z-20261022T0400Z`,
    ]);
    const alex = await read(h.alex);
    expect(alex.filter(isPrivate)).toEqual([]);
    expect(JSON.stringify(alex)).not.toContain('Private club');
    // Alex's list is the household conflict alone, the same as Sam's household one.
    expect(alex.map((c) => c.key)).toEqual([clubKey()]);
  });

  it('a person recorded on the event replaces the calendar’s usual people: Milo’s conflict ends, nothing is merged', async () => {
    await setEventPerson(h.sam, { eventId: id.club, personId: id.isla, role: 'attending' }, deps);
    const inputs = await readAgendaInputs(h.alex, deps);
    expect(inputs.events.find((e) => e.id === id.club)!.people).toEqual([
      { personId: id.isla, role: 'attending' },
    ]);
    for (const actor of [h.sam, h.alex]) {
      const cs = await read(actor);
      expect(cs.some((c) => c.key === clubKey())).toBe(false);
      // Isla is on Club only, so nothing overlaps for her.
      expect(cs.some((c) => c.person.id === id.isla)).toBe(false);
    }
  });
});
