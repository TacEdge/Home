import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearConversation } from '@/domain/kev-bookkeeping/service';
import { kevContentV2, type KevContentV2 } from '@/domain/kev-bookkeeping/schema';
import { LIMITS } from '@/kev/config';
import { SCENARIOS } from '@/kev/evals/scenarios';
import { scriptFor, type FixtureIds } from '@/kev/evals/scripted';
import { summarise, summaryJson } from '@/kev/evals/summary';
import type { ProbeGateway } from '@/kev/providers/anthropic';
import { createScriptedProvider, type ScriptStep } from '@/kev/providers/scripted';
import type { Ref } from '@/kev/tools/types';
import type { UserActor } from '@/trust/actor';
import { runScenario, storedTurn } from '../../scripts/kev-live/eval';
import { buildPlan, scenarioProbes, scenarioTurnMaxUsdMicros } from '../../scripts/kev-live/plan';
import { executePlan } from '../../scripts/kev-live/probes';
import { buildReport } from '../../scripts/kev-live/report';
import { CANARY_MARK, SENSITIVE_MARK } from '../fixtures/family';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { clockedPool, dropTestClock } from './clock';
import { adminDb, testDb } from './db';
import {
  addPrivateFor,
  at,
  buildKevFixture,
  clearKevFixture,
  NOW,
  SAT,
  writeForecast,
  type KevFixture,
} from './kev-fixture';
import {
  answer,
  clockForward,
  clockTo,
  createTickingClock,
  messagesOf,
  runTurn,
  tools,
} from './kev-turn-helpers';

// Package 5A's evaluation instrumentation end to end (ADR 0012 §56), on the
// scripted provider and the test database: the answer check stored with
// Kev's message and logged on the `kev_turn` line (first pass, after the
// regeneration, after escalation, salvage, the fixed fallback, no answer),
// with closed codes and counts only, never the rejected answer; cost and
// latency attributed per turn from what HOME stored and recorded; the
// five-call and deadline limits unchanged; nothing of the other adult's in
// any record, summary or log line; and the runner's scenario probes (E13's
// stop before the run limit). No provider is called. Synthetic only.

const { db, close } = testDb();
const admin = adminDb();
const { pool: clockedHandle, db: clocked } = clockedPool();
let f: KevFixture;
const savedEnv = { ...process.env };
let swim: Ref;
let football: Ref;
/** A plan that fails outside its words (a record no read returned): no salvage. */
const UNREAD: Ref = { type: 'event', id: 'not-returned' };
/** A model writing its own lead (answer.schema): the rejected text, which must never be kept. */
const REJECTED = 'Zebra crossing 4417 says the fence is done';

const turn = (
  actor: UserActor,
  text: string,
  script: Parameters<typeof runTurn>[2],
  opts: Partial<Parameters<typeof runTurn>[3]> = {},
) => runTurn(actor, text, script, { now: NOW, db: clocked, ...opts });

/** The `kev_turn` lines a block writes (stdout and stderr captured). */
async function logged<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const out: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  const ewrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string | Uint8Array) => (out.push(String(c)), true)) as never;
  process.stderr.write = ((c: string | Uint8Array) => (out.push(String(c)), true)) as never;
  try {
    return { value: await fn(), lines: out };
  } finally {
    process.stdout.write = write;
    process.stderr.write = ewrite;
  }
}
const turnLine = (lines: string[]) =>
  lines
    .join('')
    .split('\n')
    .filter((l) => l.includes('"event":"kev_turn"'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .at(-1)!;

const lastKev = async (actor: UserActor): Promise<KevContentV2 | null> => {
  const row = (await messagesOf(admin, actor.userId)).filter((m) => m.role === 'kev').at(-1);
  return row ? kevContentV2.parse(row.content) : null;
};

beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  process.env.HOME_KEV_MONTHLY_CAP_NZD = '300';
  f = await buildKevFixture(db, admin.db);
  await writeForecast(admin.db, at('2026-10-14', '06:55'));
  // Alex's private records are present throughout: never in Sam's records or logs.
  await addPrivateFor(f, 'alex', db, admin.db);
  swim = { type: 'event', id: f.id.swimming, at: '2026-10-14T15:30:00+13:00' };
  football = { type: 'event', id: f.id.football, at: `${SAT}T09:00:00+13:00` };
  await createTickingClock(admin);
  await clockTo(admin, '2044-05-01T00:00:00Z');
});
afterAll(async () => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await clockedHandle.end();
  await dropTestClock(admin);
  await clearKevFixture(db, admin.db);
  await close();
  await admin.close();
});
beforeEach(async () => {
  await clockForward(admin, 31);
  for (const a of [f.kev.sam, f.kev.alex]) await clearConversation(a, { db: clocked });
});

