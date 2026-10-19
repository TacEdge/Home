import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MODELS } from '@/kev/config';
import { INJECTIONS, SCENARIOS } from '@/kev/evals/scenarios';
import { scriptFor, type FixtureIds } from '@/kev/evals/scripted';
import type { Transcript } from '@/kev/evals/transcript';
import { buildProbeGateway } from '@/kev/providers/anthropic';
import { createProviderFetchForTests } from '@/kev/providers/fetch';
import type { ProviderRequest } from '@/kev/providers/types';
import type { ScriptStep } from '@/kev/providers/scripted';
import { reviewFiles } from '../../scripts/kev-live/eval';
import { capNzdFor } from '../../scripts/kev-live/guards.mts';
import { buildPlan, DEEP_SMOKE_PROBES } from '../../scripts/kev-live/plan';
import { executePlan, type RunContext } from '../../scripts/kev-live/probes';
import { reconcile } from '../../scripts/kev-live/reconcile';
import { buildReport } from '../../scripts/kev-live/report';
import { CANARY_MARK, SENSITIVE_MARK } from '../fixtures/family';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import {
  messageEnd,
  messageStart,
  startStub,
  textBlock,
  toolBlock,
  ev,
  type Handler,
  type Stub,
} from '../unit/kev-stub';
import { clockedPool, dropTestClock } from './clock';
import { adminDb, testDb } from './db';
import { applyState, buildEvalWorld, markersFor } from './kev-eval-world';
import { clearKevFixture, type KevFixture } from './kev-fixture';
import { clockTo, createTickingClock } from './kev-turn-helpers';

// Package 5D's deep smoke run (ADR 0012 §59), end to end against a local
// stub of the provider (never the provider): the session plan
// (`deep-smoke`) through the real probe gateway, HOME's fetch, kev.handle()
// on the deep tier, the real bookkeeping path under the run's own cap, the
// validator and the checker, on the evaluation world; then the
// reconciliation, the report and the review files. The stub answers as a
// model would: it reads the weekend and the forecast, then gives the
// scenario's own plan (its scripted steps, sent over the real wire format).
// What is proven is the path and HOME's checks, not a model's quality.
// Synthetic only.

const { db, close } = testDb();
const admin = adminDb();
const { pool: clockedHandle, db: clocked } = clockedPool();
const KEY = 'test-key-not-real-deep-smoke';
const savedEnv = { ...process.env };
let stub: Stub;
let f: KevFixture;
let ids: FixtureIds;
const scenario = SCENARIOS.find((s) => s.id === 'realistic.weekend_look')!;

const thinking = (index: number) =>
  ev('content_block_start', {
    index,
    content_block: { type: 'thinking', thinking: '', signature: '' },
  }) +
  ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: 'Weekend.' } }) +
  ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig' } }) +
  ev('content_block_stop', { index });

/**
 * The stub as the model: in the read phase, the scenario's own reads (or,
 * with `read: false`, none); then the end of the read phase; then, in the
 * answer phase, the scenario's own plan.
 */
function modelLike(opts: { read: boolean }): Handler {
  const [reads, plan] = scriptFor(scenario.turns[0]!, ids);
  return (_req, res, raw) => {
    const body = JSON.parse(raw) as {
      model: string;
      tools?: unknown[];
      tool_choice?: { type: string };
      output_config?: { format?: unknown };
      messages: { role: string; content: unknown }[];
    };
    const last = body.messages.at(-1)!;
    const lastHasResult =
      Array.isArray(last.content) &&
      (last.content as { type: string }[]).some((b) => b.type === 'tool_result');
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_synthetic' });
    if (body.output_config?.format) {
      const step = (plan as (r: ProviderRequest) => ScriptStep)({} as ProviderRequest);
      const text = step.kind === 'answer' ? (step.text ?? []).join('') : '';
      return res.end(messageStart(body.model) + textBlock(0, text) + messageEnd('end_turn'));
    }
    if (opts.read && body.tools?.length && body.tool_choice?.type === 'auto' && !lastHasResult) {
      const uses = (reads as ScriptStep & { toolUses: { name: string; input: unknown }[] })
        .toolUses;
      return res.end(
        messageStart(body.model) +
          thinking(0) +
          uses.map((u, i) => toolBlock(i + 1, `toolu_smoke_${i}`, u.name, u.input)).join('') +
          messageEnd('tool_use', 80),
      );
    }
    return res.end(
      messageStart(body.model) + textBlock(0, 'That is what I need.') + messageEnd('end_turn'),
    );
  };
}

