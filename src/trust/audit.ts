import 'server-only';
import { and, desc, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { auditLog } from '@/db/schema';
import type { Actor } from './actor';
import { auditVisibleTo } from './audit-subjects';
import type { Visibility } from './visibility';

export type AuditEvent = {
  event: string; // dotted, e.g. auth.sign_in
  subjectType?: string;
  subjectId?: string;
  summary?: string; // human-readable, never contains an email or token
  meta?: Record<string, unknown>;
  /**
   * P-1: the affected record's visibility after the write, and its owner when
   * private. Set by the domain write helper only; auth events leave it unset,
   * so their SQL is exactly what it was before migration 0003.
   */
  snapshot?: { visibility: Visibility; visibleToUserId: string | null };
};

type Deps = { db?: DbOrTx };

// Every query on audit_log names its columns (M2 contract §2.1, rules 2 and
// 6). Under migration-first, a migration PR adds a column to the Drizzle
// definition of audit_log before production has run that migration, so for
// a while the definition describes columns the database does not have. Any
// Drizzle query that covers "all columns" would then name those too and
// fail — on the sign-in path, because sign-in audits. That includes
// `.select()` and `.returning()` with no arguments, and also Drizzle's
// `.insert()`, which lists every defined column (unset ones as `default`).
// So the insert below is SQL naming its own columns, reads name theirs, and
// nothing here depends on columns added after M1.
// tests/unit/audit-columns-guard.test.ts enforces this for src/ and for the
// suites the previous-schema check runs.

/** The columns an audit row is read with. Add to this only with the column's migration already live. */
export const auditRowColumns = {
  id: auditLog.id,
  at: auditLog.at,
  actorUserId: auditLog.actorUserId,
  actorVia: auditLog.actorVia,
  actorChannel: auditLog.actorChannel,
  event: auditLog.event,
  subjectType: auditLog.subjectType,
  subjectId: auditLog.subjectId,
  summary: auditLog.summary,
  meta: auditLog.meta,
};

/** An audit row as listAudit returns it: exactly the named columns. */
export type AuditRow = Pick<typeof auditLog.$inferSelect, keyof typeof auditRowColumns>;

/**
 * Append one audit entry. Never throws away the write silently. Returns only
 * the new row's id (rule 6): no caller needs more, and returning every column
 * would tie sign-in to the exact shape of audit_log.
 */
export async function recordAudit(
  actor: Actor,
  e: AuditEvent,
  deps: Deps = {},
): Promise<{ id: string }> {
  const db = deps.db ?? getDb();
  const meta = e.meta === undefined || e.meta === null ? null : JSON.stringify(e.meta);
  const values = sql`
      ${actor.kind === 'user' ? actor.userId : null},
      ${actor.via},
      ${actor.kind === 'user' ? actor.channel : null},
      ${e.event},
      ${e.subjectType ?? null},
      ${e.subjectId ?? null},
      ${e.summary ?? null},
      ${meta}::jsonb`;
  // The P-1 columns (migration 0003) are named only for domain writes.
  const result = await db.execute<{ id: string }>(
    e.snapshot
      ? sql`insert into audit_log
          (actor_user_id, actor_via, actor_channel, event, subject_type, subject_id, summary, meta,
           visibility, visible_to_user_id)
        values (${values}, ${e.snapshot.visibility}, ${e.snapshot.visibleToUserId})
        returning id`
      : sql`insert into audit_log
          (actor_user_id, actor_via, actor_channel, event, subject_type, subject_id, summary, meta)
        values (${values})
        returning id`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('audit insert returned no row');
  return { id: row.id };
}

/**
 * Position in the audit log: the id of the last row seen. Deliberately not
 * its timestamp: Postgres stores `at` to the microsecond, but a JavaScript
 * Date holds milliseconds, so a cursor carrying `at` through JavaScript lands
 * before every row in the same millisecond and skips them. The database
 * resolves the id to the row's exact `(at, id)` instead.
 */
export type AuditCursor = { id: string };

export type AuditPage = { rows: AuditRow[]; next: AuditCursor | null };

/**
 * Newest first, paginated by a cursor on `(at, id)` so rows with identical or
 * sub-millisecond timestamps are never skipped or repeated (M1.1 contract
 * §2.9). The comparison happens entirely in Postgres at full precision.
 * `next` is null once the last page has been read; a cursor naming no row
 * returns an empty page. The household's activity is shared by design
 * (SYSTEM-ARCHITECTURE §5.8), except that a row about a record the actor
 * cannot currently see is never listed (P-1, `auditVisibleTo`).
 */
export async function listAudit(
  actor: Actor,
  opts: { limit?: number; before?: AuditCursor } = {},
  deps: Deps = {},
): Promise<AuditPage> {
  const db = deps.db ?? getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const cursor = opts.before;
  const rows = await db
    .select(auditRowColumns)
    .from(auditLog)
    .where(
      and(
        auditVisibleTo(actor),
        cursor
          ? sql`(${auditLog.at}, ${auditLog.id}) < (select c.at, c.id from audit_log c where c.id = ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const next = rows.length > limit && last ? { id: last.id } : null;
  return { rows: page, next };
}
