import 'server-only';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { createGunzip } from 'node:zlib';
import { isApprovedCalendarUrl } from '@/lib/calendar-address';
import { isPublicAddress } from '@/lib/net-policy';

// The one way HOME fetches something from outside (M4 contract §4.3), built
// for calendar feeds and, since M7, the weather forecast, each under its own
// frozen policy: GET only, the approved destination only, every
// redirect hop checked again, every resolved address checked at the moment
// of connecting (so a name that later resolves somewhere private is refused,
// DNS rebinding included), a total time limit, a size limit enforced while
// reading (after decompression), and no cookie, credential or HOME header
// sent. Failures are SafeFetchError with a structural code; nothing here
// logs, and no error carries the address, a header or the body.

export const FETCH_LIMITS = {
  /** The whole fetch, every hop included (M4 contract §3.3). */
  timeoutMs: 10_000,
  /** The body as read, after decompression (M4 contract §3.3). */
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 3,
} as const;

export type SafeFetchErrorCode =
  | 'unsupported_destination'
  | 'forbidden_destination'
  | 'redirect_refused'
  | 'timeout'
  | 'too_large'
  | 'address_rejected'
  | 'unreachable'
  | 'bad_response'
  // A 429 answer, under a policy that asks for it (openMeteoPolicy); the
  // calendar policy reads a 429 as `unreachable`, as it always has.
  | 'rate_limited';

export class SafeFetchError extends Error {
  constructor(readonly code: SafeFetchErrorCode) {
    super(code);
    this.name = 'SafeFetchError';
  }
}

export type Lookup = (
  hostname: string,
  options: { all: true },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

type Limits = Record<keyof typeof FETCH_LIMITS, number>;

/**
 * Where a fetch may go, and how. Production code uses googleCalendarPolicy
 * and openMeteoPolicy only. The optional parts are per-policy: a policy
 * that leaves them out gets the calendar's headers, limits and answers,
 * exactly as before the second policy existed (M7 contract §2.2).
 */
export type FetchPolicy = {
  /** May a request (first or after a redirect) go to this URL? */
  approve(url: URL): boolean;
  /** May a socket connect to this resolved address? */
  allowAddress(address: string): boolean;
  /** The only request headers sent; nothing else is ever added. Default: the calendar's. */
  headers?: Readonly<Record<string, string>>;
  /** The policy's own limits; a caller's `limits` (tests) still win. Default: FETCH_LIMITS. */
  limits?: Readonly<Partial<Limits>>;
  /** Whether a 429 answer is `rate_limited` (otherwise `unreachable`). */
  rateLimited?: boolean;
};

/** Google Calendar's secret iCal feed, on the public internet only (ADR 0007 §3). */
export const googleCalendarPolicy: FetchPolicy = Object.freeze({
  approve: isApprovedCalendarUrl,
  allowAddress: isPublicAddress,
});

const OPEN_METEO_ORIGIN = 'https://api.open-meteo.com';
const OPEN_METEO_PATH = '/v1/forecast';

/**
 * Open-Meteo's forecast endpoint, exactly (M7 contract §5.1, ADR 0011 §19):
 * https, `api.open-meteo.com`, the default port, no user or password, the
 * path `/v1/forecast`, no fragment. The query is the adapter's.
 */
function isApprovedOpenMeteoUrl(url: URL): boolean {
  return (
    url.origin === OPEN_METEO_ORIGIN &&
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === OPEN_METEO_PATH &&
    url.hash === ''
  );
}

/**
 * The weather forecast (M7 contract §5.1, ADR 0011 §19): Open-Meteo's one
 * endpoint, public addresses only, two fixed headers and nothing else, 10
 * seconds, 512 KiB, no redirects, and a 429 read as `rate_limited`. Frozen,
 * like googleCalendarPolicy, so nothing can widen it at run time.
 */
export const openMeteoPolicy: FetchPolicy = Object.freeze({
  approve: isApprovedOpenMeteoUrl,
  allowAddress: isPublicAddress,
  headers: Object.freeze({ accept: 'application/json', 'user-agent': 'HOME-weather/1' }),
  limits: Object.freeze({ timeoutMs: 10_000, maxBytes: 512 * 1024, maxRedirects: 0 }),
  rateLimited: true,
});

export type FetchedFeed = { text: string; bytes: number; contentType: string | null };

export type SafeFetchOptions = {
  policy?: FetchPolicy;
  limits?: Partial<Limits>;
  /** Tests only: a resolver, so no test needs the network. */
  lookup?: Lookup;
};

const HEADERS = {
  accept: 'text/calendar, text/plain;q=0.5',
  'accept-encoding': 'gzip, identity',
  'user-agent': 'HOME-calendar/1',
} as const;

/**
 * GETs `address` under `policy` and returns its body as text, bounded.
 * `address` should already be normalised (normaliseCalendarAddress).
 */
export async function safeGet(address: string, opts: SafeFetchOptions = {}): Promise<FetchedFeed> {
  const policy = opts.policy ?? googleCalendarPolicy;
  const limits: Limits = { ...FETCH_LIMITS, ...policy.limits, ...opts.limits };
  const lookup = opts.lookup ?? (dnsLookup as unknown as Lookup);
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new SafeFetchError('unsupported_destination');
  }
  if (!policy.approve(url)) throw new SafeFetchError('unsupported_destination');

  const deadline = Date.now() + limits.timeoutMs;
  for (let hop = 0; ; hop++) {
    const outcome = await getOnce(url, policy, lookup, limits, deadline);
    if (outcome.kind === 'body') return outcome.feed;
    if (hop >= limits.maxRedirects) throw new SafeFetchError('redirect_refused');
    let next: URL;
    try {
      next = new URL(outcome.location, url);
    } catch {
      throw new SafeFetchError('redirect_refused');
    }
    if (!policy.approve(next)) throw new SafeFetchError('redirect_refused');
    url = next;
  }
}

