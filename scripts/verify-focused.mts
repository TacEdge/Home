// pnpm verify:focused [--base <ref>] [--e2e <spec,…>|--no-e2e] — the checks
// a change affects, for routine work (ADR 0007 §48, docs/runbooks/LOCAL-DEV.md).
// Always: lint, typecheck. Then the unit and integration tests vitest finds
// through the import graph of the files changed since <ref> (default
// origin/main, plus uncommitted work), and the browser specs the changed
// paths map to below. Logs as `pnpm verify` (verify-logs/, gitignored).
//
// It narrows, it never replaces: `pnpm verify` (and CI) run everything, and
// are required before a PR, and whenever a change touches visibility,
// authority, the real-data gate, migrations, the shell, the CSP or shared
// UI (the full privacy and device sweeps). Synthetic data only.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { failureExcerpt, prepareLocalRun, run } from './verify-local.mts';

/** Changed paths → browser specs. First match wins per path; specs are unioned. */
export const SPEC_MAP: [RegExp, string[]][] = [
  [/^tests\/e2e\/(.+\.spec\.ts)$/, []], // a changed spec runs itself (below)
  [
    /^src\/app\/\(home\)\/events\/|^src\/domain\/events\//,
    ['events', 'occurrence-changes', 'synced-events'],
  ],
  [
    /^src\/domain\/engines\/(agenda|recurrence)/,
    ['events', 'today', 'synced-events', 'occurrence-changes'],
  ],
  [/^src\/domain\/engines\/profile|^src\/app\/_profile\//, ['regular-week', 'people']],
  [/^src\/app\/_agenda\//, ['today', 'events', 'synced-events', 'regular-week']],
  [
    /^src\/app\/\(home\)\/settings\/calendars\/|^src\/app\/_calendar\/|^src\/domain\/calendar\/|^src\/integrations\/calendar\//,
    ['calendars', 'calendar-refresh', 'synced-events'],
  ],
  [/^src\/app\/\(home\)\/people\/|^src\/domain\/people\//, ['people', 'regular-week']],
  [
    /^src\/app\/\(home\)\/sort\/|^src\/app\/_capture\/|^src\/domain\/(captures|proposals)\//,
    ['capture-sort'],
  ],
  [/^src\/app\/\(home\)\/home\/|^src\/domain\/(tasks|projects)\//, ['home-tasks']],
  [/^src\/app\/\(home\)\/today\//, ['today']],
  [
    /^src\/app\/\(home\)\/settings\/|^src\/domain\/(export|context|notes)\//,
    ['settings-knows-archived', 'export'],
  ],
  [/^src\/app\/_notes\//, ['events', 'people']],
  [/^src\/app\/_forms\//, ['events', 'home-tasks', 'calendars']],
  [/^src\/app\/\(auth\)\/|^src\/app\/api\/auth\/|^src\/trust\/(auth|session)/, ['sign-in']],
  [/^src\/proxy\.ts$|^next\.config\.ts$/, ['csp', 'shell']],
  [/^src\/ui\/|^src\/app\/(layout|globals)|^src\/app\/\(home\)\/layout/, ['shell']],
];

export function specsFor(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    const own = /^tests\/e2e\/(.+)\.spec\.ts$/.exec(p);
    if (own) {
      out.add(own[1]!);
      continue;
    }
    const hit = SPEC_MAP.find(([re]) => re.test(p));
    for (const s of hit?.[1] ?? []) out.add(s);
  }
  return [...out].sort();
}

function changedPaths(base: string): string[] {
  const git = (...a: string[]) =>
    execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter(Boolean);
  const mergeBase = git('merge-base', base, 'HEAD')[0]!;
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
  const paths = changedPaths(base);
  const specs = process.argv.includes('--no-e2e')
    ? []
    : arg('--e2e')
      ? arg('--e2e')!.split(',').filter(Boolean)
      : specsFor(paths);
  const LOG_DIR = 'verify-logs';
  rmSync(LOG_DIR, { recursive: true, force: true });
  mkdirSync(LOG_DIR, { recursive: true });
  console.log(`· ${paths.length} changed since ${base}`);
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
        base,
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
        base,
        '--passWithNoTests',
      ],
    ],
  ];
  if (specs.length)
    steps.push([
      'e2e',
      ['pnpm', 'exec', 'playwright', 'test', ...specs.map((s) => `tests/e2e/${s}.spec.ts`)],
    ]);
  else console.log('· e2e: no browser spec maps to this change');
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
      : `verify:focused: passed (${total}s). Run \`pnpm verify\` before a PR.`,
  );
  process.exit(failed.length ? 1 : 0);
}
