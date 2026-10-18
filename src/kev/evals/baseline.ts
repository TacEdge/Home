import 'server-only';
import { REVIEW_SET } from './review-set';
import type { EvalSummary } from './summary';
import { SIGNALS, SCRIPTED_LIMITS, type Transcript } from './transcript';

// The scripted baseline (M8 Package 5C; ADR 0012 §58): what the scripted
// evaluation (layer 2) shows about HOME's handling of Kev's answers, and
// what it cannot show about a real model's. Codes, counts and scenario ids
// only: no question, answer or record text, so it can be committed.

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);

function tally(values: readonly string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The baseline report, from the scripted runs' summary and transcripts. */
export function scriptedBaselineMarkdown(
  summary: EvalSummary,
  transcripts: readonly Transcript[],
): string {
  if (summary.mode !== 'scripted' || transcripts.some((t) => t.mode !== 'scripted'))
    throw new Error('the scripted baseline reads scripted runs only');
  const out: string[] = [
    '# Kev quality: the scripted baseline',
    '',
    '_Scripted (layer 2). Every answer here was chosen by a hand-written script, including answers that misbehave on purpose. These figures show how HOME renders, checks, limits and records an answer. They are **not** evidence of a real model’s quality, usefulness, latency or cost: that needs live runs (Package 5D, 5E) and the owner’s review._',
  ];
  for (const t of summary.tiers) {
    const runs = transcripts.filter((x) => x.tier === t.tier);
    const lastTurns = runs.map((x) => x.turns.at(-1)!);
    const answers = lastTurns.filter((x) => x.outcome === 'answer');
    const uncited = answers.reduce(
      (n, x) => n + [...x.facts, ...x.view].filter((b) => b.cites.length === 0).length,
      0,
    );
    const mustCite = runs.filter((x) => x.automated.failed.some((f) => f.startsWith('must_cite')));
    const rejected = runs.flatMap((x) => x.turns.flatMap((y) => y.check.rejectedCodes.flat()));
    out.push(
      '',
      `## Started on ${t.tier}`,
      '',
      '### Deterministic results',
      '',
      `${t.passed} of ${t.runs} runs met every expectation; the safety classes had ${t.safety.failures} failure(s) in ${t.safety.n} runs.`,
      t.failures.length === 0
        ? 'Deterministic failures: none.'
        : `Deterministic failures: ${t.failures.map((f) => `${f.scenario} (${f.failed.join(', ')})`).join('; ')}.`,
      '',
      '### Answer checks (scripted on purpose)',
      '',
      '| Measure | Count | Of | Rate |',
      '|---|---|---|---|',
      ...Object.entries(t.validator.results).map(
        ([k, v]) =>
          `| Answer check: ${k} | ${v} | ${runs.flatMap((x) => x.turns).length} turns | ${pct(v, runs.flatMap((x) => x.turns).length)} |`,
      ),
      `| Turns with a regeneration | ${t.regenerationRate.passed} | ${t.regenerationRate.n} | ${pct(t.regenerationRate.passed, t.regenerationRate.n)} |`,
      `| Turns escalated to deep | ${t.escalationRate.passed} | ${t.escalationRate.n} | ${pct(t.escalationRate.passed, t.escalationRate.n)} |`,
      `| Scored answers that fell back | ${lastTurns.filter((x) => x.outcome === 'fallback').length} | ${lastTurns.length} | ${pct(lastTurns.filter((x) => x.outcome === 'fallback').length, lastTurns.length)} |`,
      '',
      '### Citations',
      '',
      `- Runs missing a required citation: ${mustCite.length === 0 ? 'none' : mustCite.map((x) => x.scenario).join(', ')}.`,
      `- Statements shown with no record cited, across ${answers.length} answers: ${uncited}. HOME writes these itself, for an absence or a count from a complete read; a fact about a record must cite it (the validator).`,
      '',
      '### Validator codes',
      '',
      `First-answer failures by code: ${
        Object.keys(t.validator.firstCodes).length === 0
          ? 'none'
          : tally(Object.entries(t.validator.firstCodes).flatMap(([c, n]) => Array(n).fill(c)))
              .map(([c, n]) => `\`${c}\` ${n}`)
              .join(', ')
      }.`,
      `Every rejected answer’s codes: ${
        rejected.length === 0
          ? 'none'
          : tally(rejected)
              .map(([c, n]) => `\`${c}\` ${n}`)
              .join(', ')
      }.`,
      '',
      '### Signals for the reviewer',
      '',
      '| Signal | Runs |',
      '|---|---|',
      ...SIGNALS.map((g) => `| ${g} | ${runs.filter((x) => x.signals.includes(g)).length} |`),
    );
  }
  const fast = transcripts.filter((t) => t.tier === 'fast');
  const by = (l: string) => fast.filter((t) => t.scriptedLimits?.includes(l as never));
  out.push(
    '',
    '## What the scripted runs cannot establish',
    '',
    `Every scripted answer’s records and lead were chosen by its script, so **none of the ${fast.length} scenarios** shows whether a real model would choose them well. In particular (fast configuration):`,
    '',
    '| Limit | Scenarios |',
    '|---|---|',
    ...SCRIPTED_LIMITS.filter((l) => l !== 'scripted_choice').map(
      (l) =>
        `| ${l} | ${by(l).length}${
          by(l).length > 0 && by(l).length <= 30
            ? `: ${by(l)
                .map((t) => t.scenario)
                .join(', ')}`
            : ''
        } |`,
    ),
    '',
    '- `scripted_misbehaviour`: the script misbehaves on purpose, so the run shows HOME’s check working, not an answer.',
    '- `decline_only`: the script declines without reading, so whether a model would decline correctly is unmeasured.',
    '- `fixed_text`: what is shown is HOME’s own fixed sentence, so there is no model answer to judge.',
    '',
    '## The owner’s review set (fast, scripted)',
    '',
    '| # | Scenario | Category | Automated | Signals |',
    '|---|---|---|---|---|',
    ...REVIEW_SET.map((e, i) => {
      const t = fast.find((x) => x.scenario === e.scenario && x.repeat === 1);
      return `| ${i + 1} | ${e.scenario} | ${e.category} | ${t ? (t.automated.pass ? 'pass' : `fail (${t.automated.failed.join(', ')})`) : 'not run'} | ${t?.signals.join(', ') || '—'} |`;
    }),
    '',
  );
  return out.join('\n');
}
