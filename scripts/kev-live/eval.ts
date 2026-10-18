import { sql } from 'drizzle-orm';
import type { Db } from '@/db/create';
import { TURNS_PER_MINUTE } from '@/domain/kev-bookkeeping/constants';
import { clearConversation } from '@/domain/kev-bookkeeping/service';
import { kevContentV2, type KevContentV2 } from '@/domain/kev-bookkeeping/schema';
import { judge, relevanceOf, type Markers, type Verdict } from '@/kev/evals/judge';
import type { FixtureIds } from '@/kev/evals/scripted';
import { attemptIdsOf, turnRecord, type EvalRecord, type TurnRecord } from '@/kev/evals/summary';
import { topicsOf, type Scenario, type TurnSpec } from '@/kev/evals/types';
import { handle, type KevDeps, type KevEvent } from '@/kev/orchestrator';
import type { KevProvider } from '@/kev/providers/types';
import type { UserActor } from '@/trust/actor';

// One scenario run through kev.handle(), the production path (M8 contract
// §12.1, §12.2; Package 5A, ADR 0012 §56): the driver both layers share.
// The scripted evals (tests/integration/kev-evals.test.ts) give it the
// scripted provider for each turn; the live runner's scenario probes
// (probes.ts) give it the probe gateway's. Each turn's record is read from
// what HOME stored (Kev's message: its trace, calls and answer check) and
// recorded (`kev_usage`, by the message's attempts); the checker's verdict
// is closed check names. Nothing here keeps a question, an answer or a
// record's text: the record holds codes and counts only.

export type ScenarioContext = Readonly<{
  /** The fixture adults, as Kev acts (`via: 'kev'`). */
  adults: Readonly<Record<'sam' | 'alex', UserActor>>;
  ids: FixtureIds;
  /** What the asker must never be shown: fixed, or by asker (the other adult's markers). */
  markers: Markers | ((asker: 'sam' | 'alex') => Markers);
  /** The database Kev's turns run on. */
  db: KevDeps['db'];
  /** A connection that reads Kev's stored messages and `kev_usage` (the owner's, in the runner's own database). */
  reader: Db;
  /** The provider for a scenario turn (scripted: that turn's script; live: the gateway's). */
  providerFor: (turn: TurnSpec, index: number) => KevProvider;
  /** Further test seams for every turn (the sensitive strings the validator refuses). */
  deps?: Omit<KevDeps, 'db' | 'provider' | 'startTier'>;
  /** Called before the scenario and before each turn (the scripted evals move their test clock; the runner paces). */
  beforeScenario?: () => Promise<void>;
  beforeTurn?: (actor: UserActor) => Promise<void>;
  /**
   * Applies the scenario's starting state (src/kev/evals/types.ts
   * SCENARIO_STATES) and returns what restores the default, run however
   * the scenario ends. Without it, a scenario that names a state is refused.
   */
  prepare?: (s: Scenario) => Promise<() => Promise<void>>;
}>;

export type PlayedTurn = Readonly<{
  events: readonly KevEvent[];
  done: Extract<KevEvent, { type: 'done' }>;
  stored: KevContentV2 | null;
  record: TurnRecord;
}>;

export type ScenarioRun = Readonly<{
  record: EvalRecord;
  verdict: Verdict;
  turns: readonly PlayedTurn[];
}>;

/** Kev's stored message for a turn (none in the error states), and its recorded cost. */
export async function storedTurn(
  reader: Db,
  done: Extract<KevEvent, { type: 'done' }>,
): Promise<{ stored: KevContentV2 | null; record: TurnRecord }> {
  if (!done.kevMessageId) return { stored: null, record: turnRecord(done.outcome, null, null) };
  const [row] = (
    await reader.execute<{ content: unknown }>(
      sql`select content from message where id = ${done.kevMessageId} and role = 'kev'`,
    )
  ).rows;
  const stored = row ? kevContentV2.parse(row.content) : null;
  const attempts = attemptIdsOf(stored);
  let cost: bigint | null = null;
  if (attempts.length > 0) {
    const ids = sql.join(
      attempts.map((id) => sql`${id}`),
      sql`, `,
    );
    const [sum] = (
      await reader.execute<{ total: string }>(
        sql`select coalesce(sum(cost_usd_micros), 0)::text as total from kev_usage where attempt_id in (${ids})`,
      )
    ).rows;
    cost = BigInt(sum?.total ?? '0');
  }
  return { stored, record: turnRecord(done.outcome, stored, cost) };
}

