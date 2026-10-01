import type { Page } from '@playwright/test';
import { Pool } from 'pg';
import { TEST_DATABASE_URL } from '../env';
import { waitForLink } from './mailbox';

export const SENT_TEXT = 'If that address can use HOME, a link is on its way.';

/** Requests a magic link through the real sign-in form. */
export async function requestLink(page: Page, email: string): Promise<Date> {
  const since = new Date(Date.now() - 1000);
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send me a link' }).click();
  await page.waitForURL('**/sign-in?sent=1');
  return since;
}

/** Full sign-in: request a link, read it from the test mailbox, follow it. */
export async function signIn(page: Page, email: string): Promise<void> {
  const since = await requestLink(page, email);
  const link = await waitForLink(email, since);
  if (!link) throw new Error('no magic link arrived in the test mailbox');
  await page.goto(link);
  await page.waitForURL('**/today');
}

/** Direct access to the test database for setup that has no UI (e.g. expiring a link). */
export async function withDb<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}
