import 'server-only';
import type { QualityReview } from './quality';
import type { EvalRecord, EvalSummary, TierSummary } from './summary';

// The model comparison (Package 5E's Stage 3, ADR 0012 §72): live runs of the
// same review set side by side, one column per configuration, from what each
// run already produced: its judge records (`evaluation.records` in the
// run's report.json) and, where the owner rated it, its review summary
// (quality.ts). Nothing is re-judged and nothing is rescored: each column is
// the existing summary (summary.ts `summarise`) of that run's own records,
// made by the caller with its run's fast model. Scripted summaries are
// refused: they come from hand-written scripts and are never evidence of a
// model's quality (§12.3). The comparison reports; it decides nothing. The
// contract's adoption rules (§5.3: `low` within 2 points of `medium` on
// factual correctness and first-pass rate; Haiku only on every hard gate and
// measured target) and the owner's decision stay outside it.

/** One configuration's live run. */
export type ComparedRun = Readonly<{
  /** The configuration and its run, e.g. "Sonnet 5.5 `medium` (run #8)". */
  label: string;
  /**
   * The run's records summarised (summary.ts `summarise`, with the fast model
   * it ran, for §12.3's cost target), as its own report summarised them. Only
   * a `live` summary is compared.
   */
  summary: EvalSummary;
  /** The judge's records it summarises. */
  records: readonly EvalRecord[];
  /** The owner's review of the run's transcripts, when there is one. */
  review?: QualityReview | null;
}>;

export type ComparisonColumn = Readonly<{
  label: string;
  tier: 'fast' | 'deep';
  /** The scenarios it ran (by id, sorted): comparable columns ran the same ones. */
  scenarios: readonly string[];
  summary: TierSummary;
  review: QualityReview | null;
}>;

export type ComparisonRow = Readonly<{
  metric: string;
  /** One value per column, as text; `—` where there is nothing to show. */
  values: readonly string[];
}>;

export type Comparison = Readonly<{
  columns: readonly ComparisonColumn[];
  rows: readonly ComparisonRow[];
  /** Scenarios not run by every column: each column's rates are over its own set. */
  notInEvery: readonly string[];
}>;

/** The checks that test grounding: what is cited, and that what is shown was checked. */
const GROUNDING = /^(must_cite#|must_not_cite#|cites_conflict$|ungrounded$|say_unchecked$)/;

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);
const frac = (n: number, d: number) => (d === 0 ? '—' : `${n}/${d} (${pct(n, d)})`);
const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`);
const usd = (m: bigint | null) =>
  m === null ? '—' : `US$${(Number(m) / 1_000_000).toFixed(m < 10_000n ? 6 : 4)}`;

/** One configuration's column: its own records, summarised as its run's report summarised them. */
function column(run: ComparedRun): ComparisonColumn {
  if (run.summary.mode !== 'live')
    throw new Error(
      `compare: ${run.label} is a ${run.summary.mode} run; scripted results are never model-quality evidence`,
    );
  if (run.records.length === 0) throw new Error(`compare: ${run.label} has no records`);
  const tiers = new Set(run.records.map((r) => r.tier));
  const summary = run.summary.tiers[0];
  if (tiers.size !== 1 || run.summary.tiers.length !== 1)
    throw new Error(`compare: ${run.label} mixes tiers; one configuration per column`);
  if (!summary || summary.tier !== run.records[0]!.tier || summary.runs !== run.records.length)
    throw new Error(`compare: ${run.label}'s summary is not of its records`);
  if (run.review && run.review.mode !== 'live')
    throw new Error(`compare: ${run.label}'s review is of scripted transcripts`);
  return Object.freeze({
    label: run.label,
    tier: summary.tier,
    scenarios: Object.freeze([...new Set(run.records.map((r) => r.scenario))].sort()),
    summary,
    review: run.review ?? null,
  });
}

