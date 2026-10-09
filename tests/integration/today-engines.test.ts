import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listCalendars } from '@/domain/calendar/service';
import { captureVerbatim, listCaptures } from '@/domain/captures/service';
import { agenda } from '@/domain/engines/agenda';
import { insights } from '@/domain/engines/insights';
import { today } from '@/domain/engines/today';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import { createEventWithPeople } from '@/domain/events/service';
import { createPerson } from '@/domain/people/service';
import { createProject, listProjects } from '@/domain/projects/service';
import { createTask, listTasks } from '@/domain/tasks/service';
import type { UserActor } from '@/trust/actor';
import { addDays, isoDateInZone } from '@/lib/dates';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// The non-interference invariant for the Today and insights engines (ADR
// 0008 §9, M5 Package 2): composed exactly as Package 3's loader will, from
// the domain services as each adult, the other adult's private records change
// nothing in a reader's headline, person lines, Also today, to-do, counts,
// evening state or insights (list, ranking, more). The same records do change
// their owner's. Synthetic only.

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
// Wednesday 14 October, 07:03 at home: the engines' injected time.
const NOW = new Date('2026-10-14T07:03:00+13:00');
let h: Household;
const id: Record<'sam' | 'alex' | 'milo', string> = { sam: '', alex: '', milo: '' };

/** What Package 3's loader will give the engines: every read as the actor. */
async function compose(actor: UserActor, now = NOW) {
  const inputs = await readAgendaInputs(actor, deps);
  const [calendars, tasks, projects, captures] = await Promise.all([
    listCalendars(actor, { now }, deps),
    listTasks(actor, { status: 'open' }, deps),
    listProjects(actor, {}, deps),
    listCaptures(actor, {}, deps),
  ]);
  const from = isoDateInZone(now, ZONE);
  const days = agenda({
    from,
    to: addDays(from, 7),
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
    dateOfBirth: p.dateOfBirth,
  }));
  return {
    today: today({
      now,
      timeZone: ZONE,
      days,
      events: inputs.events,
      people,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        scheduledStartsAt: t.scheduledStartsAt,
      })),
      calendars,
      capturesWaiting: captures.filter((c) => c.status === 'new' || c.status === 'proposed').length,
    }),
    insights: insights({
      now,
      timeZone: ZONE,
      days,
      events: inputs.events,
      people,
      tasks: tasks.map((t) => ({ id: t.id, projectId: t.projectId })),
      projects,
      calendars,
    }),
  };
}

/** A private calendar of Sam's that last refreshed a fortnight ago. */
async function samPrivateStaleCalendar() {
  const sealed = `hc1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`;
  const c = await admin.db.execute(sql`
    insert into calendar_connection (owner_user_id, provider, credentials_encrypted, credentials_key_id, address_fingerprint)
    values (${h.sam.userId}, 'ics', ${sealed}, '0123456789abcdef', ${`fp1.${'7'.repeat(43)}`}) returning id`);
  await admin.db.execute(sql`
    insert into calendar_source (created_by, created_via, visibility, connection_id, external_calendar_id, name, last_attempt_at, last_synced_at, last_sync_status)
    values (${h.sam.userId}, 'ui', 'private', ${c.rows[0]?.id as string}::uuid, 'primary', 'Sam private calendar',
            '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z', 'ok')`);
}

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  id.sam = (await createPerson(h.sam, { name: 'Sam TE', role: 'parent' }, deps)).id;
  id.alex = (await createPerson(h.sam, { name: 'Alex TE', role: 'parent' }, deps)).id;
  id.milo = (
    await createPerson(h.sam, { name: 'Milo TE', role: 'child', dateOfBirth: '2017-02-08' }, deps)
  ).id;
  // A household Wednesday both adults see.
  await createEventWithPeople(
    h.sam,
    {
      title: 'Swimming',
      kind: 'activity',
      time: {
        allDay: false,
        startsAt: '2026-10-14T15:30:00+13:00',
        endsAt: '2026-10-14T16:15:00+13:00',
        timeZone: ZONE,
      },
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
      title: 'Pilates',
      kind: 'activity',
      time: {
        allDay: false,
        startsAt: '2026-10-14T18:15:00+13:00',
        endsAt: '2026-10-14T19:15:00+13:00',
        timeZone: ZONE,
      },
    },
    [{ personId: id.alex, role: 'attending' }],
    deps,
  );
  await createTask(h.alex, { title: 'Pay swimming term fees', dueDate: '2026-10-14' }, deps);
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
  await admin.close();
});

