import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema';
import type { ProjectStatus } from '@/db/schema/project';
import type { UserActor } from '@/trust/actor';
import { NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { records } from '../common/records';
import { assertNotReferencedByHousehold } from '../common/references';
import { auditedWrite, provenanceOf, type Deps } from '../common/write';
import {
  createProjectInput,
  updateProjectInput,
  type CreateProjectInput,
  type UpdateProjectInput,
} from './schema';

// Home projects (FAMILY-DATA-MODEL §3, M2 contract §5). Same write
// discipline as every record (common/records.ts). A project household tasks
// or notes point at cannot become private (contract §5.5).

export type Project = typeof project.$inferSelect;
type ReadOpts = { includeArchived?: boolean };

const R = records(project, 'project');
const audit = (name: string, row: Project, meta?: Record<string, string | string[]>) => ({
  event: `project.${name}`,
  subjectType: 'project',
  subjectId: row.id,
  meta,
  record: row,
});

export async function createProject(
  actor: UserActor,
  input: CreateProjectInput,
  deps: Deps = {},
): Promise<Project> {
  assertCanWrite(actor);
  const data = createProjectInput.parse(input);
  return auditedWrite(actor, deps, async (tx) => {
    const [row] = await tx
      .insert(project)
      .values({ ...data, createdBy: actor.userId, ...provenanceOf(deps) })
      .returning();
    if (!row) throw new Error('project insert returned no row');
    return {
      result: row,
      audit: audit('create', row, { status: row.status, visibility: row.visibility }),
    };
  });
}

export async function getProject(
  actor: UserActor,
  id: string,
  opts: ReadOpts = {},
  deps: Deps = {},
) {
  return R.get(deps.db ?? getDb(), actor, id, opts.includeArchived ? 'include' : 'exclude');
}

export async function listProjects(
  actor: UserActor,
  opts: ReadOpts & { status?: ProjectStatus } = {},
  deps: Deps = {},
): Promise<Project[]> {
  const db = deps.db ?? getDb();
  return db
    .select()
    .from(project)
    .where(
      and(
        R.readable(actor, opts.includeArchived ? 'include' : 'exclude'),
        opts.status ? eq(project.status, opts.status) : undefined,
      ),
    )
    .orderBy(asc(sql`lower(${project.title})`), asc(project.id));
}

export async function updateProject(
  actor: UserActor,
  id: string,
  patch: UpdateProjectInput,
  deps: Deps = {},
): Promise<Project> {
  assertCanWrite(actor);
  const data = updateProjectInput.parse(patch);
  const fields = Object.keys(data).sort();
  if (fields.length === 0) return getProject(actor, id, {}, deps);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    if (data.visibility !== undefined && data.visibility !== current.visibility) {
      if (current.createdBy !== actor.userId) throw new NotPermittedError('not_creator');
      if (data.visibility === 'private')
        await assertNotReferencedByHousehold(tx, 'project', current.id);
    }
    const row = await R.update(tx, actor, current.id, 'exclude', data);
    return { result: row, audit: audit('update', row, { fields }) };
  });
}

export async function archiveProject(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Project> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    const row = await R.update(tx, actor, current.id, 'exclude', { archivedAt: sql`now()` });
    return { result: row, audit: audit('archive', row) };
  });
}

export async function restoreProject(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Project> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'include');
    if (current.archivedAt === null) throw new NotPermittedError('not_archived');
    const row = await R.update(tx, actor, current.id, 'only', { archivedAt: null });
    return { result: row, audit: audit('restore', row) };
  });
}
