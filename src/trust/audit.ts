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

/** Position in the audit log: the `(at, id)` of the last row seen. */
export type AuditCursor = { at: Date; id: string };

export type AuditPage = { rows: AuditRow[]; next: AuditCursor | null };

/**
 * Newest first, paginated by a `(at, id)` cursor so rows with identical
 * timestamps are never skipped or repeated (M1.1 contract §2.9). `next` is
 * null once the last page has been read. Any household member may read the
 * household's activity (it is shared by design, SYSTEM-ARCHITECTURE §5.8).
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
        ? sql`(${auditLog.at}, ${auditLog.id}) < (${cursor.at}, ${cursor.id}::uuid)`
        : undefined,
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const next = rows.length > limit && last ? { at: last.at, id: last.id } : null;
  return { rows: page, next };
}
