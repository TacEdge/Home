import 'server-only';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { createGunzip } from 'node:zlib';
import { isApprovedCalendarUrl } from '@/lib/calendar-address';
import { isPublicAddress } from '@/lib/net-policy';

// The one way HOME fetches something from outside (M4 contract §4.3), built
// for calendar feeds: GET only, the approved destination only, every
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
  | 'bad_response';

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

/** Where a fetch may go. Production code uses googleCalendarPolicy only. */
export type FetchPolicy = {
  /** May a request (first or after a redirect) go to this URL? */
  approve(url: URL): boolean;
  /** May a socket connect to this resolved address? */
  allowAddress(address: string): boolean;
};

/** Google Calendar's secret iCal feed, on the public internet only (ADR 0007 §3). */
export const googleCalendarPolicy: FetchPolicy = Object.freeze({
  approve: isApprovedCalendarUrl,
  allowAddress: isPublicAddress,
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
  const limits: Limits = { ...FETCH_LIMITS, ...opts.limits };
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
        headers: HEADERS,
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
