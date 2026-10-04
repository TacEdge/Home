import 'server-only';
import { and, asc, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { context, person, project } from '@/db/schema';
import type { ContextStatus } from '@/db/schema/context';
import { isoDateInZone, type IsoDate } from '@/lib/dates';
import type { UserActor } from '@/trust/actor';
import { sensitivityFilter } from '@/trust/visibility';
import { assessStaleness, type Staleness, type StalenessCategory } from '../engines/staleness';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { records } from '../common/records';
import { checkReferences, type Ref } from '../common/references';
import {
  auditedWrite,
  executionOf,
  provenanceOf,
  type Deps,
  type DomainAudit,
} from '../common/write';
import {
  createContextInput,
  updateContextInput,
  type ContextSubject,
  type CreateContextInput,
  type UpdateContextInput,
} from './schema';

// Context: what Kev knows (FAMILY-DATA-MODEL §3, M2 contract §5.4, §5.6).
// Dated and sourced. Same write discipline as every record, plus:
//   - visibility and sensitivity are independent (ADR 0005 §37): visibility
//     says who may read a record at all (household: either adult; private:
//     its owner); sensitivity says it is left out of every default read and
//     every automatic use. A sensitive record is returned only to a person
//     authorised by its visibility who explicitly asks (`includeSensitive`),
//     and each one returned is audited (`context.sensitive_read`). Kev and
//     the system may never ask, so they never receive it;
//   - sensitive context is created and edited only by a person directly: an
//     executing proposal can neither write `sensitive` nor touch a sensitive
//     record (D15);
//   - a subject is the household, or a person or project the actor can see,
//     and household context may not be about a private one (§5.5);
//   - `confirm` sets last_confirmed_at, `retire` retires it, `reinstate`
//     undoes that; stale or retired context is never deleted (staleness is
//     derived by the engine, never stored).

export type Context = typeof context.$inferSelect;
/**
 * What a write returns: the record without its content (ADR 0005 §43). A
 * write must never become a way to read sensitive content without asking:
 * content comes only from getContext/listContext, where sensitivity is
 * explicit and audited.
 */
export type ContextRecord = Omit<Context, 'content'>;
const structural = ({ content: _content, ...rest }: Context): ContextRecord => rest;
type ReadOpts = { includeArchived?: boolean; includeSensitive?: boolean };

const R = records(context, 'context');
const audit = (
  name: string,
  row: Context,
  meta?: Record<string, string | string[]>,
): DomainAudit => ({
  event: `context.${name}`,
  subjectType: 'context',
  subjectId: row.id,
  meta,
  record: row,
});

const subjectRef = (s: { type: string; id?: string | null }): Ref | null =>
  s.type === 'person' && s.id
    ? { table: person, entity: 'person', id: s.id }
    : s.type === 'project' && s.id
      ? { table: project, entity: 'project', id: s.id }
      : null;

/** Sensitive reads are for a signed-in person who asks; Kev and the system never may (CLAUDE.md rule 6). */
function assertMayIncludeSensitive(actor: UserActor, opts: ReadOpts): void {
  if (opts.includeSensitive && actor.via !== 'ui') throw new NotPermittedError('sensitive_context');
}

/** The rows an actor may read, honouring sensitivity in SQL (contract §5.2, §5.4). */
const readable = (actor: UserActor, opts: ReadOpts): SQL =>
  and(
    R.readable(actor, opts.includeArchived ? 'include' : 'exclude'),
    sensitivityFilter(context, opts.includeSensitive),
  ) as SQL;

/** Audits every sensitive record a read returned, by id only. */
async function auditSensitiveReads(actor: UserActor, rows: Context[], deps: Deps): Promise<void> {
  const sensitive = rows.filter((r) => r.sensitivity === 'sensitive');
  if (sensitive.length === 0) return;
  await auditedWrite(actor, deps, async () => ({
    result: null,
    audit: sensitive.map((r) => audit('sensitive_read', r)),
  }));
}

/** Locks a record for a write. An executing proposal never reaches sensitive context. */
const lockFor = async (tx: DbOrTx, actor: UserActor, id: string, deps: Deps) => {
  const [row] = await tx
    .select()
    .from(context)
    .where(
      and(
        R.target(actor, R.validId(id), 'exclude'),
        executionOf(deps) ? sensitivityFilter(context) : undefined,
      ),
    )
    .for('update')
    .limit(1);
  if (!row) throw new NotFoundError('context');
  return row;
};

const refuseSensitiveExecution = (deps: Deps, sensitivity: string | undefined) => {
  if (sensitivity === 'sensitive' && executionOf(deps))
    throw new NotPermittedError('sensitive_context');
};

/** Who said it and where: the person writing, or the proposal's requester and its capture or conversation. */
function sourceOf(actor: UserActor, deps: Deps) {
  const e = executionOf(deps);
  if (!e) return { sourceType: 'manual' as const, sourceUserId: actor.userId, sourceRef: null };
  if (e.captureId)
    return { sourceType: 'capture' as const, sourceUserId: e.requestedBy, sourceRef: e.captureId };
  // A proposal the person made themselves is their own manual entry.
  return e.createdVia === 'kev'
    ? { sourceType: 'told_kev' as const, sourceUserId: e.requestedBy, sourceRef: e.conversationId }
    : { sourceType: 'manual' as const, sourceUserId: e.requestedBy, sourceRef: null };
}

export async function createContext(
  actor: UserActor,
  input: CreateContextInput,
  deps: Deps = {},
): Promise<ContextRecord> {
  assertCanWrite(actor);
  const { subject, ...data } = createContextInput.parse(input);
  refuseSensitiveExecution(deps, data.sensitivity);
  return auditedWrite(actor, deps, async (tx) => {
    await checkReferences(tx, actor, data.visibility, [subjectRef(subject)]);
    const [row] = await tx
      .insert(context)
      .values({
        ...data,
        subjectType: subject.type,
        subjectId: 'id' in subject ? subject.id : null,
        ...sourceOf(actor, deps),
        status: 'active', // P-6: pending lives in the proposal
        createdBy: actor.userId,
        ...provenanceOf(deps),
      })
      .returning();
    if (!row) throw new Error('context insert returned no row');
    return {
      result: structural(row),
      audit: audit('create', row, {
        category: row.category,
        sensitivity: row.sensitivity,
        subject_type: row.subjectType,
        visibility: row.visibility,
      }),
    };
  });
}

export async function getContext(
  actor: UserActor,
  id: string,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<Context> {
  assertMayIncludeSensitive(actor, opts);
  const db = deps.db ?? getDb();
  const [row] = await db
    .select()
    .from(context)
    .where(and(eq(context.id, R.validId(id)), readable(actor, opts)))
    .limit(1);
  if (!row) throw new NotFoundError('context');
  await auditSensitiveReads(actor, [row], deps);
  return row;
}

/** Context by subject, newest first. Retired context only when asked for by status. */
export async function listContext(
  actor: UserActor,
  opts: ReadOpts & { subject?: ContextSubject; status?: ContextStatus } = {},
  deps: Deps = {},
): Promise<Context[]> {
  assertMayIncludeSensitive(actor, opts);
  const db = deps.db ?? getDb();
  const s = opts.subject;
  const rows = await db
    .select()
    .from(context)
    .where(
      and(
        readable(actor, opts),
        opts.status ? eq(context.status, opts.status) : ne(context.status, 'retired'),
        s ? eq(context.subjectType, s.type) : undefined,
        s && 'id' in s ? eq(context.subjectId, R.validId(s.id)) : undefined,
      ),
    )
    .orderBy(asc(context.subjectType), desc(context.createdAt), desc(context.id));
  await auditSensitiveReads(actor, rows, deps);
  return rows;
}

/** Is this context possibly out of date on `today` (a date in `timeZone`)? Derived, never stored. */
export function stalenessOf(
  row: Pick<Context, 'category' | 'lastConfirmedAt' | 'validUntil'>,
  today: IsoDate,
  timeZone: string,
): Staleness {
  return assessStaleness(
    {
      category: row.category as StalenessCategory,
      lastConfirmedOn: isoDateInZone(row.lastConfirmedAt, timeZone),
      validUntil: row.validUntil,
    },
    today,
  );
}

export async function updateContext(
  actor: UserActor,
  id: string,
  patch: UpdateContextInput,
  deps: Deps = {},
): Promise<ContextRecord> {
  assertCanWrite(actor);
  const data = updateContextInput.parse(patch);
  refuseSensitiveExecution(deps, data.sensitivity);
  const fields = Object.keys(data).sort();
  if (fields.length === 0) {
    const db = deps.db ?? getDb();
    return db.transaction(async (tx) => structural(await lockFor(tx, actor, id, deps)));
  }
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lockFor(tx, actor, id, deps);
    const next = data.visibility ?? current.visibility;
    if (next !== current.visibility && current.createdBy !== actor.userId) {
      throw new NotPermittedError('not_creator');
    }
    if (next === 'household' && current.visibility === 'private') {
      await checkReferences(tx, actor, next, [
        subjectRef({ type: current.subjectType, id: current.subjectId }),
      ]);
    }
    const row = await R.update(tx, actor, current.id, 'exclude', data);
    const meta: Record<string, string | string[]> = { fields };
    if (data.sensitivity) meta.sensitivity = row.sensitivity;
    return { result: structural(row), audit: audit('update', row, meta) };
  });
}

