import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  it('approves POST /v1/messages and GET /v1/models/{id} on https://api.anthropic.com only', () => {
    const ok = (u: string, m: string) => approveDestination(new URL(u), m);
    expect(ok(MESSAGES, 'POST')).toBe(true);
    expect(ok('https://api.anthropic.com/v1/models/model-id-1', 'GET')).toBe(true);
    for (const [u, m] of [
      ['https://api.anthropic.com/v1/messages', 'GET'],
      ['https://api.anthropic.com/v1/messages', 'PUT'],
      ['https://api.anthropic.com/v1/messages/batches', 'POST'],
      ['https://api.anthropic.com/v1/messages/count_tokens', 'POST'],
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
  it('the production fetch takes the key only, and needs one', () => {
    expect(createProviderFetch.length).toBe(1);
    expect(() => createProviderFetch('')).toThrow();
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
