import { expect, test, type Browser } from '@playwright/test';
import { WEATHER_URL } from '../../playwright.config';
import { FINGERPRINT_VECTORS } from '../fixtures/weather';
import { seedCalendar } from './calendar-feeds';
import { signInAsFixtureAdult, VIEWPORTS, type Adult } from './fixture-adults';
import { ask, clearKev, q, recordedMonth, recordUsageUpTo } from './kev-helpers';

// Kev on the weather server (M8 Package 4; contract §8.4, §11.2, §13.6;
// matrix rows U5, U14 and the forecast's attribution): the synthetic home
// point and fake weather (playwright.config.ts), Kev with the scripted
// provider, and a household cap of NZ$20 so Usage's states can be reached
// with a few synthetic usage rows. The forecast is written straight into
// `weather_forecast`, fetched at 06:55 today (the server's test clock reads
// 07:03), dry except for showers on Sunday afternoon. The budget tests run
// last: once the month is at the cap, Kev pauses on this server until the
// test database is reset. Synthetic only.

test.use({ baseURL: WEATHER_URL });
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const HOUR = 3_600_000;
const NZ = 'Pacific/Auckland';
/** NZ$20 at the fixed NZ$1.80 per US$1 (contract §13.1), in micro-US-dollars. */
const CAP = 11_111_111n;

async function todayNz(): Promise<string> {
  return (await q(`select to_char(now() at time zone '${NZ}', 'YYYY-MM-DD') as d`))[0]!.d!;
}

/** The forecast, fetched at 06:55 today: dry, except an hour of showers on Sunday afternoon. */
async function setForecast(): Promise<void> {
  const today = await todayNz();
  const fetched = new Date(`${today}T06:55:00+13:00`);
  const start = Math.floor(fetched.getTime() / (24 * HOUR)) * 24 * HOUR;
  const hours = Array.from({ length: 191 }, (_, i) => {
    const t = start + i * HOUR;
    const local = new Date(t + 13 * HOUR);
    const sundayAfternoon = local.getUTCDay() === 0 && local.getUTCHours() === 14;
    return {
      start: new Date(t).toISOString(),
      temperatureC: 14,
      precipitationMm: sundayAfternoon ? 0.1 : 0,
      precipitationProbability: sundayAfternoon ? 40 : 5,
      windKmh: 15,
      gustKmh: 30,
    };
  });
  await q(
    `insert into weather_forecast (provider, fetched_at, hours, location_fingerprint, first_hour, last_hour, last_attempt_at, last_attempt_status)
     values ('open_meteo', $1::timestamptz, $2::jsonb, $3, $4::timestamptz, $5::timestamptz, $1::timestamptz, 'ok')
     on conflict (provider) do update set fetched_at = excluded.fetched_at, hours = excluded.hours,
       location_fingerprint = excluded.location_fingerprint, first_hour = excluded.first_hour,
       last_hour = excluded.last_hour, last_attempt_at = excluded.last_attempt_at, last_attempt_status = 'ok'`,
    [
      fetched.toISOString(),
      JSON.stringify(hours),
      FINGERPRINT_VECTORS[0].hex,
      hours[0]!.start,
      hours.at(-1)!.start,
    ],
  );
}

async function kevPage(browser: Browser, adult: Adult) {
  const context = await browser.newContext({ viewport: VIEWPORTS.phone, baseURL: WEATHER_URL });
  const page = await context.newPage();
  await signInAsFixtureAdult(page, adult);
  await page.goto('/kev');
  return { context, page };
}

let held: string[] = [];
test.beforeAll(async () => {
  await setForecast();
  // One healthy household calendar, last updated at 06:58, so the stretches
  // where nothing is recorded have a calendar to rest on; calendars other
  // specs left are put away and restored afterwards (as weather.spec does).
  held = (
    await q(`select id from calendar_source where archived_at is null and name not like 'kw %'`)
  ).map((r) => r.id!);
  if (held.length)
    await q(`update calendar_source set archived_at = now() where id = any($1::uuid[])`, [held]);
  const id = await seedCalendar({
    owner: 'fixture-sam',
    name: 'kw Family calendar',
    visibility: 'household',
    fingerprintTag: 'kwfamily',
  });
  const synced = `${await todayNz()}T06:58:00+13:00`;
  await q(
    `update calendar_source set archived_at = null, last_attempt_at = $2::timestamptz, last_synced_at = $2::timestamptz, last_sync_status = 'ok' where id = $1`,
    [id, synced],
  );
});
test.afterAll(async () => {
  await q(`update calendar_source set archived_at = now() where name like 'kw %'`);
  if (held.length)
    await q(`update calendar_source set archived_at = null where id = any($1::uuid[])`, [held]);
});

