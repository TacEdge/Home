import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectCalendar } from '@/domain/calendar/service';
import { refreshCalendar } from '@/domain/calendar/sync';
import { HOUSEHOLD, type Gaps } from '@/domain/engines/gaps';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import {
  archiveEvent,
  changeEventOccurrence,
  createEventWithPeople,
  listEvents,
  skipEventOccurrence,
} from '@/domain/events/service';
import { readGaps } from '@/domain/insights/gaps';
import { createPerson } from '@/domain/people/service';
import { createTask } from '@/domain/tasks/service';
import { fakeProvider } from '@/integrations/calendar/fake';
import { clockOf } from '@/lib/dates';
import type { UserActor } from '@/trust/actor';
import { SYNTHETIC_ADDRESS, googleFeed, nzEvent } from '../fixtures/calendars/google';
import { TODAY } from '../fixtures/calendars/sequences';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// The gap engine and coverage through the real services as `home_app` (M7
// Package 2; contract §3.5, §5.4–§5.5, §8.2, §8.6 G7, G9, G13, G24 and P1;
// ADR 0011 §22–§28). Composed exactly as a page will compose it: one agenda
// read as the signed-in adult (`readAgendaInputs`, which reads the calendars
// with it), one placement, one run of the engine. Two adults. The other
// adult's private records change nothing in a reader's gaps, keys, order,
// facts or coverage, and do change their own; the composition adds no query
// to the agenda read. Synthetic only.

const { db, pool, close } = testDb();
const admin = adminDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
// Wednesday 14 October 2026, 07:03 at home.
const NOW = new Date('2026-10-14T07:03:00+13:00');
// Through Saturday 31 October: G13's dates.
const DAYS = 18;

let queries = 0;
const send = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof send>) => {
  queries++;
  return send(...args);
}) as typeof pool.query;

let h: Household;
const id = { sam: '', alex: '', milo: '', isla: '', nana: '', football: '', calendar: '' };

const timed = (start: string, end: string) => ({
  allDay: false as const,
  startsAt: start,
  endsAt: end,
  timeZone: ZONE,
});
const day = (d: string, from: string, to: string) =>
  timed(`${d}T${from}:00+13:00`, `${d}T${to}:00+13:00`);
const read = (actor: UserActor) => readGaps(actor, NOW, ZONE, deps, DAYS);
// Saturday 24 and Sunday 25 October, 07:03 at home: a range starting on each.
const SAT_24 = new Date('2026-10-24T07:03:00+13:00');
const SUN_25 = new Date('2026-10-25T07:03:00+13:00');
const readFrom = (actor: UserActor, now: Date) => readGaps(actor, now, ZONE, deps, DAYS);
/** One date's gaps, byte for byte (stretch, shown span, key, commitments, facts). */
const dateBytes = (r: Gaps, date: string) => JSON.stringify(r.gaps.filter((g) => g.date === date));
/** "08:00–09:00 and 10:00–20:00": a scope's stretches on a date, as the matrix writes them. */
const said = (r: Gaps, date: string, scope = HOUSEHOLD) =>
  r.gaps
    .filter((g) => g.date === date && g.scope === scope)
    .map((g) => `${clockOf(g.stretch.from, ZONE)}–${clockOf(g.stretch.to, ZONE)}`)
    .join(' and ');
/** What a reader is given: gaps and coverage, byte for byte. */
const bytes = (r: Gaps) => JSON.stringify({ coverage: r.coverage, gaps: r.gaps });

