import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listCalendars } from '@/domain/calendar/service';
import { agenda } from '@/domain/engines/agenda';
import { forward, HORIZONS } from '@/domain/engines/forward';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import { createEventWithPeople } from '@/domain/events/service';
import { createPerson } from '@/domain/people/service';
import { createProject } from '@/domain/projects/service';
import { createTask } from '@/domain/tasks/service';
import type { UserActor } from '@/trust/actor';
import { addDays, isoDateInZone } from '@/lib/dates';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// The Forward engine through the real services (M6 Package 1, ADR 0009 §8;
// contract §3.4, §8.2): composed exactly as the Forward page will compose it,
// from one agenda read as each adult over 90 days. The other adult's private
// records change nothing in a reader's model for any horizon: counts,
// headline, units, notable entries, the usual, tasks and every fact. The same
// records do change their owner's. The read costs the same queries however
// much is recorded. Synthetic only.

const { db, pool, close } = testDb();
const admin = adminDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
const NOW = new Date('2026-10-14T07:03:00+13:00');

let queries = 0;
const send = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof send>) => {
  queries++;
  return send(...args);
}) as typeof pool.query;

let h: Household;
const id: Record<'sam' | 'alex' | 'milo', string> = { sam: '', alex: '', milo: '' };

/** One read as the actor, the 90-day agenda once, then each horizon from it. */
async function compose(actor: UserActor, now = NOW) {
  const inputs = await readAgendaInputs(actor, deps);
  const calendars = await listCalendars(actor, { now }, deps);
  const from = isoDateInZone(now, ZONE);
  const days = agenda({
    from,
    to: addDays(from, 89),
    timeZone: ZONE,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: inputs.tasks,
    projects: inputs.projects,
  });
  const people = inputs.people.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role as 'parent' | 'child' | 'other',
    inHousehold: p.inHousehold,
  }));
  return Object.fromEntries(
    HORIZONS.map((horizon) => [
      horizon,
      forward({ now, timeZone: ZONE, horizon, days, events: inputs.events, people, calendars }),
    ]),
  ) as Record<(typeof HORIZONS)[number], ReturnType<typeof forward>>;
}

const timed = (start: string, end: string) => ({
  allDay: false as const,
  startsAt: start,
  endsAt: end,
  timeZone: ZONE,
});

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  id.sam = (await createPerson(h.sam, { name: 'Sam FE', role: 'parent' }, deps)).id;
  id.alex = (await createPerson(h.sam, { name: 'Alex FE', role: 'parent' }, deps)).id;
  id.milo = (
    await createPerson(h.sam, { name: 'Milo FE', role: 'child', dateOfBirth: '2017-02-08' }, deps)
  ).id;
  // The household's: a weekly swim (usual), a one-off (notable), a scheduled task.
  await createEventWithPeople(
    h.sam,
    {
      title: 'Swimming',
      kind: 'activity',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
      time: timed('2026-10-14T15:30:00+13:00', '2026-10-14T16:15:00+13:00'),
    },
    [
      { personId: id.milo, role: 'attending' },
      { personId: id.alex, role: 'responsible' },
    ],
    deps,
  );
  await createEventWithPeople(
    h.alex,
    {
      title: 'Parent interviews',
      kind: 'school',
      time: timed('2026-10-22T16:00:00+13:00', '2026-10-22T17:00:00+13:00'),
    },
    [{ personId: id.alex, role: 'attending' }],
    deps,
  );
  await createTask(
    h.alex,
    {
      title: 'Ring the plumber',
      scheduled: { startsAt: '2026-10-15T10:00:00+13:00', endsAt: '2026-10-15T10:30:00+13:00' },
    },
    deps,
  );
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
  await admin.close();
});

