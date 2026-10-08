import type { Browser, BrowserContext, Cookie, Page } from '@playwright/test';
import { ALEX, SAM } from '../fixtures/users';
import { signIn, withDb } from './helpers';

// Signing in as one of the seeded fixture adults (M3 contract §8.3). The
// e2e global setup seeds the synthetic family into the local test database;
// these helpers sign in through the real magic-link flow (test mail
// transport), so every screen test exercises the same path a person does.
// Local and CI only: the test mailbox and the rate-limit reset need the local
// test database, and Preview is never seeded (ADR 0006 §14).

export type Adult = 'sam' | 'alex';
export const FIXTURE_ADULTS: Record<Adult, { name: string; email: string }> = {
  sam: SAM,
  alex: ALEX,
};

/**
 * Each adult's session from their last real sign-in in this worker (ADR 0007
 * §48). Signing in through the magic link costs a mail round trip and a
 * render of Today, and most tests only need to be signed in. The session is
 * reused only while the server still accepts it: a test that signs out (or
 * a session that ends) sends the next caller through the real flow again.
 * Tests of sign-in itself use `signIn` directly and never touch this.
 */
const sessions = new Map<Adult, Cookie[]>();

/** Signs a page in as a fixture adult. Lands on Today. */
export async function signInAsFixtureAdult(page: Page, adult: Adult): Promise<void> {
  const saved = sessions.get(adult);
  if (saved) {
    await page.context().clearCookies();
    await page.context().addCookies(saved);
    await page.goto('/today');
    if (new URL(page.url()).pathname === '/today') {
      // The restored session must be this adult's, never another's: the
      // session cookie's token, looked up in the test database. (HOME's auth
      // route answers only the sign-in paths, so there is no get-session.)
      const cookie = saved.find((c) => c.name.endsWith('home.session_token'));
      const token = decodeURIComponent(cookie?.value ?? '').split('.')[0];
      const who = await withDb(async (pool) => {
        const { rows } = await pool.query<{ email: string }>(
          'select u.email from "session" s join "user" u on u.id = s.user_id where s.token = $1',
          [token],
        );
        return rows[0]?.email;
      });
      if (who !== FIXTURE_ADULTS[adult].email)
        throw new Error(`cached session for ${adult} belongs to ${who ?? 'nobody'}`);
      return;
    }
    sessions.delete(adult);
  }
  // A real sign-in; the per-IP link limit is a production control, reset
  // here so a long suite never trips it.
  await withDb((pool) => pool.query('delete from "rate_limit"'));
  await signIn(page, FIXTURE_ADULTS[adult].email);
  sessions.set(adult, await page.context().cookies());
}

/** A fresh browser context, signed in as a fixture adult, at a given viewport. */
export async function fixtureAdultContext(
  browser: Browser,
  adult: Adult,
  viewport: { width: number; height: number },
  opts: { javaScriptEnabled?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, ...opts });
  const page = await context.newPage();
  await signInAsFixtureAdult(page, adult);
  return { context, page };
}

/** The approved viewports (M3 contract §4.5). */
export const VIEWPORTS = {
  phone: { width: 375, height: 812 },
  'tablet-portrait': { width: 768, height: 1024 },
  'tablet-landscape': { width: 1024, height: 768 },
  desktop: { width: 1280, height: 800 },
} as const;
