import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { icsProvider } from '@/integrations/calendar/ics/provider';
import { testFeedDirectory, testFeedFetcher } from '@/integrations/calendar/test-feeds';

// The synthetic feeds the screens' tests read instead of fetching (ADR 0007
// §43). They exist for local and CI runs only: the guard refuses every
// deployed shape in code, whatever is set, and a token picks one file in
// one directory and nothing else.

const google = (token: string) =>
  `https://calendar.google.com/calendar/ical/synthetic.family%40example.test/private-${token}/basic.ics`;
const TOKEN = 'aaaaaaaaaaaaaaaa';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'home-test-feeds-'));
  const dir = join(root, 'feeds');
  mkdirSync(dir);
  writeFileSync(join(root, 'outside.ics'), 'OUTSIDE');
  writeFileSync(join(dir, `${TOKEN}.ics`), 'INSIDE');
  writeFileSync(join(dir, `${TOKEN}.txt`), 'OTHER EXTENSION');
  return { root, dir };
}

const outcome = (p: Promise<string>) =>
  p.then(
    (t) => `read:${t}`,
    (e: unknown) => `refused:${(e as { code?: string }).code}`,
  );

describe('testFeedDirectory: local and CI only', () => {
  it('is off when the variable is unset or empty', () => {
    expect(testFeedDirectory({})).toBeNull();
    expect(testFeedDirectory({ HOME_TEST_CALENDAR_FEEDS: '' })).toBeNull();
    expect(testFeedDirectory({ HOME_TEST_CALENDAR_FEEDS: '', VERCEL: '1' })).toBeNull();
  });

  it('resolves a directory in a local or CI run', () => {
    expect(testFeedDirectory({ HOME_TEST_CALENDAR_FEEDS: 'feeds', NODE_ENV: 'test' })).toMatch(
      /^\/.*\/feeds$/,
    );
    expect(testFeedDirectory({ HOME_TEST_CALENDAR_FEEDS: '/tmp/feeds', CI: 'true' } as never)).toBe(
      '/tmp/feeds',
    );
  });

  it('refuses every deployed shape, whatever the directory', () => {
    for (const env of [
      { NODE_ENV: 'production' },
      { VERCEL: '1' },
      { VERCEL_ENV: 'preview' },
      { VERCEL_ENV: 'production' },
      { VERCEL_ENV: 'development' },
      { VERCEL: '1', NODE_ENV: 'test' },
    ])
      expect(
        () => testFeedDirectory({ HOME_TEST_CALENDAR_FEEDS: '/tmp/feeds', ...env }),
        JSON.stringify(env),
      ).toThrow(/local and CI runs only/);
  });
});

describe('testFeedFetcher: one token, one file, one directory', () => {
  it('serves the feed named by the address’s private token', async () => {
    const { dir } = fixture();
    expect(await outcome(testFeedFetcher(dir)(google(TOKEN)))).toBe('read:INSIDE');
  });

  it('a token with no feed reads as an address Google no longer accepts', async () => {
    const { dir } = fixture();
    expect(await outcome(testFeedFetcher(dir)(google('bbbbbbbbbbbbbbbb')))).toBe(
      'refused:address_rejected',
    );
  });

  it('refuses a malformed token: too short, punctuation, or an absolute or encoded path', async () => {
    const { dir } = fixture();
    const f = testFeedFetcher(dir);
    for (const address of [
      google('short'),
      google('aaaaaaaa-aaaaaaaa'),
      google('a'.repeat(129)),
      'https://calendar.google.com/calendar/ical/x/private-../outside/basic.ics',
      'https://calendar.google.com/calendar/ical/x/private-%2e%2e%2foutside0000000000/basic.ics',
      `https://calendar.google.com/calendar/ical/x/private-${TOKEN}/../../outside/basic.ics`,
      `https://calendar.google.com/calendar/ical/x/private-${encodeURIComponent('/etc/hostname')}/basic.ics`,
      'https://calendar.google.com/calendar/ical/x/private-aaaaaaaaaaaaaaaa/basic.txt',
    ]) {
      const r = await outcome(f(address));
      expect(r, address).toBe('refused:address_rejected');
    }
  });

  it('reads only .ics, .status and .hold beside the token, never another file', async () => {
    const { dir } = fixture();
    const f = testFeedFetcher(dir);
    expect(await outcome(f(google(TOKEN)))).toBe('read:INSIDE');
    writeFileSync(join(dir, `${TOKEN}.status`), 'too_large');
    expect(await outcome(f(google(TOKEN)))).toBe('refused:too_large');
    writeFileSync(join(dir, `${TOKEN}.status`), 'not-a-code; rm -rf /');
    expect(await outcome(f(google(TOKEN)))).toBe('refused:unreachable');
  });

  it('is reached only after the provider has accepted the address as Google’s', async () => {
    const seen: string[] = [];
    const provider = icsProvider({
      homeTimeZone: 'Pacific/Auckland',
      fetchFeed: async (a) => {
        seen.push(a);
        return '';
      },
    });
    for (const address of [
      `https://evil.example/calendar/ical/x/private-${TOKEN}/basic.ics`,
      `http://calendar.google.com/calendar/ical/x/private-${TOKEN}/basic.ics`,
      `https://calendar.google.com.evil.example/calendar/ical/x/private-${TOKEN}/basic.ics`,
      `file:///etc/hostname`,
    ]) {
      const r = await provider.listCalendars({ kind: 'ics', address } as never).then(
        () => 'ok',
        (e: { code?: string }) => e.code,
      );
      expect(r, address).toBe('address_rejected');
    }
    expect(seen).toEqual([]);
  });
});
