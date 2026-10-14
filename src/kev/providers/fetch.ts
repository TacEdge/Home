import 'server-only';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { deploymentEnv } from '@/lib/env';
import { isPublicAddress } from '@/lib/net-policy';
import { LIMITS, TIERS } from '../config';

// HOME's network policy for the model provider (M8 contract §5.4; ADR 0012
// §14). The SDK is given this function as its `fetch`, so every request it
// makes passes here (N4, N5), and nothing else: the SDK can reach the
// network no other way (tests/unit/kev-anthropic.test.ts traps the global
// fetch and Node's http(s).request to prove it). Built on Node's `https`
// like src/integrations/net/safe-fetch.ts (which `kev` may not import, and
// which is left unchanged), reusing `isPublicAddress`.
//
// - Destination: `https://api.anthropic.com` exactly (scheme, host, default
//   port, no user info, no fragment, no query); POST `/v1/messages`, and GET
//   `/v1/models/{id}` (the manual Models API check, G1). Anything else is
//   refused before connecting: `refused_destination`.
// - Addresses: every resolved address checked when connecting, and the
//   connected socket's address checked again; a non-public one is
//   `unreachable`.
// - Redirects: never followed; a 3xx is `refused_destination`.
// - Size: a request body over 1 MiB is refused before connecting; a
//   response over 2 MiB, counted while it streams, is `too_large`.
// - Time: no byte for 15 s is `timeout` (idle, waiting for the response or
//   between chunks); a whole call never outlives the longest tier's timeout,
//   as a backstop to the caller's per-call AbortSignal; the SDK's `signal`
//   is honoured throughout and destroys the socket.
// - Headers: an allow-list. Only the API key (which must equal the key this
//   fetch was built with), `anthropic-version` (fixed), `content-type`,
//   `accept` and the SDK's `user-agent` are sent, with `accept-encoding:
//   identity` and the length. Everything else the SDK or the environment
//   adds is dropped: the `x-stainless-*` platform headers (OS, architecture,
//   runtime and package versions, retry count; the API does not need them),
//   any `authorization`, `anthropic-beta`, cookie or HOME header, and
//   whatever ANTHROPIC_CUSTOM_HEADERS injected.
// - Errors: `ProviderNetError` with a closed code only. No error, here or
//   from here, carries the key, a header, a URL's query or a body.

export const PROVIDER_ORIGIN = 'https://api.anthropic.com';
const PROVIDER_HOST = 'api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';

export const PROVIDER_FETCH_LIMITS = Object.freeze({
  maxRequestBytes: 1024 * 1024,
  maxResponseBytes: 2 * 1024 * 1024,
  idleMs: LIMITS.idleMs,
  /** The backstop: no call outlives the longest tier's timeout. */
  maxCallMs: Math.max(TIERS.fast.callTimeoutMs, TIERS.deep.callTimeoutMs),
});

export type ProviderNetCode =
  'refused_destination' | 'unreachable' | 'timeout' | 'too_large' | 'auth';

/**
 * A refusal or failure of HOME's fetch. `sent` says whether any byte of the
 * request left HOME (a call refused before sending is no provider call);
 * `retryable` whether HOME's one retry may follow (a connection failure
 * before any response; never a refusal of policy).
 */
export class ProviderNetError extends Error {
  constructor(
    readonly code: ProviderNetCode,
    readonly sent: boolean,
    readonly retryable: boolean,
  ) {
    super(`provider fetch: ${code}`);
    this.name = 'ProviderNetError';
  }
}

export type Lookup = (
  hostname: string,
  options: { all: true },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/** How the request reaches the provider: TLS to the resolved public address, or (tests only) a local stub. */
type Transport =
  | { kind: 'tls'; lookup: Lookup; allowAddress: (a: string) => boolean }
  | { kind: 'stub'; port: number; allowAddress: (a: string) => boolean };

type Limits = typeof PROVIDER_FETCH_LIMITS;

/** What the SDK hands a custom fetch. */
type FetchInit = {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
  signal?: AbortSignal | null;
};

/** The observer a call may attach, to learn whether any response byte arrived (HOME's retry rule). */
export type FetchObserver = { responseBytes: number; status: number | null };

export type ProviderFetch = ((
  url: string | URL | Request,
  init?: FetchInit,
) => Promise<Response>) & {
  readonly __homeProviderFetch: true;
};

const minted = new WeakSet<object>();

/** Whether a function is a fetch built by this module (the adapter accepts no other). */
export function isProviderFetch(f: unknown): f is ProviderFetch {
  return typeof f === 'function' && minted.has(f);
}

const MODEL_PATH = /^\/v1\/models\/[a-z0-9][a-z0-9.-]{0,99}$/;

/** The destination rule, exactly (§5.4). Pure; exported for its test. */
export function approveDestination(url: URL, method: string): boolean {
  if (
    url.protocol !== 'https:' ||
    url.hostname !== PROVIDER_HOST ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  )
    return false;
  if (method === 'POST') return url.pathname === '/v1/messages';
  if (method === 'GET') return MODEL_PATH.test(url.pathname);
  return false;
}

function headerValue(headers: Headers, name: string): string | null {
  return headers.get(name);
}

/** The outgoing headers: the allow-list, or a refusal (§5.4). Exported for its test. */
export function allowedHeaders(
  input: HeadersInit | undefined,
  method: string,
  key: string,
  bodyBytes: number,
): Record<string, string> {
  const h = new Headers(input ?? {});
  if (headerValue(h, 'x-api-key') !== key) throw new ProviderNetError('auth', false, false);
  const out: Record<string, string> = {
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    'accept-encoding': 'identity',
  };
  const accept = headerValue(h, 'accept');
  out.accept =
    accept === 'text/event-stream' || accept === 'application/json' ? accept : 'application/json';
  const ua = headerValue(h, 'user-agent');
  if (ua && /^Anthropic\/JS [0-9][0-9A-Za-z.+-]{0,40}$/.test(ua)) out['user-agent'] = ua;
  if (method === 'POST') {
    out['content-type'] = 'application/json';
    out['content-length'] = String(bodyBytes);
  }
  return out;
}

function bodyBuffer(body: unknown): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  // The SDK sends JSON strings; a stream, form or blob is never HOME's.
  throw new ProviderNetError('refused_destination', false, false);
}

