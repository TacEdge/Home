import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { WEATHER_URL } from '../../playwright.config';
import { FINGERPRINT_VECTORS } from '../fixtures/weather';
import { seedCalendar } from './calendar-feeds';
import { signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { ask, clearKev, q, roomToAsk, recordUsageUpTo } from './kev-helpers';

// Screenshots of Kev's screen for the owner's review (M8 Package 4; contract
// §2.2: "the owner approves the wording and layout from screenshots"). Not a
// test of behaviour (kev.spec.ts and kev-weather.spec.ts are), and not run
// in CI: only with KEV_SHOTS=1, against the weather server (Kev scripted,
// the synthetic forecast, a NZ$20 cap), as Sam, on the fixture family.
// Synthetic only. Files land in test-results/kev-screenshots.

test.skip(!process.env.KEV_SHOTS, 'screenshots only on request (KEV_SHOTS=1)');
test.use({ baseURL: WEATHER_URL });
test.describe.configure({ mode: 'serial', timeout: 600_000 });

const DIR = 'test-results/kev-screenshots';
const HOUR = 3_600_000;
const SMALL = { width: 320, height: 568 };
const CAP = 11_111_111n;

async function todayNz(): Promise<string> {
  return (await q(`select to_char(now() at time zone 'Pacific/Auckland', 'YYYY-MM-DD') as d`))[0]!
    .d!;
}

async function setForecast(): Promise<void> {
  const today = await todayNz();
  const fetched = new Date(`${today}T06:55:00+13:00`);
  const start = Math.floor(fetched.getTime() / (24 * HOUR)) * 24 * HOUR;
  const hours = Array.from({ length: 191 }, (_, i) => {
    const t = start + i * HOUR;
    const local = new Date(t + 13 * HOUR);
    const showers = local.getUTCDay() === 0 && local.getUTCHours() === 14;
    return {
      start: new Date(t).toISOString(),
      temperatureC: 14,
      precipitationMm: showers ? 0.1 : 0,
      precipitationProbability: showers ? 40 : 5,
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

async function open(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, baseURL: WEATHER_URL });
  const page = await context.newPage();
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/kev');
  return { context, page };
}

const shot = (page: Page, name: string, fullPage = true) =>
  page.screenshot({ path: `${DIR}/${name}.png`, fullPage, caret: 'initial' });

test.beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  // The privacy canaries are for the sweeps, not for review: put away for the shots.
  await q(
    `update event set archived_at = now() where title like 'canary-%' and archived_at is null and title not like 'canary-archived-%'`,
  );
  await setForecast();
  const held = (
    await q(`select id from calendar_source where archived_at is null and name not like 'ks %'`)
  ).map((r) => r.id!);
  if (held.length)
    await q(`update calendar_source set archived_at = now() where id = any($1::uuid[])`, [held]);
  const id = await seedCalendar({
    owner: 'fixture-sam',
    name: 'ks Family calendar',
    visibility: 'household',
    fingerprintTag: 'ksfamily',
  });
  await q(
    `update calendar_source set archived_at = null, last_attempt_at = $2::timestamptz, last_synced_at = $2::timestamptz, last_sync_status = 'ok' where id = $1`,
    [id, `${await todayNz()}T06:58:00+13:00`],
  );
});

test.afterAll(async () => {
  await q(
    `update event set archived_at = null where title in ('canary-sam-event', 'canary-alex-event')`,
  );
});

test('the screens, for review', async ({ browser }) => {
  // 1. Empty (first open), phone and small phone; Today's line.
  {
    const { context, page } = await open(browser, VIEWPORTS.phone);
    await clearKev(page);
    await page.goto('/kev');
    await shot(page, '01-empty-phone', false);
    await page.setViewportSize(SMALL);
    await shot(page, '01-empty-small-phone', false);
    await page.setViewportSize(VIEWPORTS.phone);
    await page.goto('/today');
    await shot(page, '00-today-entry-phone', false);
    await context.close();
  }

  // 2–4. A conversation: today, the weekend (rows, credit), the weekend thought through (Kev's view).
  const { context, page } = await open(browser, VIEWPORTS.phone);
  await ask(page, 'sam', 'What’s happening today?');
  await ask(page, 'sam', 'What have we got this weekend?');
  await shot(page, '02-conversation-phone');
  await page.getByTestId('kev-turn').last().getByText('What’s this based on?').click();
  await page.getByTestId('kev-turn').last().scrollIntoViewIfNeeded();
  await shot(page, '03-answer-with-references-phone', false);
  await ask(page, 'sam', 'Help me think through our weekend.');
  await page.getByTestId('kev-turn').last().scrollIntoViewIfNeeded();
  await shot(page, '04-answer-with-kevs-view-phone', false);

  // 5. Working: a slow scripted model, caught mid-turn.
  await page.setExtraHTTPHeaders({ 'x-home-test-kev': 'slow' });
  await roomToAsk('sam');
  const box = page.locator('#kev-text');
  await box.fill('What tasks have I still got outstanding?');
  await box.press('Enter');
  await expect(page.getByTestId('kev-working')).toBeVisible();
  await page.getByTestId('kev-composer').scrollIntoViewIfNeeded();
  await shot(page, '05-working-phone', false);
  await expect(page.getByTestId('kev-pending')).toHaveCount(0, { timeout: 30_000 });

  // 6. An error and a decline kept in To sort.
  await page.setExtraHTTPHeaders({ 'x-home-test-kev': 'down' });
  await ask(page, 'sam', 'What’s on tomorrow?');
  await page.getByTestId('kev-composer').scrollIntoViewIfNeeded();
  await shot(page, '06-error-phone', false);
  await page.setExtraHTTPHeaders({});
  await ask(page, 'sam', 'Remember that Milo likes trains now.');
  await page
    .getByTestId('kev-turn')
    .last()
    .getByRole('button', { name: 'Keep in To sort' })
    .click();
  await expect(page.getByTestId('kev-turn').last().getByTestId('kev-kept')).toBeVisible();
  await page.getByTestId('kev-turn').last().scrollIntoViewIfNeeded();
  await shot(page, '06-decline-kept-phone', false);

  // 9. The composer, focused, with a long question being typed.
  await page.reload();
  await page
    .locator('#kev-text')
    .fill('Help me think through what we have on this weekend,\nand what the fence needs.');
  await page.locator('#kev-text').focus();
  await page.getByTestId('kev-composer').scrollIntoViewIfNeeded();
  await shot(page, '09-composer-focused-phone', false);
  await page.locator('#kev-text').fill('');

  // 10. Tablet and desktop.
  for (const [name, v] of [
    ['tablet', VIEWPORTS['tablet-portrait']],
    ['desktop', VIEWPORTS.desktop],
  ] as const) {
    await page.setViewportSize(v);
    await page.goto('/kev');
    await shot(page, `10-conversation-${name}`);
  }
  await page.setViewportSize(VIEWPORTS.phone);

  // 8. Usage, then 7. the budget limit, and Usage at the cap.
  await recordUsageUpTo((CAP * 30n) / 100n);
  await page.goto('/settings/usage');
  await shot(page, '08-usage-phone');
  await recordUsageUpTo((CAP * 85n) / 100n);
  await page.goto('/settings/usage');
  await shot(page, '08-usage-past-80-phone');
  await page.goto('/kev');
  await recordUsageUpTo(CAP - 300_000n);
  await ask(page, 'sam', 'What’s on tomorrow?');
  await page.getByTestId('kev-composer').scrollIntoViewIfNeeded();
  await shot(page, '07-budget-limit-phone', false);
  await recordUsageUpTo(CAP + 1n);
  await page.goto('/settings/usage');
  await shot(page, '08-usage-at-cap-phone');
  await context.close();
});
