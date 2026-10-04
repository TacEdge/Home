import { expect, test, type Page } from '@playwright/test';
import { CANARY_MARK } from '../fixtures/family';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { withDb } from './helpers';

// People and You (M3 contract §3.4), over the seeded synthetic family: Sam
// and Alex (linked), Milo, Isla, Nana Jo, each adult's private canary
// person, and an archived person.

const personIdNamed = (like: string) =>
  withDb(
    async (pool) =>
      (await pool.query(`select id from person where name like $1 limit 1`, [like])).rows[0]
        ?.id as string,
  );

async function openSummary(page: Page, text: string) {
  await page.locator('summary', { hasText: text }).click();
}

test('the list: household first, "you" marked, nothing of the other adult', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.getByLabel('Menu', { exact: true }).click();
  await page
    .getByRole('navigation', { name: 'More places' })
    .getByRole('link', { name: 'People' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
  const home = page.getByRole('list').first();
  await expect(home.getByRole('link')).toHaveText([/Alex/, /Isla/, /Milo/, /Sam.*you/]);
  const body = await page.textContent('main');
  expect(body).toContain('Nana Jo');
  expect(body).toContain(`${CANARY_MARK.sam}person`); // own private person
  expect(body).not.toContain(CANARY_MARK.alex);
  expect(body).not.toContain('canary-archived');
});

test('a profile: age and next birthday, things to know, no sensitive context', async ({ page }) => {
  await signInAsFixtureAdult(page, 'alex');
  await page.goto(`/people/${await personIdNamed('Milo')}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Milo');
  await expect(page.locator('header').getByText(/Child · age \d+/)).toBeVisible();
  await expect(page.getByText('Enjoys dinosaurs at the moment.')).toBeVisible();
  await expect(page.getByText(/Turns \d+|Birthday today/)).toBeVisible();
  expect(await page.textContent('main')).not.toContain('canary-sensitive');
});

test('add, edit, archive and restore someone', async ({ page }) => {
  await signInAsFixtureAdult(page, 'alex');
  await page.goto('/people/new');
  // Validation reads calmly, in place (a blank name gets past the browser's
  // own required check; the shared schema trims it and refuses).
  await page.getByLabel('Name', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Add them' }).click();
  await expect(page.getByText('This can’t be empty.')).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill('Uncle Rehearsal');
  await page.getByLabel('Role').selectOption('other');
  await page.getByLabel('Lives at home').uncheck();
  await openSummary(page, 'More');
  await page.getByLabel('Relationship').fill("Alex's brother");
  await page.getByRole('button', { name: 'Add them' }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Uncle Rehearsal');
  await expect(page.getByText("Alex's brother · lives elsewhere")).toBeVisible();

  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Right now').fill('Visiting in the holidays.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Visiting in the holidays.')).toBeVisible();

  const url = page.url();
  await openSummary(page, 'Archive');
  await expect(page.getByText('Nothing is deleted')).toBeVisible();
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/people$/);
  expect(await page.textContent('main')).not.toContain('Uncle Rehearsal');

  await page.goto(url);
  await expect(page.locator('header').getByText(/archived/)).toBeVisible();
  await openSummary(page, 'Restore');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('header').getByText(/archived/)).toHaveCount(0);
  await page.goto('/people');
  expect(await page.textContent('main')).toContain('Uncle Rehearsal');
});

test("the other adult's private person reads as not found", async ({ page }) => {
  await signInAsFixtureAdult(page, 'alex');
  const id = await personIdNamed(`${CANARY_MARK.sam}person%`);
  await page.goto(`/people/${id}`);
  await expect(page.getByRole('heading', { name: 'Nothing here.' })).toBeVisible();
  await page.goto(`/people/${id}/edit`);
  await expect(page.getByRole('heading', { name: 'Nothing here.' })).toBeVisible();
});

test('a linked person: the rules are explained in words, not just disabled', async ({ page }) => {
  await signInAsFixtureAdult(page, 'alex');
  const sam = await personIdNamed('Sam');
  await page.goto(`/people/${sam}`);
  await expect(page.getByText('This is someone’s own record, so it stays')).toBeVisible();
  await expect(page.locator('summary', { hasText: 'Archive' })).toHaveCount(0);
  await page.goto(`/people/${sam}/edit`);
  await expect(page.getByLabel('Role')).toHaveCount(0);
  await expect(page.getByText('so it stays a parent everyone at home can see')).toBeVisible();
  await openSummary(page, 'More');
  await page.getByLabel('Short name').fill('Sammy');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${sam}$`));
});

