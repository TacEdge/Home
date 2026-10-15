import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { auditLog } from '@/db/schema';
import { auditRowColumns, listAudit, recordAudit, type AuditCursor } from '@/trust/audit';
import { systemActor, type Actor, type UserActor } from '@/trust/actor';
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

// Reads name their columns (rule 6): this suite also runs against the
// previous schema, where the Drizzle definition may be ahead of the table.
const readBack = async (id: string) => {
  const [row] = await db.select(auditRowColumns).from(auditLog).where(eq(auditLog.id, id));
  if (!row) throw new Error('audit row not found');
  return row;
};

const sam: UserActor = {
  kind: 'user',
  userId: 'u-sam',
  email: 'sam@example.test',
  via: 'ui',
  channel: 'web',
};
const alex: UserActor = { ...sam, userId: 'u-alex', email: 'alex@example.test' };

describe('audit_log', () => {
  it('records an entry for a user actor', async () => {
    const { id } = await recordAudit(sam, { event: 'test.user', summary: 'hello' }, { db });
    const row = await readBack(id);
    expect(row.actorUserId).toBe('u-sam');
    expect(row.actorVia).toBe('ui');
    expect(row.actorChannel).toBe('web');
    expect(row.event).toBe('test.user');
    expect(row.summary).toBe('hello');
    expect(row.meta).toBeNull();
  });

  it('stores meta as JSON and returns only the new id', async () => {
    const created = await recordAudit(
      sam,
      { event: 'test.meta', meta: { count: 2, ok: true, tags: ['a'] } },
      { db },
    );
    expect(Object.keys(created)).toEqual(['id']);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await readBack(created.id)).meta).toEqual({ count: 2, ok: true, tags: ['a'] });
  });

  it('records an entry for the system actor with no user or channel', async () => {
    const { id } = await recordAudit(systemActor, { event: 'test.system' }, { db });
    const row = await readBack(id);
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
    // Issue #77: the walk is confined to this test's own rows, between two
    // fences, so it neither reads nor depends on rows other files leave in the
    // shared, append-only log. The window is a fresh second in a reserved year
    // that nothing else writes to (local test databases keep earlier runs).
    const run = randomUUID().slice(0, 8);
    const second = (
      await db.execute(
        sql`select to_char(coalesce(date_trunc('second', max(at)) + interval '1 second',
              timestamptz '1990-01-01T00:00:00Z') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as s
            from audit_log where at >= timestamptz '1990-01-01T00:00:00Z' and at < timestamptz '1991-01-01T00:00:00Z'`,
      )
    ).rows[0]?.s as string;
    const at = (frac: string) => `${second}.${frac}Z`;

    // Twenty rows inside one JavaScript millisecond: distinct microseconds,
    // some shared exactly, inserted out of order. A cursor built from a
    // JavaScript Date (milliseconds) cannot tell them apart. Some are private
    // to one adult, so the walk also proves Activity's visibility per reader.
    const micros = [
      901, 17, 450, 450, 999, 0, 233, 233, 233, 612, 88, 777, 1, 998, 500, 500, 321, 654, 42, 865,
    ];
    const owner = (i: number) => (i % 5 === 1 ? 'u-sam' : i % 5 === 3 ? 'u-alex' : null);
    const events = micros.map((_, i) => `test.micro.${run}.${i}`);
    const insert = (rows: { at: string; event: string; owner?: string | null }[]) =>
      db.execute(
        sql`insert into audit_log (at, actor_via, event, visibility, visible_to_user_id) values ${sql.join(
          rows.map(
            (r) =>
              sql`(${r.at}::timestamptz, 'system', ${r.event}, ${r.owner ? 'private' : 'household'}, ${r.owner ?? null})`,
          ),
          sql`, `,
        )} returning id`,
      );
    // The fences: the walk starts below the top one and stops at the floor.
    const [top] = (await insert([{ at: at('002000'), event: `test.micro.${run}.top` }])).rows;
    const [floor] = (await insert([{ at: at('000000'), event: `test.micro.${run}.floor` }])).rows;
    await insert(
      micros.map((us, i) => ({
        at: at(`001${String(us).padStart(3, '0')}`),
        event: events[i] as string,
        owner: owner(i),
      })),
    );
    const topId = top?.id as string;
    const floorId = floor?.id as string;

    // The one true order, computed by Postgres at full precision.
    const expected = (
      await db.execute(
        sql`select event from audit_log where event like ${`test.micro.${run}.%`}
              and event not in (${`test.micro.${run}.top`}, ${`test.micro.${run}.floor`})
            order by at desc, id desc`,
      )
    ).rows.map((r) => r.event as string);
    expect(expected).toHaveLength(micros.length);
    const ownerOf = new Map(events.map((e, i) => [e, owner(i)]));
    const visibleTo = (userId: string | null) =>
      expected.filter((e) => userId === null || [null, userId].includes(ownerOf.get(e) ?? null));

    // Walk from the top fence down to the floor fence, one page at a time.
    const walk = async (actor: Actor, limit: number) => {
      const seen: { id: string; event: string }[] = [];
      let cursor: AuditCursor | undefined = { id: topId };
      let calls = 0;
      let reachedFloor = false;
      for (let guard = 0; guard < 1_000 && cursor; guard++) {
        calls++;
        const page = await listAudit(actor, { limit, before: cursor }, { db });
        for (const r of page.rows) {
          if (r.id === floorId) {
            reachedFloor = true;
            break;
          }
          seen.push({ id: r.id, event: r.event });
        }
        if (reachedFloor) break;
        cursor = page.next ?? undefined;
      }
      return { seen, calls, reachedFloor };
    };

    const readers: [string, Actor, string | null][] = [
      ['system', systemActor, null],
      ['sam', sam, 'u-sam'],
      ['alex', alex, 'u-alex'],
    ];
    const check = async () => {
      const results: Record<string, string[]> = {};
      // Every page size, including one that ends a page on every row.
      for (const limit of [1, 2, 3, 4, 5, 7]) {
        for (const [name, actor, userId] of readers) {
          const label = `${name}, page size ${limit}`;
          const { seen, calls, reachedFloor } = await walk(actor, limit);
          const want = visibleTo(userId);
          expect(reachedFloor, label).toBe(true);
          // Complete and in order: nothing skipped, nothing out of place,
          // and nothing from outside the window.
          expect(
            seen.map((r) => r.event),
            label,
          ).toEqual(want);
          // Nothing repeated.
          expect(new Set(seen.map((r) => r.id)).size, label).toBe(seen.length);
          // The walk is bounded by this test's rows, not by the log's size.
          expect(calls, label).toBeLessThanOrEqual(Math.ceil((want.length + 1) / limit));
          results[label] = seen.map((r) => r.id);
        }
      }
      return results;
    };

    const before = await check();
    // Cross-adult privacy, stated outright: each adult's private rows reach
    // only that adult (and the system), never the other adult.
    const samPrivate = events.filter((e) => ownerOf.get(e) === 'u-sam');
    const alexPrivate = events.filter((e) => ownerOf.get(e) === 'u-alex');
    expect(samPrivate.length).toBeGreaterThan(0);
    expect(alexPrivate.length).toBeGreaterThan(0);
    expect(visibleTo('u-sam')).not.toContain(alexPrivate[0]);
    for (const limit of [1, 7]) {
      const forSam = (await walk(sam, limit)).seen.map((r) => r.event);
      const forAlex = (await walk(alex, limit)).seen.map((r) => r.event);
      for (const e of alexPrivate) expect(forSam).not.toContain(e);
      for (const e of samPrivate) expect(forAlex).not.toContain(e);
      expect(forSam).toEqual(expect.arrayContaining(samPrivate));
      expect(forAlex).toEqual(expect.arrayContaining(alexPrivate));
    }

    // Regression: unrelated rows — just above the top fence, older than the
    // window, and written now as other files write them; household and
    // private to either adult — leave every walk unchanged. (Nothing is dated
    // in the future: other files expect their own rows at the top of the log.)
    const unrelated = Array.from({ length: 60 }, (_, i) => ({
      at: [at('002001'), at('500000'), '1989-12-31T23:59:59Z'][i % 3] as string,
      event: `test.unrelated.${run}.${i}`,
      owner: [null, 'u-sam', 'u-alex'][Math.floor(i / 3) % 3] ?? null,
    }));
    await insert(unrelated);
    for (let i = 0; i < 40; i++)
      await recordAudit(sam, { event: `test.unrelated.${run}.now.${i}` }, { db });
    const after = await check();
    expect(after).toEqual(before);
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
    await db.execute(
      sql`insert into audit_log (at, actor_via, event) values ${sql.join(
        events.map((event) => sql`(${at.toISOString()}::timestamptz, 'system', ${event})`),
        sql`, `,
      )}`,
    );

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
