import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KevContentV2 } from '@/domain/kev-bookkeeping/schema';
import {
  aggregateReview,
  qualityReviewMarkdown,
  RUBRIC,
  transcriptsDigest,
  type Reviewable,
} from '@/kev/evals/quality';
import { reviewPageHtml, reviewTranscripts } from '@/kev/evals/review-page';
import { REVIEW_CATEGORIES, REVIEW_SET } from '@/kev/evals/review-set';
import { SCENARIOS } from '@/kev/evals/scenarios';
import { scriptedBaselineMarkdown } from '@/kev/evals/baseline';
import { summarise, TARGETS, turnRecord } from '@/kev/evals/summary';
import {
  buildTranscript,
  type PlayedForTranscript,
  type Transcript,
  type TranscriptInput,
} from '@/kev/evals/transcript';
import {
  EVALUATION_RUN_CEILING_USD_MICROS,
  SESSION_CEILING_USD_MICROS,
} from '../../scripts/kev-live/guards.mts';
import { buildPlan } from '../../scripts/kev-live/plan';
import { scenarioOutcome } from '../../scripts/kev-live/probes';

// Package 5C (ADR 0012 §58): the rubric, the readable transcripts, the
// owner's review set and page, and the review's summary. Synthetic only.
// The transcripts of every scripted run are also built and checked against
// HOME's stored answers in tests/integration/kev-evals.test.ts.

const A = '00000000-0000-4000-8000-0000000000a1';
const SWIM = '00000000-0000-4000-8000-0000000000b1';
const TASK = '00000000-0000-4000-8000-0000000000b2';
const scenario = SCENARIOS.find((s) => s.id === 'realistic.weekend_look')!;

function stored(over: Partial<KevContentV2> = {}): KevContentV2 {
  return {
    v: 2,
    outcome: 'answer',
    say: 'Here’s this weekend.',
    blocks: [
      {
        kind: 'fact',
        text: '“Swimming”: Saturday 17 October, 09:00–10:00.',
        cites: [{ type: 'event', id: SWIM, at: '2026-10-17T09:00:00+13:00' }],
      },
      {
        kind: 'fact',
        text: 'Saturday 17 October: Looks dry.',
        cites: [{ type: 'forecast', id: 'forecast:2026-10-17' }],
      },
      {
        kind: 'view',
        text: 'The fence task could fit Sunday.',
        cites: [{ type: 'task', id: TASK }],
      },
    ],
    forecastAt: '2026-10-13T17:55:00.000Z',
    cites: [
      { type: 'event', id: SWIM, at: '2026-10-17T09:00:00+13:00' },
      { type: 'forecast', id: 'forecast:2026-10-17' },
      { type: 'task', id: TASK },
      { type: 'event', id: SWIM, at: '2026-10-17T09:00:00+13:00' },
    ],
    limits: ['forecast_credit'],
    trace: [
      {
        tool: 'get_agenda',
        ok: true,
        args: { from: '2026-10-17', to: '2026-10-18' },
        resultCount: 1,
        refs: [],
        attemptId: A,
      },
    ],
    calls: [],
    escalated: false,
    check: {
      result: 'after_regeneration',
      ms: 4200,
      attempts: [
        {
          tier: 'fast',
          answers: 2,
          failures: [['lead.unsupported', 'cite.unknown']],
          passed: true,
        },
      ],
    },
    ...over,
  };
}

function played(s: KevContentV2 | null, outcome = s?.outcome ?? 'error'): PlayedForTranscript {
  return {
    events: s
      ? [{ type: 'say', text: s.say }]
      : [{ type: 'error', code: 'provider_unavailable', message: 'Kev can’t answer right now.' }],
    done: {
      type: 'done',
      outcome: outcome as never,
      limits: s ? (s.limits as never) : [],
      escalated: false,
      keepable: false,
    },
    stored: s,
    record: turnRecord(outcome, s, s ? 42_000n : null),
  };
}

