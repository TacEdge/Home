import 'server-only';
import tls from 'node:tls';

// TLS for the provider (M8 contract §5.4; ADR 0012 §43, I1). Every provider
// request verifies the server against Node's **bundled** Mozilla roots and
// nothing else, whatever the environment says:
//
// - `ca: tls.rootCertificates`: an explicit CA list replaces Node's default
//   store, so neither NODE_EXTRA_CA_CERTS nor `--use-openssl-ca` /
//   `--use-system-ca` (with SSL_CERT_FILE and friends) can add a root for
//   this request; `tls.rootCertificates` is the bundled snapshot, which
//   those never extend;
// - `rejectUnauthorized: true`, explicitly, so NODE_TLS_REJECT_UNAUTHORIZED=0
//   (which only changes the default) cannot turn verification off;
// - `servername` and Node's own `tls.checkServerIdentity`, so the
//   certificate must name api.anthropic.com;
// - TLS 1.2 at least, whatever `--tls-min-v1.0` says;
// - each request on a fresh `agent: false` connection (fetch.ts), so no
//   shared agent's options apply.
//
// Kept apart from fetch.ts, with only `node:tls` imported, so a child
// process can load it under each of those environment settings and prove
// the options hold (tests/unit/kev-tls.test.ts).

export const PROVIDER_TLS_HOST = 'api.anthropic.com';

export type ProviderTlsOptions = Readonly<{
  ca: readonly string[];
  rejectUnauthorized: true;
  servername: string;
  checkServerIdentity: typeof tls.checkServerIdentity;
  minVersion: 'TLSv1.2';
}>;

/** The production TLS options for every provider request. Takes nothing: nothing can widen them. */
export function providerTlsOptions(): ProviderTlsOptions {
  return Object.freeze({
    ca: tls.rootCertificates,
    rejectUnauthorized: true as const,
    servername: PROVIDER_TLS_HOST,
    checkServerIdentity: tls.checkServerIdentity,
    minVersion: 'TLSv1.2' as const,
  });
}
