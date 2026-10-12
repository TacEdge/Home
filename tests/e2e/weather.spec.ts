import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { WEATHER_URL } from '../../playwright.config';
import { FINGERPRINT_VECTORS } from '../fixtures/weather';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { seedCalendar } from './calendar-feeds';
import { signInAsFixtureAdult, VIEWPORTS, type Adult } from './fixture-adults';
import { withDb } from './helpers';

// Weather and openings on Today and Forward Week (M7 Package 4; contract
// §4.1–§4.8, §8.4, §8.6 W19, X1, X4–X7, X9, X12, P1–P3), in a browser, on
// the weather server: the synthetic home point, a test-only location key and
// the fake provider (playwright.config.ts), so every other spec sees HOME
// without weather exactly as before. The forecast is written straight into
// `weather_forecast` for the fixture family on its scenario day, Wednesday 14
// October 2026 at 07:03 (NZDT), through the test-only `x-home-test-now`
// header; the refresh the page asks for after render is answered by the
// spec, never by a provider. The spec archives the calendars other specs
// left and restores them afterwards, so nothing here depends on them.
// Synthetic only. Screenshots land in test-results/screenshots.

const SHOTS = 'test-results/screenshots';
const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const DAY = '2026-10-14';
const THU = '2026-10-15';
const FRI = '2026-10-16';
const SAT = '2026-10-17';
const SUN = '2026-10-18';
const at = (date: string, clock: string) => `${date}T${clock}:00+13:00`;
const ms = (date: string, clock: string) => new Date(at(date, clock)).getTime();
const HOUR = 3_600_000;
const FINGERPRINT = FINGERPRINT_VECTORS[0].hex;

type Values = {
  precipitationProbability: number;
  precipitationMm: number;
  gustKmh: number;
};
/** F0 (contract §8.6) with a showery Wednesday afternoon, a wet Thursday and a showery Friday and Sunday. */
const VALUES = (t: number): Partial<Values> => {
  if (t >= ms(DAY, '12:00') && t < ms(DAY, '21:00'))
    return { precipitationProbability: 40, precipitationMm: 0.1 };
  if (t >= ms(THU, '00:00') && t < ms(FRI, '00:00'))
    return { precipitationProbability: 80, precipitationMm: 2 };
  if (t === ms(FRI, '10:00') || t === ms(SUN, '13:00'))
    return { precipitationProbability: 40, precipitationMm: 0.1 };
  return {};
};

/** The forecast row, as the service would have stored it, fetched at `fetched` (an ISO instant). */
async function setForecast(fetched: string, values: (t: number) => Partial<Values> = VALUES) {
  const start = Math.floor(new Date(fetched).getTime() / (24 * HOUR)) * 24 * HOUR;
  const hours = Array.from({ length: 191 }, (_, i) => {
    const t = start + i * HOUR;
    return {
      start: new Date(t).toISOString(),
      temperatureC: 14,
      precipitationMm: 0,
      precipitationProbability: 5,
      windKmh: 15,
      gustKmh: 30,
      ...values(t),
    };
  });
  await q(
    `insert into weather_forecast (provider, fetched_at, hours, location_fingerprint, first_hour, last_hour, last_attempt_at, last_attempt_status)
     values ('open_meteo', $1::timestamptz, $2::jsonb, $3, $4::timestamptz, $5::timestamptz, $1::timestamptz, 'ok')
     on conflict (provider) do update set fetched_at = excluded.fetched_at, hours = excluded.hours,
       location_fingerprint = excluded.location_fingerprint, first_hour = excluded.first_hour,
       last_hour = excluded.last_hour, last_attempt_at = excluded.last_attempt_at, last_attempt_status = 'ok'`,
    [fetched, JSON.stringify(hours), FINGERPRINT, hours[0]!.start, hours.at(-1)!.start],
  );
}
/** No forecast yet: no hours, no fingerprint, and no attempt, so a refresh is due. */
async function clearForecast() {
  await q(
    `update weather_forecast set fetched_at = null, hours = null, location_fingerprint = null,
       first_hour = null, last_hour = null, last_attempt_at = null, last_attempt_status = null`,
  );
}

