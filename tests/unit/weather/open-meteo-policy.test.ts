import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FETCH_LIMITS,
  googleCalendarPolicy,
  openMeteoPolicy,
  safeGet,
  SafeFetchError,
  type FetchPolicy,
} from '@/integrations/net/safe-fetch';

// safe-fetch's second policy (M7 contract §5.1, §8.6 W17; ADR 0011 §19).
// A local plain-HTTP server stands in for the internet under a test-only
// policy that copies openMeteoPolicy's headers, limits and answers but
// approves the local server; the real policy's destinations are checked
// before any connection, and names resolve through an injected resolver.
// No test reaches the network, and the calendar suite
// (tests/unit/safe-fetch.test.ts) is unchanged.

const OK = '{"hourly":{}}';
const KIB = 1024;
let base = '';
let server: http.Server;
const seen: { url?: string; headers: IncomingHttpHeaders }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    const u = new URL(req.url ?? '/', 'http://x');
    switch (u.pathname) {
      case '/v1/forecast':
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(OK);
      case '/429':
        res.writeHead(429, { 'retry-after': '3600' });
        return res.end('{"error":true,"reason":"Too many requests at latitude=-41.29"}');
      case '/500':
        res.writeHead(500);
        return res.end();
      case '/503':
        res.writeHead(503);
        return res.end();
      case '/404':
        res.writeHead(404);
        return res.end();
      case '/400':
        res.writeHead(400);
        return res.end('{"error":true}');
      case '/redirect':
        res.writeHead(302, { location: '/v1/forecast' });
        return res.end();
      case '/exactly-max':
        res.writeHead(200);
        return res.end(Buffer.alloc(512 * KIB, 'a'));
      case '/over-max':
        res.writeHead(200);
        return res.end(Buffer.alloc(512 * KIB + 1, 'a'));
      case '/declared-over':
        res.writeHead(200, { 'content-length': String(512 * KIB + 1) });
        return res.end();
      case '/slow':
        return setTimeout(() => res.end(OK), 2_000);
      default:
        res.writeHead(400);
        return res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** openMeteoPolicy's headers, limits and answers, aimed at the local server (test only). */
const localWeather = (): FetchPolicy => ({
  ...openMeteoPolicy,
  approve: (u) => u.protocol === 'http:' && u.host === new URL(base).host,
  allowAddress: (a) => a === '127.0.0.1',
});
/** The calendar's behaviour (no per-policy parts), aimed at the local server. */
const localCalendar = (): FetchPolicy => ({
  approve: (u) => u.protocol === 'http:' && u.host === new URL(base).host,
  allowAddress: (a) => a === '127.0.0.1',
});
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof SafeFetchError ? e.code : `other: ${String(e)}`;
  }
};
const GOOD = 'https://api.open-meteo.com/v1/forecast?latitude=-41.29&longitude=174.78';
const resolvingTo =
  (...addresses: string[]) =>
  (_h: string, _o: unknown, cb: (e: null, a: { address: string; family: number }[]) => void) =>
    cb(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );

describe('openMeteoPolicy: what it is', () => {
  it('is frozen, with frozen headers and limits', () => {
    expect(Object.isFrozen(openMeteoPolicy)).toBe(true);
    expect(Object.isFrozen(openMeteoPolicy.headers)).toBe(true);
    expect(Object.isFrozen(openMeteoPolicy.limits)).toBe(true);
  });
  it('10 seconds, 512 KiB, no redirects; a 429 is rate_limited', () => {
    expect(openMeteoPolicy.limits).toEqual({
      timeoutMs: 10_000,
      maxBytes: 512 * KIB,
      maxRedirects: 0,
    });
    expect(openMeteoPolicy.rateLimited).toBe(true);
  });
  it('approves exactly https://api.open-meteo.com/v1/forecast (any query)', () => {
    expect(openMeteoPolicy.approve(new URL(GOOD))).toBe(true);
    expect(openMeteoPolicy.approve(new URL('https://api.open-meteo.com/v1/forecast'))).toBe(true);
    expect(openMeteoPolicy.approve(new URL('https://API.Open-Meteo.com:443/v1/forecast?x=1'))).toBe(
      true,
    );
  });
  it('the calendar policy is untouched: no headers, limits or 429 handling of its own', () => {
    expect(Object.keys(googleCalendarPolicy).sort()).toEqual(['allowAddress', 'approve']);
    expect(FETCH_LIMITS).toEqual({ timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024, maxRedirects: 3 });
  });
});

