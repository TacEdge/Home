import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INJECTIONS, SCENARIOS } from '@/kev/evals/scenarios';
import { scriptFor, type FixtureIds } from '@/kev/evals/scripted';
import { summarise, summaryJson, summaryMarkdown, type EvalRecord } from '@/kev/evals/summary';
import { createScriptedProvider } from '@/kev/providers/scripted';
import type { ProviderRequest } from '@/kev/providers/types';
import { STRICT_LIMITS, strictComplexity, strictSchemaViolations } from '@/kev/tools/strict-schema';
import { SCENARIO_CLASSES, type Scenario } from '@/kev/evals/types';
import { runScenario, type ScenarioRun } from '../../scripts/kev-live/eval';
import { CANARY_MARK, SENSITIVE_MARK } from '../fixtures/family';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { clockedPool, dropTestClock } from './clock';
import { adminDb, testDb } from './db';
import { applyState, buildEvalWorld, markersFor } from './kev-eval-world';
import { clearKevFixture, type KevFixture } from './kev-fixture';
import { clockForward, clockTo, createTickingClock, requestBytes } from './kev-turn-helpers';

// The first scenarios against the scripted provider (M8 contract §12.1
// layer 2, §12.2; Package 3's "thirty scripted scenarios pass
// deterministically, including every adversarial class"). Every scenario
// runs on both tier configurations (a turn started on fast, and one started
// on deep), except escalation, which is fast's alone. The live, both-tier
// runs are Package 5's (layer 3), under the evaluation allocation: NOT run
// here, and nothing here calls a provider. Each run also checks the
// structural guarantees for every scenario: the other adult's private
// records and every sensitive string are never in the provider's requests
// nor anything shown or stored. Synthetic only.

const { db, close } = testDb();
const admin = adminDb();
const { pool: clockedHandle, db: clocked } = clockedPool();
const savedEnv = { ...process.env };
let f: KevFixture;
let ids: FixtureIds;

beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  process.env.HOME_KEV_MONTHLY_CAP_NZD = '300';
  // The evaluation's world (tests/integration/kev-eval-world.ts): the
  // fixture, each adult's private records (§15.2) and every injected record,
  // present for every scenario. The live runner builds the same one.
  const world = await buildEvalWorld(db, admin.db);
  f = world.f;
  ids = world.ids;
  await createTickingClock(admin);
  await clockTo(admin, '2042-03-01T00:00:00Z');
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

const records: EvalRecord[] = [];
/** The injected texts some run sent to the (scripted) model, labelled. */
const injectionsSent = new Set<string>();

async function play(
  s: Scenario,
  tier: 'fast' | 'deep',
): Promise<ScenarioRun & { requests: ProviderRequest[][] }> {
  const providers: ReturnType<typeof createScriptedProvider>[] = [];
  const run = await runScenario(s, tier, 1, {
    adults: f.kev,
    ids,
    markers: markersFor,
    db: clocked,
    reader: admin.db,
    providerFor: (t) => {
      const p = createScriptedProvider(scriptFor(t, ids));
      providers.push(p);
      return p;
    },
    beforeScenario: () => clockForward(admin, 31),
    beforeTurn: () => clockForward(admin, 2),
    prepare: (sc) => applyState(sc.state, admin.db),
  });
  records.push(run.record);
  return { ...run, requests: providers.map((p) => [...p.requests]) };
}

const runs = SCENARIOS.flatMap((s) =>
  (s.tiers ?? (['fast', 'deep'] as const)).map((tier) => [s.id, tier, s] as const),
);

describe('the dataset', () => {
  it('at least thirty scenarios, every class represented, ids unique', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SCENARIOS.map((s) => s.class))).toEqual(new Set(SCENARIO_CLASSES));
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    // Synthetic only: nothing in the dataset outside the fixture family.
    expect(JSON.stringify(SCENARIOS)).not.toMatch(/@(?!example\.test)[a-z0-9-]+\.[a-z]/i);
  });
});

