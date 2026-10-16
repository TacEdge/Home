import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveDestination,
  createProviderFetch,
  createProviderFetchForTests,
  PROVIDER_FETCH_LIMITS,
  ProviderNetError,
  type Lookup,
} from '@/kev/providers/fetch';
import { startStub, type Stub } from './kev-stub';

// HOME's network policy for the provider (M8 contract §5.4; matrix rows N5,
// N6). The production policy is exercised through the test seam, which
// keeps every rule and replaces only the connection (a local stub over
// plain HTTP, or an injected resolver). No test reaches the network.

const KEY = 'test-only-not-a-key';
const MESSAGES = 'https://api.anthropic.com/v1/messages';
let stub: Stub;
beforeAll(async () => {
  stub = await startStub();
});
afterAll(() => stub.close());
beforeEach(() => {
  stub.seen.length = 0;
  stub.queue.length = 0;
});

const post = (body = '{}') => ({
  method: 'POST',
  headers: { 'x-api-key': KEY, 'content-type': 'application/json', accept: 'application/json' },
  body,
});
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ProviderNetError ? e.code : `other: ${String(e)}`;
  }
};
const viaStub = (limits = {}) => createProviderFetchForTests(KEY, { stubPort: stub.port, limits });

describe('N5: the destination, exactly', () => {
  it('approves POST /v1/messages, POST /v1/messages/count_tokens (G22) and GET /v1/models/{id} on https://api.anthropic.com only', () => {
    const ok = (u: string, m: string) => approveDestination(new URL(u), m);
    expect(ok(MESSAGES, 'POST')).toBe(true);
    expect(ok('https://api.anthropic.com/v1/messages/count_tokens', 'POST')).toBe(true);
    expect(ok('https://api.anthropic.com/v1/models/model-id-1', 'GET')).toBe(true);
    for (const [u, m] of [
      ['https://api.anthropic.com/v1/messages', 'GET'],
      ['https://api.anthropic.com/v1/messages', 'PUT'],
      ['https://api.anthropic.com/v1/messages/batches', 'POST'],
      // G22 adds exactly one path, for POST only: nothing near it is approved.
      ['https://api.anthropic.com/v1/messages/count_tokens', 'GET'],
      ['https://api.anthropic.com/v1/messages/count_tokens/', 'POST'],
      ['https://api.anthropic.com/v1/messages/count_tokens/x', 'POST'],
      ['https://api.anthropic.com/v1/messages/count_tokens?beta=true', 'POST'],
      ['https://api.anthropic.com/v1/messages/count-tokens', 'POST'],
      ['https://api.anthropic.com/v1/messages/batches/count_tokens', 'POST'],
      ['https://api.anthropic.com/v1/count_tokens', 'POST'],
      ['https://api.anthropic.com/v1/messages/COUNT_TOKENS', 'POST'],
      ['http://api.anthropic.com/v1/messages/count_tokens', 'POST'],
      ['https://api.anthropic.com:8443/v1/messages/count_tokens', 'POST'],
      ['https://api.anthropic.com/v1/messages/count_tokens/../batches', 'POST'],
      ['https://api.anthropic.com/v1/files', 'POST'],
      ['https://api.anthropic.com/v1/models', 'GET'],
      ['https://api.anthropic.com/v1/models/../messages', 'GET'],
      ['http://api.anthropic.com/v1/messages', 'POST'],
      ['https://api.anthropic.com:8443/v1/messages', 'POST'],
      ['https://user:pw@api.anthropic.com/v1/messages', 'POST'],
      ['https://api.anthropic.com/v1/messages?beta=true', 'POST'],
      ['https://api.anthropic.com/v1/messages#x', 'POST'],
      ['https://api.anthropic.com.example.test/v1/messages', 'POST'],
      ['https://example.test/v1/messages', 'POST'],
      ['https://127.0.0.1/v1/messages', 'POST'],
    ] as const)
      expect(ok(u, m), `${m} ${u}`).toBe(false);
  });

  it('refuses another host, http, another port, another path or method before any byte is sent', async () => {
    const f = viaStub();
    for (const [u, m] of [
      [`http://127.0.0.1:${stub.port}/v1/messages`, 'POST'],
      ['http://api.anthropic.com/v1/messages', 'POST'],
      ['https://api.anthropic.com:444/v1/messages', 'POST'],
      ['https://api.anthropic.com/v1/complete', 'POST'],
      ['https://evil.example.test/v1/messages', 'POST'],
      ['https://api.anthropic.com/v1/messages', 'DELETE'],
    ] as const)
      expect(await codeOf(f(u, { ...post(), method: m })), u).toBe('refused_destination');
    expect(stub.seen).toEqual([]);
  });

  it('refuses a redirect without following it', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(302, { location: 'https://evil.example.test/' });
      res.end();
    });
    expect(await codeOf(viaStub()(MESSAGES, post()))).toBe('refused_destination');
    expect(stub.seen).toHaveLength(1);
  });

  it('refuses a private address at connect time (unreachable), without the network', async () => {
    for (const address of [
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '::1',
      'fd00::1',
    ]) {
      const lookup: Lookup = (_h, _o, cb) =>
        cb(null, [{ address, family: address.includes(':') ? 6 : 4 }]);
      const f = createProviderFetchForTests(KEY, { lookup });
      expect(await codeOf(f(MESSAGES, post())), address).toBe('unreachable');
    }
    // A name that resolves to one public and one private address is refused whole.
    const mixed: Lookup = (_h, _o, cb) =>
      cb(null, [
        { address: '203.0.114.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]);
    expect(
      await codeOf(createProviderFetchForTests(KEY, { lookup: mixed })(MESSAGES, post())),
    ).toBe('unreachable');
  });
});

describe('headers: an allow-list, and the key HOME was given', () => {
  it('sends only the key, version, content type, accept, user agent, encoding and length', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    const res = await viaStub()(MESSAGES, {
      method: 'POST',
      headers: {
        'x-api-key': KEY,
        'anthropic-version': '1999-01-01',
        'content-type': 'text/plain',
        accept: 'application/json',
        'user-agent': 'Anthropic/JS 0.129.0',
        'x-stainless-os': 'Linux',
        'x-stainless-runtime-version': 'v22',
        authorization: 'Bearer not-allowed',
        'anthropic-beta': 'something',
        cookie: 'session=x',
        'x-home-user': 'sam',
      },
      body: '{"a":1}',
    });
    expect(res.status).toBe(200);
    await res.text();
    const h = stub.seen[0]!.headers;
    expect(Object.keys(h).sort()).toEqual(
      [
        'accept',
        'accept-encoding',
        'anthropic-version',
        'connection',
        'content-length',
        'content-type',
        'host',
        'user-agent',
        'x-api-key',
      ].sort(),
    );
    expect(h).toMatchObject({
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'accept-encoding': 'identity',
      host: 'api.anthropic.com',
      'user-agent': 'Anthropic/JS 0.129.0',
    });
  });

  it('refuses (auth) before connecting when the SDK’s key is not the one HOME gave', async () => {
    const f = viaStub();
    expect(await codeOf(f(MESSAGES, { ...post(), headers: { 'x-api-key': 'other' } }))).toBe(
      'auth',
    );
    expect(await codeOf(f(MESSAGES, { ...post(), headers: {} }))).toBe('auth');
    expect(stub.seen).toEqual([]);
  });
});