/** A calendar source with a given freshness, written as the owner (no address, nothing sealed). */
async function calendarRow(
  ownerUserId: string,
  visibility: 'household' | 'private',
  name: string,
  lastSyncedAt: string,
  n: string,
): Promise<string> {
  const sealed = `hc1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`;
  const c = await admin.db.execute(sql`
    insert into calendar_connection (owner_user_id, provider, credentials_encrypted, credentials_key_id, address_fingerprint)
    values (${ownerUserId}, 'ics', ${sealed}, '0123456789abcdef', ${`fp1.${n.repeat(43)}`}) returning id`);
  const s = await admin.db.execute(sql`
    insert into calendar_source (created_by, created_via, visibility, connection_id, external_calendar_id, name, last_attempt_at, last_synced_at, last_sync_status)
    values (${ownerUserId}, 'ui', ${visibility}, ${c.rows[0]?.id as string}::uuid, 'primary', ${name},
            ${lastSyncedAt}::timestamptz, ${lastSyncedAt}::timestamptz, 'ok')
    returning id`);
  return s.rows[0]?.id as string;
}
const healthyAt = '2026-10-14T06:58:00+13:00';

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  const person = async (name: string, role: 'parent' | 'child' | 'other', inHousehold = true) =>
    (await createPerson(h.sam, { name, role, inHousehold }, deps)).id;
  id.sam = await person('Sam GP', 'parent');
  id.alex = await person('Alex GP', 'parent');
  id.milo = await person('Milo GP', 'child');
  id.isla = await person('Isla GP', 'child');
  id.nana = await person('Nana Jo GP', 'other', false);
  // One household calendar, last success at 06:58: coverage `recorded` for both adults.
  id.calendar = await calendarRow(h.sam.userId, 'household', 'Household GP', healthyAt, '1');
  id.football = (
    await createEventWithPeople(
      h.sam,
      {
        title: 'Football',
        kind: 'activity',
        rrule: 'FREQ=WEEKLY;BYDAY=SA',
        time: day('2026-10-17', '09:00', '10:00'),
      },
      [{ personId: id.isla, role: 'attending' }],
      deps,
    )
  ).id;
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
  await admin.close();
});

describe('the fixture stands (so the invariants below are not vacuous)', () => {
  it('both adults: coverage recorded, Saturday 17 08:00–09:00 and 10:00–20:00, keys and scopes alike', async () => {
    const sam = await read(h.sam);
    const alex = await read(h.alex);
    for (const r of [sam, alex]) {
      expect(r.coverage).toEqual({
        rule: 'coverage.recorded',
        calendars: [
          {
            kind: 'calendar',
            id: id.calendar,
            health: 'ok',
            lastSyncedAt: new Date(healthyAt).toISOString(),
          },
        ],
      });
      expect(said(r, '2026-10-17')).toBe('08:00–09:00 and 10:00–20:00');
      expect(said(r, '2026-10-17', id.isla)).toBe('08:00–09:00 and 10:00–20:00');
      expect(said(r, '2026-10-17', id.milo)).toBe('08:00–20:00');
      expect(new Set(r.gaps.map((g) => g.scope))).toEqual(
        new Set([HOUSEHOLD, id.sam, id.alex, id.milo, id.isla]),
      );
    }
    expect(bytes(alex)).toBe(bytes(sam));
  });
});

