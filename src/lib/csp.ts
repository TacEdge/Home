// The Content-Security-Policy (ADR 0003 §9, M4 contract Package 1, ADR 0007
// §10). Scripts run only with this request's nonce ('strict-dynamic' lets a
// nonced script load the chunks it needs); nothing inline without the nonce,
// no eval in production, no other origin anywhere. HOME loads nothing from
// another origin today, so every fetch directive is 'self' or 'none'. Pure:
// the proxy (src/proxy.ts) calls it once per request.

/** A fresh nonce: 128 random bits, base64. Never logged, never reused. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * The policy for one response. `dev` adds only what `next dev` needs and
 * production never has: 'unsafe-eval' (React's development stack traces)
 * and no upgrade-insecure-requests (the dev server is plain http).
 */
export function contentSecurityPolicy(nonce: string, opts: { dev?: boolean } = {}): string {
  const dev = opts.dev ?? false;
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    ['script-src', `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ['style-src', "'self'", `'nonce-${nonce}'`],
    ['img-src', "'self'"],
    ['font-src', "'self'"],
    ['connect-src', "'self'"],
    ['manifest-src', "'self'"],
    ['media-src', "'none'"],
    ['worker-src', "'none'"],
    ['frame-src', "'none'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ...(dev ? [] : ([['upgrade-insecure-requests']] as [string][])),
  ];
  return directives.map((d) => d.join(' ')).join('; ');
}