describe('N6: sizes and time', () => {
  it('refuses a request body over 1 MiB before connecting', async () => {
    const big = 'x'.repeat(PROVIDER_FETCH_LIMITS.maxRequestBytes + 1);
    expect(await codeOf(viaStub()(MESSAGES, post(big)))).toBe('too_large');
    expect(stub.seen).toEqual([]);
  });

  it('a response over 2 MiB is too_large, counted while it streams', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = Buffer.alloc(64 * 1024, 'a');
      let sent = 0;
      const pump = () => {
        while (sent <= PROVIDER_FETCH_LIMITS.maxResponseBytes) {
          sent += chunk.length;
          if (!res.write(chunk)) return res.once('drain', pump);
        }
        res.end();
      };
      pump();
    });
    const res = await viaStub()(MESSAGES, post());
    expect(await codeOf(res.arrayBuffer())).toBe('too_large');
  });

  it('a declared length over 2 MiB is refused at once', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-length': String(PROVIDER_FETCH_LIMITS.maxResponseBytes + 1) });
      res.end();
    });
    expect(await codeOf(viaStub()(MESSAGES, post()))).toBe('too_large');
  });

  it('no byte for the idle limit is a timeout, before and during the body (15 s in production)', async () => {
    expect(PROVIDER_FETCH_LIMITS.idleMs).toBe(15_000);
    stub.queue.push(() => undefined); // never answers
    expect(await codeOf(viaStub({ idleMs: 150 })(MESSAGES, post()))).toBe('timeout');
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: ping\n\n'); // then silence
    });
    const res = await viaStub({ idleMs: 150 })(MESSAGES, post());
    expect(await codeOf(res.text())).toBe('timeout');
  });

  it('a stream that keeps dripping still ends at the backstop (the longest tier’s 40 s)', async () => {
    expect(PROVIDER_FETCH_LIMITS.maxCallMs).toBe(40_000);
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const t = setInterval(() => res.write(': keep-alive\n\n'), 20);
      res.on('close', () => clearInterval(t));
    });
    const res = await viaStub({ idleMs: 1_000, maxCallMs: 200 })(MESSAGES, post());
    expect(await codeOf(res.text())).toBe('timeout');
  });

  it('the caller’s abort ends the call and closes the socket', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: ping\n\n');
    });
    const ac = new AbortController();
    const res = await viaStub()(MESSAGES, { ...post(), signal: ac.signal });
    const closedBefore = stub.closed;
    const reading = res.text().then(
      () => 'ok',
      (e: Error) => e.name,
    );
    ac.abort();
    expect(await reading).toBe('AbortError');
    await new Promise((r) => setTimeout(r, 50));
    expect(stub.closed).toBeGreaterThan(closedBefore);
  });
});

