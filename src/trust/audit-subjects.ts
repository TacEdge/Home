import 'server-only';
import { and, eq, exists, not, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { auditLog, person } from '@/db/schema';
import type { Actor } from './actor';
import { visibleTo, type VisibilityColumns } from './visibility';

// P-1 (ADR 0005): audit metadata never reveals more than the affected record
// would. A domain audit row names its record (subject_type, subject_id); the
// Activity list shows the row only to an actor who can currently see that
// record, by the record's own visibility rule, whoever acted. Only once the
// record no longer exists does the row's write-time snapshot decide.
//
// Every M2 entity registers itself here in the PR that creates it, so an
// unregistered domain subject can never fall through to "household".

type Subject = {
  table: PgTable & { id: PgColumn } & VisibilityColumns;
  /** The record's own read rule for this actor. Owner-only tables override. */
  visible?: (actor: Actor) => SQL;
};

export const auditSubjects: Record<string, Subject> = {
  person: { table: person },
};

/** The P-1 predicate: which audit rows this actor may list. */
export function auditVisibleTo(actor: Actor): SQL {
  if (actor.kind === 'system') return sql`true`;
  const snapshot = or(
    eq(auditLog.visibility, 'household'),
    eq(auditLog.visibleToUserId, actor.userId),
  ) as SQL;
  const registered = Object.keys(auditSubjects);
  const noDomainSubject =
    registered.length === 0
      ? sql`true`
      : (or(
          sql`${auditLog.subjectType} is null`,
          not(
            sql`${auditLog.subjectType} in (${sql.join(
              registered.map((r) => sql`${r}`),
              sql`, `,
            )})`,
          ),
        ) as SQL);
  const perSubject = Object.entries(auditSubjects).map(([type, s]) => {
    const isSubject = eq(auditLog.subjectType, type);
    const record = sql`${s.table.id}::text = ${auditLog.subjectId}`;
    const current = exists(
      sql`(select 1 from ${s.table} where ${record} and ${s.visible ? s.visible(actor) : visibleTo(actor, s.table)})`,
    );
    const gone = not(exists(sql`(select 1 from ${s.table} where ${record})`));
    return and(isSubject, or(current, and(gone, snapshot))) as SQL;
  });
  return or(and(noDomainSubject, snapshot), ...perSubject) as SQL;
}
