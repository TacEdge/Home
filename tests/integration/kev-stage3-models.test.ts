import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MODELS } from '@/kev/config';
import { SCENARIOS } from '@/kev/evals/scenarios';
import { scriptFor, type FixtureIds } from '@/kev/evals/scripted';
import { buildProbeGateway } from '@/kev/providers/anthropic';
import { createProviderFetchForTests } from '@/kev/providers/fetch';
import type { ProviderRequest } from '@/kev/providers/types';
import type { ScriptStep } from '@/kev/providers/scripted';
import { capNzdFor } from '../../scripts/kev-live/guards.mts';
import {
  buildPlan,
  scenarioProbes,
  type FastConfiguration,
  type PlanDef,
} from '../../scripts/kev-live/plan';
import { executePlan, type RunContext } from '../../scripts/kev-live/probes';
import { reconcile } from '../../scripts/kev-live/reconcile';
import { buildReport } from '../../scripts/kev-live/report';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import {
  messageEnd,
  messageStart,
  startStub,
  textBlock,
  toolBlock,
  type Handler,
  type Stub,
} from '../unit/kev-stub';
import { clockedPool, dropTestClock } from './clock';
import { adminDb, testDb } from './db';
import { applyState, buildEvalWorld, markersFor } from './kev-eval-world';
import { clearKevFixture, type KevFixture } from './kev-fixture';
import { clockTo, createTickingClock } from './kev-turn-helpers';

// Package 5E's Stage 3 (ADR 0012 §72), end to end against a local stub of
// the provider (never the provider): a comparison scenario probe through
// the real probe gateway, HOME's fetch, kev.handle() started on fast, the
// bookkeeping path under the run's own cap, the validator and the checker,
// on the evaluation world. What is proven is the configuration on the wire
// (model and effort, fast calls only), escalation unchanged, Haiku recorded
// at its own prices, and the report naming the configuration. Not a
// model's quality. Synthetic only.

const { db, close } = testDb();
const admin = adminDb();
const { pool: clockedHandle, db: clocked } = clockedPool();
const KEY = 'test-key-not-real-stage-3';
const savedEnv = { ...process.env };
let stub: Stub;
let f: KevFixture;
let ids: FixtureIds;
const scenario = SCENARIOS.find((s) => s.id === 'realistic.weekend_look')!;
const BUDGET = 1_670_000n;
const RUN_CAP_NZD = capNzdFor(BUDGET);

type Body = {
  model: string;
  tools?: unknown[];
  tool_choice?: { type: string };
  output_config?: { effort?: string; format?: unknown };
  messages: { role: string; content: unknown }[];
};

/**
 * The stub as a model: the scenario's reads, the end of the read phase, then
 * its plan; or, for the model named in `fumbles`, an answer HOME cannot
 * parse (so the fast attempt fails its answers and escalates).
 */
function modelLike(fumbles: string | null = null): Handler {
  const [reads, plan] = scriptFor(scenario.turns[0]!, ids);
  return (_req, res, raw) => {
    const body = JSON.parse(raw) as Body;
    const last = body.messages.at(-1)!;
    const lastHasResult =
      Array.isArray(last.content) &&
      (last.content as { type: string }[]).some((b) => b.type === 'tool_result');
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_synthetic' });
    if (body.output_config?.format) {
      if (body.model === fumbles)
        return res.end(
          messageStart(body.model) + textBlock(0, 'not a plan') + messageEnd('end_turn'),
        );
      const step = (plan as (r: ProviderRequest) => ScriptStep)({} as ProviderRequest);
      const text = step.kind === 'answer' ? (step.text ?? []).join('') : '';
      return res.end(messageStart(body.model) + textBlock(0, text) + messageEnd('end_turn'));
    }
    if (body.tools?.length && body.tool_choice?.type === 'auto' && !lastHasResult) {
      const uses = (reads as ScriptStep & { toolUses: { name: string; input: unknown }[] })
        .toolUses;
      return res.end(
        messageStart(body.model) +
          uses.map((u, i) => toolBlock(i, `toolu_s3_${i}`, u.name, u.input)).join('') +
          messageEnd('tool_use', 80),
      );
    }
    return res.end(
      messageStart(body.model) + textBlock(0, 'That is what I need.') + messageEnd('end_turn'),
    );
  };
}

/** One comparison probe: the scenario started on fast with this configuration. */
function planFor(fast: FastConfiguration) {
  const specs = scenarioProbes({ scenarios: [scenario.id], tiers: ['fast'], repeats: 1, fast });
  const def: PlanDef = {
    kind: 'evaluation',
    probes: specs.map((p) => p.id),
    specs,
    sessionCapUsdMicros: BUDGET,
  };
  return buildPlan('stage-3-test', specs, def);
}

function context(): RunContext {
  return {
    gateway: buildProbeGateway(KEY, createProviderFetchForTests(KEY, { stubPort: stub.port }), {}),
    actor: f.kev.sam,
    deps: { db: clocked },
    budgetMicros: BUDGET,
    evaluation: {
      adults: f.kev,
      ids,
      markers: markersFor,
      db: clocked,
      reader: admin.db,
      prepare: (s) => applyState(s.state, admin.db),
    },
  };
}

const sent = () => stub.seen.map((s) => JSON.parse(s.body) as Body);

beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  const world = await buildEvalWorld(db, admin.db);
  f = world.f;
  ids = world.ids;
  await createTickingClock(admin);
  // A year no other suite uses: the run's month holds no other usage.
  await clockTo(admin, '2047-03-01T00:00:00Z');
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

