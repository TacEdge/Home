import { eq, sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor } from '@/trust/actor';
import { auditRowColumns, listAudit, recordAudit } from '@/trust/audit';
import { testDb } from './db';

// Why audit_log queries name their columns (M2 contract §2.1 rules 2 and 6).
// A migration PR adds a column to the Drizzle definition before production
// has run the migration. `futureAuditLog` is that situation: the definition
// has a column (`future_probe`) the database does not. Against the real
// table, as home_app:
//   - "all columns" queries, including Drizzle's insert, fail — the hazard;
//   - queries that name their columns keep working;
//   - recordAudit and listAudit are written the second way.

const { db, close } = testDb();
afterAll(close);

const futureAuditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorUserId: text('actor_user_id'),
  actorVia: text('actor_via').notNull(),
  actorChannel: text('actor_channel'),
  event: text('event').notNull(),
  subjectType: text('subject_type'),
  subjectId: text('subject_id'),
  summary: text('summary'),
  meta: jsonb('meta'),
  futureProbe: text('future_probe').notNull().default('household'),
});

const missingColumn = /column "future_probe".*does not exist/;

async function expectMissingColumn(p: Promise<unknown>) {
  await expect(p).rejects.toThrow();
  await p.catch((e: unknown) => {
    const err = e as Error & { cause?: Error };
    expect(`${err.message} ${err.cause?.message ?? ''}`).toMatch(missingColumn);
  });
}

describe('audit_log queries against a definition ahead of the database', () => {
  it('a Drizzle insert fails: it lists every defined column, even unset ones', async () => {
    await expectMissingColumn(
      db.insert(futureAuditLog).values({ actorVia: 'system', event: 'test.future' }),
    );
  });

  it('returning() with no columns fails', async () => {
    await expectMissingColumn(
      db
        .execute(sql`select 1`)
        .then(() =>
          db
            .insert(futureAuditLog)
            .values({ actorVia: 'system', event: 'test.future' })
            .returning(),
        ),
    );
  });

  it('select() with no columns fails', async () => {
    await expectMissingColumn(db.select().from(futureAuditLog).limit(1));
  });

  it('a select naming its columns works, whatever else the definition has', async () => {
    const rows = await db
      .select({ id: futureAuditLog.id, event: futureAuditLog.event })
      .from(futureAuditLog)
      .limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it('recordAudit and listAudit name their columns, and work end to end', async () => {
    const { id } = await recordAudit(
      systemActor,
      { event: 'test.columns', meta: { n: 1 } },
      { db },
    );
    const [row] = await db
      .select(auditRowColumns)
      .from(futureAuditLog)
      .where(eq(futureAuditLog.id, id));
    expect(row).toMatchObject({ id, event: 'test.columns', meta: { n: 1 } });
    const page = await listAudit(systemActor, { limit: 200 }, { db });
    expect(page.rows.map((r) => r.id)).toContain(id);
    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual(Object.keys(auditRowColumns).sort());
  });
});
