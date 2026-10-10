import { expect, test } from '@playwright/test';
import { signInAsFixtureAdult } from './fixture-adults';
import { withDb } from './helpers';

// The browser smoke suite (ADR 0010): a small, independent check that the
// app still signs people in, shows Today and Forward, navigates between
// places, and keeps one adult's private record from the other. It runs with
// every medium-risk change (scripts/ci-select.mts) beside the specs mapped
// to the change. It depends only on the global setup's seeded fixture
// household: every record it needs it inserts itself (titles prefixed
// `smoke `), and it puts them away afterwards. It is not the device or
// privacy sweep, which run in full regression. Synthetic data only.

const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);

const SHARED = 'smoke household dinner';
const PRIVATE = 'smoke alex-only appointment';
let privateId = '';

test.beforeAll(async () => {
  // Two days ahead in the home zone, so both records are on Forward (never
  // on the edge of today's evening state).
  const [row] = await q(
    `select to_char(now() at time zone 'Pacific/Auckland' + interval '2 days', 'YYYY-MM-DD') as d`,
  );
  const day = row!.d;
  const insert = (title: string, owner: string, visibility: string) =>
    q(
      `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, created_by, created_via, visibility, source)
       values ($1, 'social', false,
               ($2 || 'T18:00:00')::timestamp at time zone 'Pacific/Auckland',
               ($2 || 'T19:00:00')::timestamp at time zone 'Pacific/Auckland',
               'Pacific/Auckland', $3, 'ui', $4, 'manual') returning id`,
      [title, day, owner, visibility],
    );
  await insert(SHARED, 'fixture-sam', 'household');
  privateId = (await insert(PRIVATE, 'fixture-alex', 'private'))[0]!.id!;
});

test.afterAll(async () => {
  await q(
    `update event set archived_at = now() where title like 'smoke %' and archived_at is null`,
  );
});

test('authentication: signed out goes to sign-in; signing in lands on Today', async ({ page }) => {
  await page.goto('/today');
  await expect(page).toHaveURL(/\/sign-in/);
  await signInAsFixtureAdult(page, 'sam');
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('Today and Forward render, and the switch moves between them', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Forward' }).first().click();
  await expect(page).toHaveURL(/\/forward$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Forward' })).toBeVisible();
  // (The headline's "based on" list names it too: look in Coming up.)
  await expect(page.locator('li[data-unit]').getByText(SHARED)).toBeVisible();
  await page.getByRole('link', { name: 'Today' }).first().click();
  await expect(page).toHaveURL(/\/today$/);
});

test('basic navigation: the places reached from the shell answer', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  for (const path of ['/people', '/home', '/tasks', '/sort', '/settings']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }), path).toBeVisible();
  }
});

test('two adults: Alex’s private record is Alex’s alone; the household’s is both', async ({
  browser,
}) => {
  const alex = await browser.newContext();
  const alexPage = await alex.newPage();
  await signInAsFixtureAdult(alexPage, 'alex');
  await alexPage.goto('/forward');
  await expect(alexPage.locator('li[data-unit]').getByText(PRIVATE)).toBeVisible();
  await expect(alexPage.locator('li[data-unit]').getByText(SHARED)).toBeVisible();
  await alex.close();

  const sam = await browser.newContext();
  const samPage = await sam.newPage();
  await signInAsFixtureAdult(samPage, 'sam');
  for (const path of ['/forward', '/today']) {
    await samPage.goto(path);
    await expect(samPage.locator('body')).not.toContainText(PRIVATE);
  }
  await samPage.goto('/forward');
  await expect(samPage.locator('li[data-unit]').getByText(SHARED)).toBeVisible();
  // Asked for directly, the private record does not exist for Sam.
  const res = await samPage.goto(`/events/${privateId}`);
  expect(res?.status()).toBe(404);
  await expect(samPage.locator('body')).not.toContainText(PRIVATE);
  await sam.close();
});
