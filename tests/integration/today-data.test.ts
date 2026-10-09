import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInput } from '@/app/_agenda/today-input';
import { connectCalendar, listCalendars } from '@/domain/calendar/service';
import { listCaptures, captureVerbatim } from '@/domain/captures/service';
import { agenda } from '@/domain/engines/agenda';
import { today } from '@/domain/engines/today';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import { createEventWithPeople } from '@/domain/events/service';
import { createPerson, listPeople } from '@/domain/people/service';
import { createProject, listProjects } from '@/domain/projects/service';
import { createTask, listTasks } from '@/domain/tasks/service';
import { FAMILY_EVENTS, FAMILY_PEOPLE } from '../fixtures/family';
import { SYNTHETIC_ADDRESS } from '../fixtures/calendars/google';
import { testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// What Today reads (M5 Package 3, ADR 0008 §32): one agenda read as the
// signed-in adult, whose whole records the screen shares with the engine. It
// must hand over exactly what the services let this adult see (never the other
// adult's private calendar, project or task), and it must cost the same number
// of queries however much the household has recorded. Synthetic only.

const { db, pool, close } = testDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';

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
let milo: string;

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  milo = (await createPerson(h.sam, { ...FAMILY_PEOPLE.milo, name: 'Milo TD' }, deps)).id;
  await createEventWithPeople(
    h.sam,
    FAMILY_EVENTS.swimming,
    [{ personId: milo, role: 'attending' }],
    deps,
  );
  await createTask(h.sam, { title: 'Sam task TD', dueDate: '2026-10-14' }, deps);
  await createTask(
    h.sam,
    {
      title: 'Sam scheduled TD',
      scheduled: { startsAt: '2026-10-14T10:00:00+13:00', endsAt: '2026-10-14T10:30:00+13:00' },
    },
    deps,
  );
  await createTask(
    h.alex,
    { title: 'Alex private task TD', dueDate: '2026-10-14', visibility: 'private' },
    deps,
  );
  await createProject(h.sam, { title: 'Sam project TD' }, deps);
  await createProject(h.alex, { title: 'Alex private project TD', visibility: 'private' }, deps);
  await connectCalendar(
    h.sam,
    { address: SYNTHETIC_ADDRESS, name: 'Sam calendar TD', visibility: 'household' },
    deps,
  );
  await connectCalendar(
    h.alex,
    {
      address: SYNTHETIC_ADDRESS.replace('synthetic.family', 'alex.private').replace(
        '0123456789abcdef0123456789abcdef',
        'fedcba9876543210fedcba9876543210',
      ),
      name: 'Alex private calendar TD',
      visibility: 'private',
    },
    deps,
  );
  await captureVerbatim(h.sam, { text: 'Sam capture TD', channel: 'web' }, deps);
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
});

describe('what the agenda read hands the Today screen', () => {
  it('is exactly what the services give this adult: the whole records, none of the other adult’s private ones', async () => {
    const { records } = await readAgendaInputs(h.sam, deps);
    expect(records.tasks.map((t) => t.id).sort()).toEqual(
      (await listTasks(h.sam, { status: 'open' }, deps)).map((t) => t.id).sort(),
    );
    expect(records.projects.map((p) => p.id).sort()).toEqual(
      (await listProjects(h.sam, {}, deps)).map((p) => p.id).sort(),
    );
    expect(records.calendars.map((c) => c.id).sort()).toEqual(
      (await listCalendars(h.sam, {}, deps)).map((c) => c.id).sort(),
    );
    const names = JSON.stringify(records);
    expect(names).toContain('Sam task TD');
    expect(names).toContain('Sam calendar TD');
    for (const hidden of [
      'Alex private task TD',
      'Alex private project TD',
      'Alex private calendar TD',
    ])
      expect(names).not.toContain(hidden);
    // The scheduled time reaches the engine, which is what puts the task on Today.
    expect(records.tasks.find((t) => t.title === 'Sam scheduled TD')!.scheduledStartsAt).toEqual(
      new Date('2026-10-14T10:00:00+13:00'),
    );
  });

  it('gives Alex theirs, and the engine’s input from it is the same shape for either adult', async () => {
    const alex = await readAgendaInputs(h.alex, deps);
    expect(JSON.stringify(alex.records)).toContain('Alex private calendar TD');
    expect(JSON.stringify(alex.records)).toContain('Alex private task TD');
    const now = new Date('2026-10-14T07:03:00+13:00');
    const model = (a: typeof alex) =>
      today(
        todayInput(
          {
            days: agenda({
              from: '2026-10-14',
              to: '2026-10-15',
              timeZone: ZONE,
              events: a.events,
              people: a.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
              tasks: a.tasks,
              projects: a.projects,
            }),
            events: a.events,
            people: new Map(a.people.map((p) => [p.id, p])),
            records: a.records,
          },
          now,
          ZONE,
          0,
        ),
      );
    const sam = await readAgendaInputs(h.sam, deps);
    const samToday = model(sam);
    const alexToday = model(alex);
    expect(JSON.stringify(samToday)).not.toContain('Alex private');
    expect(samToday.todo.all.map((e) => e.task.title)).toEqual(['Sam scheduled TD', 'Sam task TD']);
    expect(alexToday.todo.all.map((e) => e.task.title)).toContain('Alex private task TD');
  });
});

describe('what it costs', () => {
  const load = async () => {
    const inputs = await readAgendaInputs(h.sam, deps);
    const captures = await listCaptures(h.sam, {}, deps);
    return { inputs, captures };
  };

  it('is the agenda read and the captures: the four reads the page used to repeat are gone', async () => {
    const now = await counted(load);
    const before = await counted(async () => {
      await readAgendaInputs(h.sam, deps);
      // What Package 1's page did on top of the agenda: tasks, projects, captures, people, calendars.
      await listTasks(h.sam, { status: 'open' }, deps);
      await listProjects(h.sam, {}, deps);
      await listCaptures(h.sam, {}, deps);
      await listPeople(h.sam, {}, deps);
      await listCalendars(h.sam, {}, deps);
    });
    expect(now.queries).toBeLessThan(before.queries);
    // Four repeated reads (tasks, projects, people, calendars) are gone; the calendar read is two queries.
    expect(before.queries - now.queries).toBeGreaterThanOrEqual(4);
    console.info(`Today data load: ${now.queries} queries (was ${before.queries})`);
  });

  it('does not grow with the events, tasks, projects or captures recorded', async () => {
    const small = await counted(load);
    for (let k = 0; k < 30; k++) {
      await createEventWithPeople(
        h.sam,
        { ...FAMILY_EVENTS.swimming, title: `Extra ${k}`, rrule: undefined },
        [{ personId: milo, role: 'attending' }],
        deps,
      );
      await createTask(h.sam, { title: `Extra task ${k}`, dueDate: '2026-10-14' }, deps);
      await captureVerbatim(h.sam, { text: `Extra capture ${k}`, channel: 'web' }, deps);
    }
    for (let k = 0; k < 5; k++) await createProject(h.sam, { title: `Extra project ${k}` }, deps);
    const large = await counted(load);
    expect(large.result.inputs.records.tasks.length).toBeGreaterThanOrEqual(32);
    expect(large.queries).toBe(small.queries);
    console.info(
      `Today data load: ${small.queries} queries with ${small.result.inputs.events.length} events, ` +
        `${large.queries} with ${large.result.inputs.events.length}`,
    );
  });
});
