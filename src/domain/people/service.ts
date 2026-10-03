import 'server-only';
import { and, asc, eq, getTableName, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { person } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { visibleTo } from '@/trust/visibility';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { assertNotReferencedByHousehold } from '../common/references';
import { auditedWrite, type Deps } from '../common/write';
import {
  createPersonInput,
  personId,
  updatePersonInput,
  type CreatePersonInput,
  type UpdatePersonInput,
} from './schema';

// People (FAMILY-DATA-MODEL §3, M2 contract §5). Every function takes the
// acting user first. Visibility and archive state are SQL predicates, never
// filtered afterwards (rule 1); anything the actor cannot see is a
// NotFoundError, exactly like a missing record. Every write:
//   - refuses Kev (rule 3);
//   - locks the row with the visibility predicate (SELECT … FOR UPDATE) and
//     repeats the predicate in the UPDATE itself, so a concurrent change of
//     visibility can never let the other adult write into a private record;
//   - takes its timestamps from the database clock (one value per write);
//   - runs in one transaction with a structural audit row (P-1).

export type Person = typeof person.$inferSelect;
type ReadOpts = { includeArchived?: boolean };
type Archived = 'exclude' | 'include' | 'only';

const SUBJECT = getTableName(person);

function archivedIs(state: Archived): SQL | undefined {
  if (state === 'exclude') return isNull(person.archivedAt);
  if (state === 'only') return isNotNull(person.archivedAt);
  return undefined;
}

/** The rows this actor may touch, by id, in the given archive state. */
function target(actor: UserActor, id: string, archived: Archived): SQL {
  return and(eq(person.id, id), visibleTo(actor, person), archivedIs(archived)) as SQL;
}

function validId(id: string): string {
  if (!personId.safeParse(id).success) throw new NotFoundError(SUBJECT);
  return id;
}

/** Reads and locks a row the actor may touch, or throws NotFoundError. */
async function lock(tx: DbOrTx, actor: UserActor, id: string, archived: Archived): Promise<Person> {
  const [row] = await tx
    .select()
    .from(person)
    .where(target(actor, id, archived))
    .for('update')
    .limit(1);
  if (!row) throw new NotFoundError(SUBJECT);
  return row;
}

/** Updates the locked row under the same predicate, or throws NotFoundError. */
async function update(
  tx: DbOrTx,
  actor: UserActor,
  id: string,
  archived: Archived,
  values: PgUpdateSetSource<typeof person>,
  extra?: SQL,
): Promise<Person> {
  const [row] = await tx
    .update(person)
    .set({ ...values, updatedAt: sql`now()` })
    .where(and(target(actor, id, archived), extra))
    .returning();
  if (!row) throw new NotFoundError(SUBJECT);
  return row;
}

const audit = (event: string, row: Person, meta?: Record<string, string | string[]>) => ({
  event: `${SUBJECT}.${event}`,
  subjectType: SUBJECT,
  subjectId: row.id,
  meta,
  record: row,
});

export async function createPerson(
  actor: UserActor,
  input: CreatePersonInput,
  deps: Deps = {},
): Promise<Person> {
  assertCanWrite(actor);
  const data = createPersonInput.parse(input);
  return auditedWrite(actor, deps, async (tx) => {
    const [row] = await tx
      .insert(person)
      .values({ ...data, createdBy: actor.userId, createdVia: 'ui' })
      .returning();
    if (!row) throw new Error('person insert returned no row');
    return {
      result: row,
      audit: audit('create', row, { role: row.role, visibility: row.visibility }),
    };
  });
}

export async function getPerson(
  actor: UserActor,
  id: string,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<Person> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .select()
    .from(person)
    .where(target(actor, validId(id), opts.includeArchived ? 'include' : 'exclude'))
    .limit(1);
  if (!row) throw new NotFoundError(SUBJECT);
  return row;
}

export async function listPeople(
  actor: UserActor,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<Person[]> {
  const db = deps.db ?? getDb();
  return db
    .select()
    .from(person)
    .where(and(visibleTo(actor, person), archivedIs(opts.includeArchived ? 'include' : 'exclude')))
    .orderBy(asc(sql`lower(${person.name})`), asc(person.id));
}

export async function updatePerson(
  actor: UserActor,
  id: string,
  patch: UpdatePersonInput,
  deps: Deps = {},
): Promise<Person> {
  assertCanWrite(actor);
  const data = updatePersonInput.parse(patch);
  const fields = Object.keys(data).sort();
  if (fields.length === 0) return getPerson(actor, id, {}, deps);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lock(tx, actor, validId(id), 'exclude');
    if (data.visibility !== undefined && data.visibility !== current.visibility) {
      // Only the creator may change who can see a record (contract §5.3).
      if (current.createdBy !== actor.userId) throw new NotPermittedError('not_creator');
      // Household tasks, notes and event annotations must not come to reveal it (contract §5.5).
      if (data.visibility === 'private')
        await assertNotReferencedByHousehold(tx, 'person', current.id);
    }
    if (current.userId !== null) {
      // A linked person stays what linkSelf required: a household parent.
      if (data.visibility === 'private' || (data.role !== undefined && data.role !== 'parent')) {
        throw new NotPermittedError('linked_person');
      }
    }
    const row = await update(tx, actor, current.id, 'exclude', data);
    return { result: row, audit: audit('update', row, { fields }) };
  });
}

