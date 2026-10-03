import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject, listProjects, updateProject } from '@/domain/projects/service';
import { createTask, listTasks, updateTask } from '@/domain/tasks/service';
import { FAMILY_PROJECTS, FAMILY_TASKS } from '../fixtures/family';
import { testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// Task and project specifics: completion follows status on the database
// clock; scheduled windows, needs and estimates; V0.1 projects are home
// projects; list filters.

const { db, close } = testDb();
const deps = { db };
let h: Household;
beforeAll(async () => {
  h = await ensureFixtureUsers(db);
});
afterAll(close);

describe('tasks', () => {
  it('completed_at follows the status: set when done, cleared when reopened, untouched otherwise', async () => {
    const t = await createTask(h.sam, FAMILY_TASKS.paintFence, deps);
    expect(t).toMatchObject({
      status: 'open',
      completedAt: null,
      needs: ['dry_weather', 'daylight'],
      estimateMinutes: 180,
    });
    const done = await updateTask(h.alex, t.id, { status: 'done' }, deps);
    expect(done.completedAt?.getTime()).toBe(done.updatedAt.getTime());
    const renamed = await updateTask(h.alex, t.id, { title: 'Paint the fence' }, deps);
    expect(renamed.completedAt?.getTime()).toBe(done.completedAt?.getTime());
    expect((await updateTask(h.sam, t.id, { status: 'open' }, deps)).completedAt).toBeNull();
    const createdDone = await createTask(h.sam, { title: 'Already done', status: 'done' }, deps);
    expect(createdDone.completedAt).not.toBeNull();
  });

  it('a scheduled window is stored as two instants, and cleared together', async () => {
    const t = await createTask(
      h.sam,
      {
        ...FAMILY_TASKS.garageLight,
        scheduled: { startsAt: '2026-10-17T09:00:00+13:00', endsAt: '2026-10-17T09:30:00+13:00' },
      },
      deps,
    );
    expect(t.scheduledStartsAt?.toISOString()).toBe('2026-10-16T20:00:00.000Z');
    const cleared = await updateTask(h.sam, t.id, { scheduled: null }, deps);
    expect(cleared).toMatchObject({ scheduledStartsAt: null, scheduledEndsAt: null });
  });

  it.each([
    ['a repeated need', { needs: ['daylight', 'daylight'] }],
    ['an unknown need', { needs: ['sunshine'] }],
    ['a zero estimate', { estimateMinutes: 0 }],
    ['a fractional estimate', { estimateMinutes: 1.5 }],
    [
      'a window ending as it starts',
      { scheduled: { startsAt: '2026-10-17T09:00:00Z', endsAt: '2026-10-17T09:00:00Z' } },
    ],
    ['a completion time (the service sets it)', { completedAt: '2026-10-17T09:00:00Z' }],
  ])('refuses %s', async (_label, extra) => {
    await expect(
      createTask(h.sam, { title: 'Bad task', ...extra } as never, deps),
    ).rejects.toThrow();
  });

  it('lists by due date, undated last, and filters by project and status', async () => {
    const p = await createProject(h.sam, FAMILY_PROJECTS.backFence, deps);
    const later = await createTask(
      h.sam,
      { title: 'Later', projectId: p.id, dueDate: '2026-11-01' },
      deps,
    );
    const sooner = await createTask(
      h.sam,
      { title: 'Sooner', projectId: p.id, dueDate: '2026-10-20' },
      deps,
    );
    const undated = await createTask(h.sam, { title: 'Undated', projectId: p.id }, deps);
    expect((await listTasks(h.sam, { projectId: p.id }, deps)).map((t) => t.id)).toEqual([
      sooner.id,
      later.id,
      undated.id,
    ]);
    await updateTask(h.sam, sooner.id, { status: 'done' }, deps);
    expect(
      (await listTasks(h.sam, { projectId: p.id, status: 'open' }, deps)).map((t) => t.id),
    ).toEqual([later.id, undated.id]);
  });
});

describe('projects', () => {
  it('defaults to a home project in the idea stage; only home is accepted in V0.1', async () => {
    const p = await createProject(h.sam, FAMILY_PROJECTS.garage, deps);
    expect(p).toMatchObject({ domain: 'home', status: 'idea' });
    await expect(
      createProject(h.sam, { title: 'Holiday', domain: 'family' } as never, deps),
    ).rejects.toThrow();
    await expect(updateProject(h.sam, p.id, { domain: 'us' } as never, deps)).rejects.toThrow();
  });

  it('filters by status', async () => {
    const active = await createProject(h.sam, { title: 'Active one', status: 'active' }, deps);
    const ids = (await listProjects(h.sam, { status: 'active' }, deps)).map((p) => p.id);
    expect(ids).toContain(active.id);
    expect((await listProjects(h.sam, { status: 'paused' }, deps)).map((p) => p.id)).not.toContain(
      active.id,
    );
  });
});
