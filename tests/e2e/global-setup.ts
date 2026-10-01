import { rm } from 'node:fs/promises';
import { assertTestDatabase } from '../db-guard';
import { TEST_DATABASE_URL } from '../env';
import { resetTestDatabase } from '../integration/global-setup';
import { MAILBOX_PATH } from './mailbox';

// Fresh database and empty mailbox before the e2e suite. The guard runs here
// too, so the suite never resets anything but a local *_test database.
export default async function globalSetup() {
  assertTestDatabase(TEST_DATABASE_URL);
  await resetTestDatabase();
  await rm(MAILBOX_PATH, { force: true });
}
