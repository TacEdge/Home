import { createDb } from '@/db/create';
import { assertTestDatabase } from '../db-guard';
import { TEST_APP_DATABASE_URL, TEST_DATABASE_URL } from '../env';

// One handle per test file; call close() in afterAll. Guarded: a test can only
// ever open a local *_test database (contract §1.6).

/** Connected as the runtime/app role (home_app), exactly as the application is. */
export function testDb() {
  return createDb(assertTestDatabase(TEST_APP_DATABASE_URL));
}

/**
 * Connected as the migration/admin role. Only for proving owner-level
 * behaviour (the audit trigger) and for fixtures the app role may not write.
 */
export function adminDb() {
  return createDb(assertTestDatabase(TEST_DATABASE_URL));
}
