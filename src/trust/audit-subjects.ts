import 'server-only';
import { and, eq, exists, getTableName, not, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  auditLog,
  capture,
  context,
  conversation,
  event,
  insightResponse,
  note,
  person,
  project,
  proposal,
  task,
} from '@/db/schema';
import type { Actor } from './actor';
import { visibleTo, type VisibilityColumns } from './visibility';

// P-1 (ADR 0005 §9): audit metadata never reveals more than the affected
// record would. A domain audit row names its record (subject_type is the
// table name, subject_id its id). The Activity list shows the row only to
// an actor who can currently see that record, by the record's own rule,
// whoever or whatever wrote the row. Only once the record no longer exists
// does the row's write-time snapshot (visibility, visible_to_user_id) decide.
//
// Every table with a visibility column must be registered here, in the PR
// that first uses it: tests/unit/audit-subjects.test.ts fails otherwise.
// An unregistered subject would fall back to its snapshot, which cannot
// follow a later change of the record's visibility.

export type AuditSubject =
  | {
      table: PgTable & { id: PgColumn } & VisibilityColumns;
      /** The record's own read rule; owner-only tables override the default. */
      visible?: (actor: Actor) => SQL;
    }
  | {
      /** An owner-only table with no visibility column must say who its owner is. */
      table: PgTable & { id: PgColumn };
      visible: (actor: Actor) => SQL;
    };

/** Owner-only by `user_id` (conversations, insight responses): only that user, ever. */
const ownedBy =
  (column: PgColumn) =>
  (actor: Actor): SQL =>
    actor.kind === 'system' ? sql`true` : eq(column, actor.userId);

const register = (...subjects: AuditSubject[]): Record<string, AuditSubject> =>
  Object.fromEntries(subjects.map((s) => [getTableName(s.table), s]));

// EventPerson annotations are audited as their event (subject_type 'event'),
// so their rows follow the event's visibility.
export const auditSubjects: Record<string, AuditSubject> = register(
  { table: person },
  { table: event },
  { table: project },
  { table: task },
  { table: note },
  // Captures and proposals are always private to their creator, so the
  // default rule already makes them owner-only (P-1 b).
  { table: capture },
  { table: context },
  { table: proposal },
  // Owner-only by user_id, with no visibility column (P-1 b). Messages are
  // audited as their conversation; kev_usage rows are household information
  // and are not a registered subject (their household snapshot decides).
  { table: conversation, visible: ownedBy(conversation.userId) },
  { table: insightResponse, visible: ownedBy(insightResponse.userId) },
);

/** The write-time snapshot: household, or private to its recorded owner. */
function snapshotVisibleTo(actor: Actor & { kind: 'user' }): SQL {
  return or(
    eq(auditLog.visibility, 'household'),
    eq(auditLog.visibleToUserId, actor.userId),
  ) as SQL;
}

/** Which audit rows this actor may list (P-1). */
export function auditVisibleTo(actor: Actor): SQL {
  if (actor.kind === 'system') return sql`true`;
  const snapshot = snapshotVisibleTo(actor);
  const types = Object.keys(auditSubjects);
  const notADomainSubject = or(
    sql`${auditLog.subjectType} is null`,
    not(
      sql`${auditLog.subjectType} in (${sql.join(
        types.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    ),
  ) as SQL;
  const domain = Object.entries(auditSubjects).map(([type, s]) => {
    // Text comparison: subject_id is free text, so a cast could fail.
    const same = sql`${s.table.id}::text = ${auditLog.subjectId}`;
    const rule = s.visible
      ? s.visible(actor)
      : visibleTo(actor, s.table as PgTable & VisibilityColumns);
    const canSeeNow = exists(sql`(select 1 from ${s.table} where ${same} and ${rule})`);
    const gone = not(exists(sql`(select 1 from ${s.table} where ${same})`));
    return and(eq(auditLog.subjectType, type), or(canSeeNow, and(gone, snapshot))) as SQL;
  });
  return or(and(notADomainSubject, snapshot), ...domain) as SQL;
}
