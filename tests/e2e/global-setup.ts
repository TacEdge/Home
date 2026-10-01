import { rm } from 'node:fs/promises';
import resetDatabase from '../integration/global-setup';
import { MAILBOX_PATH } from './mailbox';

// Fresh database and empty mailbox before the e2e suite.
export default async function globalSetup() {
  await resetDatabase();
  await rm(MAILBOX_PATH, { force: true });
}
