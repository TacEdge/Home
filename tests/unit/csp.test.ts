import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, newNonce } from '@/lib/csp';

// The Content-Security-Policy (ADR 0003 §9, M4 Package 1): scripts only with
// the request's nonce, nothing broad, every other directive as narrow as
// HOME's own origin allows.

const directives = (policy: string) =>
  new Map(
    policy.split('; ').map((d) => {
      const [name, ...values] = d.split(' ');
      return [name!, values] as const;
    }),
  );
const BROAD = ["'unsafe-inline'", "'unsafe-hashes'", '*', 'http:', 'https:', 'data:', 'blob:'];

describe('newNonce', () => {
  it('is 128 random bits in base64, and never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const n = newNonce();
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(atob(n)).toHaveLength(16);
      seen.add(n);
    }
    expect(seen.size).toBe(5000);
  });
});

describe('contentSecurityPolicy, production', () => {
  const nonce = 'AAAAAAAAAAAAAAAAAAAAAA==';
  const d = directives(contentSecurityPolicy(nonce));

  it('scripts run only with this nonce, and may load what a nonced script loads', () => {
    expect(d.get('script-src')).toEqual([`'nonce-${nonce}'`, "'strict-dynamic'"]);
  });

  it('allows nothing broad for scripts, ever', () => {
    for (const v of [...BROAD, "'unsafe-eval'", "'self'"])
      expect(d.get('script-src'), v).not.toContain(v);
    expect(d.has('script-src-elem')).toBe(false);
    expect(d.has('script-src-attr')).toBe(false);
  });

  it('keeps every other directive to HOME itself, or to nothing', () => {
    expect(Object.fromEntries(d)).toEqual({
      'default-src': ["'self'"],
      'script-src': [`'nonce-${nonce}'`, "'strict-dynamic'"],
      'style-src': ["'self'", `'nonce-${nonce}'`],
      'img-src': ["'self'"],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'manifest-src': ["'self'"],
      'media-src': ["'none'"],
      'worker-src': ["'none'"],
      'frame-src': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': [],
    });
    for (const [name, values] of d)
      for (const v of BROAD) expect(values, `${name} ${v}`).not.toContain(v);
  });
});

describe('contentSecurityPolicy, next dev', () => {
  it("adds only 'unsafe-eval' for React's development stacks, and no https upgrade on plain http", () => {
    const nonce = newNonce();
    const prod = directives(contentSecurityPolicy(nonce));
    const dev = directives(contentSecurityPolicy(nonce, { dev: true }));
    expect(dev.get('script-src')).toEqual([...prod.get('script-src')!, "'unsafe-eval'"]);
    expect(dev.has('upgrade-insecure-requests')).toBe(false);
    for (const [name, values] of dev)
      if (name !== 'script-src') expect(values, name).toEqual(prod.get(name));
  });
});
