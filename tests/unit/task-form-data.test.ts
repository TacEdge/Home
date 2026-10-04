import { describe, expect, it } from 'vitest';
import { FormFieldError } from '@/app/_forms/errors';
import { estimateLabel } from '@/app/(home)/tasks/copy';
import { readNewTask, readTaskPatch } from '@/app/(home)/tasks/task-form-data';
import { orderTasks } from '@/app/(home)/tasks/task-list';
import { readNewProject, readProjectPatch } from '@/app/(home)/home/project-form-data';
import type { Project } from '@/domain/projects/service';
import type { Task } from '@/domain/tasks/service';
import { createTaskInput } from '@/domain/tasks/schema';

// The task and project form readers (M3 contract §3.5, §4.1): a window in
// the home zone into instants (both ends or none), an estimate in minutes,
// needs as a set, only the offered project and people; and the To do order.

const NZ = 'Pacific/Auckland';
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const PR = '11111111-1111-4111-8111-111111111111';
const PE = '22222222-2222-4222-8222-222222222222';
const offered = { projectIds: [PR], peopleIds: [PE, '33333333-3333-4333-8333-333333333333'] };
const refusal = (f: FormData) => {
  try {
    readNewTask(f, offered, NZ);
  } catch (e) {
    if (e instanceof FormFieldError) return e.fields;
    throw e;
  }
  return null;
};

describe('readNewTask', () => {
  it('reads the whole form into the schema, a window in the home zone', () => {
    const input = readNewTask(
      form({
        title: 'Paint the fence',
        notes: 'Same green as the shed.',
        projectId: PR,
        assigneePersonId: PE,
        aboutPersonId: '',
        dueDate: '2026-10-20',
        estimateMinutes: '180',
        needs_present: '1',
        needs_dry_weather: 'on',
        needs_daylight: 'on',
        windowDate: '2026-10-17',
        windowFrom: '09:00',
        windowTo: '12:00',
        visibility: 'household',
      }),
      offered,
      NZ,
    );
    const parsed = createTaskInput.parse(input);
    expect(parsed.projectId).toBe(PR);
    expect(parsed.assigneePersonId).toBe(PE);
    expect(parsed.aboutPersonId).toBeNull();
    expect(parsed.estimateMinutes).toBe(180);
    expect(parsed.needs).toEqual(['dry_weather', 'daylight']);
    expect(parsed.scheduled).toEqual({
      startsAt: new Date('2026-10-16T20:00:00.000Z'),
      endsAt: new Date('2026-10-16T23:00:00.000Z'),
    });
  });

  it('ignores a project or person the form was not offered', () => {
    const input = readNewTask(
      form({ title: 'x', projectId: 'pr-other', assigneePersonId: 'pe-9' }),
      offered,
      NZ,
    );
    expect(input.projectId).toBeNull();
    expect(input.assigneePersonId).toBeNull();
  });

  it('an empty window clears; a half window, a bad time or an inverted one is refused by name', () => {
    expect(
      readNewTask(form({ title: 'x', windowDate: '', windowFrom: '', windowTo: '' }), offered, NZ)
        .scheduled,
    ).toBeNull();
    expect(
      refusal(form({ title: 'x', windowDate: '2026-10-17', windowFrom: '', windowTo: '' })),
    ).toEqual({
      windowFrom: 'This needs a time, like 09:00.',
      windowTo: 'This needs a time, like 11:00.',
    });
    expect(
      refusal(form({ title: 'x', windowDate: '', windowFrom: '09:00', windowTo: '10:00' })),
    ).toEqual({ windowDate: 'A window needs its date.' });
    expect(
      refusal(
        form({ title: 'x', windowDate: '2026-10-17', windowFrom: '11:00', windowTo: '10:00' }),
      ),
    ).toEqual({ windowTo: 'The window ends before it starts.' });
    expect(refusal(form({ title: 'x', estimateMinutes: 'soon' }))).toEqual({
      estimateMinutes: 'Minutes, as a whole number.',
    });
  });
});

describe('readTaskPatch', () => {
  it('sends only what the form carried, never a status', () => {
    expect(readTaskPatch(form({ title: 'y', dueDate: '' }), offered, NZ)).toEqual({
      title: 'y',
      dueDate: null,
    });
    expect(readTaskPatch(form({ needs_present: '1' }), offered, NZ)).toEqual({ needs: [] });
  });
});

describe('project form readers', () => {
  it('read the form, and a patch carries only what was sent', () => {
    expect(
      readNewProject(
        form({ title: 'Back fence', summary: '', status: 'active', targetDate: '2026-12-01' }),
      ),
    ).toEqual({
      title: 'Back fence',
      summary: null,
      status: 'active',
      targetDate: '2026-12-01',
      visibility: 'household',
    });
    expect(readProjectPatch(form({ status: 'done' }))).toEqual({ status: 'done' });
  });
});

describe('orderTasks and labels', () => {
  const t = (id: string, dueDate: string | null, projectId: string | null, created: string) =>
    ({ id, dueDate, projectId, createdAt: new Date(created), status: 'open' }) as unknown as Task;
  const projects = new Map<string, Project>([
    ['a', { id: 'a', title: 'Garage' } as Project],
    ['b', { id: 'b', title: 'Back fence' } as Project],
  ]);
  it('orders by due date (none last), then project title, then age', () => {
    const out = orderTasks(
      [
        t('1', null, 'a', '2026-01-01'),
        t('2', '2026-10-20', 'a', '2026-01-03'),
        t('3', '2026-10-20', 'b', '2026-01-02'),
        t('4', '2026-10-19', null, '2026-01-04'),
        t('5', null, null, '2026-01-01'),
        t('6', '2026-10-20', 'b', '2026-01-01'),
      ],
      projects,
    );
    expect(out.map((x) => x.id)).toEqual(['4', '6', '3', '2', '1', '5']);
  });
  it('says how long in words', () => {
    expect(estimateLabel(30)).toBe('30 min');
    expect(estimateLabel(120)).toBe('2 h');
    expect(estimateLabel(90)).toBe('1 h 30');
  });
});
