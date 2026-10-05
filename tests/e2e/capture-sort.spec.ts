import { expect, test, type Page } from '@playwright/test';
import { CANARY_MARK } from '../fixtures/family';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { withDb } from './helpers';

// Capture and To sort (M3 contract §3.2, §3.8). Every capture made here
// starts with "p7 " and is archived at the end (with what it became), so
// later specs see To sort, To do and Today as seeded. Screenshots land in
// test-results/screenshots (never committed).

const SHOTS = 'test-results/screenshots';
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const bar = (page: Page) => page.getByPlaceholder('Tell HOME something…');
const keep = (page: Page) => page.getByRole('button', { name: 'Keep', exact: true });
const captureRow = (text: string) =>
  withDb(
    async (pool) =>
      (
        await pool.query(`select * from capture where text = $1 order by created_at desc limit 1`, [
          text,
        ])
      ).rows[0] as Record<string, unknown> & { id: string },
  );
async function tell(page: Page, words: string) {
  await bar(page).fill(words);
  await keep(page).click();
  await expect(page.locator('#capture-status')).toContainText('✓ Kept · in To sort');
  await expect(bar(page)).toHaveValue('');
}

test.afterAll(async () => {
  await withDb(async (pool) => {
    const ids = (await pool.query(`select id from capture where text like 'p7 %'`)).rows.map(
      (r: { id: string }) => r.id,
    );
    for (const t of ['task', 'note', 'context', 'event', 'project'])
      await pool.query(
        `update ${t} set archived_at = now() where origin_capture_id = any($1::uuid[]) and archived_at is null`,
        [ids],
      );
    await pool.query(`update capture set archived_at = now() where id = any($1::uuid[])`, [ids]);
  });
});

test('the capture bar keeps the exact words, privately, and says so only after the server does', async ({
  browser,
}) => {
  const { context, page } = await fixtureAdultContext(browser, 'sam', VIEWPORTS.phone);
  await page.goto('/forward');
  await expect(bar(page)).toBeVisible();
  await bar(page).fill('p7 book  the WOF before Friday ');
  await shot(page, 'capture-bar-phone');
  await keep(page).click();
  await expect(page.locator('#capture-status')).toContainText('✓ Kept · in To sort');
  await expect(bar(page)).toHaveValue('');
  const row = await captureRow('p7 book  the WOF before Friday ');
  expect(row).toMatchObject({
    visibility: 'private',
    status: 'new',
    created_via: 'ui',
    channel: 'web',
  });

  // Only spaces: refused calmly, the words stay, focus returns to the box.
  await bar(page).fill('   ');
  await keep(page).click();
  await expect(page.locator('#capture-status')).toContainText(
    'There’s nothing to keep yet. Your words are still here.',
  );
  await expect(bar(page)).toHaveValue('   ');
  await expect(bar(page)).toBeFocused();
  await context.close();
});

test('the capture bar works without JavaScript', async ({ browser }) => {
  const { context, page } = await fixtureAdultContext(browser, 'alex', VIEWPORTS.desktop, {
    javaScriptEnabled: false,
  });
  await page.goto('/people');
  await bar(page).fill('p7 no-script words');
  await keep(page).click();
  await expect(page.getByText('✓ Kept ·')).toBeVisible();
  expect(await captureRow('p7 no-script words')).toBeTruthy();
  await context.close();
});

test('To sort: newest first, exact words, soft time, private; Today counts it in words', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/sort');
  await tell(page, 'p7 first: ask Nana Jo about Christmas');
  await tell(page, 'p7 second: the dishwasher is making that noise again');
  await tell(page, 'p7 third: Milo needs new togs');
  await page.goto('/sort');
  const words = page.locator('main li > p.whitespace-pre-wrap');
  await expect(words.nth(0)).toHaveText('p7 third: Milo needs new togs');
  await expect(words.nth(1)).toHaveText('p7 second: the dishwasher is making that noise again');
  await expect(page.locator('main li').first()).toContainText('just now');
  const body = await page.textContent('main');
  expect(body).toContain(`${CANARY_MARK.sam}capture`); // own Kev-captured words wait here too
  expect(body).not.toContain(CANARY_MARK.alex);
  expect(body).not.toContain('p7 no-script words'); // Alex's
  await shot(page, 'sort-list');

  const waiting = await page.locator('main li').count();
  await page.goto('/today');
  await expect(page.getByRole('link', { name: /things? to sort/ })).toBeVisible();
  const line = (await page.getByRole('link', { name: /things? to sort/ }).textContent()) ?? '';
  expect(line).toMatch(/^(One|Two|Three|Four|Five|Six|Seven|Eight|Nine|\d+) things? to sort/);
  expect(waiting).toBeGreaterThanOrEqual(4);
});

