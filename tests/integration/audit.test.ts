import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { auditLog } from '@/db/schema';
import { listAudit, recordAudit } from '@/trust/audit';
import { systemActor, type UserActor } from '@/trust/actor';
import { testDb } from './db';

const { db, close } = testDb();
afterAll(close);

// Drizzle wraps driver errors ("Failed query: …") and keeps the Postgres error
// as `cause`; the trigger's message lives there.
async function expectAppendOnly(p: Promise<unknown>) {
  await expect(p).rejects.toThrow();
  await p.catch((e: unknown) => {
    const err = e as Error & { cause?: Error };
    expect(`${err.message} ${err.cause?.message ?? ''}`).toMatch(/append-only/);
  });
}

const sam: UserActor = {
  kind: 'user',
  userId: 'u-sam',
  email: 'sam@example.test',
  via: 'ui',
  channel: 'web',
};

describe('audit_log', () => {
  it('records an entry for a user actor', async () => {
    const row = await recordAudit(sam, { event: 'test.user', summary: 'hello' }, { db });
    expect(row.actorUserId).toBe('u-sam');
    expect(row.actorVia).toBe('ui');
    expect(row.actorChannel).toBe('web');
    expect(row.event).toBe('test.user');
  });

  it('records an entry for the system actor with no user or channel', async () => {
    const row = await recordAudit(systemActor, { event: 'test.system' }, { db });
    expect(row.actorUserId).toBeNull();
    expect(row.actorVia).toBe('system');
    expect(row.actorChannel).toBeNull();
  });

  it('rejects UPDATE at the database level', async () => {
    const row = await recordAudit(sam, { event: 'test.immutable' }, { db });
    await expectAppendOnly(
      db.update(auditLog).set({ summary: 'tampered' }).where(eq(auditLog.id, row.id)),
    );
  });

  it('rejects DELETE at the database level', async () => {
    const row = await recordAudit(sam, { event: 'test.immutable' }, { db });
    await expectAppendOnly(db.delete(auditLog).where(eq(auditLog.id, row.id)));
  });

  it('rejects TRUNCATE at the database level', async () => {
    await expectAppendOnly(db.execute(sql`truncate audit_log`));
  });

  it('lists newest first and paginates with `before`', async () => {
    for (let i = 0; i < 5; i++) {
      await recordAudit(sam, { event: `test.page.${i}` }, { db });
    }
    const first = await listAudit(sam, { limit: 3 }, { db });
    expect(first).toHaveLength(3);
    expect(first.map((r) => r.event)).toEqual(['test.page.4', 'test.page.3', 'test.page.2']);
    const last = first[2];
    if (!last) throw new Error('expected a row');
    const next = await listAudit(sam, { limit: 3, before: last.at }, { db });
    expect(next.map((r) => r.event).slice(0, 2)).toEqual(['test.page.1', 'test.page.0']);
  });
});