describe('G rows through the real services', () => {
  it('G7: Sunday, a timed household event 14:00–15:00 with no one on it: household 08:00–14:00 and 15:00–20:00; Milo 08:00–20:00, naming it', async () => {
    const ev = await createEventWithPeople(
      h.alex,
      { title: 'Recorded for the house', kind: 'other', time: day('2026-10-18', '14:00', '15:00') },
      [],
      deps,
    );
    for (const actor of [h.sam, h.alex]) {
      const r = await read(actor);
      expect(said(r, '2026-10-18')).toBe('08:00–14:00 and 15:00–20:00');
      expect(said(r, '2026-10-18', id.milo)).toBe('08:00–20:00');
      const milo = r.gaps.find((g) => g.key === `gap:${id.milo}:2026-10-18:0800-2000`)!;
      expect(milo.unblocking).toEqual([{ kind: 'event', id: ev.id, occurrenceDate: '2026-10-18' }]);
    }
    await archiveEvent(h.alex, ev.id, deps);
    expect(said(await read(h.alex), '2026-10-18')).toBe('08:00–20:00');
  });

  it('G9: an all-day event Friday 16 to Saturday 17 with Sam: no gaps on 16 or 17; 08:00–20:00 on 18; Sam the same; Milo on 16 08:00–20:00', async () => {
    const ev = await createEventWithPeople(
      h.sam,
      {
        title: 'Away for work',
        kind: 'work',
        time: { allDay: true, startDate: '2026-10-16', endDate: '2026-10-18' },
      },
      [{ personId: id.sam, role: 'attending' }],
      deps,
    );
    for (const actor of [h.sam, h.alex]) {
      const r = await read(actor);
      for (const scope of [HOUSEHOLD, id.sam]) {
        expect(said(r, '2026-10-16', scope)).toBe('');
        expect(said(r, '2026-10-17', scope)).toBe('');
        expect(said(r, '2026-10-18', scope)).toBe('08:00–20:00');
      }
      expect(said(r, '2026-10-16', id.milo)).toBe('08:00–20:00');
    }
    await archiveEvent(h.sam, ev.id, deps);
  });

  it('G13: Football skipped on 24 October / changed on 31 October to 11:00–12:00: 24th 08:00–20:00 / 31st 08:00–11:00 and 12:00–20:00', async () => {
    const before = await read(h.alex);
    expect(said(before, '2026-10-24')).toBe('08:00–09:00 and 10:00–20:00');
    await skipEventOccurrence(h.sam, id.football, '2026-10-24', deps);
    await changeEventOccurrence(
      h.sam,
      id.football,
      '2026-10-30T20:00:00Z',
      { time: day('2026-10-31', '11:00', '12:00') },
      deps,
    );
    for (const actor of [h.sam, h.alex]) {
      const r = await read(actor);
      expect(said(r, '2026-10-17')).toBe('08:00–09:00 and 10:00–20:00');
      expect(said(r, '2026-10-24')).toBe('08:00–20:00');
      expect(said(r, '2026-10-31')).toBe('08:00–11:00 and 12:00–20:00');
      // The change keeps its series' people: it is Isla's.
      expect(said(r, '2026-10-31', id.isla)).toBe('08:00–11:00 and 12:00–20:00');
      expect(said(r, '2026-10-31', id.milo)).toBe('08:00–20:00');
    }
  });

  it('G24: a synced event with no annotations on a calendar whose usual person is Milo, Sunday 14:00–15:00: blocks Milo and the household; not Isla', async () => {
    const address = SYNTHETIC_ADDRESS.replace(
      /private-[0-9a-f]+/,
      `private-${'9a'.padEnd(32, '0')}`,
    );
    const cal = await connectCalendar(
      h.sam,
      { address, name: 'Club GP', visibility: 'household', defaultPersonIds: [id.milo] },
      deps,
    );
    const feed = fakeProvider(
      [
        {
          ics: googleFeed([
            nzEvent({
              uid: 'club-gp@example.test',
              start: '20261018T140000',
              end: '20261018T150000',
              summary: 'Club',
            }),
          ]),
        },
      ],
      { homeTimeZone: ZONE },
    );
    await refreshCalendar(h.sam, cal.calendarId, feed, { today: TODAY }, deps);
    // The refresh records the real clock's time; the fixture's `now` is fixed,
    // so its last success is set to 06:58 as for the household calendar.
    await admin.db.execute(
      sql`update calendar_source set last_synced_at = ${healthyAt}::timestamptz where id = ${cal.calendarId}::uuid`,
    );
    const club = (await listEvents(h.sam, {}, deps)).find((e) => e.title === 'Club')!;
    expect(club.calendarSourceId).toBe(cal.calendarId);
    for (const actor of [h.sam, h.alex]) {
      const r = await read(actor);
      expect(r.coverage.rule).toBe('coverage.recorded');
      for (const scope of [HOUSEHOLD, id.milo])
        expect(said(r, '2026-10-18', scope)).toBe('08:00–14:00 and 15:00–20:00');
      expect(said(r, '2026-10-18', id.isla)).toBe('08:00–20:00');
      expect(r.gaps.find((g) => g.key === `gap:${id.milo}:2026-10-18:1500-2000`)!.before).toEqual({
        kind: 'event',
        id: club.id,
        occurrenceDate: '2026-10-18',
      });
    }
  });
});

