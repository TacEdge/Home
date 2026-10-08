import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { seedCalendar } from './calendar-feeds';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { withDb } from './helpers';

// Changing one time of a repeating manual event (M4 contract §5.3, ADR
// 0007 §46; Package 8b): "Change this one" from the series' next few times,
// the changed time's own page with "Change this one again" and "Back to
// the series", skip and change never meeting, the series showing each time
// once, the other adult's private series out of reach, a synced series
// offering none of it, and all of it without JavaScript. Series are dated
// from the day the suite runs. Synthetic only.

const SHOTS = 'test-results/screenshots';
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const NZ = 'Pacific/Auckland';
const NOT_HERE = 'Nothing here.';

type Day = { iso: string; long: string; at16: string };
/** `n` days from today at home: its date, its long name, and the 16:00 time as the series has it. */
async function day(n: number): Promise<Day> {
  const [r] = await q(
    `with d as (select (now() at time zone $1)::date + $2::int as day)
     select to_char(day, 'YYYY-MM-DD') as iso, to_char(day, 'FMDay FMDD FMMonth') as long,
            to_char(((day || ' 16:00')::timestamp at time zone $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at16
     from d`,
    [NZ, n],
  );
  return r as Day;
}

const ids = {} as { choir: string; run: string; band: string; bandChange: string; synced: string };

/** A weekly manual series on today's weekday, started two weeks ago at 16:00 at home. Idempotent. */
async function series(opts: {
  by: 'fixture-sam' | 'fixture-alex';
  title: string;
  visibility?: 'household' | 'private';
  person?: string;
}) {
  const existing = (
    await q(
      `update event set archived_at = null where title = $1 and created_by = $2 and recurrence_parent_id is null returning id`,
      [opts.title, opts.by],
    )
  )[0];
  if (existing) return existing.id!;
  const [row] = await q(
    `with d as (select (now() at time zone $3)::date - 14 as day)
     insert into event (title, kind, all_day, starts_at, ends_at, time_zone, rrule, created_by, created_via, visibility, source)
     select $1, 'activity', false, (d.day || ' 16:00')::timestamp at time zone $3,
            (d.day || ' 16:00')::timestamp at time zone $3 + interval '1 hour',
            $3, 'FREQ=WEEKLY;BYDAY=' || upper(left(to_char(d.day, 'Dy'), 2)), $2, 'ui', $4, 'manual' from d
     returning id`,
    [opts.title, opts.by, NZ, opts.visibility ?? 'household'],
  );
  if (opts.person)
    await q(
      `insert into event_person (event_id, person_id, role, created_by, created_via) values ($1, $2, 'attending', $3, 'ui')`,
      [row!.id, opts.person, opts.by],
    );
  return row!.id!;
}

const liveChangesOf = (seriesId: string) =>
  q(
    `select id, title from event where recurrence_parent_id = $1 and archived_at is null order by created_at`,
    [seriesId],
  );