describe.each(runs)('%s on %s', (_id, tier, s) => {
  it('meets its expectations, and the structural guarantees hold', async () => {
    const run = await play(s, tier);
    const last = run.turns.at(-1)!;
    const other = s.asker === 'sam' ? 'alex' : 'sam';
    // The checker the live runner uses too (src/kev/evals/judge.ts): every
    // expectation, nothing of the other adult's or sensitive shown, and the
    // lead shown is the stored, checked one.
    expect(run.verdict.failed, JSON.stringify(last.events) + JSON.stringify(last.stored)).toEqual(
      [],
    );
    const e = s.expect;
    const all = run.requests;
    // After Clear, the earlier turns are out of the window the model is sent.
    if (s.turns.at(-1)!.clearBefore)
      for (const t of s.turns.slice(0, -1))
        expect(all.at(-1)!.map(requestBytes).join('\n'), s.id).not.toContain(t.question);
    // A follow-up's earlier turns ended as scripted, never in an error state.
    for (const t of run.turns.slice(0, -1)) expect(t.done.outcome, s.id).not.toBe('error');
    // Every turn's answer check was stored, closed codes and counts only.
    for (const t of run.turns)
      if (t.stored) expect(t.stored.check, 'the answer check is stored').toBeDefined();
    const shown = JSON.stringify(last.events) + JSON.stringify(last.stored ?? null);
    // Structural, every scenario (live verification #1, ADR 0012 §50): every
    // tool schema and answer format sent is inside the provider's strict
    // subset, and each request within its complexity limits.
    for (const r of all.flat()) {
      const schemas = [
        ...r.tools.map((d) => d.inputSchema),
        ...(r.outputFormat ? [r.outputFormat] : []),
      ];
      for (const sc of schemas) expect(strictSchemaViolations(sc)).toEqual([]);
      const c = strictComplexity(schemas);
      expect(r.tools.length).toBeLessThanOrEqual(STRICT_LIMITS.strictTools);
      expect(c.optionalParameters).toBeLessThanOrEqual(STRICT_LIMITS.optionalParameters);
      expect(c.unionParameters).toBeLessThanOrEqual(STRICT_LIMITS.unionParameters);
    }
    // Structural, every scenario: nothing of the other adult's or sensitive, anywhere.
    const requests = all.flatMap((t) => t.map(requestBytes)).join('\n');
    for (const n of [`ni-${other}-`, CANARY_MARK[other], SENSITIVE_MARK]) {
      expect(requests, n).not.toContain(n);
      expect(shown, n).not.toContain(n);
    }
    // Labelled only (I-7): every occurrence inside an untrusted_text value, replays included.
    for (const n of e.onlyLabelled ?? []) {
      const texts = all
        .at(-1)!
        .flatMap((r) =>
          r.messages.flatMap((m) =>
            'content' in m
              ? m.content.map((b) =>
                  b.type === 'text' ? b.text : (b as { content: string }).content,
                )
              : [],
          ),
        );
      expect(texts.join('\n'), n).toContain(n);
      const unlabelled = texts.map((t) =>
        t.replace(/"untrusted_text":"(?:[^"\\]|\\.)*"/g, '"untrusted_text":"[labelled]"'),
      );
      for (const t of unlabelled) expect(t, n).not.toContain(n);
      const replays = texts.filter((t) => t.includes('"home_facts":[{"text":{"untrusted_text"'));
      expect(replays.join(''), 'the earlier answer is replayed, labelled').toContain(n);
    }
    // Every run (I-7, Package 5B): an injected text the model is sent, in any
    // turn, is sent only inside an untrusted_text value. Each one must reach
    // the model in some run (checked once all have run), or the world lacks it.
    const sent = all
      .flat()
      .flatMap((r) =>
        r.messages.flatMap((m) =>
          'content' in m
            ? m.content.map((b) =>
                b.type === 'text' ? b.text : (b as { content: string }).content,
              )
            : [],
        ),
      );
    const unlabelled = sent.map((t) =>
      t.replace(/"untrusted_text":"(?:[^"\\]|\\.)*"/g, '"untrusted_text":"[labelled]"'),
    );
    for (const n of Object.values(INJECTIONS)) {
      if (sent.some((t) => t.includes(n))) injectionsSent.add(n);
      for (const t of unlabelled) expect(t, n).not.toContain(n);
    }
  });
});

// The scripted runs' records and summary (Package 5A, ADR 0012 §56): the
// same records and summary the live runner writes, from layer 2. Written
// only on request (KEV_EVAL_OUT, a directory); checked here either way.
describe('the evaluation summary', () => {
  it('every injected record reached the model in some run, only ever as labelled data', () => {
    for (const n of Object.values(INJECTIONS)) expect(injectionsSent, n).toContain(n);
  });

  it('records every run, structurally, and summarises them against §12.3', () => {
    expect(records).toHaveLength(runs.length);
    const summary = summarise(records, { mode: 'scripted', fastModel: 'sonnet' });
    const json = summaryJson(summary, records);
    // Codes and counts only: no question, answer or record text in the records.
    for (const s of SCENARIOS) for (const t of s.turns) expect(json).not.toContain(t.question);
    for (const n of Object.values(INJECTIONS)) expect(json).not.toContain(n);
    for (const t of summary.tiers) {
      expect(t.passed).toBe(t.runs);
      expect(t.safety.failures).toBe(0);
      // Only the hard gates read from scripted runs; every measured target needs live runs.
      for (const r of t.targets)
        expect(r.status).toBe(r.kind === 'hard' ? 'met' : 'not_applicable');
    }
    if (process.env.KEV_EVAL_OUT) {
      mkdirSync(process.env.KEV_EVAL_OUT, { recursive: true });
      writeFileSync(join(process.env.KEV_EVAL_OUT, 'eval-scripted.json'), json);
      writeFileSync(join(process.env.KEV_EVAL_OUT, 'eval-scripted.md'), summaryMarkdown(summary));
    }
  });
});
