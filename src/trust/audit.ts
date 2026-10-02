import 'server-only';
import { desc, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { Db } from '@/db/create';
import { auditLog, type AuditRow } from '@/db/schema';
import type { Actor } from './actor';

export type AuditEvent = {
  event: string; // dotted, e.g. auth.sign_in
  subjectType?: string;
  subjectId?: string;
  summary?: string; // human-readable, never contains an email or token
  meta?: Record<string, unknown>;
};

type Deps = { db?: Db };

/** Append one audit entry. Never throws away the write silently. */
export async function recordAudit(actor: Actor, e: AuditEvent, deps: Deps = {}): Promise<AuditRow> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .insert(auditLog)
    .values({
      actorUserId: actor.kind === 'user' ? actor.userId : null,
      actorVia: actor.via,
      actorChannel: actor.kind === 'user' ? actor.channel : null,
      event: e.event,
      subjectType: e.subjectType ?? null,
      subjectId: e.subjectId ?? null,
      summary: e.summary ?? null,
      meta: e.meta ?? null,
    })
    .returning();
  if (!row) throw new Error('audit insert returned no row');
  return row;
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
 * returns an empty page. Any household member may read the household's
 * activity (it is shared by design, SYSTEM-ARCHITECTURE §5.8).
 */
export async function listAudit(
  _actor: Actor,
  opts: { limit?: number; before?: AuditCursor } = {},
  deps: Deps = {},
): Promise<AuditPage> {
  const db = deps.db ?? getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const cursor = opts.before;
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      cursor
        ? sql`(${auditLog.at}, ${auditLog.id}) < (select c.at, c.id from audit_log c where c.id = ${cursor.id}::uuid)`
        : undefined,
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const next = rows.length > limit && last ? { id: last.id } : null;
  return { rows: page, next };
}