describe('Stage 3’s configurations on the wire (ADR 0012 §72)', () => {
  it('Haiku 5.5: every fast call on Haiku at the fast tier’s effort, counted first, recorded at Haiku’s prices', async () => {
    for (let i = 0; i < 12; i++) stub.queue.push(modelLike());
    const plan = planFor({ probeModel: 'haiku55' });
    const run = await executePlan(plan, context());
    const [r] = run.results;
    expect(r!.reasons).toEqual([]);
    expect(r!.outcome).toBe('pass');
    expect(r!.checks).toMatchObject({
      passed: true,
      escalated: false,
      countedFirst: true,
      usInference: true,
      models: MODELS.haiku55.id,
      efforts: 'medium',
    });
    const bodies = sent();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    expect(new Set(bodies.map((b) => b.model))).toEqual(new Set([MODELS.haiku55.id]));
    expect(new Set(bodies.map((b) => b.output_config?.effort))).toEqual(new Set(['medium']));
    expect(stub.counts.length).toBe(bodies.length);
    const rec = await reconcile(clocked, r!.attemptIds);
    expect(rec.mismatched).toBe(0);
    expect(rec.probeModelRows).toBe(bodies.length);
    expect(rec.recordedUsdMicros).toBeGreaterThan(0n);
    expect(rec.recordedUsdMicros).toBeLessThan(rec.reservedUsdMicros);
    // The report names the configuration and holds the summary to Haiku's cost target.
    const report = buildReport({
      plan,
      budgetMicros: BUDGET,
      capNzd: RUN_CAP_NZD,
      run,
      reconciliation: rec,
      startedAt: new Date(0),
      finishedAt: new Date(1),
    });
    const json = JSON.parse(report.json) as {
      plan: { name: string; configuration: unknown };
      evaluation: { summary: { tiers: { targets: { metric: string }[] }[] } };
    };
    expect(json.plan).toMatchObject({
      name: 'stage-3-test',
      configuration: {
        fast: { model: MODELS.haiku55.id, effort: 'medium' },
        escalation: { model: MODELS.opus55.id, effort: 'medium' },
      },
    });
    expect(json.evaluation.summary.tiers[0]!.targets.map((t) => t.metric)).toContain(
      'Mean cost, turn not escalated (Haiku 5.5)',
    );
    expect(report.markdown).toContain(
      `- Configuration: fast calls on ${MODELS.haiku55.id} at \`medium\`; an escalation on ${MODELS.opus55.id} at \`medium\``,
    );
    expect(report.markdown).not.toContain(scenario.turns[0]!.question);
  });

  it('Sonnet 5.5 `low`: every fast call on Sonnet at `low`', async () => {
    for (let i = 0; i < 12; i++) stub.queue.push(modelLike());
    const run = await executePlan(planFor({ effort: 'low' }), context());
    const [r] = run.results;
    expect(r!.reasons).toEqual([]);
    expect(r!.checks).toMatchObject({ models: MODELS.sonnet55.id, efforts: 'low' });
    const bodies = sent();
    expect(new Set(bodies.map((b) => b.model))).toEqual(new Set([MODELS.sonnet55.id]));
    expect(new Set(bodies.map((b) => b.output_config?.effort))).toEqual(new Set(['low']));
  });

  it('a run whose calls are not the configuration fails, never passes: the probe checks the wire, not the plan', async () => {
    for (let i = 0; i < 12; i++) stub.queue.push(modelLike());
    // A gateway that loses the configuration: every call goes out as the tier's own.
    const ctx = context();
    const real = ctx.gateway;
    const lossy = {
      ...real,
      run: (req: ProviderRequest, o: Parameters<typeof real.run>[1]) => real.run(req, o),
    };
    const run = await executePlan(planFor({ probeModel: 'haiku55' }), { ...ctx, gateway: lossy });
    const [r] = run.results;
    expect(new Set(sent().map((b) => b.model))).toEqual(new Set([MODELS.sonnet55.id]));
    expect(r!.checks.passed).toBe(true);
    expect(r!.outcome).toBe('fail');
    expect(r!.reasons).toEqual(['not_configured_model']);
  });

  it('escalation is unchanged: a fast attempt that fails its answers re-runs the turn on Opus 5.5 at `medium`', async () => {
    for (let i = 0; i < 16; i++) stub.queue.push(modelLike(MODELS.haiku55.id));
    const run = await executePlan(planFor({ probeModel: 'haiku55' }), context());
    const [r] = run.results;
    expect(r!.reasons).toEqual([]);
    expect(r!.checks).toMatchObject({ escalated: true, passed: true });
    const bodies = sent();
    const fast = bodies.filter((b) => b.model === MODELS.haiku55.id);
    const deep = bodies.filter((b) => b.model === MODELS.opus55.id);
    expect(fast.length).toBeGreaterThanOrEqual(2);
    expect(deep.length).toBeGreaterThanOrEqual(2);
    expect(fast.length + deep.length).toBe(bodies.length);
    expect(new Set(fast.map((b) => b.output_config?.effort))).toEqual(new Set(['medium']));
    expect(new Set(deep.map((b) => b.output_config?.effort))).toEqual(new Set(['medium']));
    // Every deep call comes after every fast one: the turn re-ran, it never mixed.
    const lastFast = bodies.map((b) => b.model).lastIndexOf(MODELS.haiku55.id);
    const firstDeep = bodies.map((b) => b.model).indexOf(MODELS.opus55.id);
    expect(lastFast).toBeLessThan(firstDeep);
    const rec = await reconcile(clocked, r!.attemptIds);
    expect(rec.mismatched).toBe(0);
    expect(rec.recordedUsdMicros).toBeLessThanOrEqual(1_500_000n);
  });
});
