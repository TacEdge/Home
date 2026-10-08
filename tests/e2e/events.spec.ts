import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { withDb } from './helpers';

// Events and Forward (M3 contract §3.3, §3.6), over the seeded synthetic
// family: Swimming (Wednesdays, Milo going, Sam responsible), Football
// (Saturdays, Isla), Nana Jo's birthday (all-day, 20 October). Screenshots
// land in test-results/screenshots (never committed).

const SHOTS = 'test-results/screenshots';
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const openSummary = (page: Page, text: string) =>
  page.locator('summary', { hasText: text }).click();
const eventIdNamed = (title: string) =>
  withDb(
    async (pool) =>
      (
        await pool.query(`select id from event where title = $1 and archived_at is null limit 1`, [
          title,
        ])
      ).rows[0]?.id as string,
  );
const homeToday = () =>
  withDb(
    async (pool) =>
      (
        await pool.query(
          `select to_char(now() at time zone 'Pacific/Auckland', 'YYYY-MM-DD') as d,
                  to_char((now() at time zone 'Pacific/Auckland') + interval '2 days', 'YYYY-MM-DD') as e`,
        )
      ).rows[0] as { d: string; e: string },
  );

test('Forward: the next 30 days grouped by day, in agenda order, with people', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/forward');
  await expect(page.getByRole('heading', { level: 1, name: 'Forward' })).toBeVisible();
  const ids = await page
    .locator('section[aria-labelledby^="day-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-labelledby')));
  expect(ids.length).toBeGreaterThanOrEqual(4); // Wednesdays and Saturdays within 30 days
  expect(ids).toEqual([...ids].sort()); // days in order
  const swim = page.getByRole('link', { name: /Swimming/ }).first();
  await expect(swim).toContainText('15:30');
  await expect(swim).toContainText('Milo');
  await expect(swim).toContainText('Sam');
  await expect(page.getByRole('link', { name: /Football/ }).first()).toContainText('Isla');
  expect(await page.textContent('main')).not.toContain('canary-alex');
  await swim.click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Swimming' })).toBeVisible();
  await expect(page.getByText('Every Wednesday')).toBeVisible();
  await expect(page.getByRole('link', { name: /Milo/ })).toContainText('Going');
  await shot(page, 'event-detail');
});

