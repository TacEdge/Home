import { expect, test, type Page } from '@playwright/test';
import { allDayEvent, googleFeed, nzEvent, vevent } from '../fixtures/calendars/google';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { addressFor, failFeed, writeFeed } from './calendar-feeds';
import { fixtureAdultContext, signInAsFixtureAdult } from './fixture-adults';
import { withDb } from './helpers';

// Synced events across the screens (M4 contract §5.2; ADR 0007 §13, §14,
// §42; Package 6), over the seeded synthetic family and synthetic
// Google-shaped feeds dated around the day the suite runs. Nothing here is a
// real calendar, address, person or event.

const TOKEN = 'e2ep6samwork00000000000000000000';
const ALEX_TOKEN = 'e2ep6alexprivate0000000000000000';
const SECRET = addressFor(TOKEN);
const SWIM_UID = 'swim-e2e-p6@example.test';
const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const calendarIdNamed = async (name: string) =>
  (await q(`select id from calendar_source where name = $1`, [name]))[0]!.id!;
/** A synced event of this spec's own calendar, by title (other specs seed calendars and events of their own). */
const eventIdNamed = async (title: string, calendar = 'Sam’s squad') =>
  (
    await q(
      `select e.id from event e join calendar_source s on s.id = e.calendar_source_id
       where e.title = $1 and s.name = $2 and e.source = 'synced' order by e.created_at`,
      [title, calendar],
    )
  )[0]!.id!;

/** A day relative to today in the home zone, as the feeds and the pages write it. */
type Day = { ymd: string; iso: string; weekday: string };
const days: Record<number, Day> = {};
async function day(offset: number): Promise<Day> {
  if (!days[offset]) {
    const r = (
      await q(
        `select to_char(now() at time zone 'Pacific/Auckland' + ($1 || ' days')::interval, 'YYYYMMDD') as ymd,
                to_char(now() at time zone 'Pacific/Auckland' + ($1 || ' days')::interval, 'YYYY-MM-DD') as iso,
                trim(to_char(now() at time zone 'Pacific/Auckland' + ($1 || ' days')::interval, 'Day')) as weekday`,
        [String(offset)],
      )
    )[0] as Day;
    days[offset] = r;
  }
  return days[offset]!;
}

const BYDAY: Record<string, string> = {
  Monday: 'MO',
  Tuesday: 'TU',
  Wednesday: 'WE',
  Thursday: 'TH',
  Friday: 'FR',
  Saturday: 'SA',
  Sunday: 'SU',
};
const swim = (start: string, weekday: string, extra: Partial<Parameters<typeof nzEvent>[0]> = {}) =>
  nzEvent({
    uid: SWIM_UID,
    start: `${start}T153000`,
    end: `${start}T163000`,
    rrule: `FREQ=WEEKLY;BYDAY=${BYDAY[weekday]}`,
    summary: 'Swim squad',
    location: 'Synthetic Aquatic Centre',
    ...extra,
  });
const brokenSwim = vevent({
  UID: SWIM_UID,
  DTSTART: ';VALUE=DATE:20261332',
  SUMMARY: 'Swim squad',
});

