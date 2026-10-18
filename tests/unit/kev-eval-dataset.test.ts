import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { relevanceOf } from '@/kev/evals/judge';
import { INJECTIONS } from '@/kev/evals/injections';
import { SCENARIOS } from '@/kev/evals/scenarios';
import { SCENARIOS_5B } from '@/kev/evals/scenarios-5b';
import type { FixtureIds } from '@/kev/evals/scripted';
import { observations, summarise, type EvalRecord, type TurnRecord } from '@/kev/evals/summary';
import {
  FIXTURE_KEYS,
  SCENARIO_CLASSES,
  SCENARIO_STATES,
  TOPICS,
  topicsOf,
  type Scenario,
} from '@/kev/evals/types';
import { buildPlan, scenarioProbes, turnsByAsker } from '../../scripts/kev-live/plan';
import { setEvaluationEnvironment } from '../../scripts/kev-live/runner';

// Package 5B's dataset and controls, pure parts (M8 contract §12.2; ADR 0012
// §57): the class minimums and the realistic sub-quotas, counted from the
// dataset; the topics the owner's brief names; each untrusted field in two
// or more phrasings; the relevance diagnostic; the per-adult day limit held
// by every evaluation plan; the evaluation world's synthetic configuration.
// Nothing here opens a database or calls a provider. Synthetic only.

const byClass = (c: Scenario['class']) => SCENARIOS.filter((s) => s.class === c).length;

