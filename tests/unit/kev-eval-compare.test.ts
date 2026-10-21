import { describe, expect, it } from 'vitest';
import { compareRuns, comparisonMarkdown, type ComparedRun } from '@/kev/evals/compare';
import { aggregateReview, transcriptsDigest, type Reviewable } from '@/kev/evals/quality';
import { summarise, type EvalRecord, type TurnRecord } from '@/kev/evals/summary';

// The model comparison (Package 5E's Stage 3, ADR 0012 §72): live runs side
// by side, each column the existing summary of its own judge records, the
// owner's review beside it. Synthetic records only (codes and counts).

const turnOf = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  outcome: 'answer',
  result: 'first_pass',
  answers: ['pass'],
  firstCodes: null,
  regenerations: 0,
  escalated: false,
  escalation: null,
  modelCalls: 2,
  toolRounds: 1,
  toolCalls: 2,
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsdMicros: '50000',
  ms: 4000,
  ...over,
});
const rec = (over: Partial<EvalRecord> = {}, turns: TurnRecord[] = [turnOf()]): EvalRecord => ({
  scenario: 'realistic.tomorrow',
  class: 'realistic',
  tier: 'fast',
  repeat: 1,
  followUp: false,
  expectEscalated: null,
  pass: true,
  failed: [],
  turns,
  ...over,
});

// A Sonnet `medium` baseline: four runs, one failed on a citation, one escalated.
const medium = [
  rec(),
  rec({ scenario: 'realistic.fence_project', pass: false, failed: ['must_cite#0'] }, [
    turnOf({ answers: ['fail', 'pass'], regenerations: 1, ms: 8000, costUsdMicros: '90000' }),
  ]),
  rec({ scenario: 'privacy.birthdays', class: 'privacy' }),
  rec({ scenario: 'injection.synced_title', class: 'injection' }, [
    turnOf({ escalated: true, ms: 30_000, costUsdMicros: '330000' }),
  ]),
];
// A Haiku run: cheaper, one privacy failure, one more escalation.
const haiku = [
  rec({}, [turnOf({ costUsdMicros: '5000', ms: 2000 })]),
  rec({ scenario: 'realistic.fence_project' }, [turnOf({ costUsdMicros: '6000', ms: 2500 })]),
  rec({ scenario: 'privacy.birthdays', class: 'privacy', pass: false, failed: ['private_shown'] }, [
    turnOf({ costUsdMicros: '5000', ms: 2000 }),
  ]),
  rec({ scenario: 'injection.synced_title', class: 'injection' }, [
    turnOf({ escalated: true, ms: 28_000, costUsdMicros: '300000' }),
  ]),
];
type RunOver = {
  label?: string;
  fastModel?: 'sonnet' | 'haiku';
  mode?: 'scripted' | 'live';
  records?: EvalRecord[];
  review?: ComparedRun['review'];
};
/** A run as the comparison script builds it: its records summarised with its fast model. */
const run = (over: RunOver = {}): ComparedRun => {
  const records = over.records ?? medium;
  return {
    label: over.label ?? 'Sonnet 5.5 medium (run #8)',
    summary: summarise(records, {
      mode: over.mode ?? 'live',
      fastModel: over.fastModel ?? 'sonnet',
    }),
    records,
    review: over.review ?? null,
  };
};
const valueOf = (c: ReturnType<typeof compareRuns>, metric: string) =>
  c.rows.find((r) => r.metric.startsWith(metric))!.values;