let held: string[] = [];
let calendarId = '';
test.beforeAll(async () => {
  // Calendars other specs left would make every opening "as far as HOME knows".
  held = (
    await q(`select id from calendar_source where archived_at is null and name not like 'ws %'`)
  ).map((r) => r.id!);
  if (held.length)
    await q(`update calendar_source set archived_at = now() where id = any($1::uuid[])`, [held]);
  calendarId = await seedCalendar({
    owner: 'fixture-sam',
    name: 'ws Family calendar',
    visibility: 'household',
    fingerprintTag: 'wsfamily',
  });
  await q(
    `update calendar_source set archived_at = null, last_attempt_at = $2::timestamptz, last_synced_at = $2::timestamptz, last_sync_status = 'ok' where id = $1`,
    [calendarId, at(DAY, '06:58')],
  );
});
test.afterAll(async () => {
  await q(`update calendar_source set archived_at = now() where name like 'ws %'`);
  if (held.length)
    await q(`update calendar_source set archived_at = null where id = any($1::uuid[])`, [held]);
  await q(`update event set archived_at = now() where title like 'ws %' and archived_at is null`);
  await q(`delete from insight_response where insight_key like 'open_window:%'`);
});
test.beforeEach(async () => {
  await q(`delete from insight_response where insight_key like 'open_window:%'`);
  await q(
    `update calendar_source set last_attempt_at = $2::timestamptz, last_synced_at = $2::timestamptz where id = $1`,
    [calendarId, at(DAY, '06:58')],
  );
  await setForecast(at(DAY, '06:55'));
});

type Opened = { context: BrowserContext; page: Page; posts: () => number };

/** A signed-in adult on the weather server at a fixed instant; the refresh is counted and answered here. */
async function open(
  browser: Browser,
  adult: Adult,
  now: string,
  path: string,
  o: {
    js?: boolean;
    viewport?: { width: number; height: number };
    /** Leave the calendar's last update as the test set it (default: five minutes before `now`). */
    keepCalendar?: boolean;
  } = {},
): Promise<Opened> {
  if (!o.keepCalendar) {
    const t = new Date(new Date(now).getTime() - 5 * 60_000).toISOString();
    await q(
      `update calendar_source set last_attempt_at = $2::timestamptz, last_synced_at = $2::timestamptz where id = $1`,
      [calendarId, t],
    );
  }
  const context = await browser.newContext({
    baseURL: WEATHER_URL,
    viewport: o.viewport ?? VIEWPORTS.phone,
    javaScriptEnabled: o.js ?? true,
    extraHTTPHeaders: { 'x-home-test-now': now },
  });
  let posts = 0;
  await context.route('**/weather/refresh', async (route) => {
    posts++;
    await route.fulfill({ status: 200, json: { changed: false } });
  });
  const page = await context.newPage();
  await signInAsFixtureAdult(page, adult);
  // The sign-in lands on Today, which may ask for a refresh of its own: leave
  // it, and count only the page under test.
  await page.goto('about:blank');
  posts = 0;
  await page.goto(path);
  return { context, page, posts: () => posts };
}

/** A Why disclosure's summary within a scope. */
const whyOf = (scope: Page | Locator) => scope.locator('summary', { hasText: /^Why/ }).first();
const credit = (page: Page) => page.locator('a[aria-label="Forecast data: Open-Meteo"]');
const visibleCredit = (page: Page) =>
  page.locator('a[aria-label="Forecast data: Open-Meteo"]:visible');
