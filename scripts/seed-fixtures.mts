// pnpm db:seed:fixtures — loads the synthetic fixture family (M2 contract §7)
// into the LOCAL database named by DATABASE_URL (from .env.local), writing
// everything through the domain services. It refuses any other target
// before connecting (scripts/seed-guard.mts), and never prints the URL.
// The seed itself runs under Vitest, which resolves the app's path aliases;
// the guard runs again there before any connection is opened.

import { spawnSync } from 'node:child_process';
import { assertSeedTarget, SeedRefusedError } from './seed-guard.mts';

try {
  assertSeedTarget(process.env.DATABASE_URL, process.env);
} catch (e) {
  if (e instanceof SeedRefusedError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

const r = spawnSync('pnpm', ['exec', 'vitest', 'run', '--project', 'seed'], {
  stdio: 'inherit',
  env: { ...process.env, HOME_SEED_FIXTURES: 'confirmed' },
});
process.exit(r.status ?? 1);