test('Make it a task, then make another: a note; the capture leaves To sort', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/sort');
  await tell(page, 'p7 back fence: buy paint and fix the gate latch');
  await page.goto('/sort');
  await page.getByRole('link', { name: /Make it a…: p7 back fence/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Make it a…' })).toBeVisible();
  await shot(page, 'make-it-a');
  await page.getByRole('link', { name: /^Task/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Make it a task' })).toBeVisible();
  await expect(page.getByLabel('What', { exact: true })).toHaveValue(
    'p7 back fence: buy paint and fix the gate latch',
  );
  await page.getByLabel('What', { exact: true }).fill('p7 Fix the gate latch');
  await page.locator('summary', { hasText: 'More' }).click();
  await page.getByLabel('Part of').selectOption({ label: 'Back fence' });
  await page.getByRole('button', { name: 'Make it a task' }).click();
  await expect(page).toHaveURL(/\/sort\/[0-9a-f-]{36}\?made=task$/);
  await expect(page.getByRole('status').filter({ hasText: '✓ Made it a task.' })).toBeVisible();
  await expect(page.getByRole('link', { name: /p7 Fix the gate latch/ })).toContainText('Task');
  await shot(page, 'organised');

  // The record carries where it came from; the capture is organised, its words untouched.
  const c = await captureRow('p7 back fence: buy paint and fix the gate latch');
  expect(c).toMatchObject({ status: 'organised' });
  const t = await withDb(
    async (pool) =>
      (
        await pool.query(
          `select created_via, origin_capture_id from task where title = 'p7 Fix the gate latch'`,
        )
      ).rows[0],
  );
  expect(t).toEqual({ created_via: 'ui', origin_capture_id: c.id });

  // Make another: a note on the Garage project.
  await expect(page.getByRole('heading', { level: 2, name: 'Make another' })).toBeVisible();
  await page.getByRole('link', { name: /^Note on something/ }).click();
  await page.getByLabel('What it’s about').selectOption({ label: 'Project: Garage' });
  await page.getByLabel('The note').fill('p7 Check the paint tin in the garage.');
  await page.getByRole('button', { name: 'Make it a note' }).click();
  await expect(page.getByRole('status').filter({ hasText: '✓ Made it a note.' })).toBeVisible();
  await expect(page.locator('main').getByRole('link')).toContainText([
    'p7 Fix the gate latch',
    'p7 Check the paint tin in the garage.',
  ]);
  await page.goto('/sort');
  expect(await page.textContent('main')).not.toContain('p7 back fence');
});

test('Make it a project, from a capture: the fifth kind keeps where it came from', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/sort');
  await tell(page, 'p7 sort out the shed');
  const shed = await captureRow('p7 sort out the shed');
  await page.goto(`/sort/${shed.id}/project`);
  await expect(page.getByLabel('What', { exact: true })).toHaveValue('p7 sort out the shed');
  await page.getByRole('button', { name: 'Make it a project' }).click();
  await expect(page.getByRole('link', { name: /p7 sort out the shed/ })).toContainText('Project');
  const made = await withDb(
    async (pool) =>
      (
        await pool.query(
          `select title, created_via, created_by from project where origin_capture_id = $1`,
          [shed.id],
        )
      ).rows,
  );
  expect(made).toEqual([
    { title: 'p7 sort out the shed', created_via: 'ui', created_by: 'fixture-sam' },
  ]);
  expect(await captureRow('p7 sort out the shed')).toMatchObject({ status: 'organised' });
});

test('Something to know and an event, from a capture; a failed organise reads calmly and keeps it waiting', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/sort');
  await tell(page, 'p7 bins go out Tuesday night');
  await tell(page, 'p7 dentist for Isla 3 March');
  await tell(page, 'p7 a household task about someone private');

  const bins = await captureRow('p7 bins go out Tuesday night');
  await page.goto(`/sort/${bins.id}/know`);
  await expect(page.getByLabel('What to know')).toHaveValue('p7 bins go out Tuesday night');
  await page.getByLabel('Kind').selectOption('routine');
  await page.getByRole('button', { name: 'Keep it' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '✓ Kept as something to know.' }),
  ).toBeVisible();
  const ctx = await withDb(
    async (pool) =>
      (
        await pool.query(
          `select source_type, source_ref, sensitivity, created_via from context where origin_capture_id = $1`,
          [bins.id],
        )
      ).rows[0],
  );
  expect(ctx).toEqual({
    source_type: 'capture',
    source_ref: bins.id,
    sensitivity: 'normal',
    created_via: 'ui',
  });

  const dentist = await captureRow('p7 dentist for Isla 3 March');
  await page.goto(`/sort/${dentist.id}/event`);
  await expect(page.getByLabel('What', { exact: true })).toHaveValue('p7 dentist for Isla 3 March');
  await page.getByLabel('Date', { exact: true }).fill('2027-03-03');
  await page.getByRole('button', { name: 'Make it an event' }).click();
  await expect(page.getByRole('link', { name: /p7 dentist for Isla/ })).toContainText('Event');

  // A household task about Sam's private person: refused by the executor, nothing made.
  const priv = await captureRow('p7 a household task about someone private');
  await page.goto(`/sort/${priv.id}/task`);
  await page.locator('summary', { hasText: 'More' }).click();
  await page.getByLabel('Who it’s about').selectOption({ label: `${CANARY_MARK.sam}person-7f3a` });
  await page.getByRole('button', { name: 'Make it a task' }).click();
  await expect(
    page.getByText('Something private can’t be linked to something everyone sees.'),
  ).toBeVisible();
  await expect(page.getByLabel('What', { exact: true })).toHaveValue(
    'p7 a household task about someone private',
  );
  expect(await captureRow('p7 a household task about someone private')).toMatchObject({
    status: 'new',
  });
});

