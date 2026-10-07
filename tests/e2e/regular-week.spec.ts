import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { withDb } from './helpers';

// A person's regular week on their profile (M4 contract §3.6, ADR 0007 §45;
// Package 7): "Usually", by weekday, in the agenda's rows, linking to each
// event; absent when there is nothing regular; the other adult's private
// series never in it. Series are dated from the day the suite runs, so the
// week always has them. Synthetic only.

const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const KID = 'Rhythm kid';
let kid = '';
const days: Record<string, string> = {};

/** A manual series of this adult's, repeating on its first day's weekday, started some days ago at a home time. */
async function series(opts: {
  by: 'fixture-sam' | 'fixture-alex';
  title: string;
  daysAgo: number;
  time: string;
  rrule: string;
  visibility?: 'household' | 'private';
}) {
  // Idempotent: a worker that restarts after a failure runs this again.
  const existing = (
    await q(
      `update event set archived_at = null where title = $1 and created_by = $2
       returning id, trim(to_char((starts_at at time zone 'Pacific/Auckland')::date, 'FMDay')) as weekday`,
      [opts.title, opts.by],
    )
  )[0];
  if (existing) {
    days[opts.title] = existing.weekday!;
    return existing.id!;
  }
  const [row] = await q(
    `with d as (select (now() at time zone 'Pacific/Auckland')::date - $3::int as day)
     insert into event (title, kind, all_day, starts_at, ends_at, time_zone, rrule, created_by, created_via, visibility, source)
     select $1, 'activity', false, (d.day || ' ' || $4)::timestamp at time zone 'Pacific/Auckland',
            (d.day || ' ' || $4)::timestamp at time zone 'Pacific/Auckland' + interval '1 hour',
            'Pacific/Auckland', $5, $2, 'ui', $6, 'manual' from d
     returning id, trim(to_char((select day from d), 'FMDay')) as weekday`,
    [opts.title, opts.by, opts.daysAgo, opts.time, opts.rrule, opts.visibility ?? 'household'],
  );
  await q(
    `insert into event_person (event_id, person_id, role, created_by, created_via) values ($1, $2, 'attending', $3, 'ui')`,
    [row!.id, kid, opts.by],
  );
  days[opts.title] = row!.weekday!;
  return row!.id!;
}

test.beforeAll(async () => {
  kid =
    (await q(`update person set archived_at = null where name = $1 returning id`, [KID]))[0]?.id ??
    (
      await q(
        `insert into person (name, role, colour, created_by, created_via, visibility) values ($1, 'child', 'sun-soft', 'fixture-sam', 'ui', 'household') returning id`,
        [KID],
      )
    )[0]!.id!;
  await series({
    by: 'fixture-sam',
    title: 'Preschool',
    daysAgo: 21,
    time: '08:30',
    rrule: 'FREQ=WEEKLY',
  });
  await series({
    by: 'fixture-sam',
    title: 'Swim lesson',
    daysAgo: 16,
    time: '15:30',
    rrule: 'FREQ=WEEKLY',
  });
  await series({
    by: 'fixture-sam',
    title: 'Library club',
    daysAgo: 12,
    time: '11:40',
    rrule: 'FREQ=WEEKLY;INTERVAL=2',
  });
  await series({
    by: 'fixture-sam',
    title: 'Monthly check-in',
    daysAgo: 30,
    time: '10:00',
    rrule: 'FREQ=MONTHLY',
  });
  await series({
    by: 'fixture-alex',
    title: 'Alex-only lessons',
    daysAgo: 18,
    time: '17:00',
    rrule: 'FREQ=WEEKLY',
    visibility: 'private',
  });
});
// Put away afterwards, so later specs see the family as seeded.
test.afterAll(async () => {
  await q(
    `update event set archived_at = now() where id in (select event_id from event_person where person_id = $1)`,
    [kid],
  );
  await q(`update person set archived_at = now() where id = $1`, [kid]);
});

