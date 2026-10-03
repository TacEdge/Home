import { readFile, rm } from 'node:fs/promises';
import { desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, session as sessionTable, user as userTable } from '@/db/schema';
import { auditRowColumns } from '@/trust/audit';
import { getAuth } from '@/trust/auth';
import { TEST_MAILBOX_PATH } from '@/trust/mail';
import { testDb } from './db';
import { clearDomainRows } from './fixtures';

// Exercises Better Auth as configured in src/trust/auth.ts against the test
// database, with the test mail transport. Never sends real mail. The gate in
// front of it (allowlist, rate limits, denied-attempt auditing) is covered in
// ./sign-in-gate.test.ts; this file is about what Better Auth itself does.

const { db, close } = testDb();
afterAll(close);
const auth = getAuth();

const ALLOWED = 'sam@example.test';
const OUTSIDER = 'someone-else@example.test';

let ipCounter = 0;
const headersFor = (ip?: string) =>
  new Headers({ 'x-real-ip': ip ?? `10.0.0.${++ipCounter}`, host: 'localhost:3000' });

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
  await clearDomainRows(db); // domain rows reference user.id (ON DELETE RESTRICT)
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
      .select(auditRowColumns)
      .from(auditLog)
      .where(eq(auditLog.event, 'auth.link_requested'))
      .orderBy(desc(auditLog.at))
      .limit(1);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain(ALLOWED);
  });

  it('sendMagicLink is defence in depth: an outsider that bypasses the gate gets no mail and no audit row with the address', async () => {
    // Calling Better Auth directly skips the gate; the plugin still refuses.
    const res = await requestLink(OUTSIDER);
    expect(res).toEqual({ status: true });
    expect(await mailbox()).toHaveLength(0);
    const users = await db.select().from(userTable).where(eq(userTable.email, OUTSIDER));
    expect(users).toHaveLength(0);
    const rows = await db.execute(
      sql`select count(*)::int as n from audit_log where summary like '%someone-else%' or meta::text like '%someone-else%'`,
    );
    expect(rows.rows[0]?.n).toBe(0);
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
      .select(auditRowColumns)
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
});