const gateway = () =>
  buildProbeGateway(KEY, createProviderFetchForTests(KEY, { stubPort: stub.port }), {});

/** The runner's own cap for the plan's recommended budget, US$1.67: NZ$3. */
const RUN_CAP_NZD = capNzdFor(1_670_000n);

beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  const world = await buildEvalWorld(db, admin.db);
  f = world.f;
  ids = world.ids;
  await createTickingClock(admin);
  // A clock no other suite uses: the run's month, like the runner's own
  // database, holds no other usage, so its own cap is what is tested.
  await clockTo(admin, '2046-06-01T00:00:00Z');
  stub = await startStub();
});
afterAll(async () => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await stub.close();
  await clockedHandle.end();
  await dropTestClock(admin);
  await clearKevFixture(db, admin.db);
  await close();
  await admin.close();
});
beforeEach(() => {
  process.env.HOME_KEV_MONTHLY_CAP_NZD = String(RUN_CAP_NZD);
  stub.seen.length = 0;
  stub.counts.length = 0;
  stub.queue.length = 0;
});

function context(transcripts: Transcript[], budgetMicros: bigint): RunContext {
  return {
    gateway: gateway(),
    actor: f.kev.sam,
    deps: { db: clocked },
    budgetMicros,
    evaluation: {
      adults: f.kev,
      ids,
      markers: markersFor,
      db: clocked,
      reader: admin.db,
      prepare: (s) => applyState(s.state, admin.db),
      onTranscript: (t) => void transcripts.push(t),
    },
  };
}

