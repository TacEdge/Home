// node scripts/kev-live/run.mts [--dry-run | --check-plan | --live]
//
// The Kev live verification runner's launcher (M8 live-verification plan
// §5; owner decisions 2–4, 2026-10-16; docs/runbooks/KEV-LIVE-VERIFY.md).
// The default is a dry run: the plan, each probe's maximum, the total and
// the plan hash, with no key, database or network. `--check-plan` is the
// workflow's keyless first job. `--live` runs the approved plan, and only
// from the `kev-evals` workflow: it needs the job's own database
// (home_live_verify on localhost), KEV_LIVE_PROVIDER_KEY, the approved plan
// hash and a budget of at most US$10.
//
// The environment guards run here first, then again inside the runner,
// which runs under Vitest so that it resolves the app's path aliases (as
// the fixture seed does). The exit code is the runner's: 0 passed, 1 a
// probe failed or the run stopped, 2 and 10–20 a refusal (guards.mts).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertEnvironment, EXIT, LiveRefusal, parseMode, type Mode } from './guards.mts';

let mode: Mode;
try {
  mode = parseMode(process.argv.slice(2));
  assertEnvironment(mode, process.env);
} catch (e) {
  if (e instanceof LiveRefusal) {
    console.error(e.message);
    process.exit(e.exitCode);
  }
  throw e;
}

const dir = mkdtempSync(join(tmpdir(), 'kev-live-'));
const statusFile = join(dir, 'status.json');
try {
  const r = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--project', 'kev-live', 'scripts/kev-live/runner.live.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        KEV_LIVE_LAUNCHED: 'confirmed',
        KEV_LIVE_MODE: mode,
        KEV_LIVE_STATUS_FILE: statusFile,
      },
    },
  );
  let code: number = EXIT.failed;
  try {
    const status = JSON.parse(readFileSync(statusFile, 'utf8')) as { exitCode?: unknown };
    if (typeof status.exitCode === 'number') code = status.exitCode;
  } catch {
    code = r.status && r.status !== 0 ? r.status : EXIT.failed;
  }
  process.exitCode = code;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
