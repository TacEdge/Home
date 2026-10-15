import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createProviderFetch,
  createProviderFetchForTests,
  ProviderNetError,
} from '@/kev/providers/fetch';
import { providerTlsOptions } from '@/kev/providers/tls';
import { makeCerts, type Certs, type Leaf } from './kev-tls-certs';

// TLS for the provider (M8 contract §5.4; ADR 0012 §43, I1). Provider
// requests verify against Node's bundled public roots only, with the
// hostname checked, whatever the environment says. Local TLS servers on
// 127.0.0.1 with throwaway certificates (./kev-tls-certs.ts); the seam's
// only difference from production is the test CA it trusts in place of the
// public roots, and the production constructor accepts no such option. No
// test reaches the network.

const KEY = 'test-only-not-a-key';
const MESSAGES = 'https://api.anthropic.com/v1/messages';
const post = () => ({
  method: 'POST',
  headers: { 'x-api-key': KEY, 'content-type': 'application/json', accept: 'application/json' },
  body: '{}',
});

let certs: Certs;
const servers: https.Server[] = [];
const ports: Record<string, number> = {};
const reached: Record<string, number> = {};

async function serve(name: string, leaf: Leaf) {
  const server = https.createServer({ key: leaf.key, cert: leaf.cert }, (req, res) => {
    reached[name] = (reached[name] ?? 0) + 1;
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  servers.push(server);
  ports[name] = (server.address() as AddressInfo).port;
}

beforeAll(async () => {
  certs = makeCerts();
  await serve('good', certs.good);
  await serve('wrongName', certs.wrongName);
  await serve('evil', certs.evil);
  await serve('selfSigned', certs.selfSigned);
  await serve('viaIntermediate', certs.viaIntermediate);
});
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  certs.cleanup();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const viaTls = (name: string) =>
  createProviderFetchForTests(KEY, { tlsStub: { port: ports[name]!, ca: certs.trustedCa } });
const outcome = async (name: string) => {
  try {
    const res = await viaTls(name)(MESSAGES, post());
    await res.text();
    return `ok ${res.status}`;
  } catch (e) {
    if (!(e instanceof ProviderNetError)) return `other: ${String(e)}`;
    return `${e.code}${e.retryable ? ' (retryable)' : ''}`;
  }
};

describe('I1: certificates, through HOME’s fetch', () => {
  it('a trusted chain naming api.anthropic.com succeeds', async () => {
    expect(await outcome('good')).toBe('ok 200');
    expect(reached.good).toBe(1);
  });

  it.each([
    ['a certificate for another name, under the CA the seam trusts', 'wrongName'],
    ['a self-signed certificate', 'selfSigned'],
    ['a chain through an untrusted intermediate', 'viaIntermediate'],
    ['a certificate from a CA HOME does not trust', 'evil'],
  ])('%s is refused (unreachable, never retried), and no request reaches it', async (_l, name) => {
    expect(await outcome(name)).toBe('unreachable');
    expect(reached[name]).toBeUndefined();
  });

  it('NODE_TLS_REJECT_UNAUTHORIZED=0 changes nothing for HOME: still refused', async () => {
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    // The control: in this process, the setting does make Node's defaults accept it.
    const control = await new Promise<string>((resolve) => {
      const req = https.request(
        { host: '127.0.0.1', port: ports.evil, servername: 'api.anthropic.com', agent: false },
        (res) => {
          res.resume();
          resolve('accepted');
        },
      );
      req.on('error', () => resolve('refused'));
      req.end();
    });
    expect(control).toBe('accepted');
    for (const name of ['evil', 'selfSigned', 'wrongName', 'viaIntermediate'])
      expect(await outcome(name), name).toBe('unreachable');
    expect(await outcome('good')).toBe('ok 200');
  });

  it('no error carries a certificate, a host or the key', async () => {
    try {
      await viaTls('evil')(MESSAGES, post());
      expect.unreachable();
    } catch (e) {
      const text = [String(e), JSON.stringify(e), (e as Error).message].join(' ');
      for (const s of [KEY, '127.0.0.1', 'BEGIN', 'home-test', 'UNABLE', 'CERT'])
        expect(text).not.toContain(s);
      expect((e as ProviderNetError).code).toBe('unreachable');
    }
  });
});

describe('I1: the production constructor’s TLS cannot be widened', () => {
  /** Captures the options HOME passes to https.request, without any network. */
  function captureOptions(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      vi.spyOn(https, 'request').mockImplementation(((opts: Record<string, unknown>) => {
        resolve(opts);
        const req = new EventEmitter() as EventEmitter & { end(): void; destroy(): void };
        req.end = () =>
          setImmediate(() =>
            req.emit('error', Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
          );
        req.destroy = () => undefined;
        return req;
      }) as never);
    });
  }

  it('Node’s bundled roots, verification on, the hostname checked, a fresh connection: whatever the environment says', async () => {
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    vi.stubEnv('NODE_EXTRA_CA_CERTS', certs.attackerCaPath);
    vi.stubEnv('SSL_CERT_FILE', certs.attackerCaPath);
    const captured = captureOptions();
    // Extra arguments are ignored: the constructor takes the key alone.
    const f = (createProviderFetch as unknown as (k: string, o: unknown) => typeof fetch)(KEY, {
      ca: certs.attackerCa,
      rejectUnauthorized: false,
      agent: new https.Agent({ rejectUnauthorized: false }),
    });
    const failed = f(MESSAGES, post() as never).catch((e: unknown) => e);
    const o = await captured;
    expect(o.ca).toBe(tls.rootCertificates);
    expect(o).toMatchObject({
      rejectUnauthorized: true,
      servername: 'api.anthropic.com',
      hostname: 'api.anthropic.com',
      port: 443,
      minVersion: 'TLSv1.2',
      agent: false,
    });
    expect(o.checkServerIdentity).toBe(tls.checkServerIdentity);
    expect(o).not.toHaveProperty('secureContext');
    expect(o).not.toHaveProperty('pfx');
    expect(tls.rootCertificates).not.toContain(certs.attackerCa);
    expect(((await failed) as ProviderNetError).code).toBe('unreachable');
    expect(createProviderFetch.length).toBe(1);
    expect(providerTlsOptions.length).toBe(0);
    expect(Object.isFrozen(providerTlsOptions())).toBe(true);
  });

  // NODE_EXTRA_CA_CERTS and --use-openssl-ca are read when Node starts, so
  // each runs in a child process: Node's defaults accept the attacker's
  // certificate there (the control), and HOME's production options refuse it.
  const child = fileURLToPath(new URL('./kev-tls-child.mjs', import.meta.url));
  const run = (env: Record<string, string>, flags: string[] = []) => {
    const out = spawnSync(
      process.execPath,
      ['--conditions=react-server', '--no-warnings', ...flags, child],
      {
        env: {
          PATH: process.env.PATH ?? '',
          CHILD_KEY: certs.evil.key,
          CHILD_CERT: certs.evil.cert,
          CHILD_CA: certs.attackerCa,
          ...env,
        } as unknown as NodeJS.ProcessEnv,
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    if (out.status !== 0) throw new Error(`child failed: ${out.stderr}`);
    return JSON.parse(out.stdout.trim().split('\n').at(-1)!) as {
      defaults: string;
      home: string;
      rootsIncludeAttacker: boolean;
      rejectUnauthorized: boolean;
    };
  };

  it.each([
    [
      'NODE_EXTRA_CA_CERTS pointing at an attacker CA',
      () => ({ NODE_EXTRA_CA_CERTS: certs.attackerCaPath }),
      [],
    ],
    [
      '--use-openssl-ca with SSL_CERT_FILE pointing at an attacker CA',
      () => ({ SSL_CERT_FILE: certs.attackerCaPath }),
      ['--use-openssl-ca'],
    ],
    [
      'NODE_EXTRA_CA_CERTS and NODE_TLS_REJECT_UNAUTHORIZED=0 together',
      () => ({ NODE_EXTRA_CA_CERTS: certs.attackerCaPath, NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
      [],
    ],
  ] as const)('%s: refused', (_l, env, flags) => {
    const r = run(env(), [...flags]);
    expect(r.defaults).toBe('accepted');
    expect(r.home).toMatch(/^refused:/);
    expect(r.rootsIncludeAttacker).toBe(false);
    expect(r.rejectUnauthorized).toBe(true);
  });
});
