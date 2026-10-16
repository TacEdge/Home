import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { assertTestDatabase } from './tests/db-guard';
import { FEED_DIR } from './tests/e2e/calendar-feeds';
import { TEST_APP_DATABASE_URL, TEST_DATABASE_URL, testEnv } from './tests/env';
import { weatherEnv } from './tests/fixtures/weather';

// End-to-end tests run against the dev server with the test mail transport
// (production refuses it, by design) and the local test database.
//
// Three servers: the main one (both fixture users allowed; Kev on, scripted,
// M8 Package 4) and a second whose
// allowlist omits Sam, and a third (M7 Package 4) with the synthetic home
// location, a test-only location key and the fake weather provider, for the
// weather specs alone, so every other spec sees HOME without weather exactly
// as before. Cookies for localhost ignore the port, so visiting the
// second server with Sam's session proves that removing an address from the
// allowlist signs that person out on their next request.

// Before any server starts: the dev servers and the global setup may only ever
// touch a local *_test database (contract §1.6).
assertTestDatabase(TEST_DATABASE_URL);
assertTestDatabase(TEST_APP_DATABASE_URL);

export const MAIN_PORT = 3333;
export const NARROW_PORT = 3334;
export const WEATHER_PORT = 3335;
export const MAIN_URL = `http://localhost:${MAIN_PORT}`;
export const NARROW_URL = `http://localhost:${NARROW_PORT}`;
export const WEATHER_URL = `http://localhost:${WEATHER_PORT}`;

const serverEnv = (port: number, allowed: string) => ({
  ...process.env,
  ...testEnv,
  NODE_ENV: 'development',
  // Synthetic calendar feeds for Settings › Calendars (tests/e2e/calendar-feeds.ts).
  HOME_TEST_CALENDAR_FEEDS: FEED_DIR,
  // Today at a frozen time (src/app/_agenda/now.ts): a steady 07:03 on the real date,
  // or whatever a request's x-home-test-now says (evening mode).
  HOME_TEST_TIME: 'allow',
  HOME_TEST_CLOCK: '07:03',
  BETTER_AUTH_URL: `http://localhost:${port}`,
  HOME_ALLOWED_EMAILS: allowed,
});

// Kev on with the scripted provider (M8 Package 4): local and CI only, no
// key, no network to any provider (HOME_TEST_KEV is refused anywhere
// deployed). The main and weather servers run Kev; the narrow server keeps
// it off, for the screens and the route with Kev off (U2, S9).
const kevOn = { HOME_KEV: 'on', HOME_TEST_KEV: 'scripted' };

// A browser the environment provides (cloud containers ship one here) when
// the shell did not say; CI installs its own and has neither.
const PROVIDED_CHROMIUM = '/opt/pw-browsers/chromium';
const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync(PROVIDED_CHROMIUM) ? PROVIDED_CHROMIUM : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  use: {
    baseURL: MAIN_URL,
    trace: 'retain-on-failure',
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `pnpm dev -p ${MAIN_PORT}`,
      url: `${MAIN_URL}/sign-in`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...serverEnv(MAIN_PORT, 'sam@example.test,alex@example.test'), ...kevOn },
    },
    {
      command: `pnpm dev -p ${NARROW_PORT}`,
      url: `${NARROW_URL}/sign-in`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...serverEnv(NARROW_PORT, 'alex@example.test'), HOME_NEXT_DIST_DIR: '.next-narrow' },
    },
    {
      command: `pnpm dev -p ${WEATHER_PORT}`,
      url: `${WEATHER_URL}/sign-in`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...serverEnv(WEATHER_PORT, 'sam@example.test,alex@example.test'),
        ...weatherEnv(),
        HOME_TEST_WEATHER: 'fake',
        HOME_NEXT_DIST_DIR: '.next-weather',
        ...kevOn,
        // A small household cap (NZ$20), so Usage's 80% and cap states are
        // reached with a few synthetic usage rows (tests/e2e/kev-budget.spec.ts)
        // without moving the main server's NZ$100 month much.
        HOME_KEV_MONTHLY_CAP_NZD: '20',
      },
    },
  ],
});
