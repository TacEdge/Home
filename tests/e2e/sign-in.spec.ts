import { expect, test } from '@playwright/test';
import { MAIN_URL, NARROW_URL } from '../../playwright.config';
import { OUTSIDER, SAM } from '../fixtures/users';
import { SENT_TEXT, requestLink, signIn, withDb } from './helpers';
import { readMailbox, waitForLink } from './mailbox';

// M1 contract §8.3. Serial: each test builds on a known state of the shared
// test database (reset once in global setup).
test.describe.configure({ mode: 'serial' });

// Rate limits have their own integration tests; this suite makes many requests
// from one machine, so each test starts with a clean counter.
test.beforeEach(async () => {
  await withDb((pool) => pool.query('delete from "rate_limit"'));
});

test('1. unauthenticated visit to /today redirects to /sign-in', async ({ page }) => {
  await page.goto('/today');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'HOME' })).toBeVisible();
});

test('2. an allowlisted user requests a link and signs in with it', async ({ page }) => {
  const since = await requestLink(page, SAM.email);
  await expect(page.getByText(SENT_TEXT)).toBeVisible();
  const link = await waitForLink(SAM.email, since);
  expect(link).toContain('/api/auth/magic-link/verify?token=');
  await page.goto(link ?? '');
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { name: 'Today will live here.' })).toBeVisible();
});

test('3. a non-allowlisted address gets the identical confirmation and no mail', async ({
  page,
}) => {
  const before = (await readMailbox()).length;
  await requestLink(page, OUTSIDER.email);
  await expect(page.getByText(SENT_TEXT)).toBeVisible();
  const link = await waitForLink(OUTSIDER.email, new Date(Date.now() - 60_000), 1500);
  expect(link).toBeNull();
  expect((await readMailbox()).length).toBe(before);
  await page.goto('/today');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('4. a magic link works once; reused and expired links are rejected', async ({ page }) => {
  const since = await requestLink(page, SAM.email);
  const link = await waitForLink(SAM.email, since);
  await page.goto(link ?? '');
  await expect(page).toHaveURL(/\/today$/);

  // Reuse from a fresh context: no session, dead token → error path.
  const fresh = await page.context().browser()?.newContext();
  const p2 = await fresh!.newPage();
  await p2.goto(link ?? '');
  await expect(p2).toHaveURL(/\/sign-in\?error=[A-Za-z_]+$/);
  await expect(p2.getByText(/That link didn.t work/)).toBeVisible();
  await fresh!.close();

  // Expired: from a signed-out context, request another link, push its expiry
  // into the past, then follow it.
  const fresh2 = await page.context().browser()?.newContext();
  const p3 = await fresh2!.newPage();
  const since2 = await requestLink(p3, SAM.email);
  const link2 = await waitForLink(SAM.email, since2);
  await withDb((pool) =>
    pool.query(`update "verification" set expires_at = now() - interval '1 minute'`),
  );
  await p3.goto(link2 ?? '');
  await expect(p3).toHaveURL(/\/sign-in\?error=[A-Za-z_]+$/);
  await fresh2!.close();
});

test('5. a signed-in user sees the places nav and their sign-in in Activity', async ({ page }) => {
  await signIn(page, SAM.email);
  const nav = page.getByRole('navigation', { name: 'Places' });
  await expect(nav.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Forward' })).toBeVisible();
  await nav.getByRole('link', { name: 'Forward' }).click();
  await expect(page.getByRole('heading', { name: 'Forward will live here.' })).toBeVisible();

  await page.goto('/settings/activity');
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  await expect(page.getByText('Signed in').first()).toBeVisible();
  await expect(page.getByText('Sign-in link requested').first()).toBeVisible();
  // Denied attempts show up, but never the address.
  await expect(page.getByText('Sign-in refused').first()).toBeVisible();
  await expect(page.getByText(OUTSIDER.email)).toHaveCount(0);
});

test('6. sign-out ends the session server-side', async ({ page }) => {
  await signIn(page, SAM.email);
  const count = () =>
    withDb(
      async (pool) => (await pool.query('select count(*)::int as n from "session"')).rows[0]?.n,
    );
  const before = await count();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/today');
  await expect(page).toHaveURL(/\/sign-in$/);
  // The session row is gone, not just the cookie.
  expect(await count()).toBe(before - 1);
});

test('7. removing an address from the allowlist signs that person out on the next request', async ({
  page,
}) => {
  await signIn(page, SAM.email);
  // Same cookie jar, a server whose allowlist no longer includes Sam.
  await page.goto(`${NARROW_URL}/today`);
  await expect(page).toHaveURL(/localhost:3334\/sign-in$/);
  // The session was revoked, so the main server no longer accepts it either.
  await page.goto('/today');
  await expect(page).toHaveURL(/localhost:3333\/sign-in$/);
});

test('8. security headers are present', async ({ request }) => {
  for (const path of ['/sign-in', '/today']) {
    const res = await request.get(path, { maxRedirects: 0 });
    const h = res.headers();
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('same-origin');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-robots-tag']).toContain('noindex');
    expect(h['x-powered-by']).toBeUndefined();
  }
});

test('9. sign-in and the Today shell render at phone and desktop widths', async ({ browser }) => {
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1440, height: 900 }],
  ] as const) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto('/sign-in');
    await expect(page.getByLabel('Email')).toBeVisible();
    await page.screenshot({ path: `test-results/${name}-sign-in.png` });
    await signIn(page, SAM.email);
    await expect(page.getByRole('heading', { name: 'Today will live here.' })).toBeVisible();
    // No horizontal overflow on phones.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({ path: `test-results/${name}-today.png` });
    await ctx.close();
  }
});

test('10. only the magic-link verify endpoint is public under /api/auth', async ({ request }) => {
  const tokens = () =>
    withDb(
      async (pool) =>
        (await pool.query('select count(*)::int as n from "verification"')).rows[0]?.n as number,
    );
  const before = await tokens();
  const signIn = await request.post('/api/auth/sign-in/magic-link', {
    data: { email: SAM.email, callbackURL: '/today' },
    headers: { origin: MAIN_URL },
  });
  expect(signIn.status()).toBe(404);
  expect(await tokens()).toBe(before);

  for (const [method, path] of [
    ['get', '/api/auth/get-session'],
    ['post', '/api/auth/update-user'],
    ['post', '/api/auth/sign-out'],
    ['get', '/api/auth/list-sessions'],
    ['post', '/api/auth/magic-link/verify'],
  ] as const) {
    const res = await request[method](path, { headers: { origin: MAIN_URL } });
    expect(res.status(), `${method.toUpperCase()} ${path}`).toBe(404);
  }
  // The one public path still answers (a bad token is an auth error, not a 404).
  const verify = await request.get('/api/auth/magic-link/verify?token=nope', { maxRedirects: 0 });
  expect(verify.status()).not.toBe(404);
});
