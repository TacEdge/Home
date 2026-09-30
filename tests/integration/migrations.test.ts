import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { testDb } from './db';

const { db, close } = testDb();
afterAll(close);

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
  });

  it('is idempotent: re-running the migrator makes no changes', async () => {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await expect(migrate(db, { migrationsFolder: 'src/db/migrations' })).resolves.toBeUndefined();
  });
});