describe('W17: every other destination is refused before any request', () => {
  const OTHER_PORT = 8443;
  it.each([
    ['another host', 'https://api.open-meteo.org/v1/forecast?latitude=1'],
    ['a lookalike host', 'https://api.open-meteo.com.evil.example/v1/forecast'],
    ['a subdomain', 'https://x.api.open-meteo.com/v1/forecast'],
    ['a trailing dot', 'https://api.open-meteo.com./v1/forecast'],
    ['http', 'http://api.open-meteo.com/v1/forecast?latitude=1'],
    ['another path', 'https://api.open-meteo.com/v1/archive?latitude=1'],
    ['a longer path', 'https://api.open-meteo.com/v1/forecast/x'],
    ['a trailing slash', 'https://api.open-meteo.com/v1/forecast/'],
    // Built from parts so the secret scanner does not read host:port as a key.
    ['another port', `https://api.open-meteo.com:${OTHER_PORT}/v1/forecast`],
    ['a user and password', 'https://u:p@api.open-meteo.com/v1/forecast'],
    ['a fragment', 'https://api.open-meteo.com/v1/forecast#x'],
    ['the calendar host', 'https://calendar.google.com/v1/forecast'],
    ['a literal address', 'https://127.0.0.1/v1/forecast'],
    ['not a URL', 'not a url'],
  ])('%s: unsupported_destination', async (_name, url) => {
    let looked = 0;
    const code = await codeOf(
      safeGet(url, {
        policy: openMeteoPolicy,
        lookup: (...a) => (looked++, resolvingTo('203.0.113.9')(...a)),
      }),
    );
    expect(code).toBe('unsupported_destination');
    expect(looked).toBe(0);
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['private 10/8', '10.1.2.3'],
    ['cloud metadata', '169.254.169.254'],
    ['IPv6 unique-local', 'fd00::1'],
    ['one private among public', '8.8.8.8,192.168.0.1'],
  ])('the approved host resolving to %s: forbidden_destination', async (_n, ips) => {
    expect(
      await codeOf(
        safeGet(GOOD, { policy: openMeteoPolicy, lookup: resolvingTo(...ips.split(',')) }),
      ),
    ).toBe('forbidden_destination');
  });

  it('a redirect, even to the same endpoint: redirect_refused, after exactly one request', async () => {
    seen.length = 0;
    expect(await codeOf(safeGet(`${base}/redirect`, { policy: localWeather() }))).toBe(
      'redirect_refused',
    );
    expect(seen.length).toBe(1);
  });

  it('a 404 is address_rejected at the fetch (the adapter records it as unreachable)', async () => {
    expect(await codeOf(safeGet(`${base}/404`, { policy: localWeather() }))).toBe(
      'address_rejected',
    );
  });
});

describe('the request and its answers under the weather policy', () => {
  it('sends only accept: application/json and user-agent: HOME-weather/1 (no cookie, credential, encoding or HOME header)', async () => {
    seen.length = 0;
    const r = await safeGet(`${base}/v1/forecast?latitude=-41.29`, { policy: localWeather() });
    expect(r.text).toBe(OK);
    const h = seen.at(-1)!.headers;
    expect(Object.keys(h).sort()).toEqual(['accept', 'connection', 'host', 'user-agent']);
    expect(h.accept).toBe('application/json');
    expect(h['user-agent']).toBe('HOME-weather/1');
  });

  it.each([
    ['/429', 'rate_limited'],
    ['/500', 'unreachable'],
    ['/503', 'unreachable'],
    ['/400', 'unreachable'],
    ['/over-max', 'too_large'],
    ['/declared-over', 'too_large'],
  ])('%s: %s', async (path, code) => {
    expect(await codeOf(safeGet(`${base}${path}`, { policy: localWeather() }))).toBe(code);
  });

  it('accepts exactly 512 KiB', async () => {
    expect((await safeGet(`${base}/exactly-max`, { policy: localWeather() })).bytes).toBe(
      512 * KIB,
    );
  });

  it('times out under its own limit (shortened here by the caller, which still wins)', async () => {
    expect(
      await codeOf(safeGet(`${base}/slow`, { policy: localWeather(), limits: { timeoutMs: 200 } })),
    ).toBe('timeout');
  });

  it('the calendar behaviour is unchanged: a 429 is unreachable, its headers and a redirect hop are as before', async () => {
    expect(await codeOf(safeGet(`${base}/429`, { policy: localCalendar() }))).toBe('unreachable');
    seen.length = 0;
    expect((await safeGet(`${base}/redirect`, { policy: localCalendar() })).text).toBe(OK);
    expect(Object.keys(seen.at(-1)!.headers).sort()).toEqual(
      ['accept', 'accept-encoding', 'connection', 'host', 'user-agent'].sort(),
    );
  });

  it('errors carry a code only: no URL, coordinate or body', async () => {
    const e = (await safeGet(`${base}/429?latitude=-41.29&longitude=174.78`, {
      policy: localWeather(),
    }).catch((x: unknown) => x)) as SafeFetchError;
    expect(JSON.stringify(e)).toBe(
      JSON.stringify({ code: 'rate_limited', name: 'SafeFetchError' }),
    );
    for (const leak of ['-41.29', '174.78', 'latitude', '127.0.0.1', 'Too many'])
      expect(`${e.message} ${e.stack}`).not.toContain(leak);
    expect(e.cause).toBeUndefined();
  });
});