test('U5 and the forecast’s attribution: a weekend answer with its rows, the credit and its time', async ({
  browser,
}) => {
  const { context, page } = await kevPage(browser, 'sam');
  await ask(page, 'sam', 'What have we got this weekend?');
  const turn = page.getByTestId('kev-turn').last();
  await expect(turn.getByTestId('kev-say')).toHaveText(/^(Righto, here’s|Here’s) /);
  await expect(turn.getByTestId('kev-forecast-credit')).toHaveText(
    /^Forecast as of 06:55\s*·\s*Open-Meteo$/,
  );
  await expect(turn.getByRole('link', { name: 'Forecast data: Open-Meteo' })).toHaveAttribute(
    'rel',
    'noreferrer',
  );
  await expect(turn.getByTestId('kev-limits')).toContainText(
    'This is only what HOME has recorded that you can see. It isn’t a check of anyone’s plans.',
  );
  await turn.getByText('What’s this based on?').click();
  await expect(turn.getByTestId('kev-based-on')).toContainText('The forecast as of 06:55');
  // Citation navigation: Football's row opens Football.
  const football = turn.getByRole('link', { name: /Football/ });
  await expect(football).toHaveAttribute('href', /^\/events\/[0-9a-f-]{36}$/);
  await football.click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Football');
  await context.close();
});

test('U5: the weekend thought through: Kev’s view under its label, and the code’s sentences', async ({
  browser,
}) => {
  const { context, page } = await kevPage(browser, 'sam');
  await ask(page, 'sam', 'Help me think through our weekend.');
  const turn = page.getByTestId('kev-turn').last();
  const view = turn.getByTestId('kev-view');
  await expect(view).toContainText('Kev’s view');
  await expect(view).toContainText('That stretch is at least as long as the task’s estimate.');
  await expect(turn.getByTestId('kev-fact').first()).toContainText('Nothing is recorded');
  await expect(turn.getByTestId('kev-limits')).toContainText('It isn’t a check of anyone’s plans.');
  const text = (await turn.textContent()) ?? '';
  for (const word of [' free', 'best', 'available']) expect(text).not.toContain(word);
  await context.close();
});

test('U14: Usage at about 30%, past 80% and at the cap: the recorded month only', async ({
  browser,
}) => {
  const { context, page } = await kevPage(browser, 'alex');
  await clearKev(page);

  await recordUsageUpTo((CAP * 30n) / 100n);
  await page.goto('/settings/usage');
  await expect(page.getByTestId('usage-month')).toHaveText(
    /^This month: about NZ\$[67] of NZ\$20 \(both of you\)\.$/,
  );
  await expect(page.getByTestId('usage-own')).toHaveText(/You(’ve| haven’t) asked Kev/);
  await expect(page.getByTestId('usage-simpler')).toHaveCount(0);
  await expect(page.getByTestId('usage-paused')).toHaveCount(0);
  const usage = (await page.locator('main').textContent()) ?? '';
  for (const hidden of ['unreconciled', 'reserv', 'counted in full', 'deep', 'fast'])
    expect(usage.toLowerCase()).not.toContain(hidden);

  // Past 80%: the quiet line, here and once on Kev's screen; Kev still answers.
  await recordUsageUpTo((CAP * 85n) / 100n);
  await page.goto('/settings/usage');
  await expect(page.getByTestId('usage-simpler')).toHaveText(
    'Kev is keeping answers simpler until the 1st.',
  );
  await page.goto('/kev');
  await expect(page.getByTestId('kev-simpler')).toHaveText(
    'Kev’s keeping answers simpler until the 1st.',
  );
  await ask(page, 'alex', 'What’s happening today?');
  await expect(page.getByTestId('kev-turn').last().getByTestId('kev-say')).toHaveText(/^Here’s /);
  await expect(page.getByTestId('kev-simpler')).toHaveCount(1);

  // Within one reservation of the cap: the turn is refused with HOME's line and
  // Keep in To sort; the recorded month is still under the cap (the boundary).
  await recordUsageUpTo(CAP - 300_000n);
  await ask(page, 'alex', 'What’s on tomorrow?');
  await expect(page.getByTestId('kev-error')).toHaveText(
    'I’ve reached this month’s limit. I’ll be back on the 1st.',
  );
  await expect(
    page.getByTestId('kev-turn').last().getByRole('button', { name: 'Keep in To sort' }),
  ).toBeVisible();
  // The refusal is what the page says: no "keeping answers simpler" beside it.
  await expect(page.getByTestId('kev-simpler')).toHaveCount(0);
  // Usage says why the limit can come before the recorded figure, in general words.
  await page.goto('/settings/usage');
  await expect(page.getByText(/sets aside enough to cover each answer/)).toBeVisible();

  // At the cap, recorded: Usage gives the date Kev resumes.
  await recordUsageUpTo(CAP + 1n);
  expect(await recordedMonth()).toBeGreaterThanOrEqual(CAP);
  await page.goto('/settings/usage');
  await expect(page.getByTestId('usage-paused')).toHaveText(
    /^Kev has reached this month’s limit and will be back on \w+ 1 \w+\.$/,
  );
  await context.close();
});
