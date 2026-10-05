import { expect, test, type Page } from '@playwright/test';
import { CANARY_MARK, SENSITIVE_MARK } from '../fixtures/family';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { withDb } from './helpers';

// Today, factual (M3 contract §3.2), over the seeded synthetic family plus
// a few records made for the day the suite runs. Screenshots land in
// test-results/screenshots (never committed).

const SHOTS = 'test-results/screenshots';
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const DAY = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d+ [A-Z][a-z]+$/;
const homeToday = async () =>
  (
    await q(
      `select to_char(now() at time zone 'Pacific/Auckland', 'YYYY-MM-DD') as d,
              to_char(now() at time zone 'Pacific/Auckland' - interval '1 day', 'YYYY-MM-DD') as y,
              to_char(now() at time zone 'Pacific/Auckland' - interval '3 days', 'YYYY-MM-DD') as e,
              trim(to_char(now() at time zone 'Pacific/Auckland' - interval '3 days', 'Day')) as ew,
              to_char(now() at time zone 'Pacific/Auckland' + interval '2 days', 'YYYY-MM-DD') as f,
              to_char(now() at time zone 'Pacific/Auckland', 'FMDay FMDD FMMonth') as long`,
    )
  )[0]!;

const P9 = 'p9 ';
test.afterAll(async () => {
  await q(`update event set archived_at = now() where title like 'p9 %' and archived_at is null`);
  await q(`update task set archived_at = now() where title like 'p9 %' and archived_at is null`);
  await q(`update capture set archived_at = now() where text like 'p9 %' and archived_at is null`);
});

test('a busy day: the date as the headline, today’s events in agenda order, due and overdue tasks in words, things to sort', async ({
  page,
}) => {
  const t = await homeToday();
  await q(
    `insert into event (title, kind, all_day, start_date, end_date, created_by, created_via, visibility, source)
     values ($1, 'other', true, $2, $3, 'fixture-sam', 'ui', 'household', 'manual')`,
    [`${P9}Teacher-only day`, t.d, t.f],
  );
  await q(
    `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, created_by, created_via, visibility, source)
     values ($1, 'appointment', false, ($2 || 'T14:00:00')::timestamp at time zone 'Pacific/Auckland', ($2 || 'T14:30:00')::timestamp at time zone 'Pacific/Auckland', 'Pacific/Auckland', 'fixture-sam', 'ui', 'household', 'manual')`,
    [`${P9}Dentist`, t.d],
  );
  await q(
    `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, created_by, created_via, visibility, source)
     values ($1, 'activity', false, ($2 || 'T08:00:00')::timestamp at time zone 'Pacific/Auckland', ($2 || 'T08:30:00')::timestamp at time zone 'Pacific/Auckland', 'Pacific/Auckland', 'fixture-sam', 'ui', 'household', 'manual')`,
    [`${P9}Early walk`, t.d],
  );
  for (const [title, due, status] of [
    [`${P9}Pay the power bill`, t.d, 'open'],
    [`${P9}Return the library books`, t.e, 'open'],
    [`${P9}Book the car in`, t.y, 'open'],
    [`${P9}Next week thing`, t.f, 'open'],
    [`${P9}Already done`, t.d, 'done'],
    [`${P9}Dropped it`, t.y, 'dropped'],
  ] as const)
    await q(
      `insert into task (title, status, due_date, needs, created_by, created_via, visibility, completed_at)
       values ($1, $2, $3, '[]', 'fixture-sam', 'ui', 'household', case when $2 = 'done' then now() end)`,
      [title, status, due],
    );
  await q(
    `insert into capture (text, channel, visibility, created_by, created_via) values ($1, 'web', 'private', 'fixture-sam', 'ui')`,
    [`${P9}remember the thing`],
  );

  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 1, name: DAY })).toHaveText(t.long!);

  // On today: all-day first, then by time, the same rows as Forward's Today section.
  const on = page.locator('section[aria-labelledby="today-on"]');
  const rows = await on.getByRole('link').allTextContents();
  const allDayEnd = rows.findIndex((r) => !r.startsWith('All day'));
  expect(rows.slice(0, allDayEnd).every((r) => r.startsWith('All day'))).toBe(true);
  expect(rows.slice(allDayEnd).some((r) => r.startsWith('All day'))).toBe(false);
  const walk = rows.findIndex((r) => r.includes('Early walk'));
  const dentist = rows.findIndex((r) => r.includes('Dentist'));
  expect(walk).toBeGreaterThan(-1);
  expect(dentist).toBeGreaterThan(walk);
  expect(rows.some((r) => r.startsWith('All day') && r.includes('Teacher-only day'))).toBe(true);
  await page.goto('/forward');
  const forwardToday = await page
    .locator('section[aria-labelledby="day-' + t.d + '"]')
    .getByRole('link')
    .allTextContents();
  expect(forwardToday.filter((r) => !r.includes('Due'))).toEqual(rows);
  await page.goto('/today');
  await on.getByRole('link', { name: /Dentist/ }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await page.goBack();

  // To do: overdue first in words, then due today; future, done and dropped absent.
  const todo = page.locator('section[aria-labelledby="today-todo"]');
  const tasks = await todo.getByRole('link').allTextContents();
  expect(tasks[0]).toContain('Return the library books');
  expect(tasks[0]).toContain(`from ${t.ew}`);
  expect(tasks[1]).toContain('Book the car in');
  expect(tasks[1]).toContain('from yesterday');
  expect(tasks[2]).toContain('Pay the power bill');
  expect(tasks[2]).toContain('Due today');
  const main = (await page.textContent('main')) ?? '';
  expect(main).not.toContain('Next week thing');
  expect(main).not.toContain('Already done');
  expect(main).not.toContain('Dropped it');
  expect(main).not.toMatch(/overdue|late|urgent/i);
  expect(main).not.toContain(CANARY_MARK.alex);
  expect(main).not.toContain(SENSITIVE_MARK);
  await todo.getByRole('link', { name: /Pay the power bill/ }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await page.goBack();

  // Things to sort, in words.
  const sort = page.getByRole('link', { name: /things? to sort ›$/ });
  await expect(sort).toBeVisible();
  expect(await sort.textContent()).toMatch(
    /^(One thing|Two|Three|Four|Five|Six|Seven|Eight|Nine|\d+) (thing|things) to sort ›$/,
  );
  await sort.click();
  await expect(page).toHaveURL(/\/sort$/);
  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['On today', 'To do']);
  await shot(page, 'today-busy');
});