describe('the answer check, stored and logged (ADR 0012 §56)', () => {
  it('first pass: one answer checked, passed; the log line says so', async () => {
    const { value: t, lines } = await logged(() =>
      turn(f.kev.sam, 'When is swimming?', [answer('Here’s {when}.', [swim])]),
    );
    expect(t.done.outcome).toBe('answer');
    const c = await lastKev(f.kev.sam);
    expect(c?.check).toMatchObject({
      result: 'first_pass',
      attempts: [{ tier: 'fast', answers: 1, failures: [], passed: true }],
    });
    expect(turnLine(lines)).toMatchObject({
      answerResult: 'first_pass',
      firstPass: true,
      answersChecked: 1,
    });
    expect(turnLine(lines)).not.toHaveProperty('firstCodes');
  });

  it('after the regeneration: the first answer’s closed codes kept, its words nowhere (stored, shown or logged)', async () => {
    const { value: t, lines } = await logged(() =>
      turn(f.kev.sam, 'When is swimming?', [
        answer(REJECTED, [swim]),
        answer('Here’s {when}.', [swim]),
      ]),
    );
    expect(t.done.outcome).toBe('answer');
    const c = await lastKev(f.kev.sam);
    expect(c?.check).toMatchObject({
      result: 'after_regeneration',
      attempts: [{ tier: 'fast', answers: 2, failures: [['answer.schema']], passed: true }],
    });
    expect(turnLine(lines)).toMatchObject({
      answerResult: 'after_regeneration',
      firstPass: false,
      answersChecked: 2,
      firstCodes: ['answer.schema'],
    });
    const stored = JSON.stringify(await messagesOf(admin, f.kev.sam.userId));
    for (const where of [stored, JSON.stringify(t.events), lines.join('')])
      expect(where).not.toContain('Zebra');
  });

  it('after escalation: two failed answers on fast, the trigger named, deep’s answer passed', async () => {
    const { value: t, lines } = await logged(() =>
      turn(f.kev.sam, 'Plan our Saturday?', [
        answer('Here you go.', [UNREAD]),
        answer('Here you go.', [UNREAD]),
        answer('Here’s {when}.', [swim]),
      ]),
    );
    expect(t.done).toMatchObject({ outcome: 'answer', escalated: true });
    const c = await lastKev(f.kev.sam);
    expect(c?.check).toMatchObject({
      result: 'after_escalation',
      escalation: 'failed_answers',
      attempts: [
        { tier: 'fast', answers: 2, failures: [['cite.unknown'], ['cite.unknown']], passed: false },
        { tier: 'deep', answers: 1, failures: [], passed: true },
      ],
    });
    expect(turnLine(lines)).toMatchObject({
      answerResult: 'after_escalation',
      escalation: 'failed_answers',
      firstPass: false,
      answersChecked: 3,
    });
  });

  it('the model’s escalate: no answer on fast, the trigger `model`, deep’s first answer the first checked', async () => {
    const { value: t, lines } = await logged(() =>
      turn(f.kev.sam, 'Help me plan the weekend?', [
        tools(['escalate', { reason: 'multi_step_planning' }]),
        answer('Here’s {when}.', [swim]),
      ]),
    );
    expect(t.done).toMatchObject({ outcome: 'answer', escalated: true });
    expect((await lastKev(f.kev.sam))?.check).toMatchObject({
      result: 'after_escalation',
      escalation: 'model',
      attempts: [
        { tier: 'fast', answers: 0, failures: [], passed: false },
        { tier: 'deep', answers: 1, failures: [], passed: true },
      ],
    });
    expect(turnLine(lines)).toMatchObject({ firstPass: true, escalation: 'model' });
  });

  it('the fixed fallback on deep (no escalation from deep): two failures, `fallback`', async () => {
    const t = await turn(
      f.kev.sam,
      'When is swimming?',
      [answer('Here you go.', [UNREAD]), answer('Here you go.', [UNREAD])],
      { deps: { startTier: 'deep' } },
    );
    expect(t.done.outcome).toBe('fallback');
    expect((await lastKev(f.kev.sam))?.check).toMatchObject({
      result: 'fallback',
      attempts: [
        { tier: 'deep', answers: 2, failures: [['cite.unknown'], ['cite.unknown']], passed: false },
      ],
    });
  });

  it('the salvage: the lead, then the view, failed; the checked facts shown with HOME’s lead, `salvaged`', async () => {
    const t = await turn(f.kev.sam, 'What have we got this weekend?', [
      tools(['get_agenda', { from: SAT, to: '2026-10-18' }]),
      answer('flagged', [football]),
      answer('here_you_go', [football], { type: 'suggestion', phrase: 'raincoat', about: [0] }),
    ]);
    expect(t.done).toMatchObject({ outcome: 'answer', escalated: false });
    const c = await lastKev(f.kev.sam);
    expect(c?.salvaged).toBe(true);
    expect(c?.check).toMatchObject({
      result: 'salvaged',
      attempts: [
        {
          tier: 'fast',
          answers: 2,
          failures: [['lead.unsupported'], ['view.unsupported']],
          passed: false,
        },
      ],
    });
  });

  it('the five-call limit is unchanged: five calls, then the fallback, every call recorded with its check', async () => {
    const bad = answer('Here you go.', [UNREAD]);
    const t = await turn(
      f.kev.sam,
      'Weekend?',
      [
        tools(['get_agenda', { from: SAT, to: '2026-10-18' }]),
        tools(['get_weather', { from: SAT, to: '2026-10-18' }]),
        tools(['get_tasks', {}]),
        bad,
        bad,
        bad,
      ],
      { deps: { startTier: 'deep' } },
    );
    expect(t.provider.requests).toHaveLength(LIMITS.modelCallsPerAttempt);
    expect(t.done.outcome).toBe('fallback');
    const { record } = await storedTurn(admin.db, t.done);
    expect(record).toMatchObject({
      result: 'fallback',
      answers: ['fail', 'fail'],
      modelCalls: LIMITS.modelCallsPerAttempt,
      toolRounds: 3,
      toolCalls: 3,
    });
  });

  it('the deadline is unchanged: a stalled model ends in the timeout state by the deadline; no message, `no_answer` logged', async () => {
    const started = Date.now();
    const { value: t, lines } = await logged(() =>
      turn(f.kev.sam, 'Synthetic question.', [{ kind: 'stall', ms: 60_000 }], {
        deps: { turnDeadlineMs: 10_000 },
      }),
    );
    expect(Date.now() - started).toBeLessThan(10_500);
    expect(t.events).toContainEqual(expect.objectContaining({ type: 'error', code: 'timeout' }));
    expect(await lastKev(f.kev.sam)).toBeNull();
    expect(turnLine(lines)).toMatchObject({
      answerResult: 'no_answer',
      firstPass: null,
      answersChecked: 0,
    });
    const { record } = await storedTurn(admin.db, t.done);
    expect(record).toMatchObject({ result: 'no_answer', modelCalls: null, costUsdMicros: null });
  }, 20_000);

  it('cost and latency are attributed per turn: each turn’s cost is its own attempts’ `kev_usage`, its time to the checked answer within the turn', async () => {
    const one = await turn(f.kev.sam, 'When is swimming?', [
      {
        ...(answer('Here’s {when}.', [swim]) as object),
        usage: { outputTokens: 900 },
      } as ScriptStep,
    ]);
    await clockForward(admin, 2);
    const started = Date.now();
    const two = await turn(f.kev.sam, 'What’s on this weekend?', [
      tools(['get_agenda', { from: SAT, to: '2026-10-18' }]),
      { kind: 'stall', ms: 300 },
      answer('Here’s {when}.', [football]),
    ]);
    const elapsed = Date.now() - started;
    const a = await storedTurn(admin.db, one.done);
    const b = await storedTurn(admin.db, two.done);
    const usage = async (ids: string[]) =>
      (
        await admin.db.execute<{ total: string }>(
          sql`select coalesce(sum(cost_usd_micros), 0)::text as total from kev_usage where attempt_id in (${sql.join(
            ids.map((i) => sql`${i}`),
            sql`, `,
          )})`,
        )
      ).rows[0]!.total;
    const idsOf = (c: KevContentV2 | null) => [...new Set(c!.calls.map((x) => x.attemptId))];
    expect(a.record.costUsdMicros).toBe(await usage(idsOf(a.stored)));
    expect(b.record.costUsdMicros).toBe(await usage(idsOf(b.stored)));
    expect(a.record.costUsdMicros).not.toBe(b.record.costUsdMicros);
    expect(idsOf(a.stored)).not.toEqual(idsOf(b.stored));
    // Every one of Sam's usage rows is attributed to exactly one of the two turns.
    const all = await admin.db.execute<{ total: string }>(
      sql`select coalesce(sum(cost_usd_micros), 0)::text as total from kev_usage where user_id = ${f.kev.sam.userId} and attempt_id in (${sql.join(
        [...idsOf(a.stored), ...idsOf(b.stored)].map((i) => sql`${i}`),
        sql`, `,
      )})`,
    );
    expect(BigInt(a.record.costUsdMicros!) + BigInt(b.record.costUsdMicros!)).toBe(
      BigInt(all.rows[0]!.total),
    );
    expect(b.record.ms).toBeGreaterThanOrEqual(300);
    expect(b.record.ms!).toBeLessThanOrEqual(elapsed);
    expect(b.record).toMatchObject({ modelCalls: 3, toolRounds: 1, toolCalls: 1 });
  });
});

