import 'server-only';
import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { DbOrTx } from '@/db/create';
import type { UserActor } from '@/trust/actor';
import { visibleTo } from '@/trust/visibility';
import { NotFoundError } from './errors';

// The write discipline every user-facing record shares (M2 contract §5,
// carried forward from Package 2b):
//   - a record the actor cannot see is NotFound, like a missing one;
//   - a write locks the row with the visibility predicate (FOR UPDATE) and
//     repeats the predicate in the UPDATE itself, so a concurrent change to
//     private can never let the other adult write into the record;
//   - timestamps come from the database clock, one value per write.

export type RecordTable = PgTable & {
  id: PgColumn;
  visibility: PgColumn;
  createdBy: PgColumn;
  archivedAt: PgColumn;
  updatedAt: PgColumn;
};

export type Archived = 'exclude' | 'include' | 'only';

const uuid = z.string().uuid();

export function records<T extends RecordTable>(table: T, entity: string) {
  type Row = T['$inferSelect'];

  const archivedIs = (state: Archived): SQL | undefined =>
    state === 'exclude'
      ? isNull(table.archivedAt)
      : state === 'only'
        ? isNotNull(table.archivedAt)
        : undefined;

  /** The rows this actor may see, in an archive state. */
  const readable = (actor: UserActor, archived: Archived): SQL =>
    and(visibleTo(actor, table), archivedIs(archived)) ?? sql`true`;

  /** One row by id that the actor may touch. */
  const target = (actor: UserActor, id: string, archived: Archived): SQL =>
    and(eq(table.id, id), readable(actor, archived)) as SQL;

  const validId = (id: string): string => {
    if (!uuid.safeParse(id).success) throw new NotFoundError(entity);
    return id;
  };

  return {
    entity,
    readable,
    target,
    validId,

    async get(db: DbOrTx, actor: UserActor, id: string, archived: Archived): Promise<Row> {
      const [row] = await db
        .select()
        .from(table as PgTable)
        .where(target(actor, validId(id), archived))
        .limit(1);
      if (!row) throw new NotFoundError(entity);
      return row as Row;
    },

    /** Reads and locks a row the actor may touch, or throws NotFoundError. */
    async lock(tx: DbOrTx, actor: UserActor, id: string, archived: Archived): Promise<Row> {
      const [row] = await tx
        .select()
        .from(table as PgTable)
        .where(target(actor, validId(id), archived))
        .for('update')
        .limit(1);
      if (!row) throw new NotFoundError(entity);
      return row as Row;
    },

    /** Updates the locked row under the same predicate, or throws NotFoundError. */
    async update(
      tx: DbOrTx,
      actor: UserActor,
      id: string,
      archived: Archived,
      values: Record<string, unknown>,
      extra?: SQL,
    ): Promise<Row> {
      const [row] = await tx
        .update(table as PgTable)
        .set({ ...values, updatedAt: sql`now()` } as PgUpdateSetSource<PgTable>)
        .where(and(target(actor, id, archived), extra))
        .returning();
      if (!row) throw new NotFoundError(entity);
      return row as Row;
    },
  };
}
