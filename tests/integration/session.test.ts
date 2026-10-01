import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';
import { buildAuth, getAuth, type Auth } from '@/trust/auth';
import { TEST_APP_DATABASE_URL } from '../env';
import { testDb } from './db';

// Session lifetime (contract §3.A) and production cookie attributes (§2.5),
// both proven in-process against the real Better Auth handler.

const { db, close } = testDb();
afterAll(close);

const SAM = 'sam@example.test';

/** Request a link through `auth`, capture it, follow it with auth.handler. */
async function signInWith(auth: Auth, host: string): Promise<Response> {
  const links: string[] = [];
  captured.push(links);
  await auth.api.signInMagicLink({
    body: { email: SAM, callbackURL: '/today' },
    headers: new Headers({ host, 'x-real-ip': '203.0.113.1' }),
  });
  const link = links.at(-1) ?? (await lastTestMailboxLink());
  if (!link) throw new Error('no magic link captured');
  return auth.handler(new Request(link, { headers: { host } }));
}

const captured: string[][] = [];
async function lastTestMailboxLink(): Promise<string | null> {
  const { readFile } = await import('node:fs/promises');
  const { TEST_MAILBOX_PATH } = await import('@/trust/mail');
  try {
    const raw = await readFile(TEST_MAILBOX_PATH, 'utf8');
    const last = raw.split('\n').filter(Boolean).at(-1);
    return last ? (JSON.parse(last).text.match(/https?:\/\/\S+/)?.[0] ?? null) : null;
  } catch {
    return null;
  }
}

const cookieFrom = (res: Response, name: string) => {
  const all = res.headers.getSetCookie();
  return all.find((c) => c.startsWith(`${name}=`)) ?? null;
};

beforeAll(async () => {
  await db.execute(sql`delete from rate_limit`);
  await db.execute(sql`delete from verification`);
  await db.execute(sql`delete from session`);
});

describe('fixed 30-day sessions (§3.A)', () => {
  it('does not extend expires_at when the session is used after more than a day', async () => {
    const auth = getAuth();
    const res = await signInWith(auth, 'localhost:3000');
    const cookie = cookieFrom(res, 'home.session_token');
    expect(cookie).toBeTruthy();

    const token = (
      await db.execute<{ token: string }>(
        sql`select token from session order by created_at desc limit 1`,
      )
    ).rows[0]?.token;
    expect(token).toBeTruthy();
    // Raw rows keep timestamps as strings; compare them as instants.
    const [before] = (
      await db.execute<{ expires_at: string }>(
        sql`update session
            set updated_at = updated_at - interval '2 days',
                created_at = created_at - interval '2 days',
                expires_at = expires_at - interval '2 days'
            where token = ${token} returning expires_at`,
      )
    ).rows;

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie?.split(';')[0] ?? '', host: 'localhost:3000' }),
    });
    expect(session?.user.email).toBe(SAM);

    const [after] = (
      await db.execute<{ expires_at: string }>(
        sql`select expires_at from session where token = ${token}`,
      )
    ).rows;
    const at = (v: string | undefined) => new Date(v ?? 0).getTime();
    expect(at(after?.expires_at)).toBe(at(before?.expires_at));
    // 28 days left: 30 from the (simulated) sign-in two days ago, not from this use.
    const lifetime = at(after?.expires_at) - Date.now();
    expect(lifetime).toBeGreaterThan(27 * 86_400_000);
    expect(lifetime).toBeLessThan(29 * 86_400_000);
  });
});

describe('production cookie attributes (§2.5)', () => {
  it('sets __Secure-home.session_token with HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=30 days and no Domain', async () => {
    const sent: string[] = [];
    const prodEnv = parseEnv({
      NODE_ENV: 'production',
      DATABASE_URL: TEST_APP_DATABASE_URL,
      BETTER_AUTH_SECRET: 'p'.repeat(48),
      BETTER_AUTH_URL: 'https://home.example.test',
      HOME_ALLOWED_EMAILS: 'sam@example.test,alex@example.test',
      HOME_MAIL_TRANSPORT: 'provider',
      MAIL_API_KEY: 'k'.repeat(20),
      MAIL_FROM: 'home@auth.example.test',
      AUDIT_HASH_SECRET: 'a'.repeat(48),
    });
    const auth = buildAuth({
      env: prodEnv,
      db,
      sendMail: async (mail) => {
        const url = mail.text.match(/https?:\/\/\S+/)?.[0];
        if (url) sent.push(url);
      },
    });
    captured.length = 0;
    await auth.api.signInMagicLink({
      body: { email: SAM, callbackURL: '/today' },
      headers: new Headers({ host: 'home.example.test', 'x-real-ip': '203.0.113.2' }),
    });
    const link = sent.at(-1);
    expect(link).toMatch(/^https:\/\/home\.example\.test\/api\/auth\/magic-link\/verify\?token=/);
    const res = await auth.handler(
      new Request(link ?? '', { headers: { host: 'home.example.test' } }),
    );
    expect([302, 303, 307]).toContain(res.status);

    const cookie = cookieFrom(res, '__Secure-home.session_token');
    expect(cookie).toBeTruthy();
    const attrs = (cookie ?? '')
      .split(';')
      .slice(1)
      .map((a) => a.trim().toLowerCase());
    expect(attrs).toContain('httponly');
    expect(attrs).toContain('secure');
    expect(attrs).toContain('samesite=lax');
    expect(attrs).toContain('path=/');
    expect(attrs).toContain('max-age=2592000');
    expect(attrs.some((a) => a.startsWith('domain='))).toBe(false);
  });
});
