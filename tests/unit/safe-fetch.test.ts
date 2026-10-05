import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FETCH_LIMITS,
  googleCalendarPolicy,
  safeGet,
  SafeFetchError,
  type FetchPolicy,
} from '@/integrations/net/safe-fetch';

// The safe outbound fetch (M4 contract §4.3). A local plain-HTTP server stands
// in for the internet under a test-only policy that approves it; the policy
// is passed in code, so nothing here widens what production may reach. No
// test touches the network: every name resolves through an injected resolver.

const SECRET_PATH = '/calendar/ical/synthetic%40example.test/private-0123456789abcdef/basic.ics';
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

let base = '';
let server: http.Server;
const seen: { method?: string; url?: string; headers: IncomingHttpHeaders }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    const u = new URL(req.url ?? '/', 'http://x');
    switch (u.pathname) {
      case SECRET_PATH:
        res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' });
        return res.end(ICS);
      case '/gzip':
        res.writeHead(200, { 'content-encoding': 'gzip' });
        return res.end(gzipSync(ICS));
      case '/gzip-bomb':
        res.writeHead(200, { 'content-encoding': 'gzip' });
        return res.end(gzipSync(Buffer.alloc(FETCH_LIMITS.maxBytes + 1024)));
      case '/brotli':
        res.writeHead(200, { 'content-encoding': 'br' });
        return res.end('x');
      case '/big-declared':
        res.writeHead(200, { 'content-length': String(FETCH_LIMITS.maxBytes + 1) });
        return res.end();
      case '/big-chunked': {
        res.writeHead(200);
        const chunk = Buffer.alloc(64 * 1024, 'a');
        let sent = 0;
        const pump = () => {
          while (sent <= FETCH_LIMITS.maxBytes) {
            sent += chunk.length;
            if (!res.write(chunk)) return res.once('drain', pump);
          }
          res.end();
        };
        return pump();
      }
      case '/exactly-max':
        res.writeHead(200);
        return res.end(Buffer.alloc(FETCH_LIMITS.maxBytes, 'b'));
      case '/slow':
        return setTimeout(() => res.end(ICS), 2_000);
      case '/drip': {
        res.writeHead(200);
        const t = setInterval(() => res.write('x'), 50);
        return res.on('close', () => clearInterval(t));
      }
      case '/to-forbidden':
        res.writeHead(302, { location: 'http://forbidden.example/feed.ics' });
        return res.end();
      case '/to-relative':
        res.writeHead(301, { location: SECRET_PATH });
        return res.end();
      case '/loop':
        res.writeHead(302, { location: '/loop' });
        return res.end();
      case '/no-location':
        res.writeHead(302);
        return res.end();
      case '/gone':
        res.writeHead(404);
        return res.end('not found, with private-0123456789abcdef in it');
      case '/forbidden':
        res.writeHead(403);
        return res.end();
      case '/broken':
        res.writeHead(500);
        return res.end();
      default:
        res.writeHead(400);
        return res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** Test only: the local server is approved and reachable; nothing else is. */
const local: FetchPolicy = {
  approve: (u) => u.protocol === 'http:' && u.host === new URL(base).host,
  allowAddress: (a) => a === '127.0.0.1',
};
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof SafeFetchError ? e.code : `other: ${String(e)}`;
  }
};

describe('a feed comes back bounded, as text', () => {
  it('GETs it with only the fixed headers: no cookie, credential or HOME header', async () => {
    seen.length = 0;
    const feed = await safeGet(`${base}${SECRET_PATH}`, { policy: local });
    expect(feed).toEqual({
      text: ICS,
      bytes: ICS.length,
      contentType: 'text/calendar; charset=utf-8',
    });
    const req = seen.at(-1)!;
    expect(req.method).toBe('GET');
    expect(Object.keys(req.headers).sort()).toEqual(
      ['accept', 'accept-encoding', 'connection', 'host', 'user-agent'].sort(),
    );
    expect(req.headers.cookie).toBeUndefined();
    expect(req.headers.authorization).toBeUndefined();
  });
  it('decompresses gzip', async () => {
    expect((await safeGet(`${base}/gzip`, { policy: local })).text).toBe(ICS);
  });
  it('accepts exactly the size limit', async () => {
    expect((await safeGet(`${base}/exactly-max`, { policy: local })).bytes).toBe(
      FETCH_LIMITS.maxBytes,
    );
  });
});

describe('limits', () => {
  it('refuses a body declared over the limit', async () => {
    expect(await codeOf(safeGet(`${base}/big-declared`, { policy: local }))).toBe('too_large');
  });
  it('stops reading a body that grows over the limit', async () => {
    expect(await codeOf(safeGet(`${base}/big-chunked`, { policy: local }))).toBe('too_large');
  });
  it('measures after decompression: a small gzip that inflates past the limit is refused', async () => {
    expect(await codeOf(safeGet(`${base}/gzip-bomb`, { policy: local }))).toBe('too_large');
  });
  it('refuses any other encoding', async () => {
    expect(await codeOf(safeGet(`${base}/brotli`, { policy: local }))).toBe('bad_response');
  });
  it('times out a slow answer', async () => {
    const t = Date.now();
    expect(
      await codeOf(safeGet(`${base}/slow`, { policy: local, limits: { timeoutMs: 200 } })),
    ).toBe('timeout');
    expect(Date.now() - t).toBeLessThan(1_500);
  });
  it('times out a body that trickles in: the limit is the whole fetch, not the gap between bytes', async () => {
    expect(
      await codeOf(safeGet(`${base}/drip`, { policy: local, limits: { timeoutMs: 300 } })),
    ).toBe('timeout');
  });
  it('uses the contract starting values', () => {
    expect(FETCH_LIMITS).toEqual({ timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024, maxRedirects: 3 });
  });
});

