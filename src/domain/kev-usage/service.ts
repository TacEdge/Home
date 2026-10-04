import 'server-only';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { conversation, kevUsage } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { timeZone as zone } from '../common/inputs';
import { auditedWrite, type Deps } from '../common/write';
import { month as monthInput, recordUsageInput, type RecordUsageInput } from './schema';

// Kev usage (FAMILY-DATA-MODEL §3, M2 contract §4.2, §5.6). An append-only
// ledger: this service only ever inserts (home_app cannot update, delete or
// truncate, and a trigger refuses it for every role), and the rows hold no
// content. Cost is micro-US-dollars only. The month total is the
// household's, since the spend cap is household-wide.

export type KevUsage = typeof kevUsage.$inferSelect;

export async function recordUsage(
  actor: UserActor,
  input: RecordUsageInput,
  deps: Deps = {},
): Promise<KevUsage> {
  assertCanWrite(actor);
  const data = recordUsageInput.parse(input);
  return auditedWrite(actor, deps, async (tx) => {
    // No foreign key (append-only, ADR 0005 §38), so check the link here:
    // only the actor's own conversation.
    if (data.conversationId) {
      const [c] = await tx
        .select({ id: conversation.id })
        .from(conversation)
        .where(and(eq(conversation.id, data.conversationId), eq(conversation.userId, actor.userId)))
        .limit(1);
      if (!c) throw new NotFoundError('conversation');
    }
    const [row] = await tx
      .insert(kevUsage)
      .values({ ...data, conversationId: data.conversationId ?? null, userId: actor.userId })
      .returning();
    if (!row) throw new Error('kev_usage insert returned no row');
    return {
      result: row,
      audit: {
        event: 'kev_usage.record',
        subjectType: 'kev_usage',
        subjectId: row.id,
        meta: { tier: row.tier, escalated: row.escalated },
        // Usage is household information (the cap is the household's).
        record: { visibility: 'household', createdBy: row.userId },
      },
    };
  });
}

/** The first instant of a YYYY-MM month in a time zone, and of the next month. */
function monthBounds(m: string): [string, string] {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return [`${m}-01 00:00:00`, `${next}-01 00:00:00`];
}

/**
 * The household's Kev cost for a calendar month in the home time zone, in
 * micro-US-dollars (contract §5.6). Any signed-in person may read it.
 */
export async function monthToDateCostUsdMicros(
  actor: UserActor,
  month: string,
  timeZone: string,
  deps: Deps = {},
): Promise<bigint> {
  if ((actor as { kind: string }).kind !== 'user') throw new NotPermittedError('not_a_user');
  const m = monthInput.parse(month);
  const tz = zone.parse(timeZone);
  const [from, to] = monthBounds(m);
  const db = deps.db ?? getDb();
  const [r] = await db
    .select({ total: sql<string>`coalesce(sum(${kevUsage.costUsdMicros}), 0)::text` })
    .from(kevUsage)
    .where(
      and(
        gte(kevUsage.at, sql`(${from}::timestamp at time zone ${tz})`),
        lt(kevUsage.at, sql`(${to}::timestamp at time zone ${tz})`),
      ),
    );
  return BigInt(r?.total ?? '0');
}