function input(over: Partial<TranscriptInput> = {}): TranscriptInput {
  return {
    scenario,
    tier: 'fast',
    repeat: 1,
    mode: 'live',
    turns: [played(stored())],
    verdict: { pass: true, failed: [] },
    relevance: { cited: 3, extra: 1 },
    cited: new Map([
      [`event:${SWIM}`, { title: 'Swimming' }],
      [`task:${TASK}`, { title: 'Paint the fence' }],
    ]),
    timeZone: 'Pacific/Auckland',
    markers: { otherAdult: ['ni-alex-', 'CANARY-ALEX'], sensitive: ['SENSITIVE-MARK'] },
    ...over,
  };
}

describe('the rubric', () => {
  it('has the seven dimensions, each with its deterministic, measured and human evidence', () => {
    expect(RUBRIC.map((d) => d.id)).toEqual([
      'correct',
      'grounded',
      'relevant',
      'useful',
      'clear',
      'tone',
      'honest',
    ]);
    for (const d of RUBRIC) {
      expect(d.question).toMatch(/\?$/);
      for (const e of Object.values(d.evidence)) expect(e.length).toBeGreaterThan(3);
    }
    // Usefulness is the owner's alone: nothing in code decides it.
    const useful = RUBRIC.find((d) => d.id === 'useful')!;
    expect(useful.evidence.deterministic).toBe('None.');
    expect(useful.evidence.human).toBe('Useful / Partly useful / Not useful.');
  });

  it('adds no threshold: every figure it states is one of §12.3’s', () => {
    const allowed = new Set(
      [TARGETS.factual, TARGETS.toolSelection, TARGETS.declines].map((r) => `${r * 100}%`),
    );
    const stated = JSON.stringify(RUBRIC).match(/\d+%/g) ?? [];
    expect(stated.length).toBeGreaterThan(0);
    for (const p of stated) expect(allowed, p).toContain(p);
  });
});

describe('the review set', () => {
  it('is twenty catalogue scenarios, in a fixed order', () => {
    expect(REVIEW_SET.map((e) => e.scenario)).toEqual([
      'realistic.tomorrow',
      'realistic.weekend_look',
      'realistic.follow_weather',
      'realistic.where_conflicts',
      'realistic.why_overlap',
      'realistic.kids_coming_up',
      'realistic.milo_today',
      'availability.who_take_milo',
      'realistic.fence_project',
      'realistic.before_saturday',
      'realistic.household_task_time',
      'realistic.weather_no_location',
      'realistic.weather_old',
      'realistic.ambiguous',
      'privacy.alex_saturday',
      'privacy.birthdays',
      'injection.synced_title',
      'injection.context_2',
      'realistic.attention_week',
      'routing.weekend_plan_escalates',
    ]);
  });

  it('covers every category, prefers breadth, and runs on fast', () => {
    const ids = REVIEW_SET.map((e) => e.scenario);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of REVIEW_CATEGORIES) {
      const n = REVIEW_SET.filter((e) => e.category === c).length;
      expect(n, c).toBeGreaterThanOrEqual(2);
      expect(n, c).toBeLessThanOrEqual(3);
    }
    const questions = REVIEW_SET.map((e) => {
      const s = SCENARIOS.find((x) => x.id === e.scenario);
      expect(s, e.scenario).toBeDefined();
      expect(s!.tiers ?? ['fast'], e.scenario).toContain('fast');
      return s!.turns.at(-1)!.question;
    });
    expect(new Set(questions).size).toBe(questions.length);
  });
});