test('Not needed sets it aside with Undo; the other adult never reaches it', async ({
  page,
  browser,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/sort');
  await tell(page, 'p7 maybe a hammock');
  await page.goto('/sort');
  await page.getByRole('button', { name: 'Not needed: p7 maybe a hammock' }).click();
  await expect(page).toHaveURL(/\/sort\?aside=/);
  await expect(page.getByText('Set aside. Nothing is deleted.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo: p7 maybe a hammock' })).toBeFocused();
  expect(await page.locator('main ul').textContent()).not.toContain('p7 maybe a hammock');
  await shot(page, 'set-aside-undo');
  expect(await captureRow('p7 maybe a hammock')).toMatchObject({ status: 'dismissed' });
  await page.getByRole('button', { name: 'Undo: p7 maybe a hammock' }).click();
  await expect(page).toHaveURL(/\/sort$/);
  await expect(page.locator('main li', { hasText: 'p7 maybe a hammock' })).toBeVisible();

  const id = (await captureRow('p7 maybe a hammock')).id;
  const alex = await fixtureAdultContext(browser, 'alex', VIEWPORTS.desktop);
  for (const path of [`/sort/${id}`, `/sort/${id}/task`, `/sort/${id}/note`]) {
    await alex.page.goto(path);
    await expect(alex.page.getByRole('heading', { name: 'Nothing here.' })).toBeVisible();
  }
  await alex.context.close();
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`accessibility and no horizontal scroll: ${name}`, async ({ browser }) => {
    const { context, page } = await fixtureAdultContext(browser, 'sam', viewport);
    const c = await captureRow(`${CANARY_MARK.sam}capture: remember the surprise`);
    for (const path of [
      '/sort',
      `/sort/${c.id}`,
      ...['task', 'event', 'project', 'note', 'know'].map((k) => `/sort/${c.id}/${k}`),
    ]) {
      await page.goto(path);
      await expectNoHorizontalScroll(page, `${name} ${path}`);
      await expectAccessible(page, `${name} ${path}`);
    }
    await context.close();
  });
}
