import { expect, test, type Browser } from '@playwright/test';
import { expectAccessible } from './a11y';
import { fixtureAdultContext, VIEWPORTS, type Adult } from './fixture-adults';
import { withDb } from './helpers';

// Today's conflicts (M6 Package 3; contract §4.5, §5.8, §5.9; ADR 0009 §17,
// §18): today's are a small mark on the affected entry, naming the other
// commitment as recorded, with Why holding the facts, Dismiss and Not
// useful; tomorrow's are listed in Worth knowing. A response is the
// reader's own: the other adult still sees it. Works without JavaScript.
// On a fixed day (Wednesday 10 March 2027, NZDT) through the test-only
// `x-home-test-now` header; every record is the spec's own (titles `tc `)
// and is put away afterwards. Synthetic only.

const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const DAY = '2027-03-10';
const NEXT = '2027-03-11';
const at = (date: string, clock: string) => `${date}T${clock}:00+13:00`;

async function event(title: string, date: string, from: string, to: string, person: string) {
  const [row] = await q(
    `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, created_by, created_via, visibility, source)
     values ($1, 'activity', false, $2::timestamptz, $3::timestamptz, 'Pacific/Auckland', 'fixture-sam', 'ui', 'household', 'manual') returning id`,
    [title, at(date, from), at(date, to)],
  );
  await q(
    `insert into event_person (event_id, person_id, role, created_by, created_via) values ($1, $2, 'attending', 'fixture-sam', 'ui')`,
    [row!.id, person],
  );
}

test.beforeAll(async () => {
  const [milo] = await q(`select id from person where name = 'Milo' and archived_at is null`);
  await event('tc Swim club', DAY, '15:00', '16:00', milo!.id!);
  await event('tc Dentist', DAY, '15:30', '16:30', milo!.id!);
  await event('tc Art', NEXT, '10:00', '11:00', milo!.id!);
  await event('tc Piano', NEXT, '10:30', '11:30', milo!.id!);
});
test.afterAll(async () => {
  await q(`update event set archived_at = now() where title like 'tc %' and archived_at is null`);
  await q(`delete from insight_response where insight_key like 'conflict.%'`);
});

async function open(browser: Browser, adult: Adult, js = true) {
  const { context, page } = await fixtureAdultContext(browser, adult, VIEWPORTS.phone, {
    javaScriptEnabled: js,
  });
  await context.setExtraHTTPHeaders({ 'x-home-test-now': at(DAY, '07:00') });
  await page.goto('/today');
  return { context, page };
}

test('today’s conflict is a mark on Milo’s entries with its facts, Dismiss and Not useful, without JavaScript', async ({
  browser,
}) => {
  const { context, page } = await open(browser, 'sam', false);
  const marks = page.locator('[data-conflict="conflict.overlap"]');
  // Milo's fixture Swimming is at 15:30 on Wednesdays too, so his day holds
  // three pairs: each entry names what it overlaps. The Swim club is named on
  // two entries (Dentist's and Swimming's), each its own conflict.
  const unfold = async (p: typeof page) => {
    const line = p
      .getByRole('listitem')
      .filter({ has: p.getByRole('link', { name: 'Milo', exact: true }) });
    const more = line.locator('summary', { hasText: /^\+ \d+ more/ });
    if ((await more.count()) > 0 && (await more.first().isVisible())) await more.first().click();
  };
  await unfold(page);
  const swimClub = marks.filter({ hasText: 'overlaps tc Swim club 15:00' });
  await expect(swimClub).toHaveCount(2);
  await expect(marks.filter({ hasText: 'overlaps tc Dentist 15:30' })).toHaveCount(2);
  // Not listed again in Worth knowing: said once, on its items.
  await expect(page.locator('[data-insight^="conflict."]', { hasText: 'tc Dentist' })).toHaveCount(
    0,
  );

  // The Dentist entry's mark: the last of the two in the day's order.
  const mark = swimClub.last();
  await mark.locator('summary', { hasText: 'Why' }).click();
  await expect(
    mark.getByText(
      'Milo is recorded on both of these, and their times overlap from 15:30 to 16:00.',
    ),
  ).toBeVisible();
  await expect(mark.getByRole('link', { name: /tc Swim club/ })).toBeVisible();
  await expect(mark.getByRole('link', { name: /tc Dentist/ })).toBeVisible();
  await expect(mark.getByRole('button', { name: /^Dismiss:/ })).toBeVisible();

  // Not useful, as a plain form post: back on Today, that pair's marks gone for Sam;
  // the Swimming pair is another conflict and stays.
  await mark.getByRole('button', { name: /^Not useful:/ }).click();
  await page.waitForURL(/\/today$/);
  await unfold(page);
  await expect(marks.filter({ hasText: 'overlaps tc Swim club 15:00' })).toHaveCount(1);
  await expect(marks.filter({ hasText: 'overlaps tc Dentist 15:30' })).toHaveCount(1);
  await context.close();

  // Alex still sees it: the response was Sam's alone.
  const alex = await open(browser, 'alex');
  const line = alex.page
    .getByRole('listitem')
    .filter({ has: alex.page.getByRole('link', { name: 'Milo', exact: true }) });
  const more = line.locator('summary', { hasText: /^\+ \d+ more/ });
  if ((await more.count()) > 0) await more.first().click();
  await expect(
    alex.page.locator('[data-conflict]', { hasText: 'overlaps tc Swim club 15:00' }),
  ).toHaveCount(2);
  await alex.context.close();
});

test('tomorrow’s conflict is listed in Worth knowing with the Sun mark; Dismiss takes it away', async ({
  browser,
}) => {
  const { context, page } = await open(browser, 'sam');
  // Ranked after data_health (ADR 0009 §18): when other records rank first it is
  // under Worth knowing's "+ N more", which a reader opens.
  const worth = page.locator('section[aria-labelledby="today-worth"]');
  const more = worth.locator('summary', { hasText: /^\+ \d+ more/ });
  if ((await more.count()) > 0) await more.first().click();
  const row = page.locator('[data-insight="conflict.overlap"]', { hasText: 'tc Art' });
  await expect(row).toContainText(
    'Milo has tc Art and tc Piano at the same time tomorrow, 10:30–11:00.',
  );
  await row.locator('summary', { hasText: 'Why' }).click();
  await expect(row.getByRole('button', { name: /^Not useful:/ })).toBeVisible();
  // Today's marks are on this page too: the baseline holds with marks and an open Why.
  await expect(page.locator('[data-conflict]').first()).toBeVisible();
  await expectAccessible(page, 'Today with conflict marks and a conflict in Worth knowing');
  await row.getByRole('button', { name: /^Dismiss:/ }).click();
  await expect(
    page.locator('[data-insight="conflict.overlap"]', { hasText: 'tc Art' }),
  ).toHaveCount(0);
  await context.close();
});