test.beforeAll(async () => {
  const milo = (await q(`select id from person where name = 'Milo'`))[0]!.id!;
  ids.choir = await series({ by: 'fixture-sam', title: 'Choir practice', person: milo });
  ids.run = await series({ by: 'fixture-alex', title: 'Alex only run', visibility: 'private' });
  ids.band = await series({ by: 'fixture-sam', title: 'Band rehearsal', person: milo });
  // A standing change of Band rehearsal in ten days, an hour later, for the device sweep.
  const d10 = await day(10);
  const standing = (
    await q(
      `update event set archived_at = null where recurrence_parent_id = $1 and recurrence_original = $2 returning id`,
      [ids.band, d10.at16],
    )
  )[0];
  ids.bandChange =
    standing?.id ??
    (
      await q(
        `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, created_by, created_via, visibility, source, recurrence_parent_id, recurrence_original)
         values ($1, 'activity', false, ($2 || ' 17:00')::timestamp at time zone $3, ($2 || ' 18:00')::timestamp at time zone $3, $3, 'fixture-sam', 'ui', 'household', 'manual', $4, $5)
         returning id`,
        ['Band rehearsal', d10.iso, NZ, ids.band, d10.at16],
      )
    )[0]!.id!;
  // A synced weekly series, as the sync would have written it (no feed needed).
  const calendar = await seedCalendar({
    owner: 'fixture-sam',
    name: 'Sam’s synced 8b',
    visibility: 'household',
    fingerprintTag: 'p8bsyncedseries',
  });
  ids.synced =
    (
      await q(
        `select id from event where calendar_source_id = $1 and external_uid = 'p8b-series@example.test'`,
        [calendar],
      )
    )[0]?.id ??
    (
      await q(
        `with d as (select (now() at time zone $2)::date - 14 as day)
         insert into event (created_by, created_via, visibility, title, kind, source, calendar_source_id, external_uid, all_day, starts_at, ends_at, time_zone, rrule)
         select 'fixture-sam', 'sync', 'household', 'Synced squad 8b', 'activity', 'synced', $1, 'p8b-series@example.test', false,
                (d.day || ' 09:00')::timestamp at time zone $2, (d.day || ' 10:00')::timestamp at time zone $2, $2, 'FREQ=WEEKLY' from d
         returning id`,
        [calendar, NZ],
      )
    )[0]!.id!;
});

test.afterAll(async () => {
  for (const id of [ids.choir, ids.run, ids.band, ids.synced])
    if (id)
      await q(`update event set archived_at = now() where id = $1 or recurrence_parent_id = $1`, [
        id,
      ]);
});

const changeLink = (page: Page, d: Day) =>
  page.getByRole('link', { name: `Change this one: ${d.long}` });
const skipButton = (page: Page, d: Day) => page.getByRole('button', { name: `Skip ${d.long}` });
const nextTimes = (page: Page) =>
  page.locator('ul').filter({ has: page.getByRole('link', { name: /Change this one: / }) });

