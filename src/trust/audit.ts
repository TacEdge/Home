import 'server-only';
import { desc, lt } from 'drizzle-orm';
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
 * Newest first, paginated by `before` (the `at` of the last row seen).
 * Any household member may read the household's activity (it is shared by
 * design, SYSTEM-ARCHITECTURE §5.8).
 */
export async function listAudit(
  _actor: Actor,
  opts: { limit?: number; before?: Date } = {},
  deps: Deps = {},
): Promise<AuditRow[]> {
  const db = deps.db ?? getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return db
    .select()
    .from(auditLog)
    .where(opts.before ? lt(auditLog.at, opts.before) : undefined)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit);
}
