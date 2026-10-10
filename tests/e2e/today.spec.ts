import { expect, test, type Page } from '@playwright/test';
import { CANARY_MARK, SENSITIVE_MARK } from '../fixtures/family';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { seedCalendar } from './calendar-feeds';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { withDb } from './helpers';

// What Today shows of the records of the day the suite runs (M3 contract
// §3.2, kept under M5 Package 3): nothing of the household's is lost, the
// other adult's private records and everything archived are absent, and a
// quiet day says so. The servers read the clock as 07:03 on the real date
// (HOME_TEST_CLOCK), so none of this depends on the hour. The screen's own
// scenarios are in today-screen.spec.ts. Screenshots land in
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
const ALEX_PRIVATE = 'alex-only';
const ARCHIVED = 'put-away';
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
/** "Two things to sort ›", as Today says it (src/app/(home)/sort/copy.ts). */
const toSortWords = (n: number) =>
  `${WORDS[n] ?? String(n)} ${n === 1 ? 'thing' : 'things'} to sort ›`;
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

  // Privacy, on the day itself: Alex's private records fall on today, so the
  // assertions below can only pass because the services filter them out.
  await q(
    `insert into event (title, kind, all_day, start_date, end_date, created_by, created_via, visibility, source)
     values ($1, 'other', true, $2, ($2::date + 1), 'fixture-alex', 'ui', 'private', 'manual')`,
    [`${P9}${ALEX_PRIVATE} event`, t.d],
  );
  for (const [title, due] of [
    [`${P9}${ALEX_PRIVATE} task due today`, t.d],
    [`${P9}${ALEX_PRIVATE} task overdue`, t.y],
  ] as const)
    await q(
      `insert into task (title, status, due_date, needs, created_by, created_via, visibility)
       values ($1, 'open', $2, '[]', 'fixture-alex', 'ui', 'private')`,
      [title, due],
    );
  await q(
    `insert into capture (text, channel, visibility, created_by, created_via) values ($1, 'web', 'private', 'fixture-alex', 'ui')`,
    [`${P9}${ALEX_PRIVATE} capture`],
  );
  // Archived, on the day itself: never shown, to anyone.
  await q(
    `insert into event (title, kind, all_day, start_date, end_date, created_by, created_via, visibility, source, archived_at)
     values ($1, 'other', true, $2, ($2::date + 1), 'fixture-sam', 'ui', 'household', 'manual', now())`,
    [`${P9}${ARCHIVED} event`, t.d],
  );
  await q(
    `insert into task (title, status, due_date, needs, created_by, created_via, visibility, archived_at)
     values ($1, 'open', $2, '[]', 'fixture-sam', 'ui', 'household', now())`,
    [`${P9}${ARCHIVED} task`, t.y],
  );
  // What each adult should be told is waiting: their own captures, nobody else's.
  const waiting = async (by: string) =>
    Number(
      (
        await q(
          `select count(*) as n from capture where created_by = $1 and status in ('new', 'proposed') and archived_at is null`,
          [by],
        )
      )[0]!.n,
    );
  const samWaiting = await waiting('fixture-sam');
  const alexWaiting = await waiting('fixture-alex');
  expect(samWaiting).toBeGreaterThan(0);
  expect(alexWaiting).toBeGreaterThan(0);

  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 1, name: DAY })).toHaveText(t.long!);

  // Nobody is recorded on these, so they are in Also today: all-day first, then by time.
  const on = page.locator('section[aria-labelledby="today-also"]');
  const rows = await on.getByRole('link').allTextContents();
  const allDayEnd = rows.findIndex((r) => !r.startsWith('All day'));
  expect(rows.slice(0, allDayEnd).every((r) => r.startsWith('All day'))).toBe(true);
  expect(rows.slice(allDayEnd).some((r) => r.startsWith('All day'))).toBe(false);
  const walk = rows.findIndex((r) => r.includes('Early walk'));
  const dentist = rows.findIndex((r) => r.includes('Dentist'));
  expect(walk).toBeGreaterThan(-1);
  expect(dentist).toBeGreaterThan(walk);
  expect(rows.some((r) => r.startsWith('All day') && r.includes('Teacher-only day'))).toBe(true);
  // Forward's Today section has the same rows, in the same order (and whatever else the family has on).
  await page.goto('/forward');
  const forwardToday = await page
    .locator('section[aria-labelledby="day-' + t.d + '"]')
    .getByRole('link')
    .allTextContents();
  expect(forwardToday.filter((r) => rows.includes(r))).toEqual(rows);
  await page.goto('/today');
  await on.getByRole('link', { name: /Dentist/ }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await page.goBack();

  // To do: what is due today first, then what is carried over, oldest first, in words; future, done and dropped absent.
  const todo = page.locator('section[aria-labelledby="today-todo"]');
  const tasks = await todo.getByRole('link').allTextContents();
  expect(tasks).toHaveLength(3);
  expect(tasks[0]).toContain('Pay the power bill');
  expect(tasks[0]).toContain('Due today');
  expect(tasks[1]).toContain('Return the library books');
  expect(tasks[1]).toContain(`From ${t.ew}`);
  expect(tasks[2]).toContain('Book the car in');
  expect(tasks[2]).toContain('From yesterday');
  await expect(todo.getByRole('link', { name: /more to do/ })).toHaveCount(0);
  const main = (await page.textContent('main')) ?? '';
  expect(main).not.toContain('Next week thing');
  expect(main).not.toContain('Already done');
  expect(main).not.toContain('Dropped it');
  expect(main).not.toMatch(/\boverdue\b|\blate\b|\burgent\b/i);
  expect(main).not.toContain(CANARY_MARK.alex);
  expect(main).not.toContain(SENSITIVE_MARK);
  // Alex's private event, tasks and capture are on today, and not on Sam's Today.
  expect(main).not.toContain(ALEX_PRIVATE);
  expect(main).not.toContain(ARCHIVED);
  await todo.getByRole('link', { name: /Pay the power bill/ }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await page.goBack();

  // Things to sort, in words: Sam's own count, unmoved by Alex's capture.
  const sort = page.getByRole('link', { name: /things? to sort ›$/ });
  await expect(sort).toHaveText(toSortWords(samWaiting));
  await sort.click();
  await expect(page).toHaveURL(/\/sort$/);
  await page.goto('/today');
  const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
  expect(headings).toEqual(expect.arrayContaining(['Also today', 'To do']));
  await expect(page.getByRole('link', { name: 'What’s coming up ›' })).toHaveCount(1);
  await shot(page, 'today-busy');

  // The same day as Alex: the private records are there for their owner, so
  // their absence above is filtering, not missing data.
  const alexContext = await page.context().browser()!.newContext();
  const alex = await alexContext.newPage();
  try {
    await signInAsFixtureAdult(alex, 'alex');
    await alex.goto('/today');
    const alexOn = alex.locator('section[aria-labelledby="today-also"]');
    await expect(
      alexOn.getByRole('link', { name: new RegExp(`${ALEX_PRIVATE} event`) }),
    ).toBeVisible();
    // Alex sees five tasks, three shown: their own private ones among them.
    const alexTodo = alex.locator('section[aria-labelledby="today-todo"]');
    await expect(
      alexTodo.getByRole('link', { name: new RegExp(`${ALEX_PRIVATE} task due today`) }),
    ).toContainText('Due today');
    await expect(alexTodo.getByRole('link', { name: 'Two more to do ›' })).toHaveAttribute(
      'href',
      '/tasks',
    );
    await expect(alex.getByRole('link', { name: /things? to sort ›$/ })).toHaveText(
      toSortWords(alexWaiting),
    );
    const alexMain = (await alex.textContent('main')) ?? '';
    expect(alexMain).not.toContain(ARCHIVED);
    expect(alexMain).not.toContain(CANARY_MARK.sam);
    expect(alexMain).not.toContain(SENSITIVE_MARK);
  } finally {
    await alexContext.close();
  }
});

