import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { person, type PersonRow } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { visibleTo } from '@/trust/visibility';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { auditedWrite, snapshotOf, type Deps } from '../common/write';
import {
  createPersonInput,
  updatePersonInput,
  type CreatePersonInput,
  type UpdatePersonInput,
} from './schema';

// People (FAMILY-DATA-MODEL §3, M2 contract §5). Every function takes the
// acting user first; visibility and archive state are filtered in the query,
// never afterwards (CLAUDE.md rule 1). Writes go through auditedWrite, so each
// one is transactional with a structural, content-free audit row (P-1).

type ReadOpts = { includeArchived?: boolean };

const SUBJECT = 'person';

function readable(actor: UserActor, opts: ReadOpts) {
  return and(
    visibleTo(actor, person),
    opts.includeArchived ? undefined : isNull(person.archivedAt),
  );
}

async function findVisible(
  db: DbOrTx,
  actor: UserActor,
  id: string,
  opts: ReadOpts = {},
): Promise<PersonRow> {
  const [row] = await db
    .select()
    .from(person)
    .where(and(eq(person.id, id), readable(actor, opts)))
    .limit(1);
  if (!row) throw new NotFoundError(SUBJECT);
  return row;
}

export async function createPerson(
  actor: UserActor,
  input: CreatePersonInput,
  deps: Deps = {},
): Promise<PersonRow> {
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
      audit: {
        event: 'person.create',
        subjectType: SUBJECT,
        subjectId: row.id,
        meta: { role: row.role, visibility: row.visibility },
        snapshot: snapshotOf(row),
      },
    };
  });
}

export async function getPerson(
  actor: UserActor,
  id: string,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<PersonRow> {
  return findVisible(deps.db ?? getDb(), actor, id, opts);
}

export async function listPeople(
  actor: UserActor,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<PersonRow[]> {
  const db = deps.db ?? getDb();
  return db
    .select()
    .from(person)
    .where(readable(actor, opts))
    .orderBy(asc(person.name), asc(person.id));
}

export async function updatePerson(
  actor: UserActor,
  id: string,
  patch: UpdatePersonInput,
  deps: Deps = {},
): Promise<PersonRow> {
  assertCanWrite(actor);
  const data = updatePersonInput.parse(patch);
  const fields = Object.keys(data).sort();
  if (fields.length === 0) return getPerson(actor, id, {}, deps);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await findVisible(tx, actor, id);
    // Only the creator may change a record's visibility (contract §5.3).
    if (data.visibility !== undefined && data.visibility !== current.visibility) {
      if (current.createdBy !== actor.userId) throw new NotPermittedError('not_creator');
    }
    const [row] = await tx
      .update(person)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(person.id, current.id))
      .returning();
    if (!row) throw new NotFoundError(SUBJECT);
    return {
      result: row,
      audit: {
        event: 'person.update',
        subjectType: SUBJECT,
        subjectId: row.id,
        meta: { fields },
        snapshot: snapshotOf(row),
      },
    };
  });
}

export async function archivePerson(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<PersonRow> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await findVisible(tx, actor, id);
    const [row] = await tx
      .update(person)
      .set({ archivedAt: sql`now()`, updatedAt: new Date() })
      .where(eq(person.id, current.id))
      .returning();
    if (!row) throw new NotFoundError(SUBJECT);
    return {
      result: row,
      audit: {
        event: 'person.archive',
        subjectType: SUBJECT,
        subjectId: row.id,
        snapshot: snapshotOf(row),
      },
    };
  });
}

export async function restorePerson(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<PersonRow> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await findVisible(tx, actor, id, { includeArchived: true });
    const [row] = await tx
      .update(person)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(person.id, current.id))
      .returning();
    if (!row) throw new NotFoundError(SUBJECT);
    return {
      result: row,
      audit: {
        event: 'person.restore',
        subjectType: SUBJECT,
        subjectId: row.id,
        snapshot: snapshotOf(row),
      },
    };
  });
}

/**
 * Links the acting user to their own Person (ADR 0005, D-M2-2): a household-
 * visible parent that is not yet linked, by a user not yet linked to anyone.
 * Nothing else ever sets `user_id`.
 */
export async function linkSelf(
  actor: UserActor,
  personId: string,
  deps: Deps = {},
): Promise<PersonRow> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await findVisible(tx, actor, personId);
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
    const [row] = await tx
      .update(person)
      .set({ userId: actor.userId, updatedAt: new Date() })
      .where(and(eq(person.id, current.id), isNull(person.userId)))
      .returning();
    if (!row) throw new NotPermittedError('already_linked');
    return {
      result: row,
      audit: {
        event: 'person.link_self',
        subjectType: SUBJECT,
        subjectId: row.id,
        snapshot: snapshotOf(row),
      },
    };
  });
}