function guardLookup(transport: Extract<Transport, { kind: 'tls' }>) {
  return (
    hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    const all = typeof options === 'object' && options !== null && options.all === true;
    transport.lookup(hostname, { all: true }, (err, addresses) => {
      if (err || !addresses?.length)
        return callback(new ProviderNetError('unreachable', false, true), all ? [] : '', 0);
      if (!addresses.every((a) => transport.allowAddress(a.address)))
        return callback(new ProviderNetError('unreachable', false, false), all ? [] : '', 0);
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

const KEPT_RESPONSE_HEADERS = ['content-type', 'retry-after', 'request-id'];

function build(key: string, transport: Transport, limits: Limits) {
  const fetchImpl = async (
    input: string | URL | Request,
    init: FetchInit = {},
  ): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
    } catch {
      throw new ProviderNetError('refused_destination', false, false);
    }
    const method = (init.method ?? 'GET').toUpperCase();
    if (!approveDestination(url, method))
      throw new ProviderNetError('refused_destination', false, false);
    const body = bodyBuffer(init.body);
    if (body.length > limits.maxRequestBytes) throw new ProviderNetError('too_large', false, false);
    if (method === 'GET' && body.length > 0)
      throw new ProviderNetError('refused_destination', false, false);
    const headers = allowedHeaders(init.headers, method, key, body.length);
    const signal = init.signal ?? undefined;
    if (signal?.aborted) throw abortError();

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      let response: IncomingMessage | undefined;
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      let sent = false;
      const timers: { idle?: NodeJS.Timeout; total?: NodeJS.Timeout } = {};
      const clear = () => {
        clearTimeout(timers.idle);
        clearTimeout(timers.total);
        signal?.removeEventListener('abort', onAbort);
      };
      const destroy = () => {
        response?.destroy();
        req.destroy();
      };
      // Before the response: reject. After: error the body stream. The first
      // failure wins; destroying the socket afterwards raises nothing more.
      let failed = false;
      const fail = (err: Error) => {
        if (failed) return;
        failed = true;
        clear();
        if (!settled) {
          settled = true;
          reject(err);
        } else if (streamController) {
          try {
            streamController.error(err);
          } catch {
            // already closed
          }
          streamController = undefined;
        }
        destroy();
      };
      const armIdle = () => {
        clearTimeout(timers.idle);
        timers.idle = setTimeout(
          () => fail(new ProviderNetError('timeout', true, false)),
          limits.idleMs,
        );
      };
      function onAbort() {
        fail(abortError());
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      timers.total = setTimeout(
        () => fail(new ProviderNetError('timeout', true, false)),
        limits.maxCallMs,
      );

      const common = {
        method,
        path: url.pathname,
        headers: { ...headers, host: PROVIDER_HOST },
        agent: false as const,
      };
      const req =
        transport.kind === 'tls'
          ? https.request({
              ...common,
              protocol: 'https:',
              hostname: PROVIDER_HOST,
              port: 443,
              servername: PROVIDER_HOST,
              lookup: guardLookup(transport) as never,
            })
          : http.request({
              ...common,
              protocol: 'http:',
              hostname: '127.0.0.1',
              port: transport.port,
            });

      req.on('socket', (socket: Socket) => {
        const check = () => {
          const remote = socket.remoteAddress;
          if (!remote || !transport.allowAddress(remote))
            fail(new ProviderNetError('unreachable', false, false));
        };
        if (socket.remoteAddress) check();
        else socket.once('connect', check);
      });
      req.on('error', (err) => {
        if (err instanceof ProviderNetError) return fail(err);
        // A connection that failed before any response: HOME's retry may follow.
        fail(new ProviderNetError('unreachable', sent, !settled));
      });
      req.on('response', (res) => {
        response = res;
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400)
          return fail(new ProviderNetError('refused_destination', true, false));
        if (status < 200 || status > 599)
          return fail(new ProviderNetError('unreachable', true, true));
        const declared = Number(res.headers['content-length'] ?? NaN);
        if (Number.isFinite(declared) && declared > limits.maxResponseBytes)
          return fail(new ProviderNetError('too_large', true, false));
        const encoding = (res.headers['content-encoding'] ?? 'identity').toLowerCase();
        if (encoding !== 'identity') return fail(new ProviderNetError('unreachable', true, false));
        armIdle();
        let total = 0;
        const stream = new ReadableStream<Uint8Array>(
          {
            start(controller) {
              streamController = controller;
              res.on('data', (chunk: Buffer) => {
                total += chunk.length;
                if (total > limits.maxResponseBytes)
                  return fail(new ProviderNetError('too_large', true, false));
                armIdle();
                controller.enqueue(new Uint8Array(chunk));
                if ((controller.desiredSize ?? 1) <= 0) res.pause();
              });
              res.on('end', () => {
                clear();
                try {
                  controller.close();
                } catch {
                  // already errored
                }
                streamController = undefined;
              });
              res.on('error', () => fail(new ProviderNetError('unreachable', true, false)));
              res.on('aborted', () => fail(new ProviderNetError('unreachable', true, false)));
            },
            pull() {
              res.resume();
            },
            cancel() {
              clear();
              destroy();
            },
          },
          { highWaterMark: 16 },
        );
        const kept = new Headers();
        for (const name of KEPT_RESPONSE_HEADERS) {
          const v = res.headers[name];
          if (typeof v === 'string') kept.set(name, v);
        }
        settled = true;
        resolve(new Response(stream, { status, headers: kept }));
      });
      sent = true;
      armIdle();
      req.end(body);
    });
  };
  const f = fetchImpl as unknown as ProviderFetch;
  minted.add(f);
  return f;
}