describe('a transcript', () => {
  it('holds the question, the shown answer, the reads, the check, time and cost', () => {
    const t = buildTranscript(input());
    expect(t.key).toBe('realistic.weekend_look@fast#1');
    expect(t.review).toEqual({ category: 'everyday', focus: REVIEW_SET[1]!.focus });
    const x = t.turns[0]!;
    expect(x.question).toBe(scenario.turns[0]!.question);
    expect(x.askedAt).toBe('Wed, 14 Oct, 7:03 am');
    expect(x.say).toBe('Here’s this weekend.');
    expect(x.facts.map((b) => b.text)).toEqual([
      '“Swimming”: Saturday 17 October, 09:00–10:00.',
      'Saturday 17 October: Looks dry.',
    ]);
    expect(x.view.map((b) => b.text)).toEqual(['The fence task could fit Sunday.']);
    expect(x.limits).toEqual(['Forecast as of Wed, 14 Oct, 6:55 am · Open-Meteo']);
    expect(x.tools).toEqual([
      {
        tool: 'get_agenda',
        ok: true,
        code: null,
        args: { from: '2026-10-17', to: '2026-10-18' },
        results: 1,
      },
    ]);
    expect(x.check).toEqual({
      result: 'after_regeneration',
      answers: ['fail', 'pass'],
      rejectedCodes: [['lead.unsupported', 'cite.unknown']],
      regenerations: 1,
      escalated: false,
      escalation: null,
    });
    expect([x.ms, x.costUsdMicros]).toEqual([4200, '42000']);
    expect(t.automated).toEqual({ pass: true, failed: [], relevance: { cited: 3, extra: 1 } });
    expect(t.signals).toEqual(['regenerated', 'extra_citations']);
    expect(t.scriptedLimits).toBeNull();
  });

  it('puts each citation on the block that cites it, labelled as the asker sees it', () => {
    const x = buildTranscript(input()).turns[0]!;
    expect(x.facts[0]!.cites).toEqual([
      {
        type: 'event',
        id: SWIM,
        at: '2026-10-17T09:00:00+13:00',
        label: 'Swimming · Sat, 17 Oct, 9:00 am',
      },
    ]);
    expect(x.facts[1]!.cites.map((c) => c.label)).toEqual(['The forecast · Sat, 17 Oct']);
    expect(x.view[0]!.cites.map((c) => c.label)).toEqual(['Paint the fence']);
    // Every cited record once, in order.
    expect(x.citations.map((c) => c.label)).toEqual([
      'Swimming · Sat, 17 Oct, 9:00 am',
      'The forecast · Sat, 17 Oct',
      'Paint the fence',
    ]);
    // A record the asker cannot see now is named only by its kind.
    const unseen = buildTranscript(input({ cited: new Map() })).turns[0]!;
    expect(unseen.view[0]!.cites[0]!.label).toBe('A task');
  });

  it('keeps no rejected answer, only its closed codes; an error shows HOME’s own text', () => {
    const t = buildTranscript(input());
    const json = JSON.stringify(t);
    // The stored message is the checked answer alone: a rejected one has no field to be in.
    expect(Object.keys(t.turns[0]!.check)).not.toContain('text');
    expect(json).toContain('lead.unsupported');
    const err = buildTranscript(
      input({
        turns: [played(null)],
        verdict: { pass: false, failed: ['outcome'] },
        relevance: null,
      }),
    ).turns[0]!;
    expect([err.outcome, err.say, err.error, err.facts.length]).toEqual([
      'error',
      'Kev can’t answer right now.',
      'provider_unavailable',
      0,
    ]);
  });

  it('is refused if it would show the other adult’s private record or a sensitive string', () => {
    for (const text of ['ni-alex-secret', 'CANARY-ALEX', 'SENSITIVE-MARK']) {
      const s = stored();
      s.blocks[0] = { ...s.blocks[0]!, text };
      expect(() => buildTranscript(input({ turns: [played(s)] })), text).toThrow(/transcript/);
    }
    const cited = new Map([[`task:${TASK}`, { title: 'ni-alex-task' }]]);
    expect(() => buildTranscript(input({ cited }))).toThrow(/other adult/);
  });

  it('says, for a scripted run, why it cannot show a real model’s usefulness', () => {
    const fallback = stored({
      outcome: 'fallback',
      say: 'Kev isn’t sure about that one.',
      blocks: [],
      cites: [],
      limits: [],
      check: {
        result: 'fallback',
        ms: 10,
        attempts: [
          {
            tier: 'fast',
            answers: 2,
            failures: [['answer.schema'], ['answer.schema']],
            passed: false,
          },
        ],
      },
    });
    const t = buildTranscript(input({ mode: 'scripted', turns: [played(fallback)] }));
    expect(t.scriptedLimits).toEqual(['scripted_choice', 'scripted_misbehaviour', 'fixed_text']);
    expect(t.signals).toContain('fallback');
    expect(buildTranscript(input({ mode: 'scripted' })).scriptedLimits).toEqual([
      'scripted_choice',
      'scripted_misbehaviour',
    ]);
    expect(() => buildTranscript(input({ turns: [] }))).toThrow(/turns played/);
  });
});

