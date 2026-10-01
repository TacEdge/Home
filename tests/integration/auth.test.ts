import { readFile, rm } from 'node:fs/promises';
import { desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, session as sessionTable, user as userTable } from '@/db/schema';
import { getAuth } from '@/trust/auth';
import { TEST_MAILBOX_PATH } from '@/trust/mail';
import { testDb } from './db';

// Exercises Better Auth as configured in src/trust/auth.ts against the test
// database, with the test mail transport. Never sends real mail.

const { db, close } = testDb();
afterAll(close);
const auth = getAuth();

const ALLOWED = 'sam@example.test';
const OUTSIDER = 'someone-else@example.test';

let ipCounter = 0;
const headersFor = (ip?: string) =>
  new Headers({ 'x-forwarded-for': ip ?? `10.0.0.${++ipCounter}`, host: 'localhost:3000' });

async function mailbox(): Promise<Array<{ to: string; text: string }>> {
  try {
    const raw = await readFile(TEST_MAILBOX_PATH, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { to: string; text: string });
  } catch {
    return [];
  }
}

const linkFrom = (text: string) => text.match(/https?:\/\/\S+/)?.[0];
const tokenFrom = (url: string) => new URL(url).searchParams.get('token');

async function requestLink(email: string, ip?: string) {
  return auth.api.signInMagicLink({
    body: { email, callbackURL: '/today' },
    headers: headersFor(ip),
  });
}

beforeAll(async () => {
  await db.execute(sql`delete from "rate_limit"`);
  await db.execute(sql`delete from "verification"`);
  await db.execute(sql`delete from "session"`);
  await db.execute(sql`delete from "user"`);
});
beforeEach(async () => {
  await rm(TEST_MAILBOX_PATH, { force: true });
});

describe('magic-link sign-in', () => {
  it('sends a link to an allowlisted address and audits the request', async () => {
    const res = await requestLink(ALLOWED);
    expect(res).toEqual({ status: true });
    const mails = await mailbox();
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe(ALLOWED);
    expect(linkFrom(mails[0]?.text ?? '')).toContain('/api/auth/magic-link/verify?token=');

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.event, 'auth.link_requested'))
      .orderBy(desc(auditLog.at))
      .limit(1);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain(ALLOWED);
  });

  it('gives an outsider the same response, sends nothing, and audits a hash only', async () => {
    const res = await requestLink(OUTSIDER);
    expect(res).toEqual({ status: true });
    expect(await mailbox()).toHaveLength(0);

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.event, 'auth.sign_in_denied'))
      .orderBy(desc(auditLog.at))
      .limit(1);
    expect(entry?.meta).toMatchObject({ stage: 'link_request' });
    expect((entry?.meta as { emailHash: string }).emailHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(entry)).not.toContain('someone-else');

    const users = await db.select().from(userTable).where(eq(userTable.email, OUTSIDER));
    expect(users).toHaveLength(0);
  });

  it('refuses to create a user for an address outside the household (layer 2)', async () => {
    const before = auth.options.databaseHooks?.user?.create?.before;
    expect(before).toBeTypeOf('function');
    const result = await before?.({
      id: 'u-x',
      email: OUTSIDER,
      name: '',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result).toBe(false);
  });

  it('verifies a fresh link once, creating a session and auditing the sign-in; the link is then dead', async () => {
    await requestLink(ALLOWED);
    const url = linkFrom((await mailbox())[0]?.text ?? '');
    const token = url ? tokenFrom(url) : null;
    expect(token).toBeTruthy();

    const verified = await auth.api.magicLinkVerify({
      query: { token: token ?? '' },
      headers: headersFor(),
    });
    expect(verified.user.email).toBe(ALLOWED);
    expect(verified.token).toBeTruthy();

    const sessions = await db.select().from(sessionTable);
    expect(sessions.length).toBeGreaterThan(0);
    const [signIn] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.event, 'auth.sign_in'))
      .orderBy(desc(auditLog.at))
      .limit(1);
    expect(signIn?.actorUserId).toBe(verified.user.id);

    // Single use: the same token must not mint a second session.
    await expect(
      auth.api.magicLinkVerify({ query: { token: token ?? '' }, headers: headersFor() }),
    ).rejects.toThrow();
  });

  it('limits link requests per IP to 5 per 15 minutes, across emails', async () => {
    await db.execute(sql`delete from "rate_limit"`);
    for (let i = 0; i < 7; i++)
      await requestLink(i % 2 ? ALLOWED : 'alex@example.test', '10.2.2.2');
    expect(await mailbox()).toHaveLength(5);
  });

  it('limits link requests per email to 5 per 15 minutes, independent of IP', async () => {
    await db.execute(sql`delete from "rate_limit"`);
    for (let i = 0; i < 7; i++) await requestLink(ALLOWED, `10.1.1.${i}`);
    expect(await mailbox()).toHaveLength(5);
  });
});