describe('the seams', () => {
  it('the production fetch takes the key only, and needs a well-formed one', () => {
    expect(createProviderFetch.length).toBe(1);
    expect(() => createProviderFetch('')).toThrow();
    for (const bad of [`${KEY}\n`, `${KEY}\x01`, `${KEY}\0`, 'with a space key', `${KEY}é`])
      expect(() => createProviderFetch(bad)).toThrow(/well-formed/);
  });

  it('the test fetch is refused anywhere deployed', () => {
    for (const source of [{ VERCEL_ENV: 'preview' }, { VERCEL: '1' }, { NODE_ENV: 'production' }])
      expect(() => createProviderFetchForTests(KEY, { stubPort: stub.port }, source)).toThrow(
        /local and CI/,
      );
  });

  it('no error carries the key, a header or a body', async () => {
    stub.queue.push((_req, res) => {
      res.writeHead(302, { location: `https://evil.example.test/?k=${KEY}` });
      res.end('body with secret-body-fragment');
    });
    try {
      await viaStub()(MESSAGES, post('{"secret":"request-body-fragment"}'));
      expect.unreachable();
    } catch (e) {
      const text = [String(e), JSON.stringify(e), (e as Error).message].join(' ');
      for (const s of [KEY, 'secret-body-fragment', 'request-body-fragment', 'evil.example.test'])
        expect(text).not.toContain(s);
    }
  });
});

describe('I6: a malformed key never crashes the process', () => {
  const uncaught: unknown[] = [];
  const trap = (e: unknown) => uncaught.push(e);
  beforeEach(() => {
    uncaught.length = 0;
    process.on('uncaughtException', trap);
  });
  afterEach(() => {
    process.off('uncaughtException', trap);
    vi.useRealTimers();
  });

  // Synthetic keys with each kind of character Node refuses in a header.
  const MALFORMED = [
    ['a control character', 'test-only-\x01-not-a-key'],
    ['DEL', 'test-only-\x7f-not-a-key'],
    ['a line feed', 'test-only-\n-not-a-key'],
    ['CR LF', 'test-only-\r\n-not-a-key'],
    ['NUL', 'test-only-\0-not-a-key'],
    ['a character outside Latin-1', 'test-only-\u20ac-not-a-key'],
  ] as const;

  it.each(MALFORMED)(
    'given %s directly (bypassing env): fails closed (`auth`), arms no timer, sends nothing',
    async (_label, bad) => {
      vi.useFakeTimers();
      const f = createProviderFetchForTests(bad, { stubPort: stub.port });
      const ac = new AbortController();
      let error: unknown;
      try {
        await f(MESSAGES, {
          ...post(),
          headers: { ...post().headers, 'x-api-key': bad },
          signal: ac.signal,
        });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ProviderNetError);
      expect((error as ProviderNetError).code).toBe('auth');
      expect((error as ProviderNetError).sent).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      // Past the idle limit and the 40 s backstop: nothing fires, nothing throws.
      expect(() => vi.advanceTimersByTime(PROVIDER_FETCH_LIMITS.maxCallMs + 1_000)).not.toThrow();
      ac.abort();
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));
      expect(uncaught).toEqual([]);
      expect(stub.seen).toEqual([]);
      const text = [String(error), JSON.stringify(error), (error as Error).message].join(' ');
      expect(text).not.toContain('test-only');
    },
  );
});