describe('the deep smoke plan (Package 5D)', () => {
  it('is the session plan: one deep scenario turn, US$1.50 at most, a US$1.67 cap the run’s NZ$3 holds', () => {
    const plan = buildPlan('deep-smoke');
    expect(plan.name).toBe('deep-smoke');
    expect(plan.kind).toBe('evaluation');
    expect(plan.probes.map((p) => [p.id, p.kind, 'tier' in p ? p.tier : null])).toEqual([
      ['realistic.weekend_look@deep#1', 'scenario', 'deep'],
    ]);
    expect(plan.totalMaxUsdMicros).toBe(1_500_000n);
    expect(plan.peakHoldUsdMicros).toBe(1_500_000n);
    expect(plan.sessionCapUsdMicros).toBe(1_670_000n);
    expect(RUN_CAP_NZD).toBe(3);
  });

  it('runs end to end on Opus: a read round, the answer phase, an accepted, cited answer, recorded and reconciled; the transcript and the deep review page are written; the report holds no question', async () => {
    for (let i = 0; i < 12; i++) stub.queue.push(modelLike({ read: true }));
    const plan = buildPlan('deep-smoke');
    const transcripts: Transcript[] = [];
    const run = await executePlan(plan, context(transcripts, 1_670_000n));
    expect(run.stopped).toBeNull();
    const [r] = run.results;
    expect(r!.reasons).toEqual([]);
    expect(r!.outcome).toBe('pass');
    expect(r!.checks).toMatchObject({
      passed: true,
      outcome: 'answer',
      answerResult: 'first_pass',
      escalated: false,
      countedFirst: true,
      usInference: true,
      models: MODELS.opus55.id,
      answerPhase: true,
      formatWithAuto: false,
      growOnly: true,
    });
    expect(r!.checks.toolRounds).toBeGreaterThanOrEqual(1);
    expect(r!.checks.cites).toBeGreaterThanOrEqual(1);
    expect(r!.checks.thinkingBlocks).toBeGreaterThanOrEqual(1);
    // Every model request went to Opus 5.5, each counted first (G22).
    const models = stub.seen.map((s) => (JSON.parse(s.body) as { model: string }).model);
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(new Set(models)).toEqual(new Set([MODELS.opus55.id]));
    expect(stub.counts.length).toBe(models.length);
    // Nothing of the other adult's or sensitive was sent.
    const sent = stub.seen.map((s) => s.body).join('\n');
    for (const m of [`ni-alex-`, CANARY_MARK.alex, SENSITIVE_MARK])
      expect(sent, m).not.toContain(m);
    // The evaluation record: the checker's verdict, on deep, its turn's cost recorded.
    expect(r!.evaluation).toMatchObject({ scenario: scenario.id, tier: 'deep', pass: true });
    expect(r!.evaluation!.turns[0]!.costUsdMicros).not.toBeNull();
    // Reconciled: nothing left open, HOME's charge within the plan's maximum.
    const rec = await reconcile(clocked, r!.attemptIds);
    expect(rec.mismatched).toBe(0);
    expect(rec.recordedUsdMicros).toBeGreaterThan(0n);
    expect(rec.recordedUsdMicros).toBeLessThanOrEqual(plan.totalMaxUsdMicros);
    // The transcript (Package 5C): live, the question, the shown answer with
    // its citations, the reads, the check; and the deep review page.
    expect(transcripts).toHaveLength(1);
    const t = transcripts[0]!;
    expect([t.key, t.mode, t.tier, t.automated.pass]).toEqual([
      'realistic.weekend_look@deep#1',
      'live',
      'deep',
      true,
    ]);
    expect(t.turns[0]!.question).toBe(scenario.turns[0]!.question);
    expect(t.turns[0]!.tools.map((x) => x.tool)).toEqual(['get_agenda', 'get_weather']);
    expect(t.turns[0]!.citations.some((c) => c.type === 'event' && c.id === f.id.football)).toBe(
      true,
    );
    expect(t.turns[0]!.limits.join(' ')).toContain('Forecast as of');
    expect(t.turns[0]!.check.rejectedCodes).toEqual([]);
    const files = reviewFiles(transcripts, 'live');
    expect(Object.keys(files).sort()).toEqual([
      'review-deep.html',
      'review-deep.json',
      'transcripts.json',
    ]);
    expect(files['review-deep.html']).toContain('Live answers');
    expect(files['review-deep.html']).toContain('id="realistic.weekend_look@deep#1"');
    expect(files['review-deep.html']).toContain('Download review sheet');
    // The report: per-call usage, cost and latency, the summary; no question,
    // no record text, no key.
    const report = buildReport({
      plan,
      budgetMicros: 1_670_000n,
      capNzd: RUN_CAP_NZD,
      run,
      reconciliation: rec,
      startedAt: new Date(0),
      finishedAt: new Date(1),
      identity: { workflowRun: null, commit: null },
    });
    expect(report.json).toContain('"evaluation"');
    expect(report.markdown).toContain('realistic.weekend_look@deep#1');
    for (const text of [
      scenario.turns[0]!.question,
      'Football',
      KEY,
      ...Object.values(INJECTIONS),
    ]) {
      expect(report.json, text).not.toContain(text);
      expect(report.markdown, text).not.toContain(text);
    }
  });

  it('fails, never passes, when the model answers without reading: no tool round, no accepted answer', async () => {
    for (let i = 0; i < 12; i++) stub.queue.push(modelLike({ read: false }));
    const transcripts: Transcript[] = [];
    const run = await executePlan(buildPlan('deep-smoke'), context(transcripts, 1_670_000n));
    const [r] = run.results;
    expect(r!.outcome).toBe('fail');
    expect(r!.reasons).toContain('no_tool_round');
    expect(r!.reasons.some((x) => x.startsWith('answer_'))).toBe(true);
    // A failed answer's words are never kept: closed codes only.
    expect(transcripts[0]!.turns[0]!.check.rejectedCodes.length).toBeGreaterThan(0);
    // The plan stops on its one probe's failure: no automatic retry.
    expect(run.results).toHaveLength(DEEP_SMOKE_PROBES.length);
  });

  it('is not run at all on a budget below its maximum: no model call', async () => {
    for (let i = 0; i < 12; i++) stub.queue.push(modelLike({ read: true }));
    const run = await executePlan(buildPlan('deep-smoke'), context([], 1_499_999n));
    expect(run.results[0]).toMatchObject({ outcome: 'not_run', reasons: ['budget'] });
    expect(run.stopped).toBe('budget');
    expect(stub.seen).toHaveLength(0);
    expect(stub.counts).toHaveLength(0);
  });
});