describe('non-interference', () => {
  it('Sam’s private records change nothing in Alex’s Today or insights, and do change Sam’s', async () => {
    const alexBefore = await compose(h.alex);
    const samBefore = await compose(h.sam);
    const alexEvening = await compose(h.alex, new Date('2026-10-14T22:00:00+13:00'));

    // Sam's private: a late evening for Sam today (which with Alex's Pilates would make a
    // late-evening headline), six things tomorrow, a person whose birthday is tomorrow, a
    // project due Friday with an open task, a task due today, a stale calendar and a capture.
    const secret = (
      await createPerson(
        h.sam,
        { name: 'Secret TE', role: 'other', visibility: 'private', dateOfBirth: '1990-10-15' },
        deps,
      )
    ).id;
    const priv = (title: string, start: string, end: string, people: string[]) =>
      createEventWithPeople(
        h.sam,
        {
          title,
          kind: 'appointment',
          visibility: 'private',
          time: { allDay: false, startsAt: start, endsAt: end, timeZone: ZONE },
        },
        people.map((personId) => ({ personId, role: 'attending' as const })),
        deps,
      );
    await priv('Private late', '2026-10-14T20:00:00+13:00', '2026-10-14T23:30:00+13:00', [
      id.sam,
      secret,
    ]);
    for (let k = 0; k < 6; k++)
      await priv(
        `Private tomorrow ${k}`,
        `2026-10-15T${String(9 + k).padStart(2, '0')}:00:00+13:00`,
        `2026-10-15T${String(9 + k).padStart(2, '0')}:30:00+13:00`,
        [id.sam],
      );
    const project = await createProject(
      h.sam,
      {
        title: 'Private project',
        status: 'active',
        targetDate: '2026-10-16',
        visibility: 'private',
      },
      deps,
    );
    await createTask(
      h.sam,
      { title: 'Private step', projectId: project.id, visibility: 'private' },
      deps,
    );
    await createTask(
      h.sam,
      { title: 'Private due today', dueDate: '2026-10-14', visibility: 'private' },
      deps,
    );
    await samPrivateStaleCalendar();
    await captureVerbatim(h.sam, { text: 'A private thought' }, deps);

    const alexAfter = await compose(h.alex);
    expect(alexAfter).toEqual(alexBefore);
    expect(await compose(h.alex, new Date('2026-10-14T22:00:00+13:00'))).toEqual(alexEvening);

    // The same records do reach their owner: the invariant is not vacuous.
    const samAfter = await compose(h.sam);
    expect(samAfter.today.headline.late?.text).toBe(
      'Alex TE and Sam TE both have something on after 6.',
    );
    expect(samBefore.today.headline.late).toBeNull();
    expect(samAfter.today.headline.qualified).toBe(true);
    expect(samAfter.today.toSort).toBe(samBefore.today.toSort + 1);
    expect(samAfter.today.todo.all.length).toBe(samBefore.today.todo.all.length + 1);
    expect(samAfter.insights.all.map((i) => i.rule).sort()).toEqual(
      [
        'busy_day.count',
        'busy_day.late',
        'data_health.stale',
        'preparation.birthday',
        'preparation.project_target',
      ].sort(),
    );
  });

  it('Alex sees the household day as recorded, and nothing about Sam’s evening', async () => {
    const { today: t } = await compose(h.alex);
    expect(t.headline).toMatchObject({
      rule: 'headline.listed',
      text: 'Swimming at 15:30, then Pilates at 18:15.',
      qualified: false,
      late: null,
    });
    expect(
      t.personLines.map((l) => `${l.name}: ${l.entries.map((e) => e.text).join(' · ')}`),
    ).toEqual(['Alex TE: 15:30 Swimming · 18:15 Pilates', 'Milo TE: 15:30 Swimming']);
  });
});
