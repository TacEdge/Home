import { createDb } from '@/db/create';
import { TEST_DATABASE_URL } from '../env';

// One handle per test file; call close() in afterAll.
export function testDb() {
  return createDb(TEST_DATABASE_URL);
}
