// Runs in every Vitest worker before test files. Sets a fake, complete
// environment pointed at the local test database. Values *override* whatever
// the shell exported (contract §1.6): an exported DATABASE_URL can never win,
// and the URL is checked before anything can connect to it.
import { assertTestDatabase } from './db-guard';
import { TEST_APP_DATABASE_URL, TEST_DATABASE_URL, testEnv } from './env';

assertTestDatabase(TEST_DATABASE_URL);
assertTestDatabase(TEST_APP_DATABASE_URL);
for (const [k, v] of Object.entries(testEnv)) {
  process.env[k] = v;
}