describe('non-interference (contract §8.2)', () => {
  it('Sam’s private records change nothing in Alex’s Forward on any horizon, and do change Sam’s', async () => {
    const alexBefore = await compose(h.alex);
    const samBefore = await compose(h.sam);
    expect(alexBefore.week.counts.tasksScheduled).toBe(1);
    expect(alexBefore.month.counts.notable).toBeGreaterThan(0);

    // Sam's private: a person with a birthday next week, a weekly private series, one-offs across the season, a scheduled task, a
    // task due, a project target and a stale calendar.
    const secret = (
      await createPerson(
        h.sam,
        { name: 'Secret FE', role: 'child', visibility: 'private', dateOfBirth: '2015-10-19' },
        deps,
      )
    ).id;
    // (A private person cannot be put on a household event: the domain refuses it,
    // `references_private`, so that path never reaches Alex.)
    void secret;
    await createEventWithPeople(
      h.sam,
      {
        title: 'Private weekly',
        kind: 'activity',
        visibility: 'private',
        rrule: 'FREQ=WEEKLY;BYDAY=TH',
        time: timed('2026-10-15T18:00:00+13:00', '2026-10-15T19:00:00+13:00'),
      },
      [{ personId: id.sam, role: 'attending' }],
      deps,
    );
    for (const day of ['2026-10-16', '2026-11-05', '2026-12-18'])
      await createEventWithPeople(
        h.sam,
        {
          title: `Private ${day}`,
          kind: 'appointment',
          visibility: 'private',
          time: timed(`${day}T09:00:00+13:00`, `${day}T10:00:00+13:00`),
        },
        [{ personId: id.sam, role: 'attending' }],
        deps,
      );
    await createTask(
      h.sam,
      {
        title: 'Private scheduled',
        visibility: 'private',
        scheduled: { startsAt: '2026-10-17T10:00:00+13:00', endsAt: '2026-10-17T11:00:00+13:00' },
      },
      deps,
    );
    await createTask(
      h.sam,
      { title: 'Private due', dueDate: '2026-10-20', visibility: 'private' },
      deps,
    );
    await createProject(
      h.sam,
      {
        title: 'Private project',
        status: 'active',
        targetDate: '2026-11-20',
        visibility: 'private',
      },
      deps,
    );
    const sealed = `hc1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`;
    const c = await admin.db.execute(sql`
      insert into calendar_connection (owner_user_id, provider, credentials_encrypted, credentials_key_id, address_fingerprint)
      values (${h.sam.userId}, 'ics', ${sealed}, '0123456789abcdef', ${`fp1.${'8'.repeat(43)}`}) returning id`);
    await admin.db.execute(sql`
      insert into calendar_source (created_by, created_via, visibility, connection_id, external_calendar_id, name, last_attempt_at, last_synced_at, last_sync_status)
      values (${h.sam.userId}, 'ui', 'private', ${c.rows[0]?.id as string}::uuid, 'primary', 'Sam private FE',
              '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z', 'ok')`);

    const alexAfter = await compose(h.alex);
    for (const horizon of HORIZONS)
      expect(alexAfter[horizon], horizon).toEqual(alexBefore[horizon]);
    expect(JSON.stringify(alexAfter)).not.toMatch(/Private|Secret/);

    // The same records reach their owner: the invariant is not vacuous.
    const samAfter = await compose(h.sam);
    expect(samAfter.season.counts.notable).toBeGreaterThan(samBefore.season.counts.notable + 4);
    expect(samAfter.week.counts.tasksScheduled).toBe(samBefore.week.counts.tasksScheduled + 1);
    expect(samAfter.week.headline.qualified).toBe(true);
    expect(samAfter.week.usual.map((w) => w.name)).toContain('Sam FE');
    expect(samBefore.week.usual.map((w) => w.name)).not.toContain('Sam FE');
    expect(JSON.stringify(samAfter.month)).toContain('Private weekly');
  });
});

describe('what the 90-day read costs (contract §3.7)', () => {
  it('does not grow with the events, tasks or projects recorded; the engine adds none', async () => {
    const measure = async () => {
      const before = queries;
      const model = await compose(h.sam);
      return { queries: queries - before, model };
    };
    const small = await measure();
    for (let k = 0; k < 30; k++) {
      const day = addDays('2026-10-14', k * 3);
      await createEventWithPeople(
        h.sam,
        {
          title: `Extra ${k}`,
          kind: 'other',
          time: timed(`${day}T12:00:00+13:00`, `${day}T12:30:00+13:00`),
        },
        [{ personId: id.milo, role: 'attending' }],
        deps,
      );
      await createTask(h.sam, { title: `Extra task ${k}`, dueDate: day }, deps);
    }
    for (let k = 0; k < 5; k++) await createProject(h.sam, { title: `Extra project ${k}` }, deps);
    const large = await measure();
    expect(large.model.season.counts.events).toBeGreaterThanOrEqual(
      small.model.season.counts.events + 30,
    );
    expect(large.queries).toBe(small.queries);
    console.info(
      `Forward data load (90 days, all horizons): ${small.queries} queries, then ${large.queries} with 30 more events and tasks`,
    );
  });
});