test('You: not me, the Today prompt, add me, and this is me', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/settings/you');
  await expect(page.getByText('In HOME, you are')).toBeVisible();
  await openSummary(page, 'Not me');
  await page.getByRole('button', { name: "That's not me" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Which one is you?' })).toBeVisible();

  await page.goto('/today');
  await page.getByRole('link', { name: 'Which one is you? ›' }).click();
  await expect(page).toHaveURL(/\/settings\/you$/);
  // The unlinked Sam is eligible again; the linked Alex is not offered.
  const eligible = page.getByRole('list').first();
  await expect(eligible).toContainText('Sam');
  await expect(eligible).not.toContainText('Alex');

  // A refused Add me keeps the typed name.
  const tooLong = 'S'.repeat(101);
  await page.getByLabel('Your name').fill(tooLong);
  await page.getByRole('button', { name: 'Add me' }).click();
  await expect(page.getByText('That’s too long.')).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue(tooLong);
  await expect(page.getByLabel('Your name')).toBeFocused();

  await page.getByLabel('Your name').fill('Sam Again');
  await page.getByRole('button', { name: 'Add me' }).click();
  await expect(page.getByText('In HOME, you are')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sam Again' })).toBeVisible();
  await page.goto('/today');
  await expect(page.getByRole('link', { name: 'Which one is you? ›' })).toHaveCount(0);

  // Back to the real Sam.
  await page.goto('/settings/you');
  await openSummary(page, 'Not me');
  await page.getByRole('button', { name: "That's not me" }).click();
  // Each choice is named for its person (one accessible name per button).
  await expect(
    page.getByRole('button', { name: 'This is me: Sam Again', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'This is me: Sam', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Sam', exact: true })).toBeVisible();
  await page.goto('/people');
  await expect(
    page
      .getByRole('list')
      .first()
      .getByRole('link', { name: /^Sam · you/ }),
  ).toBeVisible();

  // Leave nothing behind for later specs: archive the person Add me made.
  await page.getByRole('link', { name: /^Sam Again/ }).click();
  await openSummary(page, 'Archive');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/people$/);
  expect(await page.textContent('main')).not.toContain('Sam Again');
});

test('You works without JavaScript', async ({ browser }) => {
  const signedIn = await fixtureAdultContext(browser, 'alex', VIEWPORTS.phone);
  const state = await signedIn.context.storageState();
  await signedIn.context.close();
  const context = await browser.newContext({
    viewport: VIEWPORTS.phone,
    javaScriptEnabled: false,
    storageState: state,
  });
  const page = await context.newPage();
  await page.goto('/settings/you');
  await openSummary(page, 'Not me');
  await page.getByRole('button', { name: "That's not me" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Which one is you?' })).toBeVisible();
  // A refused Add me keeps the typed name, without JavaScript too.
  const tooLong = 'A'.repeat(101);
  await page.getByLabel('Your name').fill(tooLong);
  await page.getByRole('button', { name: 'Add me' }).click();
  await expect(page.getByText('That’s too long.')).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue(tooLong);
  await page.getByRole('button', { name: 'This is me: Alex', exact: true }).click();
  await expect(page.getByText('In HOME, you are')).toBeVisible();

  // The person form keeps what was typed after a refusal, without JavaScript.
  await page.goto('/people/new');
  await page.getByLabel('Name', { exact: true }).fill('   ');
  await page.getByLabel('Role').selectOption('other');
  await page.getByLabel('Right now').fill('Typed without JavaScript');
  await page.getByRole('button', { name: 'Add them' }).click();
  await expect(page.getByText('This can’t be empty.')).toBeVisible();
  await expect(page.getByLabel('Role')).toHaveValue('other');
  await expect(page.getByLabel('Right now')).toHaveValue('Typed without JavaScript');
  await context.close();
});

test('a refused save keeps what was typed (JavaScript on)', async ({ page }) => {
  await signInAsFixtureAdult(page, 'alex');
  // Validation.
  await page.goto('/people/new');
  await page.getByLabel('Name', { exact: true }).fill('   ');
  await page.getByLabel('Role').selectOption('other');
  await page.getByLabel('Right now').fill('Typed before the error');
  await openSummary(page, 'More');
  await page.getByLabel('Relationship').fill('A neighbour');
  await page.getByRole('button', { name: 'Add them' }).click();
  await expect(page.getByText('This can’t be empty.')).toBeVisible();
  // Focus goes to the field that needs another look, not the top of the page.
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Role')).toHaveValue('other');
  await expect(page.getByLabel('Right now')).toHaveValue('Typed before the error');
  await expect(page.getByLabel('Relationship')).toHaveValue('A neighbour'); // More stays open

  // A domain rule: only the person who added Milo (Sam) may change who sees him.
  const milo = await personIdNamed('Milo');
  await page.goto(`/people/${milo}/edit`);
  await page.getByLabel('Right now').fill('An edit that will be refused');
  await openSummary(page, 'More');
  await page.getByLabel('Who can see this').selectOption('private');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByText('Only the person who added this can change who sees it.'),
  ).toBeVisible();
  // A refusal that names no field: focus goes to the form's message.
  await expect(
    page.locator('[data-form-message]', {
      hasText: 'Only the person who added this can change who sees it.',
    }),
  ).toBeFocused();
  await expect(page.getByLabel('Right now')).toHaveValue('An edit that will be refused');
  await expect(page.getByLabel('Who can see this')).toHaveValue('private');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Milo');
  // Nothing was saved.
  await page.goto(`/people/${milo}`);
  expect(await page.textContent('main')).not.toContain('An edit that will be refused');
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`accessibility and no horizontal scroll on the People screens: ${name}`, async ({
    browser,
  }) => {
    const { context, page } = await fixtureAdultContext(browser, 'alex', viewport);
    const milo = await personIdNamed('Milo');
    for (const path of [
      '/people',
      '/people/new',
      `/people/${milo}`,
      `/people/${milo}/edit`,
      '/settings/you',
    ]) {
      await page.goto(path);
      await expectNoHorizontalScroll(page, `${name} ${path}`);
      await expectAccessible(page, `${name} ${path}`);
    }
    await context.close();
  });
}