describe('a scheduled task that began before the range (§5.4 “over its window”)', () => {
  it('D: an overnight task Saturday 24 22:00 to Sunday 25 10:00 for Milo, through createTask: read from Sunday, household and Milo 10:00–20:00 with the same keys and gaps as read from Saturday; no extra query', async () => {
    // Not vacuous: before the task, Sunday is open from 08:00 for both scopes.
    for (const scope of [HOUSEHOLD, id.milo])
      expect(said(await readFrom(h.alex, SUN_25), '2026-10-25', scope)).toBe('08:00–20:00');
    const overnight = await createTask(
      h.sam,
      {
        title: 'Overnight job',
        assigneePersonId: id.milo,
        scheduled: { startsAt: '2026-10-24T22:00:00+13:00', endsAt: '2026-10-25T10:00:00+13:00' },
      },
      deps,
    );
    for (const actor of [h.sam, h.alex]) {
      const sunday = await readFrom(actor, SUN_25);
      const saturday = await readFrom(actor, SAT_24);
      // The agenda from Sunday does not place it (it starts on Saturday): the
      // engine reads its window from the task record instead.
      expect(
        sunday.days
          .flatMap((d) => d.items)
          .some((i) => i.kind === 'task_scheduled' && i.taskId === overnight.id),
      ).toBe(false);
      for (const scope of [HOUSEHOLD, id.milo]) {
        expect(said(sunday, '2026-10-25', scope)).toBe('10:00–20:00');
        expect(said(saturday, '2026-10-25', scope)).toBe('10:00–20:00');
        const key = `gap:${scope}:2026-10-25:1000-2000`;
        expect(sunday.gaps.find((g) => g.scope === scope && g.date === '2026-10-25')?.key).toBe(
          key,
        );
        expect(sunday.gaps.find((g) => g.key === key)!.before).toEqual({
          kind: 'task',
          id: overnight.id,
        });
      }
      expect(said(sunday, '2026-10-25', id.isla)).toBe('08:00–20:00');
      // The whole of Sunday, every scope, byte for byte, wherever the range starts.
      expect(dateBytes(sunday, '2026-10-25')).toBe(dateBytes(saturday, '2026-10-25'));
    }
    // The composition still adds no query to the agenda read.
    let q = queries;
    await readAgendaInputs(h.alex, deps);
    const agendaQueries = queries - q;
    q = queries;
    await readFrom(h.alex, SUN_25);
    expect(queries - q).toBe(agendaQueries);
  });
});