const worth = (page: Page, id = 'today-worth') => page.locator(`section[aria-labelledby="${id}"]`);
const openings = (page: Page) => page.locator('li[data-insight^="open_window"]');
const openAll = (page: Page) =>
  page.evaluate(() =>
    document.querySelectorAll('main details').forEach((d) => d.setAttribute('open', '')),
  );
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/weather-${name}.png`, fullPage: true });

const SAT_TASK =
  'Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–19:30, and the forecast for Saturday as of 06:55 looks dry.';
const SUN_PLAIN =
  'Nothing is recorded for the household on Sunday, 08:00–19:30. The forecast for Sunday as of 06:55 has showers possible.';

test.describe('Today', () => {
  test('W19, X6: the sentence after the headline, one credit link after it, a Why from the cached forecast; nothing asked for', async ({
    browser,
  }) => {
    const { context, page, posts } = await open(browser, 'sam', at(DAY, '07:03'), '/today');
    const sentence = page.getByTestId('weather-sentence');
    await expect(sentence).toHaveText('Looks dry until midday, then showers possible.');
    // The headline, then the sentence, then "What this is based on ›".
    const y = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!.y;
    const headline = await y(page.getByTestId('headline'));
    const s = await y(sentence);
    expect(s).toBeGreaterThan(headline);
    const basedOn = page.getByText('What this is based on', { exact: false }).first();
    if (await basedOn.count()) expect(await y(basedOn)).toBeGreaterThan(s);
    // Body type, ink: not the display face.
    expect(await sentence.evaluate((e) => getComputedStyle(e).fontFamily)).not.toMatch(/Bricolage/);
    // One credit link, a real link that goes nowhere but Open-Meteo, and 44px tall.
    await expect(visibleCredit(page)).toHaveCount(1);
    const link = visibleCredit(page);
    await expect(link).toHaveAttribute('href', 'https://open-meteo.com/');
    await expect(link).toHaveAttribute('rel', 'noreferrer');
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The Why, in place.
    await whyOf(page.getByTestId('weather')).click();
    const why = page.getByTestId('weather-why');
    await expect(why).toContainText('From the forecast as of 06:55.');
    await expect(why).toContainText('Morning, 07:00–12:00: looks dry.');
    await expect(why).toContainText('Afternoon, 12:00–18:00: showers possible.');
    await expect(why).toContainText('Between 14° and 14°.');
    // Nothing was due, so nothing was asked; no network left the page for the provider.
    expect(posts()).toBe(0);
    await shot(page, 'today-sentence-phone');
    await context.close();
  });

  test('X4: without JavaScript the cached forecast stands, with its time; the Why opens; nothing is asked', async ({
    browser,
  }) => {
    await setForecast(at('2026-10-13', '21:00'));
    const { context, page, posts } = await open(browser, 'alex', at(DAY, '07:03'), '/today', {
      js: false,
    });
    await expect(page.getByTestId('weather-sentence')).toHaveText(
      'As of yesterday 21:00, looks dry until midday, then showers possible.',
    );
    await whyOf(page.getByTestId('weather')).click();
    await expect(page.getByTestId('weather-why')).toContainText('yesterday 21:00');
    expect(posts()).toBe(0);
    await context.close();
  });

  test('X6, X7: an unusable forecast says it hasn’t updated; no credit, no sentence, no “error”; the refresh is asked once, after render', async ({
    browser,
  }) => {
    await setForecast(at('2026-10-13', '17:00'));
    const { context, page, posts } = await open(browser, 'sam', at(DAY, '07:03'), '/today');
    await expect(page.getByTestId('weather-stale')).toHaveText(
      "The forecast hasn't updated since yesterday.",
    );
    await expect(page.getByTestId('weather-sentence')).toHaveCount(0);
    await expect(credit(page)).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/error/i);
    await expect.poll(posts).toBe(1);
    await shot(page, 'today-stale-phone');
    await context.close();
  });

  test('X6: no forecast yet says nothing and asks once; a fresh one asks nothing', async ({
    browser,
  }) => {
    await clearForecast();
    const a = await open(browser, 'sam', at(DAY, '07:03'), '/today');
    await expect(a.page.getByTestId('weather')).toHaveCount(0);
    await expect(a.page.getByTestId('weather-stale')).toHaveCount(0);
    await expect(credit(a.page)).toHaveCount(0);
    await expect.poll(a.posts).toBe(1);
    await a.context.close();
    await setForecast(at(DAY, '06:55'));
    const b = await open(browser, 'sam', at(DAY, '07:03'), '/today');
    await expect(b.page.getByTestId('weather-sentence')).toBeVisible();
    await b.page.waitForTimeout(500);
    expect(b.posts()).toBe(0);
    await b.context.close();
  });

  test('X6: the evening state is about tomorrow', async ({ browser }) => {
    await setForecast(at(DAY, '19:20'));
    await q(
      `update calendar_source set last_attempt_at = $2::timestamptz, last_synced_at = $2::timestamptz where id = $1`,
      [calendarId, at(DAY, '19:10')],
    );
    const { context, page } = await open(browser, 'sam', at(DAY, '19:30'), '/today');
    await expect(page.getByTestId('weather-sentence')).toHaveText('Rain likely tomorrow.');
    await expect(visibleCredit(page)).toHaveCount(1);
    await shot(page, 'today-evening-phone');
    await context.close();
  });

  test('X5, O18: on a phone the headline, the weather sentence and the first Worth knowing row (Saturday’s opening) are on the first screen; Why shows the evidence', async ({
    browser,
  }) => {
    await setForecast(at(SAT, '06:55'));
    const { context, page } = await open(browser, 'sam', at(SAT, '07:30'), '/today');
    const row = openings(page).first();
    await expect(row).toContainText(
      'Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household today, 10:00–19:30, and the forecast as of 06:55 looks dry then.',
    );
    await expect(page.getByTestId('weather-sentence')).toHaveText('Looks dry today.');
    // Only one opening on Today, and the credit link follows the sentence, not the opening.
    await expect(openings(page)).toHaveCount(1);
    await expect(visibleCredit(page)).toHaveCount(1);
    const fold = VIEWPORTS.phone.height;
    for (const loc of [page.getByTestId('headline'), page.getByTestId('weather-sentence'), row]) {
      const box = (await loc.boundingBox())!;
      expect(box.y + box.height, 'on the first screen').toBeLessThanOrEqual(fold);
    }
    await shot(page, 'today-opening-phone');
    await whyOf(row).click();
    const why = row.getByTestId('opening-why');
    await expect(why).toContainText(
      'from the end of Football (10:00) to the end of daylight (19:30; sunset 19:4',
    );
    await expect(why).toContainText('Household:');
    await expect(why).toContainText('Family calendar');
    await expect(why).toContainText('ws Family calendar · last updated');
    await expect(why).toContainText('Forecast fetched');
    await expect(why).toContainText('About three hours; dry weather and daylight');
    await expect(why.getByRole('link', { name: /Paint the back fence/ })).toHaveAttribute(
      'href',
      /^\/tasks\//,
    );
    await expect(row.getByTestId('opening-limit')).toHaveText(
      "This is only what HOME has recorded that you can see. It isn't a check of anyone's plans.",
    );
    await expect(row.getByRole('button', { name: /^Not useful/ })).toBeVisible();
    await shot(page, 'today-why-phone');
    await context.close();
  });

  test('with no sentence, the credit link follows the opening that cites the forecast (W19)', async ({
    browser,
  }) => {
    // Hours stop at Saturday 20:00: the evening part is not covered (no sentence), the opening's span is.
    const last = ms(SAT, '20:00');
    await setForecast(at(SAT, '06:55'), () => ({}));
    await q(
      `update weather_forecast set hours = (select jsonb_agg(h) from jsonb_array_elements(hours) h where (h->>'start')::timestamptz < $1::timestamptz)`,
      [new Date(last).toISOString()],
    );
    const { context, page } = await open(browser, 'sam', at(SAT, '07:30'), '/today');
    await expect(page.getByTestId('weather-sentence')).toHaveCount(0);
    await expect(visibleCredit(page)).toHaveCount(1);
    await expect(
      openings(page).first().locator('a[aria-label="Forecast data: Open-Meteo"]:visible'),
    ).toHaveCount(1);
    await context.close();
  });

  test('X4, O23: Dismiss and Not useful on an opening, from Today, without JavaScript: back on Today with it gone, for that adult only; Sunday’s follows, worded with “tomorrow”', async ({
    browser,
  }) => {
    await setForecast(at(SAT, '06:55'));
    const alex = await open(browser, 'alex', at(SAT, '07:30'), '/today', { js: false });
    await expect(openings(alex.page)).toHaveCount(1);
    await alex.page.getByRole('button', { name: /^Dismiss: Paint the back fence/ }).click();
    await alex.page.waitForURL('**/today');
    await expect(openings(alex.page)).toHaveCount(1);
    await expect(openings(alex.page)).toContainText(
      'Nothing is recorded for the household tomorrow, 08:00–19:30.',
    );
    await expect(alex.page.getByText('Paint the back fence is recorded')).toHaveCount(0);
    // Not useful, inside the Why.
    await whyOf(openings(alex.page)).click();
    await alex.page.getByRole('button', { name: /^Not useful: Nothing is recorded/ }).click();
    await alex.page.waitForURL('**/today');
    await expect(openings(alex.page)).toHaveCount(0);
    // Sam is untouched (P2), and the same keys are gone from Forward for Alex (the response is everywhere).
    const sam = await open(browser, 'sam', at(SAT, '07:30'), '/today');
    await expect(openings(sam.page)).toHaveCount(1);
    await expect(openings(sam.page)).toContainText('Paint the back fence');
    await alex.page.goto('/forward');
    await expect(openings(alex.page)).toHaveCount(0);
    const rows = await q(
      `select user_id, response from insight_response where insight_key like 'open_window:%' order by response`,
    );
    expect(rows.map((r) => r.response)).toEqual(['dismissed', 'not_useful']);
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(1);
    await sam.context.close();
    await alex.context.close();
  });
});

test.describe('Forward Week', () => {
  test('W14, W19, X6: a phrase on each day, the credit line beside Coming up with its Why, the openings as the contract words them', async ({
    browser,
  }) => {
    const { context, page, posts } = await open(browser, 'sam', at(DAY, '07:03'), '/forward');
    const phrases = page.getByTestId('day-phrase');
    await expect(phrases).toHaveText([
      'Showers possible',
      'Rain likely',
      'Showers possible',
      'Looks dry',
      'Showers possible',
      'Looks dry',
      'Looks dry',
    ]);
    // A row with nothing recorded reads its words, then the phrase.
    const thu = page.locator(`li[data-unit="${THU}"]`);
    await expect(thu).toContainText('Nothing recorded');
    await expect(thu.getByTestId('day-phrase')).toHaveText('Rain likely');
    await expect(page.getByTestId('forecast-credit')).toContainText('Forecast as of 06:55');
    await expect(visibleCredit(page)).toHaveCount(1);
    // Beside the Coming up label, in the same row.
    const label = (await page.locator('#forward-coming').boundingBox())!;
    const line = (await page.getByTestId('forecast-credit').boundingBox())!;
    expect(Math.abs(line.y - label.y)).toBeLessThan(40);
    await expect(openings(page)).toHaveCount(2);
    await expect(openings(page).nth(0)).toContainText(SAT_TASK);
    await expect(openings(page).nth(1)).toContainText(SUN_PLAIN);
    // The credit line's own Why.
    await page.getByTestId('forecast-credit').locator('xpath=following::summary[1]').click();
    await expect(page.getByTestId('forecast-why')).toContainText('planning hours, 08:00–20:00');
    await expect(page.getByTestId('forecast-why')).toContainText('60% or more, or 1 mm or more');
    expect(posts()).toBe(0);
    await shot(page, 'forward-week-phone');
    await context.close();
  });

  test('X4: without JavaScript, Dismiss from Forward lands back on Forward with the opening gone, and the same key is gone from Today (the day it is listed there)', async ({
    browser,
  }) => {
    const { context, page } = await open(browser, 'alex', at(DAY, '07:03'), '/forward', {
      js: false,
    });
    await page
      .getByRole('button', { name: /^Dismiss: Nothing is recorded for the household on Sunday/ })
      .click();
    await page.waitForURL('**/forward');
    await expect(openings(page)).toHaveCount(1);
    await expect(openings(page)).toContainText('Paint the back fence');
    await context.close();
    await setForecast(at(SAT, '06:55'));
    const sat = await open(browser, 'alex', at(SAT, '07:30'), '/today');
    // Saturday's opening shows; Sunday's (dismissed on Forward) does not follow it.
    await sat.page.getByRole('button', { name: /^Dismiss: Paint the back fence/ }).click();
    await expect(openings(sat.page)).toHaveCount(0);
    await sat.context.close();
  });

  test('X7: an older forecast dates the credit line; an unusable one has no phrases and no credit, and the openings say nothing of weather', async ({
    browser,
  }) => {
    await setForecast(at('2026-10-13', '21:00'));
    let o = await open(browser, 'sam', at(DAY, '07:03'), '/forward');
    await expect(o.page.getByTestId('forecast-credit')).toContainText(
      'Forecast as of yesterday 21:00',
    );
    await o.context.close();
    await setForecast(at('2026-10-13', '17:00'));
    o = await open(browser, 'sam', at(DAY, '07:03'), '/forward');
    await expect(o.page.getByTestId('day-phrase')).toHaveCount(0);
    await expect(credit(o.page)).toHaveCount(0);
    await expect(openings(o.page)).toHaveCount(2);
    await expect(openings(o.page).first()).toContainText(
      'Nothing is recorded for the household on Saturday, 10:00–19:30.',
    );
    await expect(openings(o.page).first()).not.toContainText('forecast');
    await expect(o.page.locator('main')).not.toContainText(/error/i);
    await expect.poll(o.posts).toBe(1);
    await o.context.close();
  });

  test('a stale calendar qualifies the openings and its health is listed first (O16, O22)', async ({
    browser,
  }) => {
    await q(
      `update calendar_source set last_attempt_at = $2::timestamptz, last_synced_at = $2::timestamptz where id = $1`,
      [calendarId, at('2026-10-12', '06:58')],
    );
    const { context, page } = await open(browser, 'sam', at(DAY, '07:03'), '/forward', {
      keepCalendar: true,
    });
    await expect(worth(page, 'forward-worth').locator('li[data-insight]').first()).toHaveAttribute(
      'data-insight',
      'data_health.stale',
    );
    await expect(page.locator('main')).toContainText(
      'on Sunday, 08:00–19:30, as far as HOME knows',
    );
    await context.close();
  });

  test('X12: Month, Season and a person’s Coming up carry no phrase, no credit and no opening', async ({
    browser,
  }) => {
    const { context, page, posts } = await open(
      browser,
      'sam',
      at(DAY, '07:03'),
      '/forward?h=month',
    );
    for (const path of ['/forward?h=month', '/forward?h=season']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Coming up' })).toBeVisible();
      await expect(page.getByTestId('day-phrase')).toHaveCount(0);
      await expect(page.getByTestId('forecast-credit')).toHaveCount(0);
      await expect(credit(page)).toHaveCount(0);
      await expect(openings(page)).toHaveCount(0);
    }
    const milo = (await q(`select id from person where name = 'Milo' and archived_at is null`))[0]!
      .id;
    await page.goto(`/people/${milo}`);
    await expect(page.getByTestId('day-phrase')).toHaveCount(0);
    await expect(credit(page)).toHaveCount(0);
    await expect(openings(page)).toHaveCount(0);
    expect(posts()).toBe(0);
    await context.close();
  });

  test('identity: a changed gap is a new opening that an old dismissal does not hide; a changed forecast keeps a dismissal (O7, O8)', async ({
    browser,
  }) => {
    const alex = await open(browser, 'alex', at(DAY, '07:03'), '/forward');
    await alex.page
      .getByRole('button', { name: /^Dismiss: Nothing is recorded for the household on Sunday/ })
      .click();
    await expect(openings(alex.page)).toHaveCount(1);
    // The forecast is refreshed with new numbers: still dismissed.
    await setForecast(at(DAY, '07:00'), (t) =>
      t === ms(SUN, '15:00') ? { precipitationProbability: 70 } : VALUES(t),
    );
    await alex.page.goto('/forward');
    await expect(openings(alex.page)).toHaveCount(1);
    await expect(openings(alex.page)).toContainText('Paint the back fence');
    // A commitment moves the stretch: Sunday's opening has a new key and is shown again.
    await q(
      `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, created_by, created_via, visibility, source)
       values ('ws Sunday lunch', 'activity', false, $1::timestamptz, $2::timestamptz, 'Pacific/Auckland', 'fixture-sam', 'ui', 'household', 'manual')`,
      [at(SUN, '11:30'), at(SUN, '12:30')],
    );
    const lunch = (await q(`select id from event where title = 'ws Sunday lunch'`))[0]!.id;
    const milo = (await q(`select id from person where name = 'Milo' and archived_at is null`))[0]!
      .id;
    await q(
      `insert into event_person (event_id, person_id, role, created_by, created_via) values ($1, $2, 'attending', 'fixture-sam', 'ui')`,
      [lunch, milo],
    );
    await alex.page.goto('/forward');
    await expect(openings(alex.page)).toHaveCount(2);
    await expect(openings(alex.page).nth(1)).toContainText('on Sunday, 12:30–19:30');
    await alex.context.close();
    await q(`update event set archived_at = now() where title = 'ws Sunday lunch'`);
  });
});

test.describe('P1: the other adult’s private records leave this adult’s pages byte for byte', () => {
  test('Sam’s private Saturday event, Sunday all-day event and dry-weather task change Sam’s Forward and not Alex’s', async ({
    browser,
  }) => {
    const html = async (o: Opened, path: string) => {
      await o.page.goto(path);
      await expect(o.page.locator('main')).toBeVisible();
      return o.page.locator('main').innerHTML();
    };
    const alex = await open(browser, 'alex', at(DAY, '07:03'), '/forward');
    const sam = await open(browser, 'sam', at(DAY, '07:03'), '/forward');
    const before = { fwd: await html(alex, '/forward'), today: await html(alex, '/today') };
    const samBefore = await html(sam, '/forward');
    const samId = (await q(`select id from person where name = 'Sam' and archived_at is null`))[0]!
      .id;
    await q(
      `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, created_by, created_via, visibility, source)
       values ('ws Sam private noon', 'appointment', false, $1::timestamptz, $2::timestamptz, 'Pacific/Auckland', 'fixture-sam', 'ui', 'private', 'manual')`,
      [at(SAT, '12:00'), at(SAT, '13:00')],
    );
    await q(
      `insert into event (title, kind, all_day, start_date, end_date, created_by, created_via, visibility, source)
       values ('ws Sam private day', 'other', true, $1, $2, 'fixture-sam', 'ui', 'private', 'manual')`,
      [SUN, '2026-10-19'],
    );
    for (const t of ['ws Sam private noon', 'ws Sam private day'])
      await q(
        `insert into event_person (event_id, person_id, role, created_by, created_via)
         select id, $2, 'attending', 'fixture-sam', 'ui' from event where title = $1`,
        [t, samId],
      );
    await q(
      `insert into task (title, status, estimate_minutes, needs, created_by, created_via, visibility)
       values ('ws Sam private dry', 'open', 120, '["dry_weather"]', 'fixture-sam', 'ui', 'private')`,
    );
    try {
      expect(await html(alex, '/forward')).toBe(before.fwd);
      expect(await html(alex, '/today')).toBe(before.today);
      expect(before.fwd + before.today).not.toContain('ws Sam private');
      const samAfter = await html(sam, '/forward');
      expect(samAfter).not.toBe(samBefore);
    } finally {
      await q(`update event set archived_at = now() where title like 'ws Sam private %'`);
      await q(`update task set archived_at = now() where title like 'ws Sam private %'`);
    }
    await alex.context.close();
    await sam.context.close();
  });
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`X5 at ${name}`, () => {
    test(`axe, no horizontal scroll and 44px targets on Today and Forward Week with every Why open`, async ({
      browser,
    }) => {
      await setForecast(at(SAT, '06:55'));
      const today = await open(browser, 'sam', at(SAT, '07:30'), '/today', { viewport });
      await expect(openings(today.page)).toHaveCount(1);
      await openAll(today.page);
      await expectAccessible(today.page, `Today at ${name}`);
      await expectNoHorizontalScroll(today.page, `Today at ${name}`);
      await shot(today.page, `today-why-open-${name}`);
      await today.context.close();

      await setForecast(at(DAY, '06:55'));
      const week = await open(browser, 'sam', at(DAY, '07:03'), '/forward', { viewport });
      await expect(openings(week.page)).toHaveCount(2);
      await openAll(week.page);
      await expectAccessible(week.page, `Forward at ${name}`);
      await expectNoHorizontalScroll(week.page, `Forward at ${name}`);
      for (const page of [week.page]) {
        for (const link of await page
          .locator('main a[aria-label="Forecast data: Open-Meteo"]')
          .all())
          if (await link.isVisible())
            expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        for (const b of await page.locator('main summary, main button[type="submit"]').all())
          if (await b.isVisible())
            expect((await b.boundingBox())!.height, 'target height').toBeGreaterThanOrEqual(43.5);
      }
      mkdirSync(SHOTS, { recursive: true });
      await shot(week.page, `forward-week-${name}`);
      await week.context.close();
    });
  });
}