/** Someone confirms it is still true: the staleness clock restarts. */
export async function confirmContext(actor: UserActor, id: string, deps: Deps = {}) {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lockFor(tx, actor, id, deps);
    if (current.status !== 'active') throw new NotPermittedError('not_eligible');
    const row = await R.update(tx, actor, current.id, 'exclude', { lastConfirmedAt: sql`now()` });
    return { result: structural(row), audit: audit('confirm', row) };
  });
}

/** No longer true: kept, dated, and out of Kev's context. Repeating is a no-op. */
export async function retireContext(actor: UserActor, id: string, deps: Deps = {}) {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lockFor(tx, actor, id, deps);
    if (current.status === 'retired') return { result: structural(current), audit: null };
    const row = await R.update(tx, actor, current.id, 'exclude', {
      status: 'retired',
      retiredAt: sql`now()`,
    });
    return { result: structural(row), audit: audit('retire', row, { status: row.status }) };
  });
}

/** Undoes a retirement: active again, confirmed now. */
export async function reinstateContext(actor: UserActor, id: string, deps: Deps = {}) {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lockFor(tx, actor, id, deps);
    if (current.status !== 'retired') throw new NotPermittedError('not_eligible');
    const row = await R.update(tx, actor, current.id, 'exclude', {
      status: 'active',
      retiredAt: null,
      lastConfirmedAt: sql`now()`,
    });
    return { result: structural(row), audit: audit('reinstate', row, { status: row.status }) };
  });
}

export async function archiveContext(actor: UserActor, id: string, deps: Deps = {}) {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lockFor(tx, actor, id, deps);
    const row = await R.update(tx, actor, current.id, 'exclude', { archivedAt: sql`now()` });
    return { result: structural(row), audit: audit('archive', row) };
  });
}

export async function restoreContext(actor: UserActor, id: string, deps: Deps = {}) {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'include');
    if (current.archivedAt === null) throw new NotPermittedError('not_archived');
    const row = await R.update(tx, actor, current.id, 'only', { archivedAt: null });
    return { result: structural(row), audit: audit('restore', row) };
  });
}