describe('the comparison', () => {
  it('puts each configuration’s own summary side by side, metric by metric', () => {
    const c = compareRuns([
      run({}),
      run({ label: 'Haiku 5.5', fastModel: 'haiku', records: haiku }),
    ]);
    expect(c.columns.map((x) => x.label)).toEqual(['Sonnet 5.5 medium (run #8)', 'Haiku 5.5']);
    expect(c.notInEvery).toEqual([]);
    expect(valueOf(c, 'Scenario pass rate')).toEqual(['3/4 (75.0%)', '3/4 (75.0%)']);
    expect(valueOf(c, 'First-pass validation')).toEqual(['3/4 (75.0%)', '4/4 (100.0%)']);
    expect(valueOf(c, 'Valid within one regeneration')).toEqual(['4/4 (100.0%)', '4/4 (100.0%)']);
    expect(valueOf(c, 'Factual correctness')).toEqual(['1/2 (50.0%)', '2/2 (100.0%)']);
    expect(valueOf(c, 'Grounding')).toEqual(['1 of 4', '0 of 4']);
    // The privacy failure is a hard-gate failure, whatever else improved.
    expect(valueOf(c, 'Safety failures')).toEqual([
      '0 of 2 safety-class runs',
      '1 of 2 safety-class runs',
    ]);
    expect(valueOf(c, 'Privacy scenarios passed')).toEqual(['1/1 (100.0%)', '0/1 (0.0%)']);
    expect(valueOf(c, 'Injection scenarios passed')).toEqual(['1/1 (100.0%)', '1/1 (100.0%)']);
    expect(valueOf(c, 'Latency to the checked answer, median')).toEqual(['4.00 s', '2.00 s']);
    expect(valueOf(c, 'Latency to the checked answer, P95')).toEqual(['8.00 s', '2.50 s']);
    expect(valueOf(c, 'Latency, P95 (escalated)')).toEqual(['30.00 s', '28.00 s']);
    expect(valueOf(c, 'Escalation frequency')).toEqual(['1/4 (25.0%)', '1/4 (25.0%)']);
    expect(valueOf(c, 'Regeneration frequency')).toEqual(['1/4 (25.0%)', '0/4 (0.0%)']);
    expect(valueOf(c, 'Cost per turn, mean (HOME recorded, all turns)')).toEqual([
      'US$0.1300',
      'US$0.0790',
    ]);
    expect(valueOf(c, 'Cost per turn, mean (not escalated)')).toEqual(['US$0.0633', 'US$0.005333']);
    expect(valueOf(c, 'Cost, run total')).toEqual(['US$0.5200', 'US$0.3160']);
    expect(valueOf(c, 'Human-rated usefulness')).toEqual(['not reviewed', 'not reviewed']);
  });

  it('holds each column to its own fast model’s cost target', () => {
    const c = compareRuns([run({}), run({ label: 'Haiku', fastModel: 'haiku', records: haiku })]);
    const target = (i: number) =>
      c.columns[i]!.summary.targets.find((t) =>
        t.metric.startsWith('Mean cost, turn not escalated'),
      )!;
    expect(target(0).metric).toContain('Sonnet 5.5');
    expect(target(1).metric).toContain('Haiku 5.5');
  });

  it('says which scenarios a column did not run (deep runs without the fast-only one)', () => {
    const deep = medium.slice(0, 3).map((r) => ({ ...r, tier: 'deep' as const }));
    const c = compareRuns([run({}), run({ label: 'Opus 5.5 medium (run #10)', records: deep })]);
    expect(c.columns.map((x) => x.tier)).toEqual(['fast', 'deep']);
    expect(c.notInEvery).toEqual(['injection.synced_title']);
    expect(comparisonMarkdown(c)).toContain(
      'Not run by every column (each column’s rates are over its own set): injection.synced_title.',
    );
  });

  it('shows the owner’s usefulness ratings beside the automated results, from the review alone', () => {
    const transcripts: Reviewable[] = [
      {
        key: 'realistic.tomorrow@fast#1',
        scenario: 'realistic.tomorrow',
        mode: 'live',
        review: { category: 'everyday' },
        automated: { pass: true, failed: [] },
        signals: [],
      },
      {
        key: 'privacy.birthdays@fast#1',
        scenario: 'privacy.birthdays',
        mode: 'live',
        review: { category: 'privacy' },
        automated: { pass: true, failed: [] },
        signals: [],
      },
    ];
    const review = aggregateReview(transcripts, transcriptsDigest(transcripts), {
      format: 'home-kev-quality-review',
      version: 1,
      mode: 'live',
      transcripts: transcriptsDigest(transcripts),
      scores: [
        { key: 'realistic.tomorrow@fast#1', usefulness: 'useful' },
        { key: 'privacy.birthdays@fast#1', usefulness: 'partly_useful' },
      ],
    });
    const c = compareRuns([
      run({ review }),
      run({ label: 'Haiku', fastModel: 'haiku', records: haiku }),
    ]);
    expect(valueOf(c, 'Human-rated usefulness')).toEqual([
      '1 useful, 1 partly, 0 not, of 2 rated',
      'not reviewed',
    ]);
  });

  it('refuses scripted results, a review of scripted transcripts, mixed tiers, one run, or two labels alike', () => {
    expect(() => compareRuns([run({}), run({ label: 'Scripted', mode: 'scripted' })])).toThrow(
      /never model-quality evidence/,
    );
    const scriptedReview = { mode: 'scripted' } as unknown as ComparedRun['review'];
    expect(() => compareRuns([run({}), run({ label: 'R', review: scriptedReview })])).toThrow(
      /scripted transcripts/,
    );
    expect(() =>
      compareRuns([run({}), run({ label: 'Mixed', records: [...medium, rec({ tier: 'deep' })] })]),
    ).toThrow(/mixes tiers/);
    expect(() => compareRuns([run({})])).toThrow(/at least two/);
    expect(() => compareRuns([run({}), run({})])).toThrow(/labels must differ/);
    expect(() => compareRuns([run({}), run({ label: 'Empty', records: [] })])).toThrow(
      /no records/,
    );
    // A summary that is not of the records beside it.
    expect(() =>
      compareRuns([run({}), { ...run({ label: 'Other' }), records: haiku.slice(0, 2) }]),
    ).toThrow(/not of its records/);
  });

  it('prints labels, codes and counts only, and decides nothing', () => {
    const md = comparisonMarkdown(
      compareRuns([run({}), run({ label: 'Haiku 5.5', fastModel: 'haiku', records: haiku })]),
    );
    expect(md).toContain('| Metric | Sonnet 5.5 medium (run #8) | Haiku 5.5 |');
    expect(md).toContain('it decides nothing');
    expect(md).toContain('- Haiku 5.5: failed privacy.birthdays (private_shown).');
    expect(md).not.toMatch(/adopt(ed)? Haiku|recommend/i);
  });
});
