import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { assertTestDatabase } from '../db-guard';
import { TEST_APP_DATABASE_URL, TEST_DATABASE_URL, testEnv } from '../env';
import { resetTestDatabase } from '../integration/global-setup';
import { FEED_DIR } from './calendar-feeds';
import { MAILBOX_PATH } from './mailbox';

// Fresh database and empty mailbox before the e2e suite. The guard runs here
// too, so the suite never resets anything but a local *_test database. Then
// the synthetic fixture family is seeded through the domain services, by the
// same launcher and guard as `pnpm db:seed:fixtures` (ADR 0005 §41), so the
// screens have a household to show. Synthetic data only.
export default async function globalSetup() {
  assertTestDatabase(TEST_DATABASE_URL);
  assertTestDatabase(TEST_APP_DATABASE_URL);
  await resetTestDatabase();
  await rm(MAILBOX_PATH, { force: true });
  await rm(FEED_DIR, { recursive: true, force: true });
  const seed = spawnSync('node', ['scripts/seed-fixtures.mts'], {
    stdio: 'inherit',
    env: { ...process.env, ...testEnv, DATABASE_URL: TEST_APP_DATABASE_URL },
  });
  if (seed.status !== 0) throw new Error('the fixture seed failed');
}