/**
 * The lookup a request connects through: every address the name resolves to
 * must be allowed, or none is used. Node asks in one of two shapes: with
 * `all: true` (its default, since it tries IPv6 and IPv4 in turn) it expects
 * the whole list back, otherwise one address and its family. Either way the
 * list is judged as a whole. Exported for tests.
 */
export function guardLookup(policy: FetchPolicy, lookup: Lookup) {
  return (
    hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    const all = typeof options === 'object' && options !== null && options.all === true;
    lookup(hostname, { all: true }, (err, addresses) => {
      if (err || !addresses?.length) return callback(err ?? new Error('lookup'), all ? [] : '', 0);
      if (!addresses.every((a) => policy.allowAddress(a.address)))
        return callback(new SafeFetchError('forbidden_destination'), all ? [] : '', 0);
      if (all)
        return callback(
          null,
          addresses.map((a) => ({ address: a.address, family: a.family })),
        );
      const first = addresses[0]!;
      callback(null, first.address, first.family);
    });
  };
}

type Outcome = { kind: 'body'; feed: FetchedFeed } | { kind: 'redirect'; location: string };

function getOnce(
  url: URL,
  policy: FetchPolicy,
  lookup: Lookup,
  limits: Limits,
  deadline: number,
): Promise<Outcome> {
  return new Promise<Outcome>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    let response: IncomingMessage | undefined;
    // Closes the connection: a body HOME will not read is never drained, so
    // nothing keeps downloading after the fetch has settled.
    const close = () => {
      response?.destroy();
      req.destroy();
    };
    const fail = (code: SafeFetchErrorCode) => {
      finish(() => reject(new SafeFetchError(code)));
      close();
    };
    const remaining = deadline - Date.now();
    const timer = setTimeout(() => fail('timeout'), Math.max(0, remaining));

    const guardedLookup = guardLookup(policy, lookup);

    const transport = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
    if (!transport) return fail('unsupported_destination');
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { ...(policy.headers ?? HEADERS) },
        agent: false,
        lookup: guardedLookup as never,
      },
      (res) => {
        response = res;
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && status !== 304) {
          const location = res.headers.location;
          if (!location) return fail('bad_response');
          finish(() => resolve({ kind: 'redirect', location }));
          return close();
        }
        if (status === 429 && policy.rateLimited === true) {
          return fail('rate_limited');
        }
        if ([401, 403, 404, 410].includes(status)) {
          return fail('address_rejected');
        }
        if (status !== 200) {
          return fail('unreachable');
        }
        const declared = Number(res.headers['content-length'] ?? NaN);
        if (Number.isFinite(declared) && declared > limits.maxBytes) {
          return fail('too_large');
        }
        const encoding = (res.headers['content-encoding'] ?? 'identity').toLowerCase();
        if (encoding !== 'identity' && encoding !== 'gzip') {
          return fail('bad_response');
        }
        const stream = encoding === 'gzip' ? res.pipe(createGunzip()) : res;
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > limits.maxBytes) {
            stream.destroy();
            return fail('too_large');
          }
          chunks.push(chunk);
        });
        stream.on('error', () => fail(encoding === 'gzip' ? 'bad_response' : 'unreachable'));
        stream.on('end', () =>
          finish(() =>
            resolve({
              kind: 'body',
              feed: {
                text: new TextDecoder('utf-8').decode(Buffer.concat(chunks)),
                bytes: total,
                contentType: res.headers['content-type'] ?? null,
              },
            }),
          ),
        );
      },
    );
    // A second check on the socket actually connected, whatever resolved it.
    req.on('socket', (socket: Socket) => {
      socket.once('connect', () => {
        const remote = socket.remoteAddress;
        if (!remote || !policy.allowAddress(remote)) fail('forbidden_destination');
      });
    });
    req.on('error', (err) => fail(err instanceof SafeFetchError ? err.code : 'unreachable'));
    req.end();
  });
}