describe('no cross-adult leakage in the evaluation records, summary or log', () => {
  it('Sam’s scenario runs, with Alex’s private records present, hold nothing of Alex’s, no sensitive string and no question', async () => {
    const ids = Object.fromEntries(
      Object.entries(f.id).filter(([k]) => k !== 'calendar'),
    ) as FixtureIds;
    const privacy = SCENARIOS.filter((s) => s.class === 'privacy' && s.asker === 'sam');
    expect(privacy.length).toBeGreaterThan(0);
    const { value: runs, lines } = await logged(async () => {
      const out = [];
      for (const s of privacy)
        out.push(
          await runScenario(s, 'fast', 1, {
            adults: f.kev,
            ids,
            markers: { otherAdult: ['ni-alex-', CANARY_MARK.alex], sensitive: [SENSITIVE_MARK] },
            db: clocked,
            reader: admin.db,
            providerFor: (t) => createScriptedProvider(scriptFor(t, ids)),
            beforeScenario: () => clockForward(admin, 31),
            beforeTurn: () => clockForward(admin, 2),
          }),
        );
      return out;
    });
    const records = runs.map((r) => r.record);
    const json = summaryJson(
      summarise(records, { mode: 'scripted', fastModel: 'sonnet' }),
      records,
    );
    for (const text of [json, lines.join('')]) {
      for (const n of ['ni-alex-', CANARY_MARK.alex, SENSITIVE_MARK]) expect(text).not.toContain(n);
      for (const s of privacy) for (const t of s.turns) expect(text).not.toContain(t.question);
    }
    for (const r of runs) expect(r.verdict.failed).not.toContain('private_shown');
  });
});