test('a quiet day says so; the identity prompt appears only for an unlinked adult', async ({
  page,
}) => {
  const t = await homeToday();
  // Everything Alex could see today is put away for a moment, and the waiting capture set aside.
  const held = await q(`select id from event where archived_at is null`);
  const heldTasks = await q(
    `select id from task where archived_at is null and status = 'open' and due_date <= $1`,
    [t.d],
  );
  const heldCaptures = await q(
    `select id, status from capture where created_by = 'fixture-alex' and status in ('new', 'proposed') and archived_at is null`,
  );
  const birthdays = await q(
    `select id, date_of_birth from person where to_char(date_of_birth, 'MM-DD') = to_char(now() at time zone 'Pacific/Auckland', 'MM-DD') and archived_at is null`,
  );
  const targets = await q(
    `select id, target_date from project where target_date = $1 and archived_at is null`,
    [t.d],
  );
  try {
    await q(`update event set archived_at = now() where id = any($1::uuid[])`, [
      held.map((r) => r.id),
    ]);
    await q(`update task set archived_at = now() where id = any($1::uuid[])`, [
      heldTasks.map((r) => r.id),
    ]);
    await q(
      `update capture set status = 'dismissed', dismissed_at = now() where id = any($1::uuid[])`,
      [heldCaptures.map((r) => r.id)],
    );
    await q(`update person set date_of_birth = null where id = any($1::uuid[])`, [
      birthdays.map((r) => r.id),
    ]);
    await q(`update project set target_date = null where id = any($1::uuid[])`, [
      targets.map((r) => r.id),
    ]);

    await signInAsFixtureAdult(page, 'alex');
    await page.goto('/today');
    await expect(page.getByRole('heading', { level: 1, name: DAY })).toBeVisible();
    await expect(page.getByText('Nothing on today.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
    expect(await page.textContent('main')).not.toContain('to sort');
    expect(await page.textContent('main')).not.toContain('Which one is you?');
    await shot(page, 'today-quiet');

    // Unlinked: the prompt appears (the gate is open locally).
    await q(`update person set user_id = null where user_id = 'fixture-alex'`);
    await page.goto('/today');
    await expect(page.getByRole('link', { name: 'Which one is you? ›' })).toBeVisible();
    await shot(page, 'today-identity');
    await page.getByRole('link', { name: 'Which one is you? ›' }).click();
    await expect(page).toHaveURL(/\/settings\/you$/);
  } finally {
    await q(
      `update person set user_id = 'fixture-alex' where name = 'Alex' and archived_at is null`,
    );
    await q(`update event set archived_at = null where id = any($1::uuid[])`, [
      held.map((r) => r.id),
    ]);
    await q(`update task set archived_at = null where id = any($1::uuid[])`, [
      heldTasks.map((r) => r.id),
    ]);
    for (const c of heldCaptures)
      await q(`update capture set status = $2, dismissed_at = null where id = $1`, [
        c.id,
        c.status,
      ]);
    for (const b of birthdays)
      await q(`update person set date_of_birth = $2 where id = $1`, [b.id, b.date_of_birth]);
    for (const p of targets)
      await q(`update project set target_date = $2 where id = $1`, [p.id, p.target_date]);
  }
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`accessibility, no horizontal scroll and screenshots: ${name}`, async ({ browser }) => {
    const { context, page } = await fixtureAdultContext(browser, 'sam', viewport);
    await page.goto('/today');
    await expectNoHorizontalScroll(page, `${name} /today`);
    await expectAccessible(page, `${name} /today`);
    // The capture bar never covers the last control: focus it and check it is in view above the bar.
    const last = page.locator('main a, main button').last();
    await last.focus();
    const clear = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const bar = document.querySelector('#capture-text')?.closest('.sticky') as HTMLElement | null;
      if (!el || !bar) return true;
      return el.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + 1;
    });
    expect(clear, `${name}: the last control is clear of the capture bar`).toBe(true);
    if (name === 'phone') await shot(page, 'today-phone');
    if (name === 'tablet-portrait') await shot(page, 'today-ipad');
    await context.close();
  });
}
