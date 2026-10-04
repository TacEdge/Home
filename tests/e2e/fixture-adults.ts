import type { Browser, BrowserContext, Page } from '@playwright/test';
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

/** Signs a page in as a fixture adult. Lands on Today. */
export async function signInAsFixtureAdult(page: Page, adult: Adult): Promise<void> {
  // Each test signs in afresh; the per-IP link limit is a production control,
  // reset here so a long suite never trips it.
  await withDb((pool) => pool.query('delete from "rate_limit"'));
  await signIn(page, FIXTURE_ADULTS[adult].email);
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