test('change one time: the form has that time; the changed time has its own page; the series and Forward show it once', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const d7 = await day(7);
  await page.goto(`/events/${ids.choir}`);
  await expect(page.getByRole('link', { name: /Change this one: / }).first()).toBeVisible();
  await expect(page.getByText('Edit changes every time this happens')).toBeVisible();
  await shot(page, 'p8b-series-before');
  await changeLink(page, d7).click();
  await expect(page).toHaveURL(new RegExp(`/events/${ids.choir}/change/`));
  await expect(page.getByRole('heading', { level: 1, name: 'Change this one' })).toBeVisible();
  await expect(page.getByText(`Choir practice · ${d7.long} · 16:00–17:00`)).toBeVisible();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue(d7.iso);
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('16:00');
  await expect(page.getByLabel('To', { exact: true })).toHaveValue('17:00');
  await expect(page.getByLabel('What', { exact: true })).toHaveValue('Choir practice');
  // Nothing about the series is on offer here.
  await expect(page.getByLabel('Repeats')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Who’s going' })).toHaveCount(0);
  await expect(page.getByLabel('Who can see this')).toHaveCount(0);
  await shot(page, 'p8b-change-form');

  await page.getByLabel('What', { exact: true }).fill('Choir practice (late)');
  await page.getByLabel('From', { exact: true }).fill('17:00');
  await page.getByLabel('To', { exact: true }).fill('18:00');
  await page.getByRole('button', { name: 'Change this one' }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toContain(ids.choir);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Choir practice (late)' }),
  ).toBeVisible();
  await expect(page.getByText('One time of Choir practice, changed from the usual.')).toBeVisible();
  await expect(page.getByText(`Usually ${d7.long} · 16:00–17:00.`)).toBeVisible();
  await expect(page.getByText(`${d7.long} · 17:00–18:00`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Change this one again' })).toBeVisible();
  await expect(page.locator('summary', { hasText: 'Back to the series' })).toBeVisible();
  // The series' people come with it until it has its own.
  await expect(page.getByRole('link', { name: /Milo/ })).toContainText('Usually going');
  await expect(page.getByRole('link', { name: 'Change who’s going, for this one' })).toBeVisible();
  for (const absent of ['Edit', 'Archive', 'Skip this one'])
    await expect(page.getByText(absent, { exact: true })).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toMatch(/override|exdate|recurrence_original|RECURRENCE-ID/i);
  await shot(page, 'p8b-changed-time');

  // The series shows that day once, as changed, with no Skip for it.
  await page.goto(`/events/${ids.choir}`);
  const row = nextTimes(page).locator('li', { hasText: d7.long });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('17:00');
  await expect(row).toContainText('Changed from the usual · Choir practice (late)');
  await expect(row.getByRole('button', { name: `Back to the series: ${d7.long}` })).toBeVisible();
  await expect(changeLink(page, d7)).toHaveCount(0);
  await expect(skipButton(page, d7)).toHaveCount(0);
  await shot(page, 'p8b-series-changed');

  await page.goto('/forward');
  const thatDay = page.locator(`section[aria-labelledby="day-${d7.iso}"]`);
  await expect(thatDay.getByRole('link', { name: /Choir practice/ })).toHaveCount(1);
  await expect(thatDay.getByRole('link', { name: /Choir practice/ })).toContainText('17:00');
  await expect(thatDay.getByRole('link', { name: /Choir practice/ })).toContainText('Milo');
});

test('changing it again updates the same change; moved to another day it moves on the series and Forward', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const [d7, d8] = [await day(7), await day(8)];
  const [change] = await liveChangesOf(ids.choir);
  await page.goto(`/events/${change!.id}/edit`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Change this one again' }),
  ).toBeVisible();
  await expect(page.getByText(`Usually ${d7.long} · 16:00–17:00.`)).toBeVisible();
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('17:00');
  await page.getByLabel('Date', { exact: true }).fill(d8.iso);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${change!.id}$`));
  await expect(page.getByText(`${d8.long} · 17:00–18:00`)).toBeVisible();
  expect(await liveChangesOf(ids.choir)).toHaveLength(1);

  await page.goto(`/events/${ids.choir}`);
  await expect(nextTimes(page).locator('li', { hasText: d8.long })).toContainText(
    'Changed from the usual',
  );
  await expect(nextTimes(page).locator('li', { hasText: d7.long })).toHaveCount(0);
  await page.goto('/forward');
  await expect(
    page.locator(`section[aria-labelledby="day-${d8.iso}"]`).getByRole('link', {
      name: /Choir practice/,
    }),
  ).toHaveCount(1);
  await expect(
    page.locator(`section[aria-labelledby="day-${d7.iso}"]`).getByRole('link', {
      name: /Choir practice/,
    }),
  ).toHaveCount(0);
});

test('skip and change never meet: a changed time has no Skip, a crafted skip is refused, a skipped time is not changed', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const [d7, d14] = [await day(7), await day(14)];
  await page.goto(`/events/${ids.choir}`, { waitUntil: 'networkidle' });
  await expect(skipButton(page, d7)).toHaveCount(0);
  // Tamper another time's Skip to name the changed one: refused by the service.
  await page.evaluate((date) => {
    const f = document.querySelector('button[aria-label^="Skip "]')!.closest('form')!;
    (f.querySelector('input[name=date]') as HTMLInputElement).value = date;
  }, d7.iso);
  await page.locator('button[aria-label^="Skip "]').first().click();
  await expect(
    page.getByText('That time has already been changed. Put that change back first.'),
  ).toBeVisible();
  expect(await liveChangesOf(ids.choir)).toHaveLength(1);

  // A skipped time is put back before it is changed.
  await page.goto(`/events/${ids.choir}`);
  await skipButton(page, d14).click();
  await expect(page.getByRole('button', { name: `Put back ${d14.long}` })).toBeVisible();
  await page.goto(`/events/${ids.choir}/change/${encodeURIComponent(d14.at16)}`);
  await expect(
    page.getByText('That time is skipped. Put it back first, then change it.'),
  ).toBeVisible();
  await expect(page.getByLabel('What', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to Choir practice ›' }).click();
  await page.getByRole('button', { name: `Put back ${d14.long}` }).click();
  await expect(changeLink(page, d14)).toBeVisible();
});

test('back to the series puts the change away and the usual time returns; it can be brought back', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const [d7, d8] = [await day(7), await day(8)];
  const [change] = await liveChangesOf(ids.choir);
  await page.goto(`/events/${change!.id}`);
  await page.locator('summary', { hasText: 'Back to the series' }).click();
  await expect(
    page.getByText(
      `Choir practice goes back to the usual: ${d7.long} · 16:00–17:00. Nothing is deleted.`,
    ),
  ).toBeVisible();
  await shot(page, 'p8b-back-to-series');
  await page.getByRole('button', { name: 'Back to the series' }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${ids.choir}$`));
  await expect(changeLink(page, d7)).toBeVisible();
  await expect(skipButton(page, d7)).toBeVisible();
  await expect(nextTimes(page).locator('li', { hasText: d8.long })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Put away' })).toBeVisible();
  await expect(page.getByRole('link', { name: /A one-off change, put away/ })).toContainText(
    d7.long,
  );
  expect(await liveChangesOf(ids.choir)).toHaveLength(0);
  expect((await q(`select count(*)::int as n from event where id = $1`, [change!.id]))[0]!.n).toBe(
    1,
  ); // never deleted

  await page.goto('/forward');
  await expect(
    page.locator(`section[aria-labelledby="day-${d7.iso}"]`).getByRole('link', {
      name: /Choir practice/,
    }),
  ).toContainText('16:00');
  await expect(
    page.locator(`section[aria-labelledby="day-${d8.iso}"]`).getByRole('link', {
      name: /Choir practice/,
    }),
  ).toHaveCount(0);

  await page.goto(`/events/${change!.id}`);
  await expect(page.getByText(/put away$/)).toBeVisible();
  await expect(
    page.getByText('This one-off change was put away. Choir practice happens as usual that day.'),
  ).toBeVisible();
  await expect(page.locator('summary', { hasText: 'Back to the series' })).toHaveCount(0);
  await page.locator('summary', { hasText: 'Bring this change back' }).click();
  await page.getByRole('button', { name: 'Bring it back' }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${change!.id}$`));
  await expect(page.getByRole('link', { name: 'Change this one again' })).toBeVisible();
  // And away again, from the series' own row this time.
  await page.goto(`/events/${ids.choir}`);
  await page.getByRole('button', { name: `Back to the series: ${d8.long}` }).click();
  await expect(changeLink(page, d7)).toBeVisible();
  expect(await liveChangesOf(ids.choir)).toHaveLength(0);
});

test('two changes on one series are independent', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  const [d7, d14] = [await day(7), await day(14)];
  for (const [d, title] of [
    [d7, 'Choir practice (late)'],
    [d14, 'Choir concert'],
  ] as const) {
    await page.goto(`/events/${ids.choir}`);
    await changeLink(page, d).click();
    await page.getByLabel('What', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Change this one' }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  }
  expect((await liveChangesOf(ids.choir)).map((c) => c.title).sort()).toEqual([
    'Choir concert',
    'Choir practice (late)',
  ]);
  await page.goto(`/events/${ids.choir}`);
  await expect(nextTimes(page).locator('li', { hasText: d7.long })).toContainText('(late)');
  await expect(nextTimes(page).locator('li', { hasText: d14.long })).toContainText('Choir concert');
  await page.getByRole('button', { name: `Back to the series: ${d7.long}` }).click();
  await expect(changeLink(page, d7)).toBeVisible();
  await expect(nextTimes(page).locator('li', { hasText: d14.long })).toContainText('Choir concert');
  await page.getByRole('button', { name: `Back to the series: ${d14.long}` }).click();
  await expect(changeLink(page, d14)).toBeVisible();
  expect(await liveChangesOf(ids.choir)).toHaveLength(0);
});

test('a synced series offers no Change this one, and its change address goes back to its page', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const d7 = await day(7);
  await page.goto(`/events/${ids.synced}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Synced squad 8b' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next few times' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Change this one/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Skip / })).toHaveCount(0);
  await page.goto(`/events/${ids.synced}/change/${encodeURIComponent(d7.at16)}`);
  console.log(
    'DEBUG synced',
    page.url(),
    await page.locator('h1').allTextContents(),
    (await page.textContent('main'))?.slice(0, 300),
  );
  await expect(page).toHaveURL(new RegExp(`/events/${ids.synced}$`));
  expect(
    (
      await q(`select count(*)::int as n from event where recurrence_parent_id = $1`, [ids.synced])
    )[0]!.n,
  ).toBe(0);
});

