import { TASK_NEEDS } from '@/domain/tasks/schema';
import type { CreateTaskInput, UpdateTaskInput } from '@/domain/tasks/schema';
import type { Task } from '@/domain/tasks/service';
import { choiceOf, requiredTextOf, textOf } from '@/app/_forms/read';
import { FormFieldError } from '@/app/_forms/errors';
import { instantFromWallClock, isValidIsoDate, parseIsoDate } from '@/lib/dates';

// The task form, read into the shared Zod schema's shape (M3 contract §3.5,
// §4.1). Pure: the service validates. A scheduled window is a date, a from
// and a to time in the home zone, both ends or none; an empty window
// clears. The project and people a form may name are the ones it offered
// (read in the action), so no other id can be sent.

const TIME = /^(\d{2}):(\d{2})$/;

type Offered = { projectIds: readonly string[]; peopleIds: readonly string[] };

function offeredId(
  form: FormData,
  name: string,
  ids: readonly string[],
): string | null | undefined {
  const v = textOf(form, name);
  if (v === undefined || v === null) return v;
  return ids.includes(v) ? v : null;
}

function readWindow(form: FormData, timeZone: string): CreateTaskInput['scheduled'] {
  if (!form.has('windowDate')) return undefined;
  const date = textOf(form, 'windowDate');
  const from = textOf(form, 'windowFrom');
  const to = textOf(form, 'windowTo');
  if (!date && !from && !to) return null;
  const fields: Record<string, string> = {};
  if (!date) fields.windowDate = 'A window needs its date.';
  else if (!isValidIsoDate(date)) fields.windowDate = 'This needs a real date.';
  if (!from || !TIME.test(from)) fields.windowFrom = 'This needs a time, like 09:00.';
  if (!to || !TIME.test(to)) fields.windowTo = 'This needs a time, like 11:00.';
  if (Object.keys(fields).length) throw new FormFieldError(fields);
  const wall = (t: string) => {
    const m = TIME.exec(t)!;
    return { ...parseIsoDate(date!), hour: Number(m[1]), minute: Number(m[2]), second: 0 };
  };
  const startsAt = instantFromWallClock(wall(from!), timeZone);
  const endsAt = instantFromWallClock(wall(to!), timeZone);
  if (endsAt.getTime() <= startsAt.getTime())
    throw new FormFieldError({ windowTo: 'The window ends before it starts.' });
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

function readEstimate(form: FormData): number | null | undefined {
  const v = textOf(form, 'estimateMinutes');
  if (v === undefined || v === null) return v;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1)
    throw new FormFieldError({ estimateMinutes: 'Minutes, as a whole number.' });
  return n;
}

function readNeeds(form: FormData): CreateTaskInput['needs'] | undefined {
  if (!form.has('needs_present')) return undefined;
  return TASK_NEEDS.filter((n) => form.get(`needs_${n}`) === 'on');
}

export function readNewTask(form: FormData, offered: Offered, timeZone: string): CreateTaskInput {
  return {
    title: requiredTextOf(form, 'title'),
    notes: textOf(form, 'notes'),
    projectId: offeredId(form, 'projectId', offered.projectIds),
    assigneePersonId: offeredId(form, 'assigneePersonId', offered.peopleIds),
    aboutPersonId: offeredId(form, 'aboutPersonId', offered.peopleIds),
    dueDate: textOf(form, 'dueDate'),
    estimateMinutes: readEstimate(form),
    needs: readNeeds(form) ?? [],
    scheduled: readWindow(form, timeZone),
    visibility: (choiceOf(form, 'visibility') ?? 'household') as CreateTaskInput['visibility'],
  };
}

/**
 * A patch: only what the form sent. Status is never read here (it has its
 * own actions). A reference (project, people) is sent only when it differs
 * from what the task holds, so a project or person that has since been
 * archived (not offered for new links) is kept when left alone, and a
 * change must name something offered.
 */
export function readTaskPatch(
  form: FormData,
  offered: Offered,
  timeZone: string,
  current: Pick<Task, 'projectId' | 'assigneePersonId' | 'aboutPersonId'>,
): UpdateTaskInput {
  const reference = (name: keyof typeof current, ids: readonly string[]) => {
    const sent = textOf(form, name);
    if (sent === undefined || sent === current[name]) return undefined;
    if (sent === null) return current[name] === null ? undefined : null;
    return ids.includes(sent) ? sent : null;
  };
  const patch: UpdateTaskInput = {
    title: form.has('title') ? requiredTextOf(form, 'title') : undefined,
    notes: textOf(form, 'notes'),
    projectId: reference('projectId', offered.projectIds),
    assigneePersonId: reference('assigneePersonId', offered.peopleIds),
    aboutPersonId: reference('aboutPersonId', offered.peopleIds),
    dueDate: textOf(form, 'dueDate'),
    estimateMinutes: readEstimate(form),
    needs: readNeeds(form),
    scheduled: readWindow(form, timeZone),
    visibility: choiceOf(form, 'visibility') as UpdateTaskInput['visibility'],
  };
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as UpdateTaskInput;
}
