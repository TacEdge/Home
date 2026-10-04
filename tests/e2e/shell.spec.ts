import { expect, test } from '@playwright/test';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';

// The M3 shell (M3 contract §3.1, §4): wordmark, Today/Forward switch, the ⌂
// menu of quiet places, Settings, and the accessibility baseline at every
// approved viewport. Signed in as a seeded fixture adult.

const SCREENS = [
  '/today',
  '/forward',
  '/settings',
  '/settings/activity',
  '/settings/export',
  '/people',
  '/people/new',
  '/settings/you',
  '/events/new',
  '/home',
  '/home/projects/new',
  '/tasks',
  '/tasks/new',
  '/sort',
];

test('the ⌂ menu lists only places that exist, and closes on Escape', async ({ page }) => {
  await signInAsFixtureAdult(page, 'alex');
  await page.getByLabel('Menu', { exact: true }).click();
  const more = page.getByRole('navigation', { name: 'More places' });
  await expect(more.getByRole('link')).toHaveText([
    'People',
    'Home',
    'To do',
    'To sort',
    'Settings',
  ]);
  await page.keyboard.press('Escape');
  await expect(more).toBeHidden();
  await page.getByLabel('Menu', { exact: true }).click();
  await more.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  // It closes once the page changes.
  await expect(more).toBeHidden();
});

test('the menu and Settings work without JavaScript', async ({ browser }) => {
  // Sign in with JavaScript, then reuse the session in a context without it.
  const signedIn = await fixtureAdultContext(browser, 'sam', VIEWPORTS.phone);
  const state = await signedIn.context.storageState();
  await signedIn.context.close();
  const context = await browser.newContext({
    viewport: VIEWPORTS.phone,
    javaScriptEnabled: false,
    storageState: state,
  });
  const page = await context.newPage();
  await page.goto('/today');
  await page.getByLabel('Menu', { exact: true }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText('Signed in as sam@example.test')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await context.close();
});

test('keyboard: skip link first, then the header in order', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'HOME' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Today' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Menu', { exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'More places' })).toBeVisible();
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`accessibility, targets and no horizontal scroll: ${name}`, async ({ browser }) => {
    const { context, page } = await fixtureAdultContext(browser, 'alex', viewport);
    for (const path of SCREENS) {
      await page.goto(path);
      await expectNoHorizontalScroll(page, `${name} ${path}`);
      await expectAccessible(page, `${name} ${path}`);
    }
    // Every control in the header is at least 44px tall (M3 contract §4.5).
    await page.goto('/today');
    const controls = page.locator('header a, header summary');
    for (let i = 0; i < (await controls.count()); i++) {
      const box = await controls.nth(i).boundingBox();
      expect(box?.height ?? 0, `header control ${i}`).toBeGreaterThanOrEqual(44);
    }
    await context.close();

    // Signed out: the sign-in page meets the same baseline.
    const anon = await browser.newContext({ viewport });
    const p = await anon.newPage();
    await p.goto('/sign-in');
    await expectNoHorizontalScroll(p, `${name} /sign-in`);
    await expectAccessible(p, `${name} /sign-in`);
    await anon.close();
  });
}
