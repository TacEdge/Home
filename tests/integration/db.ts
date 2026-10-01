import { createDb } from '@/db/create';
import { assertTestDatabase } from '../db-guard';
import { TEST_DATABASE_URL } from '../env';

// One handle per test file; call close() in afterAll. Guarded: a test can only
// ever open a local *_test database (contract §1.6).
export function testDb() {
  return createDb(assertTestDatabase(TEST_DATABASE_URL));
}