test('a quiet day says so, even with things to sort; the identity prompt appears only for an unlinked adult', async ({
  page,
}) => {
  const t = await homeToday();
  // A calendar is connected, so this is a quiet day and not a first run.
  await seedCalendar({
    owner: 'fixture-sam',
    name: 'p9 quiet-day calendar',
    visibility: 'household',
    fingerprintTag: 'p9quietday',
  });
  // Everything Alex could see today is put away for a moment. A capture is
  // left waiting: captures don't make a day busy.
  const held = await q(`select id from event where archived_at is null`);
  const heldTasks = await q(
    `select id from task where archived_at is null and status = 'open' and due_date <= $1`,
    [t.d],
  );
  const [me] = await q(
    `select id from person where user_id = 'fixture-alex' and archived_at is null`,
  );
  expect(me?.id).toBeTruthy();
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
      `insert into capture (text, channel, visibility, created_by, created_via) values ($1, 'web', 'private', 'fixture-alex', 'ui')`,
      [`${P9}quiet day capture`],
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
    await expect(page.getByRole('link', { name: 'What’s coming up ›' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: /things? to sort ›$/ })).toBeVisible();
    const quietMain = (await page.textContent('main')) ?? '';
    expect(quietMain.indexOf('Nothing on today.')).toBeLessThan(quietMain.indexOf('to sort'));
    expect(quietMain).not.toContain('Which one is you?');
    await shot(page, 'today-quiet');

    // Unlinked: the prompt appears (the gate is open locally).
    await q(`update person set user_id = null where id = $1`, [me!.id]);
    await page.goto('/today');
    await expect(page.getByRole('link', { name: 'Which one is you? ›' })).toBeVisible();
    await shot(page, 'today-identity');
    await page.getByRole('link', { name: 'Which one is you? ›' }).click();
    await expect(page).toHaveURL(/\/settings\/you$/);
  } finally {
    await q(`update calendar_source set archived_at = now() where name = 'p9 quiet-day calendar'`);
    await q(`update person set user_id = 'fixture-alex' where id = $1`, [me!.id]);
    await q(`update event set archived_at = null where id = any($1::uuid[])`, [
      held.map((r) => r.id),
    ]);
    await q(`update task set archived_at = null where id = any($1::uuid[])`, [
      heldTasks.map((r) => r.id),
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