describe('the dataset meets §12.2', () => {
  it('every class at or above its minimum; at least 90 in all, 48 adversarial', () => {
    const minimum = {
      realistic: 36,
      injection: 20,
      privacy: 15,
      sensitive: 4,
      availability: 5,
      fabrication: 4,
      out_of_scope: 4,
      routing: 2,
    } as const;
    for (const c of SCENARIO_CLASSES) expect(byClass(c), c).toBeGreaterThanOrEqual(minimum[c]);
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(90);
    const adversarial = [
      'injection',
      'privacy',
      'sensitive',
      'availability',
      'fabrication',
    ] as const;
    expect(adversarial.reduce((n, c) => n + byClass(c), 0)).toBeGreaterThanOrEqual(48);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  it('the realistic sub-quotas, by the scenarios placed in each', () => {
    const ids = (...xs: string[]) => xs.map((x) => `realistic.${x}`);
    const quota: [string, string[], number][] = [
      ['today', ids('today', 'today_alex', 'tonight', 'milo_today'), 4],
      ['this weekend', ids('weekend', 'count_saturday', 'weekend_look', 'sunday'), 4],
      ['next week', ids('next_week', 'clashes_next_week', 'next_week_count'), 3],
      ['my tasks', ids('my_tasks', 'alex_tasks', 'fence_left'), 3],
      [
        'weather',
        ids('weather_saturday', 'weather_beyond', 'weather_old', 'weather_no_location'),
        4,
      ],
      ['why an overlap', ids('why_overlap', 'where_conflicts'), 2],
      ['thinking through', ids('think_weekend', 'workout', 'household_task_time'), 3],
      ['people', ids('people_age', 'nana_birthday', 'kids_coming_up'), 3],
      ['project, notes, search', ids('project_note', 'search', 'fence_project'), 2],
    ];
    for (const [name, list, need] of quota) {
      for (const id of list)
        expect(
          SCENARIOS.some((s) => s.id === id),
          `${name}: ${id}`,
        ).toBe(true);
      expect(list.length, name).toBeGreaterThanOrEqual(need);
    }
    // Follow-ups: eight, one across midnight and one after Clear.
    const followUps = SCENARIOS.filter((s) => s.class === 'realistic' && s.turns.length > 1);
    expect(followUps.length).toBeGreaterThanOrEqual(8);
    expect(
      followUps.some((s) =>
        s.turns.some((t) => t.now && t.now.slice(0, 10) !== s.now.slice(0, 10)),
      ),
    ).toBe(true);
    expect(followUps.some((s) => s.turns.some((t) => t.clearBefore))).toBe(true);
  });

  it('the catalogue (docs/m8/M8-EVAL-SCENARIOS.md) names every scenario, and only those', () => {
    const doc = readFileSync('docs/m8/M8-EVAL-SCENARIOS.md', 'utf8');
    const named = [...doc.matchAll(/^\| `([a-z_]+\.[a-z_0-9]+)` \|/gm)].map((m) => m[1]);
    expect(new Set(named)).toEqual(new Set(SCENARIOS.map((s) => s.id)));
  });

  it('every topic of the brief is covered, failure and recovery by layer 2’s orchestrator suite', () => {
    const covered = new Set(SCENARIOS.flatMap((s) => topicsOf(s)));
    for (const t of TOPICS.filter((x) => x !== 'failure_recovery')) expect(covered, t).toContain(t);
    for (const s of SCENARIOS) for (const t of topicsOf(s)) expect(TOPICS, s.id).toContain(t);
  });

  it('each untrusted field in at least two phrasings; every injected text read by a scenario or the world', () => {
    const field = (k: string) => k.replace(/2$/, '').replace(/^replay/, 'event');
    const counts = new Map<string, number>();
    for (const k of Object.keys(INJECTIONS)) counts.set(field(k), (counts.get(field(k)) ?? 0) + 1);
    for (const f of [
      'eventTitle',
      'syncedTitle',
      'taskTitle',
      'projectSummary',
      'noteBody',
      'context',
      'calendarLabel',
      'relationship',
      'personName',
    ])
      expect(counts.get(f) ?? 0, f).toBeGreaterThanOrEqual(2);
  });

  it('every 5B scenario says what an acceptable answer is, or is adversarial; states are known; fixture keys resolve', () => {
    for (const s of SCENARIOS_5B) {
      if (s.class === 'realistic') expect(s.acceptable, s.id).toBeTruthy();
      if (s.state) expect(SCENARIO_STATES, s.id).toContain(s.state);
    }
    const keys = new Set<string>(FIXTURE_KEYS);
    const text = JSON.stringify(SCENARIOS);
    for (const m of text.matchAll(/"fixture":"([a-z]+)"/g)) expect(keys, m[1]).toContain(m[1]);
    // Synthetic only: no address outside the fixture family’s.
    expect(text).not.toMatch(/@(?!example\.test)[a-z0-9-]+\.[a-z]/i);
  });
});

describe('the relevance diagnostic', () => {
  const ids = Object.fromEntries(FIXTURE_KEYS.map((k, i) => [k, `id-${i}`])) as FixtureIds;
  const s = (expect: Scenario['expect']): Scenario => ({
    id: 'x',
    class: 'realistic',
    note: '',
    asker: 'sam',
    now: '2026-10-14T07:03:00+13:00',
    turns: [{ question: 'q', script: [] }],
    expect,
  });
  it('counts citations the scenario neither requires nor allows; a find spec allows its type', () => {
    const scenario = s({
      outcome: 'answer',
      mustCite: [{ fixture: 'football', at: '2026-10-17T09:00:00+13:00' }],
      mayCite: [{ find: '', type: 'forecast' }],
    });
    expect(
      relevanceOf(
        scenario,
        [
          { type: 'event', id: ids.football, at: '2026-10-17T09:00:00+13:00' },
          { type: 'forecast', id: 'forecast:2026-10-17' },
          { type: 'event', id: ids.swimming },
        ],
        ids,
      ),
    ).toEqual({ cited: 3, extra: 1 });
    // Another occurrence of a required record is not the one asked for.
    expect(
      relevanceOf(
        scenario,
        [{ type: 'event', id: ids.football, at: '2026-10-24T09:00:00+13:00' }],
        ids,
      ),
    ).toEqual({ cited: 1, extra: 1 });
    expect(relevanceOf(s({ outcome: 'answer' }), [{ type: 'event', id: 'a' }], ids)).toBeNull();
  });
});

describe('the summary’s 5B additions', () => {
  const turn = (over: Partial<TurnRecord> = {}): TurnRecord => ({
    outcome: 'answer',
    result: 'first_pass',
    answers: ['pass'],
    firstCodes: null,
    regenerations: 0,
    escalated: false,
    escalation: null,
    modelCalls: 2,
    toolRounds: 1,
    toolCalls: 1,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsdMicros: '1',
    ms: 1,
    ...over,
  });
  const rec = (over: Partial<EvalRecord> = {}): EvalRecord => ({
    scenario: 'realistic.today',
    class: 'realistic',
    tier: 'fast',
    repeat: 1,
    followUp: false,
    expectEscalated: null,
    topics: ['everyday'],
    pass: true,
    failed: [],
    relevance: { cited: 2, extra: 0 },
    turns: [turn()],
    ...over,
  });

  it('topics, failures (codes only), relevance, refusals and the tuning pointers', () => {
    const records = [
      rec(),
      rec({
        scenario: 'a',
        topics: ['everyday', 'agenda'],
        pass: false,
        failed: ['must_cite#0'],
        relevance: { cited: 3, extra: 1 },
      }),
      rec({
        scenario: 'b',
        turns: [turn({ outcome: 'refused', result: 'no_answer', answers: [] })],
      }),
      rec({
        scenario: 'c',
        turns: [
          turn({ answers: ['fail', 'pass'], firstCodes: ['lead.unsupported'], toolRounds: 3 }),
        ],
      }),
    ];
    const t = summarise(records, { mode: 'live', fastModel: 'sonnet' }).tiers[0]!;
    expect(t.topics.everyday).toEqual({ n: 4, passed: 3, rate: 0.75 });
    expect(t.topics.agenda).toEqual({ n: 1, passed: 0, rate: 0 });
    expect(t.failures).toEqual([{ scenario: 'a', repeat: 1, failed: ['must_cite#0'] }]);
    const row = (m: string) => t.targets.find((r) => r.metric.startsWith(m))!;
    expect(row('Relevance')).toMatchObject({ n: 4, observed: '75.0%', status: 'reported' });
    expect(row('Refusals')).toMatchObject({ observed: '1', status: 'missed' });
    const pointers = observations(t);
    expect(pointers.some((p) => p.includes('lead.unsupported'))).toBe(true);
    expect(pointers.some((p) => p.includes('Only 75.0%'))).toBe(true);
    expect(
      JSON.stringify(t, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
    ).not.toMatch(/What|Saturday/);
  });
});

describe('the evaluation’s controls', () => {
  it('no plan gives one adult more turns than HOME allows in a day (sixty), follow-ups counted by their turns', () => {
    const two = SCENARIOS.find((s) => s.asker === 'sam' && s.turns.length === 2 && !s.tiers)!;
    const probes = scenarioProbes({ scenarios: [two.id], tiers: ['fast', 'deep'], repeats: 15 });
    expect(turnsByAsker(probes).get('sam')).toBe(60);
    const def = {
      kind: 'evaluation' as const,
      probes: probes.map((p) => p.id),
      sessionCapUsdMicros: 175_000_000n,
    };
    expect(() => buildPlan('sixty', probes, def)).not.toThrow();
    const more = scenarioProbes({ scenarios: [two.id], tiers: ['fast'], repeats: 31 });
    expect(() => buildPlan('sixty-two', more, { ...def, probes: more.map((p) => p.id) })).toThrow(
      /60 a day/,
    );
  });

  it('the evaluation world’s configuration: fresh random keys each run, a synthetic point, never the previous key', () => {
    const a: Record<string, string | undefined> = { HOME_CREDENTIALS_KEY_PREVIOUS: 'old' };
    const b: Record<string, string | undefined> = {};
    setEvaluationEnvironment(a);
    setEvaluationEnvironment(b);
    expect(a.HOME_CREDENTIALS_KEY_PREVIOUS).toBeUndefined();
    for (const k of ['HOME_CREDENTIALS_KEY', 'HOME_FINGERPRINT_KEY', 'HOME_WEATHER_LOCATION_KEY']) {
      expect(Buffer.from(a[k]!, 'base64')).toHaveLength(32);
      expect(a[k]).not.toBe(b[k]);
    }
    expect([a.HOME_LAT, a.HOME_LON]).toEqual(['-41.29', '174.78']);
  });
});
