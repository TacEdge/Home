import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { person, project, task } from '@/db/schema';
import type { TaskStatus } from '@/db/schema/task';
import type { UserActor } from '@/trust/actor';
import { NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { records } from '../common/records';
import { checkReferences, type Ref } from '../common/references';
import { auditedWrite, provenanceOf, type Deps } from '../common/write';
import {
  createTaskInput,
  updateTaskInput,
  type CreateTaskInput,
  type UpdateTaskInput,
} from './schema';

// Tasks (FAMILY-DATA-MODEL §3, M2 contract §5). Same write discipline as
// every record. A task's project and people are references: visible to the
// actor, not archived, and household whenever the task is (§5.5).
// `completed_at` follows the status: set (database clock) when a task
// becomes done, cleared when it stops being done.

export type Task = typeof task.$inferSelect;
type ReadOpts = { includeArchived?: boolean };

const R = records(task, 'task');
const audit = (name: string, row: Task, meta?: Record<string, string | string[]>) => ({
  event: `task.${name}`,
  subjectType: 'task',
  subjectId: row.id,
  meta,
  record: row,
});

type RefIds = {
  projectId?: string | null;
  assigneePersonId?: string | null;
  aboutPersonId?: string | null;
};
const refsOf = (ids: RefIds): (Ref | null)[] => [
  ids.projectId ? { table: project, entity: 'project', id: ids.projectId } : null,
  ids.assigneePersonId ? { table: person, entity: 'person', id: ids.assigneePersonId } : null,
  ids.aboutPersonId ? { table: person, entity: 'person', id: ids.aboutPersonId } : null,
];

const windowColumns = (w: { startsAt: Date; endsAt: Date } | null | undefined) =>
  w === undefined
    ? {}
    : { scheduledStartsAt: w?.startsAt ?? null, scheduledEndsAt: w?.endsAt ?? null };

export async function createTask(
  actor: UserActor,
  input: CreateTaskInput,
  deps: Deps = {},
): Promise<Task> {
  assertCanWrite(actor);
  const { scheduled, ...data } = createTaskInput.parse(input);
  return auditedWrite(actor, deps, async (tx) => {
    await checkReferences(tx, actor, data.visibility, refsOf(data));
    const [row] = await tx
      .insert(task)
      .values({
        ...data,
        ...windowColumns(scheduled),
        completedAt: data.status === 'done' ? sql`now()` : null,
        createdBy: actor.userId,
        ...provenanceOf(deps),
      })
      .returning();
    if (!row) throw new Error('task insert returned no row');
    return {
      result: row,
      audit: audit('create', row, { status: row.status, visibility: row.visibility }),
    };
  });
}

export async function getTask(actor: UserActor, id: string, opts: ReadOpts = {}, deps: Deps = {}) {
  return R.get(deps.db ?? getDb(), actor, id, opts.includeArchived ? 'include' : 'exclude');
}

/** Tasks by due date (undated last), then age. Filters narrow what the actor can already see. */
export async function listTasks(
  actor: UserActor,
  opts: ReadOpts & { projectId?: string; status?: TaskStatus } = {},
  deps: Deps = {},
): Promise<Task[]> {
  const db = deps.db ?? getDb();
  return db
    .select()
    .from(task)
    .where(
      and(
        R.readable(actor, opts.includeArchived ? 'include' : 'exclude'),
        opts.projectId ? eq(task.projectId, R.validId(opts.projectId)) : undefined,
        opts.status ? eq(task.status, opts.status) : undefined,
      ),
    )
    .orderBy(sql`${task.dueDate} asc nulls last`, asc(task.createdAt), asc(task.id));
}

export async function updateTask(
  actor: UserActor,
  id: string,
  patch: UpdateTaskInput,
  deps: Deps = {},
): Promise<Task> {
  assertCanWrite(actor);
  const parsed = updateTaskInput.parse(patch);
  const { scheduled, ...data } = parsed;
  const fields = Object.keys(parsed).sort();
  if (fields.length === 0) return getTask(actor, id, {}, deps);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    const next = data.visibility ?? current.visibility;
    if (next !== current.visibility && current.createdBy !== actor.userId) {
      throw new NotPermittedError('not_creator');
    }
    // Re-check references whenever they change, or the task becomes household.
    const refsChanged = ['projectId', 'assigneePersonId', 'aboutPersonId'].some((k) => k in data);
    if (refsChanged || (next === 'household' && current.visibility === 'private')) {
      await checkReferences(tx, actor, next, refsOf({ ...current, ...data }));
    }
    const completed =
      data.status === undefined || data.status === current.status
        ? {}
        : { completedAt: data.status === 'done' ? sql`now()` : null };
    const row = await R.update(tx, actor, current.id, 'exclude', {
      ...data,
      ...windowColumns(scheduled),
      ...completed,
    });
    return {
      result: row,
      audit: audit('update', row, data.status ? { fields, status: row.status } : { fields }),
    };
  });
}

export async function archiveTask(actor: UserActor, id: string, deps: Deps = {}): Promise<Task> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    const row = await R.update(tx, actor, current.id, 'exclude', { archivedAt: sql`now()` });
    return { result: row, audit: audit('archive', row) };
  });
}

export async function restoreTask(actor: UserActor, id: string, deps: Deps = {}): Promise<Task> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'include');
    if (current.archivedAt === null) throw new NotPermittedError('not_archived');
    const row = await R.update(tx, actor, current.id, 'only', { archivedAt: null });
    return { result: row, audit: audit('restore', row) };
  });
}
