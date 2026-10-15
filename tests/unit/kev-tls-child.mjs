// A child process for tests/unit/kev-tls.test.ts (ADR 0012 §43, I1). Run by
// plain Node (`--conditions=react-server`, so `server-only` is inert) with
// the environment under test: NODE_EXTRA_CA_CERTS, SSL_CERT_FILE with
// `--use-openssl-ca`, NODE_TLS_REJECT_UNAUTHORIZED. These are read when Node
// starts, so they can only be tested in a process of their own.
//
// It serves the attacker-signed api.anthropic.com certificate on 127.0.0.1,
// then connects twice: with Node's defaults (the control: the environment
// makes Node trust it) and with HOME's production TLS options from
// src/kev/providers/tls.ts (which must refuse it). It prints one JSON line.
import https from 'node:https';
import tls from 'node:tls';
import { providerTlsOptions } from '../../src/kev/providers/tls.ts';

const [key, cert] = [process.env.CHILD_KEY ?? '', process.env.CHILD_CERT ?? ''];
const server = https.createServer({ key, cert }, (_req, res) => res.end('ok'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const attempt = (options) =>
  new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        port,
        path: '/',
        method: 'GET',
        agent: false,
        lookup: (_h, o, cb) =>
          o && o.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4),
        ...options,
      },
      (res) => {
        res.resume();
        resolve('accepted');
      },
    );
    req.on('error', (e) => resolve(`refused:${e.code ?? 'unknown'}`));
    req.end();
  });

const options = providerTlsOptions();
const result = {
  defaults: await attempt({ servername: 'api.anthropic.com' }),
  home: await attempt({ ...options }),
  rootsIncludeAttacker: tls.rootCertificates.some(
    (c) => c.trim() === (process.env.CHILD_CA ?? '').trim(),
  ),
  rejectUnauthorized: options.rejectUnauthorized,
};
server.close();
process.stdout.write(JSON.stringify(result) + '\n');
