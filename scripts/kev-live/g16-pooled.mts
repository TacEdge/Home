// node scripts/kev-live/g16-pooled.mts
//   G16_DATABASE_URL    home-dev's POOLED connection (the runtime role), never Production
//   PRODUCTION_DB_HOST  Production's database host, required, to refuse it
//
// G16 on Neon's pooled connection (contract §5.7 stage D; M8 live-verification
// plan §8; owner decision 5, 2026-10-16), on a trusted machine, with the
// owner's approval: reservation-only, no model, no key. It refuses a local
// database, Production's host (or its endpoint), a deployed process, and a
// database that fails the isolation check (any person who is not the
// fixture family's). Then it creates the two fixture adults if absent
// (.test addresses, which can never sign in), and runs ten rounds of
// concurrent reservations settled with no calls, plus one round against a
// held budget lock. Never run in CI. Exit codes as guards.mts.

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertNoRealData,
  assertNotDeployed,
  assertNotLocal,
  assertNotProduction,
  EXIT,
  LiveRefusal,
} from './guards.mts';
import { checkIsolation, isolationLines, isolationPasses } from './isolation-check.mts';

try {
  assertNotDeployed(process.env);
  assertNoRealData(process.env);
  if (process.env.CI) throw new LiveRefusal('deployed', 'G16 never runs in CI.');
  assertNotLocal(process.env.G16_DATABASE_URL, 'G16_DATABASE_URL');
  assertNotProduction(
    process.env.G16_DATABASE_URL,
    process.env.PRODUCTION_DB_HOST,
    'G16_DATABASE_URL',
  );
  const iso = await checkIsolation(
    process.env.G16_DATABASE_URL,
    process.env.PRODUCTION_DB_HOST,
    'G16_DATABASE_URL',
  );
  for (const l of isolationLines(iso)) console.log(l);
  const verdict = isolationPasses(iso);
  if (!verdict.ok) throw new LiveRefusal('isolation', verdict.reasons.join('; '));
} catch (e) {
  if (e instanceof LiveRefusal) {
    console.error(e.message);
    process.exit(e.exitCode);
  }
  console.error(`G16 failed before it started: ${e instanceof Error ? e.name : 'error'}`);
  process.exit(EXIT.failed);
}

const dir = mkdtempSync(join(tmpdir(), 'kev-g16-'));
const statusFile = join(dir, 'status.json');
try {
  // The app's environment for the bookkeeping path, for this process only:
  // synthetic values, a fresh random secret per run, the cap at its maximum
  // so only the run's own reservations count. Never Preview's configuration.
  const synthetic = randomBytes(32).toString('hex');
  const r = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--project', 'kev-live', 'scripts/kev-live/g16.live.ts'],
    {
      stdio: 'inherit',
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        G16_DATABASE_URL: process.env.G16_DATABASE_URL,
        PRODUCTION_DB_HOST: process.env.PRODUCTION_DB_HOST,
        DATABASE_URL: process.env.G16_DATABASE_URL,
        BETTER_AUTH_SECRET: synthetic,
        BETTER_AUTH_URL: 'http://localhost:3000',
        HOME_ALLOWED_EMAILS: 'sam@example.test,alex@example.test',
        HOME_MAIL_TRANSPORT: 'test',
        AUDIT_HASH_SECRET: randomBytes(32).toString('hex'),
        HOME_KEV_MONTHLY_CAP_NZD: '300',
        KEV_G16_LAUNCHED: 'confirmed',
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
