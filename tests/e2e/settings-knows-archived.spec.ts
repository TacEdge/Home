import { expect, test, type Page } from '@playwright/test';
import { ARCHIVED_MARK, CANARY_MARK, SENSITIVE_MARK } from '../fixtures/family';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { withDb } from './helpers';

// What Kev knows, Archived and Activity (M3 contract §3.9, §3.10, §3.1),
// over the seeded synthetic family: Milo enjoys dinosaurs (Sam's), the bins
// routine (Alex's, household), a sensitive household item (Sam's) and a
// sensitive private item (Alex's); archived household canaries of every
// type; each adult's private canaries. Screenshots land in
// test-results/screenshots (never committed).

const SHOTS = 'test-results/screenshots';
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, unknown>[]);
const openSummary = (page: Page, text: string) =>
  page.locator('summary', { hasText: text }).first().click();

test.afterAll(async () => {
  await q(
    `update context set archived_at = now() where content like 'p8 %' and archived_at is null`,
  );
});

test('What Kev knows: grouped by subject, stale first and gently worded, kinds in words, no sensitive items', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  // One item last confirmed a year ago: the engine says "still true?".
  const [milo] = await q(`select id from person where name = 'Milo'`);
  await q(
    `insert into context (subject_type, subject_id, content, category, status, sensitivity, visibility, source_type, source_user_id, last_confirmed_at, created_by, created_via)
     values ('person', $1, 'p8 Still does the swimming squad', 'routine', 'active', 'normal', 'household', 'manual', 'fixture-sam', now() - interval '13 months', 'fixture-sam', 'ui')`,
    [milo!.id],
  );
  await page.goto('/settings');
  await page.getByRole('link', { name: /What Kev knows/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'What Kev knows' })).toBeVisible();
  const headings = await page.locator('main section h2').allTextContents();
  expect(headings[0]).toBe('Everyone at home');
  expect(headings).toContain('Milo');
  const miloSection = page.locator('section', { has: page.getByRole('heading', { name: 'Milo' }) });
  const items = miloSection.locator('ul li > p:first-child');
  await expect(items.first()).toHaveText('p8 Still does the swimming squad'); // stale first
  await expect(miloSection.getByText(/^Still true\? Not confirmed since/)).toBeVisible();
  await expect(miloSection.getByText('A routine · noted')).toBeVisible(); // a kind in words
  await expect(miloSection.locator('p', { hasText: 'Something they enjoy' }).first()).toBeVisible();
  const body = await page.textContent('main');
  expect(body).not.toContain(SENSITIVE_MARK);
  expect(body).not.toContain(CANARY_MARK.alex);
  expect(body).not.toMatch(/\binterest\b|\bpractical\b/); // never raw category names
  await shot(page, 'knows');

  // Still true: the line goes away. No longer true: folded; Reinstate brings it back.
  await miloSection.getByRole('button', { name: /^Still true: p8 Still/ }).click();
  await expect(page.getByText(/^Still true\? Not confirmed since/)).toHaveCount(0);
  const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Milo' }) });
  await sec.getByRole('button', { name: /^No longer true: p8 Still/ }).click();
  await expect(page.locator('summary', { hasText: 'No longer true · 1' })).toBeVisible();
  await openSummary(page, 'No longer true · 1');
  await page.getByRole('button', { name: 'Reinstate' }).click();
  await expect(page.locator('summary', { hasText: 'No longer true' })).toHaveCount(0);

  // Change in place keeps what was typed on a refusal and focuses it.
  const row = page.locator('li', { hasText: 'p8 Still does the swimming squad' });
  await row.locator('summary', { hasText: 'Change' }).click();
  await row.getByLabel('What to know').fill('   ');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This can’t be empty.')).toBeVisible();
  const row2 = page.locator('li', { hasText: 'This can’t be empty.' });
  await expect(row2.getByLabel('What to know')).toBeFocused();
  await row2.getByLabel('What to know').fill('p8 Swimming squad on Wednesdays');
  await row2.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('p', { hasText: 'p8 Swimming squad on Wednesdays' })).toBeVisible();

  // Archive, then it is under Archived with Restore.
  const row3 = page.locator('li', { hasText: 'p8 Swimming squad on Wednesdays' });
  await row3.locator('summary', { hasText: 'Change' }).click();
  await row3.locator('summary', { hasText: 'Archive' }).click();
  await row3.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.locator('p', { hasText: 'p8 Swimming squad on Wednesdays' })).toHaveCount(0);
  await page.goto('/settings/archived');
  await expect(page.getByText('p8 Swimming squad on Wednesdays')).toBeVisible();
  await page.getByRole('button', { name: /^Restore: p8 Swimming/ }).click();
  await expect(page.getByText('p8 Swimming squad on Wednesdays')).toHaveCount(0);
});