describe('answers', () => {
  it.each([
    ['/gone', 'address_rejected'],
    ['/forbidden', 'address_rejected'],
    ['/broken', 'unreachable'],
    ['/no-location', 'bad_response'],
  ])('%s reads %s', async (path, code) => {
    expect(await codeOf(safeGet(`${base}${path}`, { policy: local }))).toBe(code);
  });
  it('a closed port is unreachable', async () => {
    const closed: FetchPolicy = { approve: () => true, allowAddress: (a) => a === '127.0.0.1' };
    expect(await codeOf(safeGet('http://127.0.0.1:1/feed.ics', { policy: closed }))).toBe(
      'unreachable',
    );
  });
});

describe('redirects', () => {
  it('follows a hop the policy approves', async () => {
    expect((await safeGet(`${base}/to-relative`, { policy: local })).text).toBe(ICS);
  });
  it('refuses a hop to a destination the policy does not approve, before any request is made there', async () => {
    let asked = 0;
    const counting: FetchPolicy = { ...local, approve: (u) => (asked++, local.approve(u)) };
    expect(await codeOf(safeGet(`${base}/to-forbidden`, { policy: counting }))).toBe(
      'redirect_refused',
    );
    expect(asked).toBe(2); // the first URL, then the hop: every hop is judged again
  });
  it('refuses a loop after the hop limit', async () => {
    seen.length = 0;
    expect(await codeOf(safeGet(`${base}/loop`, { policy: local }))).toBe('redirect_refused');
    expect(seen.length).toBe(FETCH_LIMITS.maxRedirects + 1);
  });
});

describe('destinations (SSRF)', () => {
  const GOOD = `https://calendar.google.com${SECRET_PATH}`;
  const resolvingTo =
    (...addresses: string[]) =>
    (_host: string, _o: unknown, cb: (e: null, a: { address: string; family: number }[]) => void) =>
      cb(
        null,
        addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      );

  it.each([
    ['loopback', '127.0.0.1'],
    ['private 10/8', '10.0.0.5'],
    ['private 192.168/16', '192.168.1.10'],
    ['private 172.16/12', '172.20.0.1'],
    ['carrier-grade NAT', '100.64.1.1'],
    ['cloud metadata', '169.254.169.254'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unique-local', 'fd00::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['documentation range', '192.0.2.10'],
  ])('the approved host resolving to %s is refused before connecting', async (_n, ip) => {
    expect(await codeOf(safeGet(GOOD, { lookup: resolvingTo(ip) }))).toBe('forbidden_destination');
  });

  it('one private answer among public ones is enough to refuse (no picking the safe one)', async () => {
    expect(await codeOf(safeGet(GOOD, { lookup: resolvingTo('203.0.113.1', '127.0.0.1') }))).toBe(
      'forbidden_destination',
    );
  });

  it('the production policy approves only the Google calendar host over https', async () => {
    for (const u of [
      `http://calendar.google.com${SECRET_PATH}`,
      `${base}${SECRET_PATH}`,
      `https://127.0.0.1${SECRET_PATH}`,
      `https://[::1]${SECRET_PATH}`,
      `https://evil.example${SECRET_PATH}`,
      `https://calendar.google.com.evil.example${SECRET_PATH}`,
      `https://user:pass@calendar.google.com${SECRET_PATH}`,
      `https://calendar.google.com:8443${SECRET_PATH}`,
      'not a url',
      `file:///etc/passwd`,
    ])
      expect(await codeOf(safeGet(u)), u).toBe('unsupported_destination');
    expect(googleCalendarPolicy.approve(new URL(GOOD))).toBe(true);
    expect(Object.isFrozen(googleCalendarPolicy)).toBe(true);
  });

  it('checks the connected socket too: a literal address skips DNS but not the check', async () => {
    const literal: FetchPolicy = { approve: () => true, allowAddress: () => false };
    expect(await codeOf(safeGet(`${base}${SECRET_PATH}`, { policy: literal }))).toBe(
      'forbidden_destination',
    );
  });
});

describe('errors carry a code only', () => {
  it.each([
    [`${SECRET_PATH.replace('basic.ics', 'missing.ics')}`, 'unreachable'],
    ['/gone', 'address_rejected'],
    ['/big-declared', 'too_large'],
    ['/to-forbidden', 'redirect_refused'],
  ])(
    '%s: no address, path, token, host or body in the message, JSON or stack',
    async (path, code) => {
      const error = await safeGet(`${base}${path}`, { policy: local }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(SafeFetchError);
      const e = error as SafeFetchError;
      expect(e.message).toBe(code);
      expect(JSON.stringify(e)).toBe(JSON.stringify({ code, name: 'SafeFetchError' }));
      for (const leak of ['private-', 'calendar', '127.0.0.1', 'forbidden.example', 'not found'])
        expect(`${e.message} ${JSON.stringify(e)} ${e.stack}`, leak).not.toContain(leak);
      expect(e.cause).toBeUndefined();
    },
  );
});