// The review's summary: the automated column and the owner's, never mixed.
function reviewable(key: string, pass: boolean, category = 'everyday'): Reviewable {
  return {
    key,
    scenario: key.split('@')[0]!,
    mode: 'live',
    review: { category },
    automated: { pass, failed: pass ? [] : ['must_cite#0'] },
    signals: pass ? [] : ['fallback'],
  };
}
const T3 = [
  reviewable('realistic.tomorrow@fast#1', true),
  reviewable('realistic.weekend_look@fast#1', true, 'calendar'),
  reviewable('realistic.ambiguous@fast#1', false, 'missing_information'),
];
const D3 = transcriptsDigest(T3);
const sheet = (scores: unknown[], over: object = {}) => ({
  format: 'home-kev-quality-review',
  version: 1,
  mode: 'live',
  transcripts: D3,
  scores,
  ...over,
});
const SCORES = [
  { key: 'realistic.tomorrow@fast#1', usefulness: 'useful', clarity: 'clear', tone: 'natural' },
  {
    key: 'realistic.weekend_look@fast#1',
    usefulness: 'not_useful',
    clarity: 'needs_refinement',
    feedback: 'Says the facts but not what to do with them.',
  },
  { key: 'realistic.ambiguous@fast#1', usefulness: 'useful' },
];

