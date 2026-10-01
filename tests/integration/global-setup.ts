// Global setup for the integration project: reset the test database and apply
// every migration from scratch, so each run proves the migrations work on an
// empty database. The guard runs before any connection is opened (contract
// §1.6): a wrong URL throws here, never at `drop schema`.
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { assertTestDatabase } from '../db-guard';
import { TEST_DATABASE_URL } from '../env';

type MinimalPool = { query: (sql: string) => Promise<unknown>; end: () => Promise<unknown> };

export type ResetOptions = {
  url?: string;
  createPool?: (url: string) => MinimalPool;
  migrate?: (pool: MinimalPool) => Promise<void>;
};

export async function resetTestDatabase(opts: ResetOptions = {}): Promise<void> {
  const url = assertTestDatabase(opts.url ?? TEST_DATABASE_URL);
  const createPool = opts.createPool ?? ((u) => new Pool({ connectionString: u, max: 1 }));
  const migrate =
    opts.migrate ??
    ((pool) => drizzleMigrate(drizzle(pool as Pool), { migrationsFolder: 'src/db/migrations' }));
  const pool = createPool(url);
  try {
    await pool.query('drop schema if exists public cascade; create schema public;');
    await pool.query('drop schema if exists drizzle cascade;');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}

export default async function setup() {
  await resetTestDatabase();
}
