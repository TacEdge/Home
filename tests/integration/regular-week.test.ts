import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventPerson } from '@/db/schema';
import { connectCalendar, listCalendars } from '@/domain/calendar/service';
import { refreshCalendar } from '@/domain/calendar/sync';
import { regularWeek, type RegularWeekEventInput } from '@/domain/engines/profile';
import { overriddenOriginals, recurringWithOverrides } from '@/domain/events/occurrences';
import { createEvent, listEventPeople, listEvents, setEventPerson } from '@/domain/events/service';
import { effectivePeople } from '@/domain/events/who';
import { archivePerson, createPerson, listPeople } from '@/domain/people/service';
import type { UserActor } from '@/trust/actor';
import { fakeProvider } from '@/integrations/calendar/fake';
import { SYNTHETIC_ADDRESS, googleFeed, nzEvent } from '../fixtures/calendars/google';
import { TODAY } from '../fixtures/calendars/sequences';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// The regular week across the two adults (M4 contract §3.6, ADR 0007 §45;
// Package 7): what each adult's profile would show, composed exactly as the
// agenda loader composes it (the domain reads as the actor, override
// suppression, effective people), then the profile engine. Synthetic only.

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

let n = 200;
const nextAddress = () =>
  SYNTHETIC_ADDRESS.replace(
    'private-0123456789abcdef0123456789abcdef',
    `private-${(++n).toString(16).padStart(8, '0')}${'ef'.repeat(12)}`,
  );

/** What `loadAgenda` hands the profile, as this adult. */
async function inputsFor(actor: UserActor): Promise<RegularWeekEventInput[]> {
  const [events, people, calendars] = await Promise.all([
    listEvents(actor, {}, deps),
    listPeople(actor, {}, deps),
    listCalendars(actor, {}, deps),
  ]);
  const visible = new Set(people.map((p) => p.id));
  const defaults = new Map(calendars.map((c) => [c.id, c.defaultPersonIds]));
  const overridden = overriddenOriginals(events);
  return Promise.all(
    events.map(async (e) => ({
      ...recurringWithOverrides(e, overridden),
      id: e.id,
      title: e.title,
      people: effectivePeople(
        (await listEventPeople(actor, e.id, {}, deps)).map((a) => ({
          personId: a.personId,
          role: a.role as 'attending' | 'responsible',
        })),
        e.calendarSourceId ? defaults.get(e.calendarSourceId) : undefined,
        visible,
      ).people,
    })),
  );
}
const weekOf = async (actor: UserActor, personId: string) =>
  (await regularWeek(await inputsFor(actor), personId, { today: TODAY, timeZone: ZONE })).map(
    (e) => `${e.weekday} ${e.allDay ? 'all day' : e.time} ${e.title} ${e.cadence}`,
  );
const weekly = (title: string, startsAt: string, rrule: string, visibility = 'household') =>
  ({
    title,
    kind: 'activity',
    time: {
      allDay: false,
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + 3600_000).toISOString(),
      timeZone: ZONE,
    },
    rrule,
    visibility,
  }) as Parameters<typeof createEvent>[1];

