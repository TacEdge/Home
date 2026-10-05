// node scripts/check-csp.mts <database-url> — the production CSP (ADR 0003 §9,
// M4 Package 1), checked against `next start` on the built app, because the
// e2e suite runs `next dev`, whose policy also allows 'unsafe-eval'. Needs
// `pnpm build` first and a reachable database. For each page: the header is
// exactly src/lib/csp.ts's production policy for the nonce it carries, the
// nonce is new on every response, every <script> in the document carries it,
// nothing has a style attribute, and the other security headers are present.
// Never prints a nonce.

import { spawn } from 'node:child_process';
import { contentSecurityPolicy } from '../src/lib/csp.ts';

const dbUrl = process.argv[2] ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('check-csp: pass the database URL as the first argument.');
  process.exit(2);
}
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  DATABASE_URL: dbUrl,
  BETTER_AUTH_SECRET: 'csp-check-secret-'.repeat(3),
  BETTER_AUTH_URL: 'https://home.example.test',
  HOME_ALLOWED_EMAILS: 'sam@example.test',
  HOME_MAIL_TRANSPORT: 'provider',
  MAIL_API_KEY: 'csp-check-not-a-real-key',
  MAIL_FROM: 'home@auth.example.test',
  AUDIT_HASH_SECRET: 'csp-check-audit-'.repeat(3),
};
const PORT = 3125;
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (msg: string): never => {
  console.error(`check-csp: ${msg}`);
  process.exit(1);
};

const server = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PORT)], {
  env,
  stdio: 'ignore',
});
try {
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try {
      await fetch(`${base}/sign-in`);
      up = true;
    } catch {
      await sleep(300);
    }
  }
  if (!up) fail('the production server did not start.');

  const seen = new Set<string>();
  const pages: [string, boolean][] = [
    ['/sign-in', true],
    ['/sign-in', true],
    ['/nothing-here', true],
    ['/today', false], // redirects to sign-in when signed out: still a policy
    ['/robots.txt', false],
  ];
  for (const [path, document] of pages) {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    const policy = res.headers.get('content-security-policy');
    if (!policy) fail(`${path}: no CSP`);
    const nonce = /'nonce-([A-Za-z0-9+/]{22}==)'/.exec(policy!)?.[1];
    if (!nonce) fail(`${path}: no nonce`);
    if (seen.has(nonce!)) fail(`${path}: a nonce was reused`);
    seen.add(nonce!);
    if (policy !== contentSecurityPolicy(nonce!))
      fail(`${path}: the policy is not the production policy for its nonce`);
    const fixed: [string, string][] = [
      ['x-frame-options', 'DENY'],
      ['x-content-type-options', 'nosniff'],
      ['referrer-policy', 'same-origin'],
    ];
    for (const [h, want] of fixed)
      if (res.headers.get(h) !== want) fail(`${path}: ${h} missing or changed`);
    if (!res.headers.get('strict-transport-security')?.includes('max-age='))
      fail(`${path}: strict-transport-security missing`);
    if (res.headers.get('x-powered-by')) fail(`${path}: x-powered-by present`);
    if (document) {
      const html = await res.text();
      const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      if (scripts.length === 0) fail(`${path}: no scripts found to check`);
      if (scripts.some((s) => !s.includes(` nonce="${nonce}"`)))
        fail(`${path}: a script without this response's nonce`);
      if (/<[a-z][^>]* style="/i.test(html)) fail(`${path}: an inline style attribute`);
    }
  }
  console.log(
    `check-csp: ${pages.length} responses carry the production policy with their own nonce; every script is nonced.`,
  );
} finally {
  server.kill('SIGTERM');
  await sleep(200);
  server.kill('SIGKILL');
}