describe('the runner’s scenario probes (Package 5A)', () => {
  const ids = () =>
    Object.fromEntries(Object.entries(f.id).filter(([k]) => k !== 'calendar')) as FixtureIds;
  const pick = [
    'realistic.today',
    'privacy.alex_saturday',
    'fabrication.dentist',
    'out_of_scope.book',
  ];

  const run = async (budgetMicros: bigint, repeats = 1) => {
    const probes = scenarioProbes({ scenarios: pick, tiers: ['fast', 'deep'], repeats });
    const plan = buildPlan('evaluation-test', probes, {
      kind: 'evaluation',
      probes: probes.map((p) => p.id),
      sessionCapUsdMicros: 175_000_000n,
    });
    // The scripted provider through the gateway's shape: no network, no evidence.
    const gateway = {
      provider: () => {
        throw new Error('the scripted runs give each turn its own provider');
      },
      evidence: () => [],
    } as unknown as ProbeGateway;
    const fixed = ids();
    return {
      plan,
      out: await executePlan(plan, {
        gateway,
        actor: f.kev.sam,
        deps: { db: clocked },
        budgetMicros,
        evaluation: {
          adults: f.kev,
          ids: fixed,
          markers: { otherAdult: [], sensitive: [SENSITIVE_MARK] },
          db: clocked,
          reader: admin.db,
          providerFor: (t) => createScriptedProvider(scriptFor(t, fixed)),
          beforeScenario: () => clockForward(admin, 31),
          beforeTurn: () => clockForward(admin, 2),
        },
      }),
    };
  };

  it('runs each scenario on each tier through kev.handle(), checks it, and the report carries §12.3’s summary with no question or answer', async () => {
    const { plan, out } = await run(175_000_000n);
    expect(out.stopped).toBeNull();
    expect(out.results).toHaveLength(pick.length * 2);
    for (const r of out.results) {
      expect(r.outcome, `${r.id} ${r.reasons.join(',')}`).toBe('pass');
      expect(r.evaluation).toMatchObject({ scenario: r.id.split('@')[0], pass: true });
      expect(r.evaluation!.turns.at(-1)!.result).not.toBe('no_answer');
    }
    const report = buildReport({
      plan,
      budgetMicros: 175_000_000n,
      capNzd: 315,
      run: out,
      reconciliation: null,
      startedAt: new Date(0),
      finishedAt: new Date(1),
    });
    const doc = JSON.parse(report.json) as {
      evaluation: { summary: { mode: string; tiers: { tier: string; runs: number }[] } };
    };
    expect(doc.evaluation.summary.mode).toBe('live');
    expect(doc.evaluation.summary.tiers.map((t) => [t.tier, t.runs])).toEqual([
      ['fast', pick.length],
      ['deep', pick.length],
    ]);
    expect(report.markdown).toContain('## Evaluation (§12.3)');
    for (const id of pick)
      for (const t of SCENARIOS.find((s) => s.id === id)!.turns) {
        expect(report.json).not.toContain(t.question);
        expect(report.markdown).not.toContain(t.question);
      }
  });

  it('E13: a run stops before the scenario whose maximum would cross the budget, finishing no further scenario', async () => {
    // Room for exactly three scenario turns at their maximum (US$1.50 each).
    const budget = 3n * scenarioTurnMaxUsdMicros('fast');
    const before = (
      await admin.db.execute<{ n: string }>(
        sql`select count(*)::text as n from kev_usage where user_id = ${f.kev.sam.userId}`,
      )
    ).rows[0]!.n;
    const { out } = await run(budget);
    expect(out.stopped).toBe('budget');
    expect(out.results.slice(0, 3).every((r) => r.outcome === 'pass')).toBe(true);
    for (const r of out.results.slice(3)) {
      expect(r).toMatchObject({ outcome: 'not_run', reasons: ['budget'] });
      expect(r.evaluation).toBeUndefined();
    }
    expect(out.committedMaxUsdMicros).toBe(budget);
    // Only the three run scenarios were charged (each a turn's own attempts).
    const after = (
      await admin.db.execute<{ n: string }>(
        sql`select count(*)::text as n from kev_usage where user_id = ${f.kev.sam.userId}`,
      )
    ).rows[0]!.n;
    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  it('without the evaluation fixture a scenario probe is not run and costs nothing', async () => {
    const probes = scenarioProbes({ scenarios: ['realistic.today'], tiers: ['fast'], repeats: 1 });
    const plan = buildPlan('evaluation-test', probes, {
      kind: 'evaluation',
      probes: probes.map((p) => p.id),
      sessionCapUsdMicros: 10_000_000n,
    });
    const out = await executePlan(plan, {
      gateway: { evidence: () => [] } as unknown as ProbeGateway,
      actor: f.kev.sam,
      deps: { db: clocked },
      budgetMicros: 10_000_000n,
    });
    expect(out.results[0]).toMatchObject({
      outcome: 'not_run',
      reasons: ['no_evaluation_fixture'],
    });
  });
});