/** The DOM abort error the SDK recognises as an abort (its `isAbortError`). */
function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * HOME's fetch for the provider, in production: TLS to api.anthropic.com's
 * public addresses only, with the frozen limits. It takes the key only, so
 * it can check the SDK sends exactly that key; nothing else can be passed.
 */
export function createProviderFetch(key: string): ProviderFetch {
  if (typeof key !== 'string' || key.length === 0) throw new Error('a provider key is required');
  return build(
    key,
    { kind: 'tls', lookup: dnsLookup as unknown as Lookup, allowAddress: isPublicAddress },
    PROVIDER_FETCH_LIMITS,
  );
}

/** Refuses anywhere deployed: the test seam can never reach a real deployment. */
function assertNotDeployed(source: Record<string, string | undefined>): void {
  if (source.VERCEL_ENV || source.VERCEL || source.NODE_ENV === 'production')
    throw new Error('the provider test fetch is for local and CI tests only');
}

/**
 * Tests only (refused when VERCEL_ENV, VERCEL or NODE_ENV=production is set):
 * the same policy, but the request goes over plain HTTP to a local stub on
 * 127.0.0.1:`stubPort`, or (with `lookup`) resolves through an injected
 * resolver so a private address can be refused without any network. The
 * URL, method, path, header, size and redirect rules are production's.
 */
export function createProviderFetchForTests(
  key: string,
  opts: {
    stubPort?: number;
    lookup?: Lookup;
    limits?: Partial<Limits>;
  },
  source: Record<string, string | undefined> = deploymentEnv(),
): ProviderFetch {
  assertNotDeployed(source);
  const limits = { ...PROVIDER_FETCH_LIMITS, ...opts.limits };
  const transport: Transport =
    opts.stubPort !== undefined
      ? { kind: 'stub', port: opts.stubPort, allowAddress: (a) => a === '127.0.0.1' }
      : {
          kind: 'tls',
          lookup: opts.lookup ?? (dnsLookup as unknown as Lookup),
          allowAddress: isPublicAddress,
        };
  return build(key, transport, limits);
}

/**
 * The per-call observer hook: the adapter wraps HOME's fetch to learn, for
 * each request, whether any response byte arrived. Returns a fetch that
 * reports into `observer` and forwards to `inner` unchanged.
 */
export function observedFetch(inner: ProviderFetch, observer: FetchObserver): ProviderFetch {
  if (!isProviderFetch(inner)) throw new Error('only HOME’s provider fetch may be observed');
  const f = (async (input: string | URL | Request, init?: FetchInit) => {
    const res = await inner(input, init);
    observer.status = res.status;
    if (!res.body) return res;
    const reader = res.body.getReader();
    const counted = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) return controller.close();
          observer.responseBytes += value.byteLength;
          controller.enqueue(value);
        } catch (err) {
          controller.error(err);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return new Response(counted, { status: res.status, headers: res.headers });
  }) as unknown as ProviderFetch;
  minted.add(f);
  return f;
}