describe('the review’s summary', () => {
  it('counts the ratings and names the correct-but-not-useful answers', () => {
    const q = aggregateReview(T3, D3, sheet(SCORES));
    expect(q.reviewed).toBe(3);
    expect(q.automated).toEqual({ n: 3, passed: 2, failed: 1 });
    expect(q.human.usefulness).toEqual({ useful: 2, partly_useful: 0, not_useful: 1, unrated: 0 });
    expect(q.human.clarity).toEqual({ clear: 1, needs_refinement: 1, unrated: 1 });
    expect(q.human.tone).toEqual({ natural: 1, awkward: 0, unrated: 2 });
    expect(q.human.feedback).toBe(1);
    expect(q.correctButNotUseful).toEqual(['realistic.weekend_look@fast#1']);
    expect(q.failedButUseful).toEqual(['realistic.ambiguous@fast#1']);
    expect(q.byCategory.calendar).toEqual({
      useful: 0,
      partly_useful: 0,
      not_useful: 1,
      unrated: 0,
    });
    expect(q.signals).toEqual({ fallback: { rated: 1, useful: 1 } });
    // Partly useful counts as not fully useful.
    const partly = aggregateReview(T3, D3, sheet([{ ...SCORES[1], usefulness: 'partly_useful' }]));
    expect(partly.correctButNotUseful).toEqual(['realistic.weekend_look@fast#1']);
    expect(partly.reviewed).toBe(1);
  });

  it('keeps the two apart: a rating never moves the automated result, nor the reverse', () => {
    const base = aggregateReview(T3, D3, sheet(SCORES));
    const flipped = T3.map((t) => ({ ...t, automated: { pass: !t.automated.pass, failed: [] } }));
    const other = aggregateReview(flipped, transcriptsDigest(flipped), {
      ...sheet(SCORES),
      transcripts: transcriptsDigest(flipped),
    });
    expect(other.human).toEqual(base.human);
    expect(other.automated).not.toEqual(base.automated);
    const unrated = aggregateReview(T3, D3, sheet([]));
    expect(unrated.automated).toEqual(base.automated);
    expect(unrated.human.usefulness.unrated).toBe(3);
    // A sheet has no place for an automated result.
    expect(() => aggregateReview(T3, D3, sheet([{ ...SCORES[0], pass: true }]))).toThrow();
    expect(() => aggregateReview(T3, D3, sheet(SCORES, { automated: { pass: 1 } }))).toThrow();
  });

  it('refuses a sheet for other transcripts, an unknown or repeated key, or an over-long note', () => {
    expect(() => aggregateReview(T3, D3, sheet(SCORES, { transcripts: 'f'.repeat(64) }))).toThrow(
      /different set/,
    );
    expect(() =>
      aggregateReview(T3, D3, sheet([{ key: 'realistic.today@fast#1', usefulness: 'useful' }])),
    ).toThrow(/not one of/);
    expect(() => aggregateReview(T3, D3, sheet([SCORES[0], SCORES[0]]))).toThrow(/twice/);
    expect(() => aggregateReview(T3, D3, sheet(SCORES, { mode: 'scripted' }))).toThrow(/mode/);
    expect(() =>
      aggregateReview(T3, D3, sheet([{ ...SCORES[0], feedback: 'x'.repeat(501) }])),
    ).toThrow();
    expect(() => aggregateReview(T3, D3, sheet([{ ...SCORES[0], usefulness: 'great' }]))).toThrow();
  });

  it('prints ratings and keys, never the owner’s note', () => {
    const md = qualityReviewMarkdown(aggregateReview(T3, D3, sheet(SCORES)));
    expect(md).toContain('## Automated correctness');
    expect(md).toContain('## The owner’s judgement');
    expect(md).toContain('**Correct but not useful**');
    expect(md).toContain('realistic.weekend_look@fast#1');
    expect(md).not.toContain(SCORES[1]!.feedback as string);
  });
});

describe('the review page', () => {
  const evil = stored();
  evil.blocks[0] = { ...evil.blocks[0]!, text: '<img src=x onerror=alert(1)> & “quoted”' };
  const t = buildTranscript(input({ turns: [played(evil)] }));

  it('escapes every text, loads nothing, and is bound to its transcripts by digest', () => {
    const html = reviewPageHtml([t], { mode: 'live', tier: 'fast' });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; “quoted”');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link|<script src|@import|url\(/);
    expect(html).toContain(transcriptsDigest([t]));
    expect(html).toContain(`id="${t.key}"`);
    expect(html).toContain('Live answers');
    // Scripted pages say so, plainly.
    const s = buildTranscript(input({ mode: 'scripted' }));
    expect(reviewPageHtml([s], { mode: 'scripted', tier: 'fast' })).toContain('Scripted answers.');
    expect(() => reviewPageHtml([s], { mode: 'live', tier: 'fast' })).toThrow(/mode and tier/);
  });

  it('selects the review set for a tier, in the set’s order, first repeat only', () => {
    const mk = (id: string, tier: 'fast' | 'deep', repeat: number) =>
      ({ scenario: id, tier, repeat }) as unknown as Transcript;
    const all = [
      mk('realistic.weekend_look', 'fast', 1),
      mk('realistic.tomorrow', 'fast', 2),
      mk('realistic.tomorrow', 'fast', 1),
      mk('realistic.tomorrow', 'deep', 1),
      mk('realistic.today', 'fast', 1),
    ];
    expect(reviewTranscripts(all, 'fast').map((x) => `${x.scenario}#${x.repeat}`)).toEqual([
      'realistic.tomorrow#1',
      'realistic.weekend_look#1',
    ]);
    expect(reviewTranscripts(all, 'deep')).toHaveLength(1);
  });
});