test('privacy: the other adult reaches nothing of a private series, its change form or its changed time', async ({
  browser,
}) => {
  const d7 = await day(7);
  const alex = await fixtureAdultContext(browser, 'alex', VIEWPORTS.desktop);
  let page = alex.page;
  await page.goto(`/events/${ids.run}`);
  await changeLink(page, d7).click();
  await page.getByLabel('From', { exact: true }).fill('06:30');
  await page.getByLabel('To', { exact: true }).fill('07:30');
  await page.getByRole('button', { name: 'Change this one' }).click();
  await expect(page.getByText('One time of Alex only run, changed from the usual.')).toBeVisible();
  const [change] = await liveChangesOf(ids.run);

  const sam = await fixtureAdultContext(browser, 'sam', VIEWPORTS.desktop);
  page = sam.page;
  for (const path of [
    `/events/${ids.run}`,
    `/events/${ids.run}/change/${encodeURIComponent(d7.at16)}`,
    `/events/${change!.id}`,
    `/events/${change!.id}/edit`,
    `/events/${change!.id}/people`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: NOT_HERE }), path).toBeVisible();
  }
  await page.goto('/forward');
  expect(await page.textContent('main')).not.toContain('Alex only run');
  // Alex still has it, changed.
  page = alex.page;
  await page.goto('/forward');
  await expect(
    page.locator(`section[aria-labelledby="day-${d7.iso}"]`).getByRole('link', {
      name: /Alex only run/,
    }),
  ).toContainText('06:30');
  await alex.context.close();
  await sam.context.close();
});