test('sensitive items: hidden until asked, audited, for that response only; never on another screen', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/settings/knows');
  expect(await page.textContent('main')).not.toContain(SENSITIVE_MARK);
  const before = Number(
    (await q(`select count(*)::int as n from audit_log where event = 'context.sensitive_read'`))[0]!
      .n,
  );
  await page.getByRole('button', { name: 'Show sensitive items' }).click();
  await expect(
    page.locator('p', { hasText: `${SENSITIVE_MARK}household spare key arrangement` }),
  ).toBeVisible();
  await expect(page.locator('p', { hasText: 'about Everyone at home · Practical' })).toBeVisible();
  expect(await page.textContent('main')).not.toContain(`${SENSITIVE_MARK}private note`); // Alex's private
  await shot(page, 'knows-sensitive');
  const after = Number(
    (await q(`select count(*)::int as n from audit_log where event = 'context.sensitive_read'`))[0]!
      .n,
  );
  expect(after).toBeGreaterThan(before);
  // Not remembered: reload, navigate, and on other screens.
  await page.reload();
  expect(await page.textContent('main')).not.toContain(SENSITIVE_MARK);
  await page.getByRole('button', { name: 'Show sensitive items' }).click();
  await expect(
    page.locator('p', { hasText: `${SENSITIVE_MARK}household spare key` }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Forward', exact: true }).click();
  await page.waitForURL(/forward/);
  expect(await page.textContent('body')).not.toContain(SENSITIVE_MARK);
  for (const path of ['/today', '/settings/archived', '/settings/activity', '/sort']) {
    await page.goto(path);
    expect(await page.textContent('main'), path).not.toContain(SENSITIVE_MARK);
  }
  // Activity never lists the sensitive read's subject rows, only that items were shown.
  await page.goto('/settings/activity');
  expect(await page.textContent('main')).not.toContain('Sensitive items shown'); // rows about sensitive items never list (ADR 0005 §43)

  // A sensitive item made here, directly: out of the default list, in the reveal.
  await page.goto('/settings/knows');
  await page.locator('#new-context-content').fill('p8 the alarm code is with Nana Jo');
  await page.locator('#new-context-category').selectOption('practical');
  const newForm = page.locator('form', { has: page.locator('#new-context-content') });
  await newForm.locator('summary', { hasText: 'More' }).click();
  await page.locator('#new-context-sensitivity').selectOption('sensitive');
  await newForm.getByRole('button', { name: 'Keep it' }).click();
  await expect(page.locator('#new-context-content')).toHaveValue(''); // saved: the page came back fresh
  await expect(page.locator('[data-form-message]')).toHaveCount(0);
  expect(await page.textContent('main')).not.toContain('p8 the alarm code');
  await page.getByRole('button', { name: 'Show sensitive items' }).click();
  await expect(page.locator('p', { hasText: 'p8 the alarm code is with Nana Jo' })).toBeVisible();
  const [made] = await q(
    `select sensitivity, created_via, source_type from context where content = 'p8 the alarm code is with Nana Jo'`,
  );
  expect(made).toEqual({ sensitivity: 'sensitive', created_via: 'ui', source_type: 'manual' });
});

test('an archived sensitive item comes back only through the reveal; a bad Activity cursor reads as Latest', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const words = `${SENSITIVE_MARK}household spare key arrangement`;
  // 1. reveal; 2. archive it from the reveal (the reveal clears).
  await page.goto('/settings/knows');
  await page.getByRole('button', { name: 'Show sensitive items' }).click();
  const row = page.locator('li', { hasText: words });
  await row.locator('summary', { hasText: 'Change' }).click();
  await row.locator('summary', { hasText: 'Archive' }).click();
  await row.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show sensitive items' })).toBeVisible();
  expect(await page.textContent('main')).not.toContain(SENSITIVE_MARK);
  // 3. nowhere by default: not What Kev knows, not Archived, not Activity.
  for (const path of ['/settings/knows', '/settings/archived', '/settings/activity']) {
    await page.goto(path);
    expect(await page.textContent('main'), path).not.toContain(SENSITIVE_MARK);
  }
  // 4. reveal again: it is listed as put away, with Restore; 5. restore (the reveal clears).
  await page.goto('/settings/knows');
  await page.getByRole('button', { name: 'Show sensitive items' }).click();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Sensitive items put away' }),
  ).toBeVisible();
  await page.getByRole('button', { name: `Restore: ${words.slice(0, 40)}` }).click();
  await expect(page.getByRole('button', { name: 'Show sensitive items' })).toBeVisible();
  // 6. still excluded by default; back among the live sensitive items when asked.
  expect(await page.textContent('main')).not.toContain(SENSITIVE_MARK);
  await page.goto('/settings/archived');
  expect(await page.textContent('main')).not.toContain(SENSITIVE_MARK);
  await page.goto('/settings/knows');
  await page.getByRole('button', { name: 'Show sensitive items' }).click();
  await expect(page.locator('p', { hasText: words })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Sensitive items put away' }),
  ).toHaveCount(0);
  expect(
    (await q(`select archived_at from context where content = $1`, [words]))[0]!.archived_at,
  ).toBeNull();

  // A crafted cursor never errors: it reads as Latest.
  const r = await page.goto('/settings/activity?before=not-a-uuid');
  expect(r?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 2, name: 'Recent' })).toBeVisible();
  expect(await page.textContent('main')).not.toMatch(/select |audit_log|Failed query/);
});