describe('P1: the privacy invariant for gaps and coverage (contract §3.5, §8.2)', () => {
  it('Sam’s private event, all-day event, scheduled task, person and stale calendar leave Alex’s gaps, keys, order, facts and coverage byte-identical, and change Sam’s', async () => {
    const before = { alex: await read(h.alex), sam: await read(h.sam) };
    // Not vacuous: Alex has gaps on the days the private records fall on.
    expect(said(before.alex, '2026-10-17', id.sam)).toBe('08:00–20:00');
    expect(said(before.alex, '2026-10-18', id.sam)).toBe('08:00–20:00');
    expect(said(before.sam, '2026-10-17', id.sam)).toBe('08:00–20:00');

    const privateEvent = await createEventWithPeople(
      h.sam,
      {
        title: 'Private Saturday',
        kind: 'appointment',
        visibility: 'private',
        time: day('2026-10-17', '12:00', '13:00'),
      },
      [{ personId: id.sam, role: 'attending' }],
      deps,
    );
    const privateAllDay = await createEventWithPeople(
      h.sam,
      {
        title: 'Private Sunday',
        kind: 'other',
        visibility: 'private',
        time: { allDay: true, startDate: '2026-10-18', endDate: '2026-10-19' },
      },
      [{ personId: id.sam, role: 'attending' }],
      deps,
    );
    const privatePerson = (
      await createPerson(
        h.sam,
        { name: 'Private friend GP', role: 'other', visibility: 'private' },
        deps,
      )
    ).id;
    const withPrivatePerson = await createEventWithPeople(
      h.sam,
      {
        title: 'Private visit',
        kind: 'other',
        visibility: 'private',
        time: day('2026-10-17', '16:00', '17:00'),
      },
      [{ personId: privatePerson, role: 'attending' }],
      deps,
    );
    const privateTask = await createTask(
      h.sam,
      {
        title: 'Private scheduled job',
        visibility: 'private',
        assigneePersonId: id.sam,
        scheduled: { startsAt: '2026-10-17T14:00:00+13:00', endsAt: '2026-10-17T15:00:00+13:00' },
      },
      deps,
    );
    const staleCalendar = await calendarRow(
      h.sam.userId,
      'private',
      'Private GP',
      '2026-10-13T06:00:00+13:00',
      '2',
    );

    const after = { alex: await read(h.alex), sam: await read(h.sam) };
    // Alex: identical, deep and byte for byte.
    expect(after.alex.gaps).toEqual(before.alex.gaps);
    expect(after.alex.coverage).toEqual(before.alex.coverage);
    expect(bytes(after.alex)).toBe(bytes(before.alex));
    for (const secret of [
      privateEvent.id,
      privateAllDay.id,
      privatePerson,
      withPrivatePerson.id,
      privateTask.id,
      staleCalendar,
      'Private',
    ])
      expect(bytes(after.alex)).not.toContain(secret);

    // Sam: the same records do change Sam's own.
    expect(said(after.sam, '2026-10-17', id.sam)).toBe(
      '08:00–12:00 and 13:00–14:00 and 15:00–20:00',
    );
    expect(said(after.sam, '2026-10-17')).toBe(
      '08:00–09:00 and 10:00–12:00 and 13:00–14:00 and 15:00–16:00 and 17:00–20:00',
    );
    expect(said(after.sam, '2026-10-18', id.sam)).toBe('');
    expect(said(after.sam, '2026-10-18')).toBe('');
    expect(said(after.sam, '2026-10-17', privatePerson)).toBe('08:00–16:00 and 17:00–20:00');
    expect(after.sam.coverage.rule).toBe('coverage.partial');
    expect(after.sam.coverage.calendars.find((c) => c.id === staleCalendar)?.health).toBe('stale');
    expect(bytes(after.sam)).not.toBe(bytes(before.sam));
  });

  it('Sam’s private overnight scheduled task (Saturday 24 22:00 to Sunday 25 11:00), read from Sunday: Alex’s gaps, keys, facts and coverage byte-identical; Sam’s change', async () => {
    const before = { alex: await readFrom(h.alex, SUN_25), sam: await readFrom(h.sam, SUN_25) };
    // Not vacuous: both adults have Sunday gaps for the household and for Sam.
    for (const r of [before.alex, before.sam]) {
      expect(said(r, '2026-10-25')).toBe('10:00–20:00');
      expect(said(r, '2026-10-25', id.sam)).toBe('08:00–20:00');
    }
    const privateOvernight = await createTask(
      h.sam,
      {
        title: 'Private overnight job',
        visibility: 'private',
        assigneePersonId: id.sam,
        scheduled: { startsAt: '2026-10-24T22:00:00+13:00', endsAt: '2026-10-25T11:00:00+13:00' },
      },
      deps,
    );
    const after = { alex: await readFrom(h.alex, SUN_25), sam: await readFrom(h.sam, SUN_25) };
    expect(after.alex.gaps).toEqual(before.alex.gaps);
    expect(after.alex.coverage).toEqual(before.alex.coverage);
    expect(bytes(after.alex)).toBe(bytes(before.alex));
    expect(bytes(after.alex)).not.toContain(privateOvernight.id);
    // Sam's own: the private window blocks Sam and the household until 11:00.
    expect(said(after.sam, '2026-10-25', id.sam)).toBe('11:00–20:00');
    expect(said(after.sam, '2026-10-25')).toBe('11:00–20:00');
    expect(
      after.sam.gaps.find((g) => g.key === `gap:${id.sam}:2026-10-25:1100-2000`)!.before,
    ).toEqual({ kind: 'task', id: privateOvernight.id });
    expect(bytes(after.sam)).not.toBe(bytes(before.sam));
  });
});

describe('what the composition costs (contract §3.8)', () => {
  it('is the agenda read and nothing more, and the same after 20 more events', async () => {
    const measure = async () => {
      let q = queries;
      await readAgendaInputs(h.sam, deps);
      const agenda = queries - q;
      q = queries;
      await read(h.sam);
      return { agenda, gaps: queries - q };
    };
    const small = await measure();
    expect(small.gaps).toBe(small.agenda);
    for (let k = 0; k < 20; k++)
      await createEventWithPeople(
        h.sam,
        {
          title: `Extra ${k}`,
          kind: 'other',
          time: day(`2026-10-${16 + (k % 10)}`, '10:00', '11:00'),
        },
        [{ personId: id.milo, role: 'attending' }],
        deps,
      );
    const large = await measure();
    expect(large).toEqual(small);
    console.info(
      `Gaps for a reader (${DAYS} days): ${small.gaps} queries, the agenda read's ${small.agenda}; ${large.gaps} after 20 more events`,
    );
  });
});