export async function archivePerson(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Person> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lock(tx, actor, validId(id), 'exclude');
    // The household's adults are not archived out from under their logins.
    if (current.userId !== null) throw new NotPermittedError('linked_person');
    const row = await update(tx, actor, current.id, 'exclude', { archivedAt: sql`now()` });
    return { result: row, audit: audit('archive', row) };
  });
}

export async function restorePerson(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Person> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lock(tx, actor, validId(id), 'include');
    if (current.archivedAt === null) throw new NotPermittedError('not_archived');
    const row = await update(tx, actor, current.id, 'only', { archivedAt: null });
    return { result: row, audit: audit('restore', row) };
  });
}

/**
 * Links the acting user to their own Person (ADR 0005, D-M2-2). Only for an
 * unarchived, household-visible parent with no login yet, and only for a
 * user not yet linked to anyone. Only linkSelf sets `user_id`, and only
 * unlinkSelf clears it (the actor's own link). Races are
 * settled by the row lock, the UPDATE's own conditions and the unique index.
 */
export async function linkSelf(actor: UserActor, id: string, deps: Deps = {}): Promise<Person> {
  assertCanWrite(actor);
  try {
    return await auditedWrite(actor, deps, async (tx) => {
      const current = await lock(tx, actor, validId(id), 'exclude');
      if (current.role !== 'parent' || current.visibility !== 'household') {
        throw new NotPermittedError('not_eligible');
      }
      if (current.userId !== null) throw new NotPermittedError('already_linked');
      const [mine] = await tx
        .select({ id: person.id })
        .from(person)
        .where(eq(person.userId, actor.userId))
        .limit(1);
      if (mine) throw new NotPermittedError('already_linked');
      const eligible = and(
        isNull(person.userId),
        eq(person.role, 'parent'),
        eq(person.visibility, 'household'),
      );
      const row = await update(
        tx,
        actor,
        current.id,
        'exclude',
        { userId: actor.userId },
        eligible,
      );
      return { result: row, audit: audit('link_self', row) };
    });
  } catch (e) {
    // A concurrent link of the same user elsewhere loses on the unique index.
    const code =
      (e as { code?: string; cause?: { code?: string } }).cause?.code ??
      (e as { code?: string }).code;
    if (code === '23505') throw new NotPermittedError('already_linked');
    throw e;
  }
}

/**
 * Clears the acting user's own link (ADR 0005 §22): the recovery path for a
 * wrong linkSelf. It touches only the person linked to this user, and only
 * `user_id` (and `updated_at`); it can never unlink another adult. The row
 * is locked under the visibility rule and the UPDATE repeats both the
 * visibility and `user_id = actor` conditions, so a concurrent unlink or
 * relink cannot clear someone else's link. NotFoundError when the user has
 * no link. Afterwards the person is an ordinary record again: the
 * linked-person rules (§19) no longer apply.
 */
export async function unlinkSelf(actor: UserActor, deps: Deps = {}): Promise<Person> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const mine = eq(person.userId, actor.userId);
    const [current] = await tx
      .select()
      .from(person)
      .where(and(mine, visibleTo(actor, person)))
      .for('update')
      .limit(1);
    if (!current) throw new NotFoundError(SUBJECT);
    const row = await update(tx, actor, current.id, 'include', { userId: null }, mine);
    return { result: row, audit: audit('unlink_self', row) };
  });
}
