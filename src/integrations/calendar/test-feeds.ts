import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { testFeedEnv } from '@/lib/env';
import { SafeFetchError, type SafeFetchErrorCode } from '../net/safe-fetch';
import type { FeedFetcher } from './ics/provider';

// Synthetic feeds for local and CI runs of the real screens (M4 contract
// §4.2, §6.1; ADR 0007 §43). Package 5's Settings › Calendars needs
// "Refresh now" to work end to end without any network, so when
// HOME_TEST_CALENDAR_FEEDS names a directory, the composition root reads a
// calendar's feed from there instead of fetching it. This never widens the
// host allowlist: the adapter has already approved the address as Google's
// secret address shape, and only its private token chooses a file. And it
// can never run in a deployed environment: the same refusals as the fixture
// seed (any Vercel environment, production) apply, whatever is set.
//
//   <token>.ics      the feed served for that address
//   <token>.status   one safe-fetch failure code, served instead
//   <token>.hold     while this file exists the fetch waits (busy tests)
//
// A token with no file reads as an address Google no longer accepts.

const TOKEN = /\/private-([A-Za-z0-9]{16,128})\/basic\.ics$/;
const CODES = new Set<SafeFetchErrorCode>([
  'unsupported_destination',
  'redirect_refused',
  'address_rejected',
  'forbidden_destination',
  'timeout',
  'unreachable',
  'too_large',
  'bad_response',
]);
const HOLD_STEP_MS = 100;
const HOLD_MAX_MS = 15_000;

/** The test feed directory, or null when HOME must fetch for real. Refuses deployed environments. */
export function testFeedDirectory(env = testFeedEnv()): string | null {
  const dir = env.HOME_TEST_CALENDAR_FEEDS;
  if (!dir) return null;
  if (env.VERCEL_ENV || env.VERCEL || env.NODE_ENV === 'production')
    throw new Error('HOME_TEST_CALENDAR_FEEDS is for local and CI runs only');
  return resolve(dir);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** A fetcher that serves synthetic feeds from `dir` by the address's private token. */
export function testFeedFetcher(dir: string): FeedFetcher {
  return async (address) => {
    const token = TOKEN.exec(new URL(address).pathname)?.[1];
    if (!token) throw new SafeFetchError('address_rejected');
    const file = (ext: string) => join(dir, `${token}.${ext}`);
    for (
      let waited = 0;
      (await exists(file('hold'))) && waited < HOLD_MAX_MS;
      waited += HOLD_STEP_MS
    )
      await sleep(HOLD_STEP_MS);
    if (await exists(file('status'))) {
      const code = (await readFile(file('status'), 'utf8')).trim() as SafeFetchErrorCode;
      throw new SafeFetchError(CODES.has(code) ? code : 'unreachable');
    }
    if (!(await exists(file('ics')))) throw new SafeFetchError('address_rejected');
    return readFile(file('ics'), 'utf8');
  };
}
