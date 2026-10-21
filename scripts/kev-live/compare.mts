// node scripts/kev-live/compare.mts <comparison.json>
//
// The model comparison (M8 Package 5E's Stage 3; ADR 0012 §72): live runs
// of the review set side by side. `comparison.json` lists the runs, each a
// configuration's own downloaded report and, where the owner rated it, its
// review files:
//
//   { "runs": [
//     { "label": "Sonnet 5.5 medium (run #8)", "report": "run8/report.json",
//       "review": { "transcripts": "run8/review-fast.json", "sheet": "run8/sheet.json" } },
//     { "label": "Sonnet 5.5 low", "report": "low/report.json" }, ... ] }
//
// Each report's judge records are summarised exactly as its run's report
// summarised them; reviews through the owner's review summary (quality.ts).
// A report that is not a live evaluation is refused. Prints the comparison
// (labels, codes and counts only: no question, answer or feedback text).
// Local files only: no database, key or network.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComparedRun } from '../../src/kev/evals/compare.ts';
import type { Reviewable } from '../../src/kev/evals/quality.ts';
import type { EvalRecord } from '../../src/kev/evals/summary.ts';

// src/kev is server-only (S13): its modules load only under the
// `react-server` condition, so the command re-runs itself with it.
if (!process.execArgv.includes('--conditions=react-server')) {
  const r = spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}
const { compareRuns, comparisonMarkdown } = await import('../../src/kev/evals/compare.ts');
const { summarise } = await import('../../src/kev/evals/summary.ts');
const { aggregateReview, transcriptsDigest } = await import('../../src/kev/evals/quality.ts');

type Spec = {
  runs: { label: string; report: string; review?: { transcripts: string; sheet: string } }[];
};

const [specPath] = process.argv.slice(2);
if (!specPath) {
  console.error('usage: node scripts/kev-live/compare.mts <comparison.json>');
  process.exit(2);
}
const read = (base: string, p: string): unknown =>
  JSON.parse(readFileSync(resolve(base, p), 'utf8'));
try {
  const base = dirname(resolve(specPath));
  const spec = read('.', specPath) as Spec;
  if (!Array.isArray(spec?.runs)) throw new Error('compare: the spec lists no runs');
  const runs: ComparedRun[] = spec.runs.map((r) => {
    const report = read(base, r.report) as {
      format?: unknown;
      plan?: { configuration?: { fast?: { model?: unknown } } };
      evaluation?: { summary?: { mode?: unknown }; records?: EvalRecord[] };
    };
    if (report.format !== 'home-kev-live-report' || !report.evaluation?.records)
      throw new Error(`compare: ${r.label}'s report is not a live evaluation report`);
    const fastModelId = String(report.plan?.configuration?.fast?.model ?? '');
    const review = r.review
      ? (() => {
          const transcripts = read(base, r.review.transcripts) as Reviewable[];
          return aggregateReview(
            transcripts,
            transcriptsDigest(transcripts),
            read(base, r.review.sheet),
          );
        })()
      : null;
    // Summarised exactly as the run's report did (report.ts), with its fast model.
    const records = report.evaluation.records;
    return {
      label: r.label,
      summary: summarise(records, {
        mode: report.evaluation.summary?.mode === 'live' ? 'live' : 'scripted',
        fastModel: fastModelId.includes('haiku') ? 'haiku' : 'sonnet',
      }),
      records,
      review,
    };
  });
  process.stdout.write(comparisonMarkdown(compareRuns(runs)));
} catch (e) {
  console.error(e instanceof Error ? e.message : 'compare: unreadable input');
  process.exit(1);
}