const usually = (page: Page) => page.locator('section[aria-labelledby="usually"]');

test('“Usually” lists the weekly and fortnightly series by weekday, links each to its event, and leaves irregular ones out', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto(`/people/${kid}`);
  const section = usually(page);
  await expect(section.getByRole('heading', { level: 2, name: 'Usually' })).toBeVisible();
  const text = await section.innerText();
  for (const [title, time] of [
    ['Preschool', '08:30'],
    ['Swim lesson', '15:30'],
    ['Library club', '11:40'],
  ] as const) {
    await expect(section.getByRole('heading', { level: 3, name: days[title]! })).toBeVisible();
    await expect(section.getByRole('link', { name: new RegExp(title) })).toContainText(time);
  }
  await expect(section.getByRole('link', { name: /Library club/ })).toContainText(
    `Every second ${days['Library club']}`,
  );
  await expect(section.getByRole('link', { name: /Preschool/ })).not.toContainText('Every second');
  expect(text).not.toContain('Monthly check-in');
  expect(text).not.toContain('Alex-only lessons'); // Alex's private series is not Sam's to see
  expect(await page.content()).not.toContain('Alex-only lessons');
  // Monday to Sunday.
  const order = await section.getByRole('heading', { level: 3 }).allInnerTexts();
  const week = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  expect(order).toEqual([...order].sort((a, b) => week.indexOf(a) - week.indexOf(b)));
  // Each row is the event's own page.
  const preschool = (await q(`select id from event where title = 'Preschool'`))[0]!.id;
  await expect(section.getByRole('link', { name: /Preschool/ })).toHaveAttribute(
    'href',
    `/events/${preschool}`,
  );
  // No machinery: no source, no confidence, no edit.
  expect(text).not.toMatch(/calendar|synced|inferred|confidence|%|Edit/i);
});

test('the other adult sees their own private series in the person’s week', async ({ page }) => {
  await signInAsFixtureAdult(page, 'alex');
  await page.goto(`/people/${kid}`);
  await expect(usually(page).getByRole('link', { name: /Alex-only lessons/ })).toBeVisible();
});

test('with nothing regular, there is no “Usually” at all', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  const nana = (await q(`select id from person where name = 'Nana Jo'`))[0]!.id;
  await page.goto(`/people/${nana}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Usually' })).toHaveCount(0);
  expect(await page.locator('main').innerText()).not.toMatch(/Usually|doesn’t know/i);
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`the profile with a regular week at ${name}: accessible, no sideways scroll, 44px rows, the last one clear of the capture bar`, async ({
    browser,
  }) => {
    const { context, page } = await fixtureAdultContext(browser, 'sam', viewport);
    await page.goto(`/people/${kid}`);
    await expect(usually(page)).toBeVisible();
    await expectNoHorizontalScroll(page, `${name} profile`);
    await expectAccessible(page, `${name} profile`);
    const rows = usually(page).getByRole('link');
    const heights = await rows.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    );
    expect(heights.length).toBeGreaterThanOrEqual(3);
    expect(heights.filter((h) => h < 44)).toEqual([]);
    // The last entry, reached by keyboard from the top, is in view with
    // nothing (the sticky header or the capture bar) on top of it.
    const last = rows.last();
    await page.evaluate(() => window.scrollTo(0, 0));
    await last.focus();
    await expect(last).toBeFocused();
    const covered = await last.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) return `out of view ${r.top}–${r.bottom}`;
      // Inset past the row's rounded corners, which take no hits.
      for (const [x, y] of [
        [r.left + 10, r.top + 10],
        [r.right - 10, r.bottom - 10],
        [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
      ] as const) {
        const at = document.elementFromPoint(x, y);
        if (!at || !(el === at || el.contains(at))) return `covered by ${at?.tagName}`;
      }
      return null;
    });
    expect(covered, `${name}: the last Usually row`).toBeNull();
    await context.close();
  });
}
