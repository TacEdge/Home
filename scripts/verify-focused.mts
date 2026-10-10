// pnpm verify:focused [--base <ref>] [--e2e <spec,…>|--no-e2e] — the checks
// a change affects, for routine work (ADR 0007 §48, ADR 0010,
// docs/runbooks/LOCAL-DEV.md). Always: lint, typecheck. Then the unit and
// integration tests vitest finds through the import graph of the files
// changed since <ref> (default origin/main, plus uncommitted work), and the
// browser specs the shared risk classifier selects (scripts/ci-select.mts).
// Logs as `pnpm verify` (verify-logs/, gitignored).
//
// It narrows, it never replaces: `pnpm verify` runs everything and is
// required before a PR. A high or critical change, including any path no
// rule names, fails this command outright, before anything runs: no focused
// selection proves it. Synthetic data only.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { select } from './ci-select.mts';
import { failureExcerpt, prepareLocalRun, run } from './verify-local.mts';

// What a change needs is decided by the shared risk classifier
// (scripts/ci-select.mts, ADR 0010), the same one CI uses: a high or critical
// change fails this command outright (only the full run proves it), an
// unmapped path is high (fail closed), and a medium change runs the specs
// mapped to it plus the smoke suite.
const git = (...a: string[]) =>
  execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter(Boolean);

/** Paths changed since the merge-base, plus uncommitted and untracked work. */
function changedPaths(mergeBase: string): string[] {
  return [
    ...new Set([
      ...git('diff', '--name-only', mergeBase),
      ...git('ls-files', '--others', '--exclude-standard'),
    ]),
  ].sort();
}

if (process.argv[1]?.endsWith('verify-focused.mts')) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const base = arg('--base') ?? 'origin/main';
  // Browser specs and vitest's import-graph selection both start from the
  // merge-base, so work already on <base> is never counted as this change.
  const mergeBase = git('merge-base', base, 'HEAD')[0]!;
  const paths = changedPaths(mergeBase);
  const selection = select({ paths, event: 'local' });
  const escalated = selection.paths.filter((p) => p.tier === 'high' || p.tier === 'critical');
  if (escalated.length) {
    console.log(
      `✗ ${selection.tier} risk: a focused run cannot prove this change. Run pnpm verify.`,
    );
    for (const p of escalated) console.log(`  · ${p.path} (${p.tier}: ${p.reason})`);
    process.exit(1);
  }
  const specs = process.argv.includes('--no-e2e')
    ? []
    : arg('--e2e')
      ? arg('--e2e')!.split(',').filter(Boolean)
      : selection.specs;
  const LOG_DIR = 'verify-logs';
  rmSync(LOG_DIR, { recursive: true, force: true });
  mkdirSync(LOG_DIR, { recursive: true });
  console.log(`· ${paths.length} changed since ${base} (merge-base ${mergeBase.slice(0, 7)})`);
  console.log(`· risk tier: ${selection.tier}`);
  for (const note of prepareLocalRun()) console.log(`· ${note}`);
  const steps: [string, string[]][] = [
    ['lint', ['pnpm', 'lint']],
    ['typecheck', ['pnpm', 'typecheck']],
    [
      'unit',
      [
        'pnpm',
        'exec',
        'vitest',
        'run',
        '--project',
        'unit',
        '--changed',
        mergeBase,
        '--passWithNoTests',
      ],
    ],
    [
      'integration',
      [
        'pnpm',
        'exec',
        'vitest',
        'run',
        '--project',
        'integration',
        '--changed',
        mergeBase,
        '--passWithNoTests',
      ],
    ],
  ];
  if (specs.length)
    steps.push([
      'e2e',
      ['pnpm', 'exec', 'playwright', 'test', ...specs.map((s) => `tests/e2e/${s}.spec.ts`)],
    ]);
  else
    console.log(
      process.argv.includes('--no-e2e')
        ? '· e2e: skipped (--no-e2e)'
        : '· e2e: none needed for a low-risk change',
    );
  const started = Date.now();
  const failed: string[] = [];
  for (const [step, command] of steps) {
    const t = Date.now();
    const code = await run(step, command);
    const secs = Math.round((Date.now() - t) / 1000);
    const path = join(LOG_DIR, `${step}.log`);
    if (code === 0) {
      console.log(`✓ ${step} (${secs}s)${step === 'e2e' ? ` — ${specs.join(', ')}` : ''}`);
      continue;
    }
    failed.push(step);
    console.log(`✗ ${step} (${secs}s, exit ${code}) — full output in ${path}`);
    console.log(failureExcerpt(readFileSync(path, 'utf8')));
  }
  const total = Math.round((Date.now() - started) / 1000);
  console.log(
    failed.length
      ? `verify:focused: failed: ${failed.join(', ')} (${total}s)`
      : `verify:focused: passed (${total}s). This is not full verification: run \`pnpm verify\` before a PR.`,
  );
  process.exit(failed.length ? 1 : 0);
}