async function feedOf(step: 'initial' | 'partial' | 'repaired'): Promise<string> {
  const [today, in3, in5, in7] = await Promise.all([day(0), day(3), day(5), day(7)]);
  const bins = allDayEvent({
    uid: 'bins-e2e-p6@example.test',
    start: today.ymd,
    end: (await day(1)).ymd,
    summary: 'Recycling out',
  });
  const games = nzEvent({
    uid: 'games-e2e-p6@example.test',
    start: `${in3.ymd}T193000`,
    end: `${in3.ymd}T213000`,
    // A rule HOME has no preset for: the same day of the month, monthly.
    rrule: `FREQ=MONTHLY;BYMONTHDAY=${Number(in3.ymd.slice(6, 8))}`,
    summary: 'Board games',
  });
  const london = vevent({
    UID: 'london-e2e-p6@example.test',
    DTSTART: `;TZID=Europe/London:${in5.ymd}T090000`,
    DTEND: `;TZID=Europe/London:${in5.ymd}T100000`,
    SUMMARY: 'London call',
  });
  const moved = nzEvent({
    uid: SWIM_UID,
    recurrenceId: `${in7.ymd}T153000`,
    start: `${in7.ymd}T170000`,
    end: `${in7.ymd}T180000`,
    summary: 'Swim squad',
    location: 'Synthetic Aquatic Centre',
    sequence: 1,
  });
  switch (step) {
    case 'initial':
      return googleFeed([swim(today.ymd, today.weekday), bins, games, london]);
    case 'partial':
      // The series is unreadable this time (its UID still known); the moved occurrence is readable.
      return googleFeed([brokenSwim, moved, bins, games, london]);
    case 'repaired':
      return googleFeed([
        swim(today.ymd, today.weekday, { exdate: [`${in7.ymd}T153000`], sequence: 2 }),
        moved,
        bins,
        games,
        london,
      ]);
  }
}

async function connect(page: Page, name: string, address: string, visibility = 'household') {
  await page.goto('/settings/calendars/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Google Calendar address').fill(address);
  await page.getByLabel('Who can see it').selectOption(visibility);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForURL(/\/settings\/calendars\/[0-9a-f-]{36}\?connected=1$/);
  return page.url().match(/calendars\/([0-9a-f-]{36})/)![1]!;
}
/** Refresh now from the calendar's page, waiting for the refresh itself to finish (the page's URL does not change). */
async function refreshNow(page: Page, calendarId: string) {
  await page.goto(`/settings/calendars/${calendarId}`);
  const done = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes(`/settings/calendars/${calendarId}`),
  );
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await done;
  await page.waitForLoadState('networkidle');
}
const forbidden = [
  SWIM_UID,
  'calendar.google.com',
  'private-',
  'hc1.',
  'fp2.',
  'externalUid',
  'recurrenceOriginal',
  'calendarSourceId',
];
const PROVIDER_WORDS = /\b(synced|sync|google|ical|ics|feed|provider|uid|read-only)\b/i;

test.beforeAll(async () => {
  writeFeed(TOKEN, await feedOf('initial'));
  writeFeed(
    ALEX_TOKEN,
    googleFeed([
      nzEvent({
        uid: 'alex-private-e2e-p6@example.test',
        start: `${(await day(1)).ymd}T120000`,
        end: `${(await day(1)).ymd}T130000`,
        summary: 'Alex’s private appointment',
      }),
    ]),
  );
});
test.beforeEach(() => failFeed(TOKEN, null));
// The events the feeds brought in are put away afterwards, so later specs see the family as seeded.
test.afterAll(async () => {
  await q(
    `update event set archived_at = now() where calendar_source_id is not null and archived_at is null`,
  );
});

test('Today and Forward: synced events sit among the manual ones, in agenda order, in HOME’s own words', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await connect(page, 'Sam’s squad', SECRET);
  await refreshNow(page, id);
  await expect(page.getByText(/^Updated just now/)).toBeVisible();

  await page.goto('/today');
  const onToday = page.locator('section[aria-labelledby="today-on"]');
  await expect(onToday.getByRole('link', { name: /Recycling out/ })).toBeVisible();
  await expect(onToday.getByRole('link', { name: /Swim squad/ })).toContainText('15:30');
  // All-day first: Bins out above Swimming, whatever else the family has on.
  const titles = await onToday.getByRole('link').allInnerTexts();
  expect(titles.findIndex((t) => t.includes('Recycling out'))).toBeLessThan(
    titles.findIndex((t) => t.includes('Swim squad')),
  );
  expect(await page.locator('main').innerText()).not.toMatch(PROVIDER_WORDS);
  await expectAccessible(page, 'today with synced events');

  await page.goto('/forward');
  const swims = page.getByRole('link', { name: /Swim squad/ });
  expect(await swims.count()).toBeGreaterThanOrEqual(4); // weekly, over 30 days
  await expect(page.getByRole('link', { name: /Board games/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /London call/ })).toBeVisible();
  const main = await page.locator('main').innerText();
  expect(main).not.toMatch(PROVIDER_WORDS);
  expect(main).not.toMatch(/Updated|updated/); // freshness is not on every row
  const html = await page.content();
  for (const s of forbidden) expect(html, s).not.toContain(s);
  await expectNoHorizontalScroll(page, 'forward with synced events');
  await expectAccessible(page, 'forward with synced events');
});

