import { sql } from 'drizzle-orm';
import type { Db } from '@/db/create';
import { getSpendReport } from '@/domain/kev-bookkeeping/service';
import { GEO_MULTIPLIER, MODELS, TIERS } from '@/kev/config';
import { systemActor } from '@/trust/actor';
import { costUsdMicros } from '@/trust/usage';
import type { KevTier } from '@/domain/kev-bookkeeping/schema';

// The reconciliation after a session (M8 live-verification plan §9), run
// against the runner's own database: no reservation left open or
// unreconciled; each attempt settled at exactly the sum of its usage rows;
// conservative charges (a cost other than the tokens at the tier's prices ×
// 1.1) counted; tokens by model and UTC day, to set against the provider
// Console's figures. Counts, tokens and amounts only.

export type Reconciliation = Readonly<{
  openCount: number;
  unreconciledCount: number;
  lateSettledCount: number;
  /** The session's attempts (its reservations, by attempt id). */
  attempts: number;
  /** Attempts whose settled amount is not the sum of their usage rows, or not `settled`. */
  mismatched: number;
  /** HOME's recorded cost for the session (µ$). */
  recordedUsdMicros: bigint;
  usageRows: number;
  /** Rows charged other than their tokens at the tier's prices × 1.1 (unknown, partial or aborted). */
  conservativeRows: number;
  /** Rows for a model other than their tier's (Haiku 5.5 probes, charged at the fast tier's prices). */
  probeModelRows: number;
  /** What those rows would cost at their own model's prices (µ$): the provider's bill should be near this. */
  atModelPricesUsdMicros: bigint;
  /** Tokens by model and UTC day, for the Console's Usage and Cost views. */
  byModelDay: readonly Readonly<{
    model: string;
    day: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    recordedUsdMicros: bigint;
  }>[];
  ok: boolean;
}>;

const priceOf = (model: string) =>
  Object.values(MODELS).find((m) => m.id === model)?.prices ?? null;

export async function reconcile(db: Db, attemptIds: readonly string[]): Promise<Reconciliation> {
  const ids = sql.join(
    (attemptIds.length ? attemptIds : ['00000000-0000-0000-0000-000000000000']).map(
      (id) => sql`${id}`,
    ),
    sql`, `,
  );
  const report = await getSpendReport(systemActor, { db });
  const attempts = await db.execute<{
    attempt_id: string;
    status: string;
    settled: string | null;
    usage: string;
  }>(sql`
    select r.attempt_id, r.status, r.settled_usd_micros::text as settled,
           coalesce((select sum(u.cost_usd_micros) from kev_usage u
                      where u.attempt_id = r.attempt_id), 0)::text as usage
      from kev_budget_reservation r
     where r.attempt_id in (${ids})`);
  let mismatched = 0;
  for (const a of attempts.rows)
    if (a.status !== 'settled' || a.settled === null || BigInt(a.settled) !== BigInt(a.usage))
      mismatched += 1;
  const rows = await db.execute<{
    tier: KevTier;
    model: string;
    day: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost: string;
  }>(sql`
    select u.tier, u.model, to_char(u.at at time zone 'UTC', 'YYYY-MM-DD') as day,
           u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens,
           u.cost_usd_micros::text as cost
      from kev_usage u
      join kev_budget_reservation r on r.attempt_id = u.attempt_id
     where r.attempt_id in (${ids})`);
  let recorded = 0n;
  let conservative = 0;
  let probeModel = 0;
  let atModel = 0n;
  const groups = new Map<
    string,
    Reconciliation['byModelDay'][number] & { recordedUsdMicros: bigint }
  >();
  for (const r of rows.rows) {
    const tokens = {
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens),
    };
    const cost = BigInt(r.cost);
    recorded += cost;
    if (cost !== costUsdMicros(tokens, TIERS[r.tier].model.prices, GEO_MULTIPLIER))
      conservative += 1;
    if (r.model !== TIERS[r.tier].model.id) probeModel += 1;
    const own = priceOf(r.model);
    atModel += own ? costUsdMicros(tokens, own, GEO_MULTIPLIER) : cost;
    const key = `${r.model} ${r.day}`;
    const g = groups.get(key) ?? {
      model: r.model,
      day: r.day,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      recordedUsdMicros: 0n,
    };
    groups.set(key, {
      ...g,
      calls: g.calls + 1,
      inputTokens: g.inputTokens + tokens.inputTokens,
      outputTokens: g.outputTokens + tokens.outputTokens,
      cacheReadTokens: g.cacheReadTokens + tokens.cacheReadTokens,
      cacheWriteTokens: g.cacheWriteTokens + tokens.cacheWriteTokens,
      recordedUsdMicros: g.recordedUsdMicros + cost,
    });
  }
  return Object.freeze({
    openCount: report.openCount,
    unreconciledCount: report.unreconciledCount,
    lateSettledCount: report.lateSettledCount,
    attempts: attempts.rows.length,
    mismatched,
    recordedUsdMicros: recorded,
    usageRows: rows.rows.length,
    conservativeRows: conservative,
    probeModelRows: probeModel,
    atModelPricesUsdMicros: atModel,
    byModelDay: Object.freeze(
      [...groups.values()].sort((a, b) => (a.day + a.model).localeCompare(b.day + b.model)),
    ),
    ok: report.openCount === 0 && report.unreconciledCount === 0 && mismatched === 0,
  });
}