/** One run of a scenario on a tier configuration: its turns in a fresh conversation, then the checker. */
export async function runScenario(
  s: Scenario,
  tier: 'fast' | 'deep',
  repeat: number,
  ctx: ScenarioContext,
): Promise<ScenarioRun> {
  const actor = ctx.adults[s.asker];
  if (s.state && !ctx.prepare)
    throw new Error(`scenario ${s.id} needs a state the driver cannot set`);
  await ctx.beforeScenario?.();
  const restore = ctx.prepare ? await ctx.prepare(s) : async () => {};
  const turns: PlayedTurn[] = [];
  try {
    // A fresh conversation: no earlier scenario's turns in this one's window.
    await clearConversation(actor, { db: ctx.db });
    for (const [i, t] of s.turns.entries()) {
      // A follow-up after Clear: the earlier turns are out of the window.
      if (t.clearBefore) await clearConversation(actor, { db: ctx.db });
      await ctx.beforeTurn?.(actor);
      const events: KevEvent[] = [];
      for await (const e of handle(
        { actor, channel: 'web', input: { text: t.question }, now: new Date(t.now ?? s.now) },
        {
          db: ctx.db,
          provider: ctx.providerFor(t, i),
          ...(tier === 'deep' ? { startTier: 'deep' as const } : {}),
          ...ctx.deps,
        },
      ))
        events.push(e);
      const done = events.at(-1);
      if (!done || done.type !== 'done') throw new Error('a turn always ends with done');
      const { stored, record } = await storedTurn(ctx.reader, done);
      turns.push(Object.freeze({ events, done, stored, record }));
    }
  } finally {
    await restore();
  }
  const last = turns.at(-1)!;
  const markers = typeof ctx.markers === 'function' ? ctx.markers(s.asker) : ctx.markers;
  const verdict = judge(s, tier, { events: last.events, stored: last.stored }, ctx.ids, markers);
  const record: EvalRecord = Object.freeze({
    scenario: s.id,
    class: s.class,
    tier,
    repeat,
    followUp: s.turns.length > 1,
    expectEscalated: s.expect.escalated ?? null,
    topics: topicsOf(s),
    pass: verdict.pass,
    failed: verdict.failed,
    relevance: relevanceOf(s, last.stored?.cites ?? [], ctx.ids),
    turns: Object.freeze(turns.map((t) => t.record)),
  });
  return Object.freeze({ record, verdict, turns: Object.freeze(turns) });
}

/**
 * Paces a live evaluation within HOME's own per-adult limit (§9.6: six turns
 * a minute), never around it: before each turn, waits while the adult
 * already has `TURNS_PER_MINUTE` turns in the last minute, counted exactly
 * as HOME counts them (their `message.add` audit rows with role `user`, by
 * the database's clock). The day's limit (sixty) is held by the plan: an
 * evaluation gives no adult more turns than that (plan.ts). Waits at most
 * `maxWaits` times, then refuses rather than let HOME refuse the turn.
 */
export async function paceTurn(
  reader: Db,
  userId: string,
  opts: { sleep?: (ms: number) => Promise<void>; stepMs?: number; maxWaits?: number } = {},
): Promise<number> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stepMs = opts.stepMs ?? 5_000;
  const maxWaits = opts.maxWaits ?? 24;
  for (let waits = 0; ; waits++) {
    const [row] = (
      await reader.execute<{ n: number }>(sql`
        select count(*)::int as n from audit_log
         where at >= now() - interval '1 minute' and actor_user_id = ${userId}
           and event = 'message.add' and meta ->> 'role' = 'user'`)
    ).rows;
    if (Number(row?.n ?? 0) < TURNS_PER_MINUTE) return waits;
    if (waits >= maxWaits) throw new Error('pacing: the per-minute limit did not clear');
    await sleep(stepMs);
  }
}