test('a synced event’s page: where it comes from and how fresh, calm ownership words, no provider controls, nothing internal', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const swimId = await eventIdNamed('Swim squad');
  await page.goto(`/events/${swimId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Swim squad' })).toBeVisible();
  await expect(
    page.getByText(/From Sam’s squad calendar · updated (just now|\d+ min ago)/),
  ).toBeVisible();
  await expect(page.getByText(`Every ${(await day(0)).weekday}`)).toBeVisible();
  await expect(page.getByText('Synthetic Aquatic Centre')).toBeVisible();
  await expect(
    page.getByText('This comes from Sam’s squad calendar, so change those details there.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Next few times' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.locator('summary', { hasText: 'Archive' })).toHaveCount(0);
  await expect(page.locator('button[aria-label^="Skip "]')).toHaveCount(0);
  await expect(page.locator('button[aria-label^="Put back "]')).toHaveCount(0);
  expect((await page.request.get(`/events/${swimId}/edit`)).url()).toMatch(
    new RegExp(`/events/${swimId}$`),
  );
  const main = await page.locator('main').innerText();
  expect(main).not.toMatch(/\b(synced|sync|google|ical|ics|feed|provider|uid|read-only|locked)\b/i);
  const html = await page.content();
  for (const s of forbidden) expect(html, s).not.toContain(s);
  await expectAccessible(page, 'synced event page');

  // A rule HOME has no preset for is said plainly, never guessed at.
  await page.goto(`/events/${await eventIdNamed('Board games')}`);
  await expect(page.getByText('Repeats as in the calendar')).toBeVisible();
  await expect(page.getByText(/Repeats \(custom\)/)).toHaveCount(0);
});

test('who’s going and the notes are HOME’s: changed from the event page, seen on Forward, Today and the person’s Coming up', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const swimId = await eventIdNamed('Swim squad');
  await page.goto(`/events/${swimId}`);
  await expect(page.getByText('Nobody in particular yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Change who’s going' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Who’s going to Swim squad' }),
  ).toBeVisible();
  await page
    .getByRole('group', { name: 'Who’s going' })
    .getByLabel('Milo', { exact: true })
    .check();
  await page
    .getByRole('group', { name: 'Who’s responsible' })
    .getByLabel('Sam', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(new RegExp(`/events/${swimId}$`));
  await expect(page.getByRole('link', { name: /Milo/ })).toContainText('Going');
  await expect(page.getByRole('link', { name: /Sam/ }).first()).toContainText('Responsible');

  await page.locator('summary', { hasText: 'Add a note' }).click();
  await page.getByLabel('A note').fill('Goggles are in the blue bag.');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('p', { hasText: 'Goggles are in the blue bag.' })).toBeVisible();

  await page.goto('/forward');
  await expect(page.getByRole('link', { name: /Swim squad/ }).first()).toContainText('Milo');
  await page.goto('/today');
  await expect(
    page.locator('section[aria-labelledby="today-on"]').getByRole('link', { name: /Swim squad/ }),
  ).toContainText('Milo');
  const milo = (await q(`select id from person where name = 'Milo'`))[0]!.id;
  await page.goto(`/people/${milo}`);
  await expect(page.getByRole('link', { name: /Swim squad/ }).first()).toBeVisible();
  await expectAccessible(page, 'coming up with a synced event');
});

test('a calendar’s usual people show on its events that have none of their own', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await calendarIdNamed('Sam’s squad');
  await page.goto(`/settings/calendars/${id}/edit`);
  await page.getByRole('checkbox', { name: /Isla/ }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
  const bins = await eventIdNamed('Recycling out');
  await page.goto(`/events/${bins}`);
  await expect(page.getByRole('link', { name: /Isla/ })).toContainText('Usually going');
  await page.goto('/forward');
  await expect(page.getByRole('link', { name: /Recycling out/ })).toContainText('Isla');
  // Swimming has its own people, so Isla is not shown there.
  await expect(page.getByRole('link', { name: /Swim squad/ }).first()).not.toContainText('Isla');
  expect(
    (await q(`select count(*)::int as n from event_person where event_id = $1`, [bins]))[0]!.n,
  ).toBe(0); // derived, never written
});

test('a moved occurrence shows once at its new time, even while the series lacks its EXDATE', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await calendarIdNamed('Sam’s squad');
  const in7 = await day(7);
  writeFeed(TOKEN, await feedOf('partial'));
  await refreshNow(page, id);
  await expect(page.getByText(/with a few things skipped/)).toBeVisible();
  const series = (
    await q(`select exdates from event where external_uid = $1 and recurrence_original is null`, [
      SWIM_UID,
    ])
  )[0]!;
  expect(series.exdates).toBeNull(); // the partial state
  await page.goto('/forward');
  const thatDay = page.locator(`section[aria-labelledby="day-${in7.iso}"]`);
  await expect(thatDay.getByRole('link', { name: /Swim squad/ })).toHaveCount(1);
  await expect(thatDay.getByRole('link', { name: /Swim squad/ })).toContainText('17:00');
  // Its people came with the series' annotations? No: the moved one is its own
  // event; it shows the calendar's usual people instead.
  await expect(thatDay.getByRole('link', { name: /Swim squad/ })).toContainText('Isla');

  // The series repairing its EXDATE later changes nothing.
  writeFeed(TOKEN, await feedOf('repaired'));
  await refreshNow(page, id);
  await page.goto('/forward');
  await expect(thatDay.getByRole('link', { name: /Swim squad/ })).toHaveCount(1);
  await expect(thatDay.getByRole('link', { name: /Swim squad/ })).toContainText('17:00');
});

test('a failed refresh keeps the last-known events, with no alarm anywhere', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await calendarIdNamed('Sam’s squad');
  failFeed(TOKEN, 'unreachable');
  await refreshNow(page, id);
  await expect(page.getByText(/^Couldn’t update just now/)).toBeVisible();
  await page.goto('/forward');
  expect(await page.getByRole('link', { name: /Swim squad/ }).count()).toBeGreaterThanOrEqual(4);
  const main = await page.locator('main').innerText();
  expect(main).not.toMatch(/couldn’t|stale|broken|failed|error/i);
  await page.goto(`/events/${await eventIdNamed('Swim squad')}`);
  await expect(
    page.getByText(/From Sam’s squad calendar · updated (just now|\d+ min ago)/),
  ).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(/couldn’t|stale|broken|failed|error/i);
});

test('privacy: the other adult’s private synced event is nowhere, not even by URL; a household one is shared with safe source words only', async ({
  browser,
}) => {
  const alex = await fixtureAdultContext(browser, 'alex', { width: 375, height: 812 });
  const alexCal = await connect(alex.page, 'Alex only', addressFor(ALEX_TOKEN), 'private');
  await refreshNow(alex.page, alexCal);
  const privateId = await eventIdNamed('Alex’s private appointment', 'Alex only');
  expect(privateId).toBeTruthy();
  await alex.page.goto('/forward');
  await expect(alex.page.getByRole('link', { name: /Alex’s private appointment/ })).toBeVisible();

  // The household event, as the other adult: the calendar's name and
  // freshness, HOME's own people controls, nothing of the connection.
  const swimId = await eventIdNamed('Swim squad');
  await alex.page.goto(`/events/${swimId}`);
  await expect(alex.page.getByText(/From Sam’s squad calendar · updated/)).toBeVisible();
  await expect(alex.page.getByRole('link', { name: 'Change who’s going' })).toBeVisible();
  const html = await alex.page.content();
  for (const s of forbidden) expect(html, s).not.toContain(s);
  await alex.context.close();

  const sam = await fixtureAdultContext(browser, 'sam', { width: 375, height: 812 });
  for (const path of ['/today', '/forward']) {
    const body = await (await sam.page.request.get(path)).text();
    expect(body).not.toContain('Alex’s private appointment');
    expect(body).not.toContain('Alex only');
  }
  for (const path of [`/events/${privateId}`, `/events/${privateId}/people`]) {
    const r = await sam.page.request.get(path);
    expect(r.status(), path).toBe(404);
    expect(await r.text()).not.toContain('Alex’s private appointment');
  }
  await sam.context.close();
});

test('disconnecting takes the events off the agenda; reconnecting brings the same ones back with their people', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await calendarIdNamed('Sam’s squad');
  const swimId = await eventIdNamed('Swim squad');
  await page.goto(`/settings/calendars/${id}`);
  await page.locator('summary', { hasText: 'Disconnect' }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('Disconnected.', { exact: true })).toBeVisible();
  await page.goto('/forward');
  await expect(page.getByRole('link', { name: /Swim squad/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Recycling out/ })).toHaveCount(0);

  await page.goto(`/settings/calendars/${id}/reconnect`);
  await page.getByLabel('Google Calendar address').fill(SECRET);
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await page.waitForURL(/\?reconnected=1$/);
  await refreshNow(page, id);
  await page.goto('/forward');
  const swims = page.getByRole('link', { name: /Swim squad/ });
  expect(await swims.count()).toBeGreaterThanOrEqual(4);
  await expect(swims.first()).toContainText('Milo');
  await expect(swims.first()).toHaveAttribute('href', `/events/${swimId}`); // the same row
  await page.goto(`/events/${swimId}`);
  await expect(page.locator('p', { hasText: 'Goggles are in the blue bag.' })).toBeVisible();
});

test('refresh on use: Today asks for a refresh after it has rendered when a calendar is stale', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await calendarIdNamed('Sam’s squad');
  await q(
    `update calendar_source set last_attempt_at = now() - interval '20 minutes', last_synced_at = now() - interval '20 minutes', feed_hash = null where id = $1`,
    [id],
  );
  const refreshed = page.waitForResponse(
    (r) => r.url().endsWith('/calendars/refresh') && r.request().method() === 'POST',
  );
  await page.goto('/today');
  await expect(
    page.locator('section[aria-labelledby="today-on"]').getByRole('link', { name: /Swim squad/ }),
  ).toBeVisible(); // shown at once, from what HOME had
  expect((await refreshed).status()).toBe(200);
  await page.goto(`/settings/calendars/${id}`);
  await expect(page.getByText(/^Updated just now/)).toBeVisible();
});

test('without JavaScript: who’s going is changed from the event page', async ({ browser }) => {
  const { context, page } = await fixtureAdultContext(
    browser,
    'alex',
    { width: 375, height: 812 },
    { javaScriptEnabled: false },
  );
  const bins = await eventIdNamed('Recycling out');
  await page.goto(`/events/${bins}/people`);
  await page
    .getByRole('group', { name: 'Who’s going' })
    .getByLabel('Alex', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(new RegExp(`/events/${bins}$`));
  await expect(page.getByRole('link', { name: /Alex/ })).toContainText('Going');
  await expect(page.getByRole('link', { name: /Isla/ })).toHaveCount(0); // its own person now, not the usual one
  await context.close();
});
