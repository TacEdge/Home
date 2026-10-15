import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Throwaway certificates for the provider TLS tests (M8 contract §5.4; ADR
// 0012 §43, I1), made with the `openssl` CLI into a temporary directory at
// test time and deleted afterwards: nothing is committed, so no key material
// is ever in the repository. EC P-256, valid for two days, synthetic names.
//
// - `trusted`: the test CA the seam is given in place of the public roots;
// - `attacker`: a CA nobody trusts (planted through NODE_EXTRA_CA_CERTS or
//   SSL_CERT_FILE in the environment tests);
// - leaves: `good` (trusted, api.anthropic.com), `wrongName` (trusted,
//   another name), `evil` (attacker, api.anthropic.com), `selfSigned`
//   (api.anthropic.com, no CA), `viaIntermediate` (an intermediate under the
//   attacker's root; served with its chain).

export type Leaf = { key: string; cert: string };
export type Certs = {
  dir: string;
  trustedCa: string;
  attackerCa: string;
  attackerCaPath: string;
  good: Leaf;
  wrongName: Leaf;
  evil: Leaf;
  selfSigned: Leaf;
  viaIntermediate: Leaf;
  cleanup(): void;
};

export function makeCerts(): Certs {
  const dir = mkdtempSync(join(tmpdir(), 'home-kev-tls-'));
  const p = (n: string) => join(dir, n);
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  const key = (n: string) =>
    ssl(
      'genpkey',
      '-algorithm',
      'EC',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-out',
      p(`${n}.key`),
    );
  const ca = (n: string) => {
    key(n);
    ssl(
      'req',
      '-x509',
      '-new',
      '-key',
      p(`${n}.key`),
      '-subj',
      `/CN=home-test-${n}`,
      '-days',
      '2',
      '-out',
      p(`${n}.crt`),
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    );
  };
  const issue = (n: string, issuer: string, ext: string, cn: string) => {
    key(n);
    ssl('req', '-new', '-key', p(`${n}.key`), '-subj', `/CN=${cn}`, '-out', p(`${n}.csr`));
    writeFileSync(p(`${n}.ext`), ext);
    ssl(
      'x509',
      '-req',
      '-in',
      p(`${n}.csr`),
      '-CA',
      p(`${issuer}.crt`),
      '-CAkey',
      p(`${issuer}.key`),
      '-CAcreateserial',
      '-days',
      '2',
      '-out',
      p(`${n}.crt`),
      '-extfile',
      p(`${n}.ext`),
    );
  };
  const leafExt = (name: string) =>
    `subjectAltName=DNS:${name}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`;
  ca('trusted');
  ca('attacker');
  issue('good', 'trusted', leafExt('api.anthropic.com'), 'api.anthropic.com');
  issue('wrongname', 'trusted', leafExt('other.example.test'), 'other.example.test');
  issue('evil', 'attacker', leafExt('api.anthropic.com'), 'api.anthropic.com');
  issue(
    'inter',
    'attacker',
    'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n',
    'home-test-inter',
  );
  issue('viainter', 'inter', leafExt('api.anthropic.com'), 'api.anthropic.com');
  key('self');
  ssl(
    'req',
    '-x509',
    '-new',
    '-key',
    p('self.key'),
    '-subj',
    '/CN=api.anthropic.com',
    '-days',
    '2',
    '-out',
    p('self.crt'),
    '-addext',
    'subjectAltName=DNS:api.anthropic.com',
  );
  const r = (n: string) => readFileSync(p(n), 'utf8');
  const leaf = (n: string, chain = ''): Leaf => ({
    key: r(`${n}.key`),
    cert: r(`${n}.crt`) + chain,
  });
  return {
    dir,
    trustedCa: r('trusted.crt'),
    attackerCa: r('attacker.crt'),
    attackerCaPath: p('attacker.crt'),
    good: leaf('good'),
    wrongName: leaf('wrongname'),
    evil: leaf('evil'),
    selfSigned: leaf('self'),
    viaIntermediate: leaf('viainter', r('inter.crt')),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