test('add a timed event with people, make it repeat, skip one, put it back, archive, restore', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'alex');
  await page.goto('/events/new');
  await shot(page, 'event-new-form');

  // Validation keeps what was typed and focuses the field.
  await page.getByLabel('What', { exact: true }).fill('   ');
  await page.getByLabel('Date', { exact: true }).fill('2027-03-10');
  await page.getByLabel('From', { exact: true }).fill('10:00');
  await page.getByLabel('To', { exact: true }).fill('10:45');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.getByText('This can’t be empty.')).toBeVisible();
  await expect(page.getByLabel('What', { exact: true })).toBeFocused();
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('10:00');
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2027-03-10');

  await page.getByLabel('What', { exact: true }).fill('Piano lesson');
  await page
    .getByRole('group', { name: 'Who’s going' })
    .getByLabel('Isla', { exact: true })
    .check();
  await page
    .getByRole('group', { name: 'Who’s responsible' })
    .getByLabel('Alex', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Piano lesson' })).toBeVisible();
  await expect(page.getByText('Wednesday 10 March · 10:00–10:45')).toBeVisible();
  await expect(page.getByRole('link', { name: /Isla/ })).toContainText('Going');
  await expect(page.getByRole('link', { name: /Alex/ })).toContainText('Responsible');
  const url = page.url();

  // Edit: weekly on Wednesday and Friday, 4 times; Isla no longer going.
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Repeats', { exact: true }).selectOption('weekly');
  await page.getByRole('group', { name: 'On', exact: true }).getByLabel('Wed').check();
  await page.getByRole('group', { name: 'On', exact: true }).getByLabel('Fri').check();
  await page.getByLabel('Ends', { exact: true }).selectOption('after');
  await page.getByLabel('How many times').fill('4');
  await page
    .getByRole('group', { name: 'Who’s going' })
    .getByLabel('Isla', { exact: true })
    .uncheck();
  await shot(page, 'event-edit-recurring');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(url);
  await expect(page.getByText('Every Wednesday and Friday, 4 times')).toBeVisible();
  await expect(page.getByRole('link', { name: /Isla/ })).toHaveCount(0);
  await expect(page.getByText('Nothing in the next eight weeks.')).toBeVisible(); // it starts in 2027

  // Start it today so the next few times appear; skip one, put it back.
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Date', { exact: true }).fill((await homeToday()).d);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(url);
  const first = page.locator('button[aria-label^="Skip "]').first();
  const firstDate = (await first.getAttribute('aria-label'))!.replace('Skip ', '');
  await first.click();
  await expect(page.getByRole('heading', { level: 2, name: 'Skipped' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Put back ${firstDate}` })).toBeVisible();
  await expect(page.locator(`button[aria-label="Skip ${firstDate}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: `Put back ${firstDate}` }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Skipped' })).toHaveCount(0);
  await expect(page.locator(`button[aria-label="Skip ${firstDate}"]`)).toHaveCount(1);

  // Archive, then restore; archive again so later specs see Forward as seeded.
  await openSummary(page, 'Archive');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/forward$/);
  expect(await page.textContent('main')).not.toContain('Piano lesson');
  await page.goto(url);
  await expect(page.locator('header').getByText(/archived/)).toBeVisible();
  await openSummary(page, 'Restore');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('header').getByText(/archived/)).toHaveCount(0);
  await openSummary(page, 'Archive');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/forward$/);
});

test('an all-day event over several days shows each day on Forward', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  const today = await homeToday();
  await page.goto('/events/new');
  await page.getByLabel('What', { exact: true }).fill('Camp rehearsal');
  await page.getByLabel('All day').check();
  await page.getByLabel('First day').fill(today.d);
  await page.getByLabel('Last day').fill(today.e);
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(page.locator('header').getByText(/ to /)).toBeVisible();
  const url = page.url();
  await page.goto('/forward');
  const rows = page.getByRole('link', { name: /Camp rehearsal/ });
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Day 1 of 3');
  await expect(rows.nth(2)).toContainText('Day 3 of 3');
  await page.goto(url);
  await openSummary(page, 'Archive');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/forward$/);
});

