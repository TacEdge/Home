import { readFile, rm } from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, verification } from '@/db/schema';
import { TEST_MAILBOX_PATH } from '@/trust/mail';
import { gateLinkRequest, handleLinkRequest } from '@/trust/sign-in-gate';
import { testDb } from './db';

// B1 (contract §1.1): the gate runs before Better Auth, through the same code
// path the server action uses. Connected as the runtime/app role.

const { db, close } = testDb();
afterAll(close);

const SAM = 'sam@example.test';
const ALEX = 'alex@example.test';
const OUTSIDER = 'someone-else@example.test';

const headersFor = (ip: string | null) =>
  new Headers({ host: 'localhost:3000', ...(ip ? { 'x-real-ip': ip } : {}) });

const request = (email: string, ip: string | null) =>
  handleLinkRequest({ email, ip, headers: headersFor(ip) }, { db });

const count = async (table: 'verification' | 'audit_log', where = sql`true`) =>
  Number(
    (await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`))
      .rows[0]?.n,
  );
const denied = () => count('audit_log', sql`event = 'auth.sign_in_denied'`);

async function sentTo(email: string): Promise<number> {
  try {
    const raw = await readFile(TEST_MAILBOX_PATH, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { to: string })
      .filter((m) => m.to === email).length;
  } catch {
    return 0;
  }
}

beforeEach(async () => {
  await db.execute(sql`delete from rate_limit`);
  await db.execute(sql`delete from verification`);
  await rm(TEST_MAILBOX_PATH, { force: true });
});

describe('sign-in gate', () => {
  it('20 outside-address requests from one IP: no token rows, at most one audit row, no address stored', async () => {
    const auditBefore = await denied();
    const decisions: string[] = [];
    for (let i = 0; i < 20; i++) decisions.push(await request(OUTSIDER, '203.0.113.50'));
    expect(decisions.every((d) => d === 'drop')).toBe(true);

    expect(await count('verification')).toBe(0);
    expect((await denied()) - auditBefore).toBe(1);
    expect(await sentTo(OUTSIDER)).toBe(0);

    // No plaintext address anywhere: not in tokens, users, nor audit rows.
    const needle = 'someone-else';
    expect(await count('verification', sql`value like ${'%' + needle + '%'}`)).toBe(0);
    expect(
      (
        await db.execute(
          sql`select count(*)::int as n from "user" where email like ${'%' + needle + '%'}`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(
      await count(
        'audit_log',
        sql`summary like ${'%' + needle + '%'} or meta::text like ${'%' + needle + '%'}`,
      ),
    ).toBe(0);
    const [row] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.event, 'auth.sign_in_denied'))
      .orderBy(sql`at desc`)
      .limit(1);
    expect(row?.meta).toMatchObject({ stage: 'link_request', count: 1 });
    expect((row?.meta as { emailHash: string }).emailHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('7 requests for a household address from one IP: exactly 5 links (per-IP limit)', async () => {
    const decisions = [];
    for (let i = 0; i < 7; i++) decisions.push(await request(SAM, '203.0.113.60'));
    expect(decisions.filter((d) => d === 'send')).toHaveLength(5);
    expect(await sentTo(SAM)).toBe(5);
    expect(await count('verification')).toBe(5);
  });

  it('7 requests for a household address from 7 IPs: exactly 5 links (per-email limit)', async () => {
    const decisions = [];
    for (let i = 0; i < 7; i++) decisions.push(await request(SAM, `203.0.113.${100 + i}`));
    expect(decisions.filter((d) => d === 'send')).toHaveLength(5);
    expect(await sentTo(SAM)).toBe(5);
  });

  it('the per-IP limit counts outside addresses too, so it applies to household ones after', async () => {
    for (let i = 0; i < 5; i++) await request(OUTSIDER, '203.0.113.70');
    expect(await request(SAM, '203.0.113.70')).toBe('drop');
    expect(await sentTo(SAM)).toBe(0);
  });

  it('a household address on a fresh IP still gets its link after another IP is limited', async () => {
    for (let i = 0; i < 6; i++) await request(ALEX, '203.0.113.80');
    expect(await request(SAM, '203.0.113.81')).toBe('send');
    expect(await sentTo(SAM)).toBe(1);
  });

  it('requests without a usable client IP share one bucket', async () => {
    for (let i = 0; i < 5; i++) await gateLinkRequest({ email: SAM, ip: null }, { db });
    expect(await gateLinkRequest({ email: ALEX, ip: null }, { db })).toBe('drop');
  });

  it('a dropped request writes nothing to verification', async () => {
    await request(OUTSIDER, '203.0.113.90');
    const rows = await db.select().from(verification);
    expect(rows).toHaveLength(0);
  });
});
