import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { insightResponse } from '@/db/schema';
import type { InsightResponseKind } from '@/db/schema/insight-response';
import type { UserActor } from '@/trust/actor';
import { NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { auditedWrite, type Deps } from '../common/write';
import { insightKey, insightResponseKind } from './schema';

// Insight responses (M2 contract §5.6). One person's response to one insight,
// upserted; private to that person by `user_id` in every query. Insights
// themselves are derived on read and never stored (CLAUDE.md rule 15).

export type InsightResponse = typeof insightResponse.$inferSelect;

/** Records (or changes) the actor's own response to an insight. */
export async function respond(
  actor: UserActor,
  key: string,
  response: InsightResponseKind,
  deps: Deps = {},
): Promise<InsightResponse> {
  assertCanWrite(actor);
  const k = insightKey.parse(key);
  const r = insightResponseKind.parse(response);
  return auditedWrite(actor, deps, async (tx) => {
    const [row] = await tx
      .insert(insightResponse)
      .values({ userId: actor.userId, insightKey: k, response: r })
      .onConflictDoUpdate({
        target: [insightResponse.userId, insightResponse.insightKey],
        set: { response: r, respondedAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error('insight_response upsert returned no row');
    return {
      result: row,
      audit: {
        event: 'insight_response.respond',
        subjectType: 'insight_response',
        subjectId: row.id,
        meta: { response: row.response },
        record: { visibility: 'private', createdBy: row.userId },
      },
    };
  });
}

/** The actor's own responses among these keys: key → response. Never another person's. */
export async function respondedKeys(
  actor: UserActor,
  keys: string[],
  deps: Deps = {},
): Promise<Record<string, InsightResponseKind>> {
  if ((actor as { kind: string }).kind !== 'user') throw new NotPermittedError('not_a_user');
  const valid = keys.filter((k) => insightKey.safeParse(k).success);
  if (valid.length === 0) return {};
  const db = deps.db ?? getDb();
  const rows = await db
    .select({ key: insightResponse.insightKey, response: insightResponse.response })
    .from(insightResponse)
    .where(
      and(eq(insightResponse.userId, actor.userId), inArray(insightResponse.insightKey, valid)),
    );
  return Object.fromEntries(rows.map((r) => [r.key, r.response as InsightResponseKind]));
}

/** All of the actor's own responses, oldest first (for their export). Never another person's. */
export async function listOwnResponses(actor: UserActor, deps: Deps = {}) {
  if ((actor as { kind: string }).kind !== 'user') throw new NotPermittedError('not_a_user');
  const db = deps.db ?? getDb();
  return db
    .select()
    .from(insightResponse)
    .where(eq(insightResponse.userId, actor.userId))
    .orderBy(asc(insightResponse.respondedAt), asc(insightResponse.id));
}