test('a synced event is read-only, with calm copy', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await withDb(async (pool) => {
    // A synthetic connection and source (migration 0007): the credential and
    // fingerprint have Package 2's shapes and seal nothing.
    const r = await pool.query(
      `with c as (
         insert into calendar_connection (owner_user_id, provider, credentials_encrypted, credentials_key_id, address_fingerprint)
         values ('fixture-sam', 'ics', 'hc1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}', '0123456789abcdef', 'fp1.e2e-synced-event-fingerprint-0000000000000')
         returning id
       ), s as (
         insert into calendar_source (created_by, created_via, visibility, connection_id, external_calendar_id, name)
         select 'fixture-sam', 'ui', 'household', c.id, 'primary', 'Appointments' from c
         returning id
       )
       insert into event (title, kind, all_day, start_date, end_date, source, calendar_source_id, external_uid, created_by, created_via, visibility)
       select 'Dentist (from calendar)', 'appointment', true, '2027-05-05', '2027-05-06', 'synced', s.id, 'uid-e2e', 'fixture-sam', 'sync', 'household' from s
       returning id`,
    );
    return r.rows[0].id as string;
  });
  await page.goto(`/events/${id}`);
  // M4 Package 6: where it comes from, and that its details are the calendar's to change.
  await expect(page.getByText('From Appointments calendar · not updated yet')).toBeVisible();
  await expect(
    page.getByText('This comes from Appointments calendar, so change those details there.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await expect(page.locator('summary', { hasText: 'Archive' })).toHaveCount(0);
  await page.goto(`/events/${id}/edit`);
  await expect(page).toHaveURL(new RegExp(`/events/${id}$`));
  await withDb(async (pool) => {
    const s = await pool.query(`delete from event where id = $1 returning calendar_source_id`, [
      id,
    ]);
    const c = await pool.query(
      `delete from calendar_source where id = $1 returning connection_id`,
      [s.rows[0].calendar_source_id],
    );
    await pool.query(`delete from calendar_connection where id = $1`, [c.rows[0].connection_id]);
  });
});

test("the other adult's private event reads as not found; a person's Coming up uses the agenda", async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'alex');
  const id = await eventIdNamed('canary-sam-event');
  await page.goto(`/events/${id}`);
  await expect(page.getByRole('heading', { name: 'Nothing here.' })).toBeVisible();
  await page.goto(`/events/${id}/edit`);
  await expect(page.getByRole('heading', { name: 'Nothing here.' })).toBeVisible();
  const milo = await withDb(
    async (pool) =>
      (await pool.query(`select id from person where name = 'Milo'`)).rows[0].id as string,
  );
  await page.goto(`/people/${milo}`);
  await expect(page.locator('section[aria-labelledby^="day-"]').first()).toBeVisible();
  // Coming up's row (Usually, above it, carries no people).
  const swim = page
    .locator('section[aria-labelledby^="day-"]')
    .getByRole('link', { name: /Swimming/ })
    .first();
  await expect(swim).toBeVisible();
  await expect(swim).toContainText('Sam'); // the same people as Forward shows
  expect(await page.textContent('main')).not.toContain('Football'); // Isla's, not Milo's
});

test('a crafted skip of a one-off event is refused, calmly', async ({ page }) => {
  await signInAsFixtureAdult(page, 'alex');
  const swim = await eventIdNamed('Swimming');
  const nana = await eventIdNamed("Nana Jo's birthday");
  // Tamper after hydration (the server page is the same; React must not reset the values).
  await page.goto(`/events/${swim}`, { waitUntil: 'networkidle' });
  await page.evaluate((id) => {
    const f = document.querySelector('button[aria-label^="Skip "]')!.closest('form')!;
    (f.querySelector('input[name=id]') as HTMLInputElement).value = id;
    (f.querySelector('input[name=date]') as HTMLInputElement).value = '2026-10-20';
  }, nana);
  await page.locator('button[aria-label^="Skip "]').first().click();
  await expect(page.getByText('This happens once, so there’s nothing to skip.')).toBeVisible();
  await page.goto('/forward');
  await expect(
    page.getByRole('link', { name: /Nana Jo’s birthday|Nana Jo's birthday/ }).first(),
  ).toBeVisible();
  // And a date the rule does not reach.
  await page.goto(`/events/${swim}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const f = document.querySelector('button[aria-label^="Skip "]')!.closest('form')!;
    (f.querySelector('input[name=date]') as HTMLInputElement).value = '2026-10-22';
  });
  await page.locator('button[aria-label^="Skip "]').first().click();
  await expect(page.getByText('That isn’t one of the times this happens.')).toBeVisible();
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`accessibility, no horizontal scroll and screenshots: ${name}`, async ({ browser }) => {
    const { context, page } = await fixtureAdultContext(browser, 'sam', viewport);
    const swim = await eventIdNamed('Swimming');
    for (const path of ['/forward', '/events/new', `/events/${swim}`, `/events/${swim}/edit`]) {
      await page.goto(path);
      await expectNoHorizontalScroll(page, `${name} ${path}`);
      await expectAccessible(page, `${name} ${path}`);
    }
    await page.goto('/forward');
    if (name === 'phone') await shot(page, 'forward-phone');
    if (name === 'tablet-portrait') await shot(page, 'forward-ipad');
    await context.close();
  });
}