test('Archived: every type, grouped, with Restore; set-aside captures with Back to To sort; nothing of the other adult', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/sort');
  await page.getByPlaceholder('Tell HOME something…').fill('p8 maybe repaint the hall');
  await page.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('#capture-status')).toContainText('Kept');
  await page.goto('/sort');
  await page.getByRole('button', { name: 'Not needed: p8 maybe repaint the hall' }).click();
  await expect(page).toHaveURL(/\/sort\?aside=/); // set aside before looking under Archived
  await page.goto('/settings/archived');
  await expect(page.getByRole('heading', { level: 1, name: 'Archived' })).toBeVisible();
  const headings = await page.locator('main section h2').allTextContents();
  for (const h of [
    'People',
    'Events',
    'Projects',
    'Tasks',
    'Notes',
    'Things to know',
    'Set aside from To sort',
    'Captures',
  ])
    expect(headings, h).toContain(h);
  const body = await page.textContent('main');
  expect(body).toContain(`${ARCHIVED_MARK}person`);
  expect(body).toContain(`${ARCHIVED_MARK}task`);
  expect(body).toContain('p8 maybe repaint the hall');
  expect(body).not.toContain(CANARY_MARK.alex);
  expect(body).not.toContain(SENSITIVE_MARK);
  expect(body).not.toMatch(/deleted|gone for good|removed for good/i);
  await shot(page, 'archived');
  await page.getByRole('button', { name: 'Back to To sort: p8 maybe repaint the hall' }).click();
  await expect(page.getByText('p8 maybe repaint the hall')).toHaveCount(0);
  await page.goto('/sort');
  await expect(page.locator('main li', { hasText: 'p8 maybe repaint the hall' })).toBeVisible();
  await q(`update capture set archived_at = now() where text = 'p8 maybe repaint the hall'`);
  // Restore an archived task, then put it back as seeded.
  await page.goto('/settings/archived');
  await page.getByRole('button', { name: `Restore: ${ARCHIVED_MARK}task` }).click();
  await expect(page.getByText(`${ARCHIVED_MARK}task`)).toHaveCount(0);
  await q(`update task set archived_at = now() where title = $1`, [`${ARCHIVED_MARK}task`]);
});

test('Activity: plain words, a page at a time with Earlier and Latest, nothing written shown', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/settings/activity');
  const rows = page.locator('main ul li');
  await expect(rows).toHaveCount(50);
  const text = await page.textContent('main');
  expect(text).not.toMatch(/\b[a-z_]+\.[a-z_]+\b/); // no raw event codes
  expect(text).not.toContain('dinosaurs'); // no written content, ever
  expect(text).not.toContain(CANARY_MARK.alex);
  await expect(page.getByText(/by hand|through Kev|HOME/).first()).toBeVisible();
  await shot(page, 'activity');
  const firstPageIds = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  await page.getByRole('link', { name: 'Earlier ›' }).click();
  await expect(page).toHaveURL(/before=/);
  await expect(page.getByRole('heading', { level: 2, name: 'Earlier' })).toBeVisible();
  const second = await page
    .locator('main ul li')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  expect(second.length).toBeGreaterThan(0);
  expect(second.some((s) => firstPageIds.includes(s))).toBe(false); // nothing repeated
  await shot(page, 'activity-earlier');
  await page.getByRole('link', { name: '‹ Latest' }).click();
  await expect(page).toHaveURL(/\/settings\/activity$/);
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`accessibility, no horizontal scroll and screenshots: ${name}`, async ({ browser }) => {
    const { context, page } = await fixtureAdultContext(browser, 'sam', viewport);
    for (const path of [
      '/settings',
      '/settings/knows',
      '/settings/archived',
      '/settings/activity',
    ]) {
      await page.goto(path);
      await expectNoHorizontalScroll(page, `${name} ${path}`);
      await expectAccessible(page, `${name} ${path}`);
    }
    if (name === 'phone' || name === 'tablet-portrait') {
      await page.goto('/settings/knows');
      await shot(page, `knows-${name}`);
      await page.goto('/settings/archived');
      await shot(page, `archived-${name}`);
    }
    await context.close();
  });
}
