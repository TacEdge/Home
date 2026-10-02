import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { auditLog } from '@/db/schema';
import { listAudit, recordAudit, type AuditCursor } from '@/trust/audit';
import { systemActor, type UserActor } from '@/trust/actor';
import { adminDb, testDb } from './db';

const { db, close } = testDb();
// The trigger is the second layer behind the role privileges (contract §1.7).
// As home_app the privilege check fires first (tests/integration/app-role),
// so proving the trigger itself means connecting as the owner.
const admin = adminDb();
afterAll(async () => {
  await close();
  await admin.close();
});

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

  it('rejects UPDATE at the database level, even for the table owner (trigger)', async () => {
    const row = await recordAudit(sam, { event: 'test.immutable' }, { db });
    await expectAppendOnly(
      admin.db.update(auditLog).set({ summary: 'tampered' }).where(eq(auditLog.id, row.id)),
    );
  });

  it('rejects DELETE at the database level, even for the table owner (trigger)', async () => {
    const row = await recordAudit(sam, { event: 'test.immutable' }, { db });
    await expectAppendOnly(admin.db.delete(auditLog).where(eq(auditLog.id, row.id)));
  });

  it('rejects TRUNCATE at the database level, even for the table owner (trigger)', async () => {
    await expectAppendOnly(admin.db.execute(sql`truncate audit_log`));
  });

  it('lists newest first and paginates with a (at, id) cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await recordAudit(sam, { event: `test.page.${i}` }, { db });
    }
    const first = await listAudit(sam, { limit: 3 }, { db });
    expect(first.rows).toHaveLength(3);
    expect(first.rows.map((r) => r.event)).toEqual(['test.page.4', 'test.page.3', 'test.page.2']);
    expect(first.next).not.toBeNull();
    const next = await listAudit(sam, { limit: 3, before: first.next ?? undefined }, { db });
    expect(next.rows.map((r) => r.event).slice(0, 2)).toEqual(['test.page.1', 'test.page.0']);
  });

  it('pages completely when timestamps differ only below the millisecond (Postgres keeps microseconds, JavaScript does not)', async () => {
    // Twenty rows inside one JavaScript millisecond: distinct microseconds,
    // some shared exactly, inserted out of order. A cursor built from a
    // JavaScript Date (milliseconds) cannot tell them apart.
    const micros = [
      901, 17, 450, 450, 999, 0, 233, 233, 233, 612, 88, 777, 1, 998, 500, 500, 321, 654, 42, 865,
    ];
    const events = micros.map((_, i) => `test.micro.${i}`);
    await db.execute(
      sql`insert into audit_log (at, actor_via, event) values ${sql.join(
        micros.map(
          (us, i) =>
            sql`(${`2026-03-02T10:00:00.123${String(us).padStart(3, '0')}Z`}::timestamptz, 'system', ${events[i]})`,
        ),
        sql`, `,
      )}`,
    );
    // The one true order, computed by Postgres at full precision.
    const expected = (
      await db.execute(
        sql`select event from audit_log where event like 'test.micro.%' order by at desc, id desc`,
      )
    ).rows.map((r) => r.event as string);
    expect(expected).toHaveLength(micros.length);

    // Every page size, including one that ends a page on every row.
    for (const limit of [1, 2, 3, 4, 5, 7]) {
      const seen: { id: string; event: string }[] = [];
      let cursor: AuditCursor | undefined;
      for (let guard = 0; guard < 10_000; guard++) {
        const page = await listAudit(sam, { limit, before: cursor }, { db });
        seen.push(...page.rows.map((r) => ({ id: r.id, event: r.event })));
        if (!page.next) break;
        cursor = page.next;
      }
      const micro = seen.map((r) => r.event).filter((e) => e.startsWith('test.micro.'));
      // Complete and in order: nothing skipped, nothing out of place.
      expect(micro, `page size ${limit}`).toEqual(expected);
      // Nothing repeated: no row of the whole log is returned twice.
      const ids = seen.map((r) => r.id);
      expect(new Set(ids).size, `page size ${limit}`).toBe(ids.length);
      // And the walk covered the whole log.
      const total = (await db.execute(sql`select count(*)::int as n from audit_log`)).rows[0]?.n;
      expect(ids.length, `page size ${limit}`).toBe(total);
    }
  });

  it('a cursor naming no row returns an empty page rather than restarting', async () => {
    const page = await listAudit(
      sam,
      { before: { id: '00000000-0000-0000-0000-000000000000' } },
      { db },
    );
    expect(page.rows).toEqual([]);
    expect(page.next).toBeNull();
  });

  it('returns every row exactly once when timestamps are identical across a page boundary (§2.9)', async () => {
    // Twelve rows that all share one explicit `at`, so only `id` can order them.
    const at = new Date('2026-03-01T10:00:00.000Z');
    const events = Array.from({ length: 12 }, (_, i) => `test.same.${i}`);
    await db.insert(auditLog).values(events.map((event) => ({ at, actorVia: 'system', event })));

    const seen: string[] = [];
    let cursor: AuditCursor | undefined;
    // Page to the very end: other tests leave rows above these twelve.
    for (let guard = 0; guard < 10_000; guard++) {
      const page = await listAudit(sam, { limit: 5, before: cursor }, { db });
      seen.push(...page.rows.map((r) => r.event));
      if (!page.next) break;
      cursor = page.next;
    }
    const same = seen.filter((e) => e.startsWith('test.same.'));
    expect(same).toHaveLength(12);
    expect(new Set(same).size).toBe(12);
    expect(same.sort()).toEqual([...events].sort());
  });
});