test('crafted addresses read as not found; nothing is made', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  const d7 = await day(7);
  const wrongHour = d7.at16.replace(
    /T(\d{2})/,
    (_, h: string) => `T${String((Number(h) + 1) % 24).padStart(2, '0')}`,
  );
  for (const path of [
    `/events/${ids.choir}/change/2026-13-45`,
    `/events/${ids.choir}/change/not-a-time`,
    `/events/${ids.choir}/change/${encodeURIComponent(wrongHour)}`,
    `/events/${ids.choir}/change/${d7.iso}`, // a date, for a timed series
    `/events/00000000-0000-4000-8000-000000000000/change/${encodeURIComponent(d7.at16)}`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: NOT_HERE }), path).toBeVisible();
  }
  expect(await liveChangesOf(ids.choir)).toHaveLength(0);
});

test('without JavaScript: change this one, then back to the series', async ({ browser }) => {
  const { context, page } = await fixtureAdultContext(browser, 'sam', VIEWPORTS.desktop, {
    javaScriptEnabled: false,
  });
  const d21 = await day(21);
  await page.goto(`/events/${ids.choir}`);
  await changeLink(page, d21).click();
  await page.getByLabel('What', { exact: true }).fill('Choir practice, no script');
  await page.getByRole('button', { name: 'Change this one' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Choir practice, no script' }),
  ).toBeVisible();
  // A refused save keeps the words and says why, with no script either.
  await page.getByRole('link', { name: 'Change this one again' }).click();
  await page.getByLabel('What', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This can’t be empty.')).toBeVisible();
  await expect(page.getByLabel('What', { exact: true })).toHaveValue('   ');
  const [change] = await liveChangesOf(ids.choir);
  await page.goto(`/events/${change!.id}`);
  await page.locator('summary', { hasText: 'Back to the series' }).click();
  await page.getByRole('button', { name: 'Back to the series' }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${ids.choir}$`));
  await expect(changeLink(page, d21)).toBeVisible();
  expect(await liveChangesOf(ids.choir)).toHaveLength(0);
  await context.close();
});

test('an archived series puts its changes away with it; restoring brings them back', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const d7 = await day(28);
  await page.goto(`/events/${ids.choir}`);
  await changeLink(page, d7).click();
  await page.getByLabel('From', { exact: true }).fill('18:00');
  await page.getByLabel('To', { exact: true }).fill('19:00');
  await page.getByRole('button', { name: 'Change this one' }).click();
  await expect(page.getByText('One time of Choir practice, changed from the usual.')).toBeVisible();
  const [change] = await liveChangesOf(ids.choir);
  await page.goto(`/events/${ids.choir}`);
  await page.locator('summary', { hasText: 'Archive' }).click();
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/forward$/);
  expect(await page.textContent('main')).not.toContain('Choir practice');

  await page.goto(`/events/${change!.id}`);
  await expect(page.getByText(/put away$/)).toBeVisible();
  await expect(
    page.getByText('Choir practice is archived, so this one-off change is put away with it.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Change this one again' })).toHaveCount(0);
  await expect(page.locator('summary', { hasText: 'Back to the series' })).toHaveCount(0);
  await expect(page.locator('summary', { hasText: 'Bring this change back' })).toHaveCount(0);
  await page.goto(`/events/${change!.id}/edit`);
  await expect(page).toHaveURL(new RegExp(`/events/${change!.id}$`));
  // Nothing was written to the change itself.
  expect(await liveChangesOf(ids.choir)).toHaveLength(1);

  await page.goto(`/events/${ids.choir}`);
  await page.locator('summary', { hasText: 'Restore' }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${ids.choir}$`));
  await expect(nextTimes(page).locator('li', { hasText: d7.long })).toContainText('18:00');
  await page.getByRole('button', { name: `Back to the series: ${d7.long}` }).click();
  await expect(changeLink(page, d7)).toBeVisible();
  expect(await liveChangesOf(ids.choir)).toHaveLength(0);
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`accessibility, targets, keyboard and no horizontal scroll: ${name}`, async ({
    browser,
  }) => {
    const { context, page } = await fixtureAdultContext(browser, 'sam', viewport);
    const d17 = await day(17);
    const paths = [
      `/events/${ids.band}`,
      `/events/${ids.band}/change/${encodeURIComponent(d17.at16)}`,
      `/events/${ids.bandChange}`,
      `/events/${ids.bandChange}/edit`,
    ];
    for (const path of paths) {
      await page.goto(path);
      await expectNoHorizontalScroll(page, `${name} ${path}`);
      await expectAccessible(page, `${name} ${path}`);
      const targets = page.locator(
        'a[aria-label^="Change this one"], button[aria-label^="Skip "], button[aria-label^="Back to the series"], a:has-text("Change this one again"), summary:has-text("Back to the series"), button:has-text("Change this one"), button:has-text("Save")',
      );
      for (const box of await targets.evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect().height),
      ))
        expect(box, `${name} ${path} target height`).toBeGreaterThanOrEqual(44);
    }
    // Keyboard: the first Change this one link takes focus and stays in view.
    await page.goto(`/events/${ids.band}`);
    const first = page.getByRole('link', { name: /Change this one: / }).first();
    await first.focus();
    await expect(first).toBeFocused();
    const inView = await first.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    expect(inView, `${name} focused link in view`).toBe(true);
    if (name === 'phone') {
      await shot(page, 'p8b-series-phone');
      await page.goto(`/events/${ids.bandChange}`);
      await shot(page, 'p8b-changed-time-phone');
    }
    if (name === 'desktop') await shot(page, 'p8b-series-desktop');
    await context.close();
  });
}
