import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { CANARY_MARK, SENSITIVE_MARK } from '../fixtures/family';
import { signInAsFixtureAdult } from './fixture-adults';

// Export (M3 contract §7.1), over the seeded synthetic family.

test('Settings › Export downloads the adult’s own view, sensitive items left out', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/settings');
  await page.getByRole('link', { name: /Export/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Export' })).toBeVisible();
  await expect(page.getByLabel('Include sensitive items')).not.toBeChecked();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download my HOME data' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^home-export-\d{4}-\d{2}-\d{2}\.json$/);
  const body = await readFile((await download.path())!, 'utf8');
  const data = JSON.parse(body);
  expect(data.format).toBe('home-export');
  expect(data.version).toBe(2);
  expect(data.includesSensitive).toBe(false);
  expect(body).toContain(CANARY_MARK.sam);
  expect(body).not.toContain(CANARY_MARK.alex);
  expect(body).not.toContain(SENSITIVE_MARK);
  // Still on the page: a download, not a navigation.
  await expect(page).toHaveURL(/\/settings\/export$/);
});

test('ticking the box includes household sensitive items', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/settings/export');
  await page.getByLabel('Include sensitive items').check();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download my HOME data' }).click(),
  ]);
  const body = await readFile((await download.path())!, 'utf8');
  expect(JSON.parse(body).includesSensitive).toBe(true);
  expect(body).toContain(`${SENSITIVE_MARK}household`);
  expect(body).not.toContain(`${SENSITIVE_MARK}private`); // Alex's own
});

test('the download is never cached, refuses cross-site posts and needs a session', async ({
  page,
  request,
}) => {
  await signInAsFixtureAdult(page, 'alex');
  const ok = await page.request.post('/settings/export/download', { form: {} });
  expect(ok.status()).toBe(200);
  expect(ok.headers()['cache-control']).toBe('no-store');
  expect(ok.headers()['content-disposition']).toMatch(/^attachment; filename="home-export-/);
  expect(ok.headers()['content-type']).toContain('application/json');

  const cross = await page.request.post('/settings/export/download', {
    form: {},
    headers: { origin: 'https://elsewhere.example' },
  });
  expect(cross.status()).toBe(403);

  const anon = await request.post('/settings/export/download', { form: {}, maxRedirects: 0 });
  expect(anon.status()).toBe(303);
  expect(anon.headers()['location']).toMatch(/\/sign-in$/);
});
