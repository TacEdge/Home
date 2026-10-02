import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { adminDb, testDb } from './db';

const { db, close } = testDb();
const admin = adminDb();
afterAll(async () => {
  await close();
  await admin.close();
});

describe('database', () => {
  it('answers a trivial query through Drizzle', async () => {
    const rows = await db.execute(sql`select 1 as one`);
    expect(rows.rows[0]).toEqual({ one: 1 });
  });

  it('applied migrations from an empty database (global setup)', async () => {
    const rows = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const names = rows.rows.map((r) => r.table_name);
    expect(names).toContain('audit_log');
    expect(names).toContain('person');
  });

  it('0003 added the P-1 columns to audit_log additively, with the household default', async () => {
    const cols = await db.execute(
      sql`select column_name, column_default, is_nullable from information_schema.columns
          where table_name = 'audit_log' and column_name in ('visibility', 'visible_to_user_id') order by 1`,
    );
    expect(cols.rows).toEqual([
      { column_name: 'visibility', column_default: "'household'::text", is_nullable: 'NO' },
      { column_name: 'visible_to_user_id', column_default: null, is_nullable: 'YES' },
    ]);
    // The M1-shaped insert (no P-1 columns named) still works: the deployed
    // app keeps auditing while its migration waits for approval.
    await db.execute(
      sql`insert into audit_log (actor_via, event) values ('system', 'test.m1_shape')`,
    );
    const r = await db.execute(sql`select visibility from audit_log where event = 'test.m1_shape'`);
    expect(r.rows[0]?.visibility).toBe('household');
  });

  it('person enforces its vocabularies with CHECK constraints', async () => {
    const checks = await db.execute(
      sql`select conname from pg_constraint where conrelid = 'person'::regclass and contype = 'c' order by 1`,
    );
    expect(checks.rows.map((r) => r.conname)).toEqual([
      'person_colour_check',
      'person_created_via_check',
      'person_role_check',
      'person_visibility_check',
    ]);
  });

  it('is idempotent: re-running the migrator (as the migration/admin role) makes no changes', async () => {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await expect(
      migrate(admin.db, { migrationsFolder: 'src/db/migrations' }),
    ).resolves.toBeUndefined();
  });
});