/** Every configuration's metrics side by side (each from its own run). */
export function compareRuns(runs: readonly ComparedRun[]): Comparison {
  if (runs.length < 2) throw new Error('compare: at least two runs');
  const labels = runs.map((r) => r.label);
  if (new Set(labels).size !== labels.length) throw new Error('compare: labels must differ');
  const columns = runs.map(column);
  const all = [...new Set(columns.flatMap((c) => c.scenarios))].sort();
  const notInEvery = all.filter((s) => columns.some((c) => !c.scenarios.includes(s)));

  const rows: ComparisonRow[] = [];
  const row = (metric: string, f: (c: ComparisonColumn) => string) =>
    rows.push(Object.freeze({ metric, values: Object.freeze(columns.map(f)) }));
  const records = (c: ComparisonColumn) =>
    runs[columns.indexOf(c)]!.records as readonly EvalRecord[];
  const cls = (c: ComparisonColumn, k: string) => c.summary.classes[k];

  row('Started on', (c) => c.tier);
  row('Scenario pass rate (runs)', (c) => frac(c.summary.passed, c.summary.runs));
  row('First-pass validation (HOME’s checker)', (c) =>
    frac(c.summary.validator.firstPass.passed, c.summary.validator.firstPass.n),
  );
  row('Valid within one regeneration', (c) =>
    frac(c.summary.validator.withinOne.passed, c.summary.validator.withinOne.n),
  );
  row('Factual correctness (realistic scenarios)', (c) => {
    const r = cls(c, 'realistic');
    return r ? frac(r.passed, r.n) : '—';
  });
  row('Grounding: runs failing a citation or checked-text check', (c) => {
    const rs = records(c);
    return `${rs.filter((r) => r.failed.some((f) => GROUNDING.test(f))).length} of ${rs.length}`;
  });
  row(
    'Safety failures (privacy, sensitive, injection, fabrication; any private or sensitive text shown)',
    (c) => `${c.summary.safety.failures} of ${c.summary.safety.n} safety-class runs`,
  );
  row('Privacy scenarios passed', (c) => {
    const r = cls(c, 'privacy');
    return r ? frac(r.passed, r.n) : '—';
  });
  row('Injection scenarios passed', (c) => {
    const r = cls(c, 'injection');
    return r ? frac(r.passed, r.n) : '—';
  });
  row('Latency to the checked answer, median (not escalated)', (c) =>
    secs(c.summary.latency.notEscalated.p50),
  );
  row('Latency to the checked answer, P95 (not escalated)', (c) =>
    secs(c.summary.latency.notEscalated.p95),
  );
  row('Latency, P95 (escalated)', (c) => secs(c.summary.latency.escalated.p95));
  row('Escalation frequency (turns)', (c) =>
    frac(c.summary.escalationRate.passed, c.summary.escalationRate.n),
  );
  row('Regeneration frequency (turns)', (c) =>
    frac(c.summary.regenerationRate.passed, c.summary.regenerationRate.n),
  );
  row('Cost per turn, mean (HOME recorded, all turns)', (c) => {
    const n = records(c)
      .flatMap((r) => r.turns)
      .filter((t) => t.costUsdMicros !== null).length;
    return n === 0 ? '—' : usd(c.summary.cost.total / BigInt(n));
  });
  row('Cost per turn, mean (not escalated)', (c) => usd(c.summary.cost.notEscalatedMean));
  row('Cost per turn, mean (escalated)', (c) => usd(c.summary.cost.escalatedMean));
  row('Cost, run total (HOME recorded)', (c) => usd(c.summary.cost.total));
  row('Human-rated usefulness (the owner’s review)', (c) => {
    if (!c.review) return 'not reviewed';
    const u = c.review.human.usefulness;
    const rated = u.useful + u.partly_useful + u.not_useful;
    return rated === 0
      ? 'not rated'
      : `${u.useful} useful, ${u.partly_useful} partly, ${u.not_useful} not, of ${rated} rated`;
  });
  return Object.freeze({
    columns: Object.freeze(columns),
    rows: Object.freeze(rows),
    notInEvery: Object.freeze(notInEvery),
  });
}

/** The comparison for the owner: one table, the caveats first. Codes and counts only. */
export function comparisonMarkdown(c: Comparison): string {
  const head = `| Metric | ${c.columns.map((x) => x.label).join(' | ')} |`;
  const rule = `|---|${c.columns.map(() => '---').join('|')}|`;
  return [
    '# Kev model comparison (live runs)',
    '',
    '_Live runs of the owner’s review set, one configuration per column, each summarised from its own judge records exactly as its run’s report was. Finite samples (n ≈ 20 per column, one repetition): differences of a scenario or two are within noise. Scripted results are not included and are never evidence of model quality. This compares; it decides nothing: the adoption rules (contract §5.3) and the decision are the owner’s._',
    '',
    c.notInEvery.length === 0
      ? 'Every column ran the same scenarios.'
      : `Not run by every column (each column’s rates are over its own set): ${c.notInEvery.join(', ')}.`,
    '',
    head,
    rule,
    ...c.rows.map((r) => `| ${r.metric} | ${r.values.join(' | ')} |`),
    '',
    ...c.columns.flatMap((x) =>
      x.summary.failures.length === 0
        ? [`- ${x.label}: no failed run.`]
        : [
            `- ${x.label}: failed ${x.summary.failures.map((f) => `${f.scenario} (${f.failed.join(', ')})`).join('; ')}.`,
          ],
    ),
    '',
  ].join('\n');
}
