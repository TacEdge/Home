// pnpm verify [--skip <step>,…] — the full local verification, one step at a
// time (never two suites on `home_test` at once), keeping every step's whole
// output. Each step writes `verify-logs/<step>.log` (gitignored), so a failed
// run can be diagnosed afterwards from the log rather than from a summary
// line. On failure the step's failing tests and the end of its output are
// printed, with the log's path. Steps: lint, typecheck, unit, integration,
// build, boot, csp, e2e. Needs the local Postgres (LOCAL-DEV.md). Synthetic
// data only; prints no secret (the test database URL is local and fixed).
// For routine work, `pnpm verify:focused` (scripts/verify-focused.mts) runs
// the checks a change affects; this full run is required before a PR.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_APP_DATABASE_URL } from '../tests/env.ts';

const LOG_DIR = 'verify-logs';
const STEPS: Record<string, string[]> = {
  lint: ['pnpm', 'lint'],
  typecheck: ['pnpm', 'typecheck'],
  unit: ['pnpm', 'test'],
  integration: ['pnpm', 'test:integration'],
  build: ['pnpm', 'build'],
  boot: ['node', 'scripts/check-boot-validation.mjs', TEST_APP_DATABASE_URL],
  csp: ['node', 'scripts/check-csp.mts', TEST_APP_DATABASE_URL],
  e2e: ['pnpm', 'test:e2e'],
};

const skipArg = process.argv.indexOf('--skip');
const skip = new Set(skipArg === -1 ? [] : (process.argv[skipArg + 1] ?? '').split(','));
for (const s of skip)
  if (!(s in STEPS)) {
    console.error(`verify: unknown step "${s}". Steps: ${Object.keys(STEPS).join(', ')}.`);
    process.exit(2);
  }

/**
 * The known causes of a failed run that are not the code (ADR 0007 §48):
 * the dev servers' caches (`.next`, `.next-narrow`) left by an earlier or
 * aborted run, whose stale route types break the typecheck and whose stale
 * compiled routes answer 404; and a Playwright browser path the container
 * provides but the shell did not export. Cleared and defaulted before
 * every run; CI starts clean and installs its own browser.
 */
export function prepareLocalRun(): string[] {
  const notes: string[] = [];
  for (const dir of ['.next', '.next-narrow']) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      notes.push(`cleared ${dir}`);
    }
  }
  const provided = '/opt/pw-browsers/chromium';
  if (!process.env.PLAYWRIGHT_CHROMIUM_PATH && existsSync(provided)) {
    process.env.PLAYWRIGHT_CHROMIUM_PATH = provided;
    notes.push(`PLAYWRIGHT_CHROMIUM_PATH=${provided}`);
  }
  return notes;
}

/** Lines worth printing from a failed step: failing tests and errors, then the end of the log. */
export function failureExcerpt(log: string, tail = 80): string {
  const lines = log.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  const marks = lines
    .map((l, i) => (/\bFAIL\b|✘|×|Error:|AssertionError|timed out/.test(l) ? i : -1))
    .filter((i) => i >= 0)
    .slice(0, 40);
  const picked = new Set<number>();
  for (const i of marks) for (let j = i; j < Math.min(i + 12, lines.length); j++) picked.add(j);
  const head = [...picked].sort((a, b) => a - b).map((i) => lines[i]);
  return [...head, '…', ...lines.slice(-tail)].join('\n');
}

export function run(step: string, [cmd, ...args]: string[]): Promise<number> {
  const path = join(LOG_DIR, `${step}.log`);
  const out = createWriteStream(path);
  out.write(`$ ${step} — started ${new Date().toISOString()}\n`);
  return new Promise((resolve) => {
    const child = spawn(cmd!, args, {
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on('close', (code) => {
      out.end(`\n$ ${step} — exit ${code} at ${new Date().toISOString()}\n`, () =>
        resolve(code ?? 1),
      );
    });
  });
}

if (process.argv[1]?.endsWith('verify-local.mts')) {
  rmSync(LOG_DIR, { recursive: true, force: true });
  mkdirSync(LOG_DIR, { recursive: true });
  for (const note of prepareLocalRun()) console.log(`· ${note}`);
  const started = Date.now();
  const failed: string[] = [];
  for (const [step, command] of Object.entries(STEPS)) {
    if (skip.has(step)) {
      console.log(`- ${step}: skipped`);
      continue;
    }
    const started = Date.now();
    const code = await run(step, command);
    const secs = Math.round((Date.now() - started) / 1000);
    if (code === 0) {
      console.log(`✓ ${step} (${secs}s)`);
      continue;
    }
    failed.push(step);
    const path = join(LOG_DIR, `${step}.log`);
    console.log(`✗ ${step} (${secs}s, exit ${code}) — full output in ${path}`);
    console.log(failureExcerpt(readFileSync(path, 'utf8')));
  }
  const total = Math.round((Date.now() - started) / 1000);
  console.log(
    failed.length
      ? `verify: failed: ${failed.join(', ')} (${total}s)`
      : `verify: all steps passed (${total}s)`,
  );
  process.exit(failed.length ? 1 : 0);
}