describe('the regular week, as each adult reads it', () => {
  it('a household manual series is in both adults’ view of the person; a private one only in its owner’s', async () => {
    const milo = await createPerson(h.sam, { name: 'Milo P7', role: 'child' }, deps);
    const swim = await createEvent(
      h.sam,
      weekly('Swimming P7', '2026-10-14T15:30:00+13:00', 'FREQ=WEEKLY;BYDAY=WE'),
      deps,
    );
    const lesson = await createEvent(
      h.sam,
      weekly(
        'Sam-only lesson P7',
        '2026-10-15T17:00:00+13:00',
        'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH',
        'private',
      ),
      deps,
    );
    for (const e of [swim, lesson])
      await setEventPerson(h.sam, { eventId: e.id, personId: milo.id, role: 'attending' }, deps);
    expect(await weekOf(h.sam, milo.id)).toEqual([
      '2 15:30 Swimming P7 weekly',
      '3 17:00 Sam-only lesson P7 fortnightly',
    ]);
    expect(await weekOf(h.alex, milo.id)).toEqual(['2 15:30 Swimming P7 weekly']);
  });

  it('a private calendar’s series and its private usual person are its owner’s alone; a household calendar’s usual person shows for both', async () => {
    const own = await createPerson(
      h.alex,
      { name: 'Alex private P7', role: 'other', visibility: 'private' },
      deps,
    );
    const kid = await createPerson(h.alex, { name: 'Kid P7', role: 'child' }, deps);
    const series = (uid: string, summary: string) =>
      googleFeed([
        nzEvent({
          uid,
          start: '20261017T114000',
          end: '20261017T124000',
          rrule: 'FREQ=WEEKLY;BYDAY=SA',
          summary,
        }),
      ]);
    const priv = await connectCalendar(
      h.alex,
      {
        address: nextAddress(),
        name: 'Alex only P7',
        visibility: 'private',
        defaultPersonIds: [own.id],
      },
      deps,
    );
    await refreshCalendar(
      h.alex,
      priv.calendarId,
      fakeProvider([{ ics: series('p7-private@example.test', 'Private Saturday P7') }], {
        homeTimeZone: ZONE,
      }),
      { today: TODAY },
      deps,
    );
    const shared = await connectCalendar(
      h.alex,
      {
        address: nextAddress(),
        name: 'Family P7',
        visibility: 'household',
        defaultPersonIds: [kid.id],
      },
      deps,
    );
    await refreshCalendar(
      h.alex,
      shared.calendarId,
      fakeProvider([{ ics: series('p7-shared@example.test', 'Saturday swim P7') }], {
        homeTimeZone: ZONE,
      }),
      { today: TODAY },
      deps,
    );

    expect(await weekOf(h.alex, own.id)).toEqual(['5 11:40 Private Saturday P7 weekly']);
    expect(await weekOf(h.sam, own.id)).toEqual([]); // Sam cannot see the person, or the event
    const samInputs = await inputsFor(h.sam);
    expect(samInputs.map((e) => e.title)).not.toContain('Private Saturday P7');
    expect(JSON.stringify(samInputs)).not.toContain(own.id);
    for (const adult of [h.alex, h.sam])
      expect(await weekOf(adult, kid.id)).toEqual(['5 11:40 Saturday swim P7 weekly']);
  });

  it('an event whose only own annotation is an archived person drops out of the usual person’s week (no fallback to the calendar’s people)', async () => {
    const usual = await createPerson(h.sam, { name: 'Usual P7', role: 'child' }, deps);
    const gone = await createPerson(h.sam, { name: 'Gone P7', role: 'child' }, deps);
    const cal = await connectCalendar(
      h.sam,
      {
        address: nextAddress(),
        name: 'Clubs P7',
        visibility: 'household',
        defaultPersonIds: [usual.id],
      },
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
                uid: 'p7-club@example.test',
                start: '20261019T160000',
                end: '20261019T170000',
                rrule: 'FREQ=WEEKLY;BYDAY=MO',
                summary: 'Club P7',
              }),
            ]),
          },
        ],
        { homeTimeZone: ZONE },
      ),
      { today: TODAY },
      deps,
    );
    expect(await weekOf(h.sam, usual.id)).toEqual(['0 16:00 Club P7 weekly']);
    const [club] = (await listEvents(h.sam, {}, deps)).filter(
      (e) => e.calendarSourceId === cal.calendarId,
    );
    await setEventPerson(h.sam, { eventId: club!.id, personId: gone.id, role: 'attending' }, deps);
    expect(await weekOf(h.sam, usual.id)).toEqual([]); // its own person now
    expect(await weekOf(h.sam, gone.id)).toEqual(['0 16:00 Club P7 weekly']);
    await archivePerson(h.sam, gone.id, deps);
    expect(await weekOf(h.sam, usual.id)).toEqual([]); // still not the calendar's people
    // The calendar's usual person was never written as an annotation.
    expect(
      await admin.db.select().from(eventPerson).where(eq(eventPerson.personId, usual.id)),
    ).toEqual([]);
  });

  it('manual and synced series with the same rule read alike', async () => {
    const twin = await createPerson(h.sam, { name: 'Twin P7', role: 'child' }, deps);
    const manual = await createEvent(
      h.sam,
      weekly('Twin manual P7', '2026-10-16T09:00:00+13:00', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR'),
      deps,
    );
    await setEventPerson(h.sam, { eventId: manual.id, personId: twin.id, role: 'attending' }, deps);
    const cal = await connectCalendar(
      h.sam,
      {
        address: nextAddress(),
        name: 'Twin cal P7',
        visibility: 'household',
        defaultPersonIds: [twin.id],
      },
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
                uid: 'p7-twin@example.test',
                start: '20261016T090000',
                end: '20261016T100000',
                rrule: 'FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=FR',
                summary: 'Twin synced P7',
              }),
            ]),
          },
        ],
        { homeTimeZone: ZONE },
      ),
      { today: TODAY },
      deps,
    );
    expect(await weekOf(h.sam, twin.id)).toEqual([
      '4 09:00 Twin manual P7 fortnightly',
      '4 09:00 Twin synced P7 fortnightly',
    ]);
  });
});