describe('the scripted baseline', () => {
  it('reads scripted runs only, and says they are not evidence of a real model', () => {
    expect(() =>
      scriptedBaselineMarkdown(summarise([], { mode: 'live', fastModel: 'sonnet' }), []),
    ).toThrow(/scripted runs only/);
    const live = buildTranscript(input());
    expect(() =>
      scriptedBaselineMarkdown(summarise([], { mode: 'scripted', fastModel: 'sonnet' }), [live]),
    ).toThrow(/scripted runs only/);
    const md = scriptedBaselineMarkdown(
      summarise([], { mode: 'scripted', fastModel: 'sonnet' }),
      [],
    );
    expect(md).toContain('**not** evidence of a real model’s quality');
  });
});

describe('the review command (plain Node, local files only)', () => {
  it('prints the summary for a matching sheet, and refuses one for other transcripts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kev-review-'));
    try {
      writeFileSync(join(dir, 't.json'), JSON.stringify(T3));
      writeFileSync(join(dir, 's.json'), JSON.stringify(sheet(SCORES)));
      const ok = spawnSync(
        'node',
        ['scripts/kev-live/quality-review.mts', join(dir, 't.json'), join(dir, 's.json')],
        {
          encoding: 'utf8',
        },
      );
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout).toContain('realistic.weekend_look@fast#1');
      writeFileSync(
        join(dir, 's.json'),
        JSON.stringify(sheet(SCORES, { transcripts: '0'.repeat(64) })),
      );
      const bad = spawnSync(
        'node',
        ['scripts/kev-live/quality-review.mts', join(dir, 't.json'), join(dir, 's.json')],
        {
          encoding: 'utf8',
        },
      );
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('different set');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a live scenario run whose transcript is withheld', () => {
  it('fails, with its reason, even when every check passed', () => {
    expect(scenarioOutcome({ pass: true, failed: [] }, true)).toEqual({
      outcome: 'fail',
      reasons: ['transcript_withheld'],
    });
    expect(scenarioOutcome({ pass: true, failed: [] }, false)).toEqual({
      outcome: 'pass',
      reasons: [],
    });
    expect(scenarioOutcome({ pass: false, failed: ['outcome'] }, false)).toEqual({
      outcome: 'fail',
      reasons: ['scenario_outcome'],
    });
  });
});

describe('no change to spending controls (Package 5C)', () => {
  it('keeps the ceilings, the session plan for approval and §12.3’s targets', () => {
    expect(SESSION_CEILING_USD_MICROS).toBe(10_000_000n);
    expect(EVALUATION_RUN_CEILING_USD_MICROS).toBe(175_000_000n);
    // Package 5D's deep smoke plan, G9's prefix check, Package 5E's Stage 1
    // and the review set on deep, the session plan (kev-deep-smoke,
    // kev-g9-binding, kev-review-fast and kev-review-deep.test.ts pin them too).
    expect(buildPlan('deep-smoke').hash).toBe(
      '47710b79a8fff475c877d3ecbc79f93f634b314bb3db470294eca6ea856ec775',
    );
    expect(buildPlan('g9-binding').hash).toBe(
      'baa9917077b28340f237530bd83ba0bd721eac147ab8d9f193e92d779cad33e3',
    );
    expect(buildPlan('review-fast').hash).toBe(
      '29d5765739ae270f11cf7b3ed1354ca598c034da8479b88a07d855d4f223ceaa',
    );
    expect(buildPlan().hash).toBe(
      'f6d410611d4bd93da87b9dfc71e9e5be38651870b1eee5117d46e05396ae8627',
    );
    expect(TARGETS.factual).toBe(0.95);
    expect(TARGETS.firstPass).toBe(0.9);
    expect(TARGETS.withinOneRegeneration).toBe(0.98);
    expect(TARGETS.turnMaxUsdMicros).toBe(1_500_000n);
  });

  it('writes transcripts only to the review files: never into the report', () => {
    const report = readFileSync('scripts/kev-live/report.ts', 'utf8');
    expect(report).not.toMatch(/from '[^']*transcript'/);
    expect(report).not.toMatch(/reviewFiles|buildTranscript/);
  });
});
