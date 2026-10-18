import { sql } from 'drizzle-orm';
import type { Db } from '@/db/create';
import { clearConversation } from '@/domain/kev-bookkeeping/service';
import { kevContentV2, type KevContentV2 } from '@/domain/kev-bookkeeping/schema';
import { judge, type Markers, type Verdict } from '@/kev/evals/judge';
import type { FixtureIds } from '@/kev/evals/scripted';
import { attemptIdsOf, turnRecord, type EvalRecord, type TurnRecord } from '@/kev/evals/summary';
import type { Scenario, TurnSpec } from '@/kev/evals/types';
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
  markers: Markers;
  /** The database Kev's turns run on. */
  db: KevDeps['db'];
  /** A connection that reads Kev's stored messages and `kev_usage` (the owner's, in the runner's own database). */
  reader: Db;
  /** The provider for a scenario turn (scripted: that turn's script; live: the gateway's). */
  providerFor: (turn: TurnSpec, index: number) => KevProvider;
  /** Further test seams for every turn (the sensitive strings the validator refuses). */
  deps?: Omit<KevDeps, 'db' | 'provider' | 'startTier'>;
  /** Called before the scenario and before each turn (the scripted evals move their test clock). */
  beforeScenario?: () => Promise<void>;
  beforeTurn?: () => Promise<void>;
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
  await ctx.beforeScenario?.();
  // A fresh conversation: no earlier scenario's turns in this one's window.
  await clearConversation(actor, { db: ctx.db });
  const turns: PlayedTurn[] = [];
  for (const [i, t] of s.turns.entries()) {
    await ctx.beforeTurn?.();
    const events: KevEvent[] = [];
    for await (const e of handle(
      { actor, channel: 'web', input: { text: t.question }, now: new Date(s.now) },
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
  const last = turns.at(-1)!;
  const verdict = judge(
    s,
    tier,
    { events: last.events, stored: last.stored },
    ctx.ids,
    ctx.markers,
  );
  const record: EvalRecord = Object.freeze({
    scenario: s.id,
    class: s.class,
    tier,
    repeat,
    followUp: s.turns.length > 1,
    expectEscalated: s.expect.escalated ?? null,
    pass: verdict.pass,
    failed: verdict.failed,
    turns: Object.freeze(turns.map((t) => t.record)),
  });
  return Object.freeze({ record, verdict, turns: Object.freeze(turns) });
}
