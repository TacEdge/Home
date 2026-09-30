// Global setup for the integration project: reset the test database and apply
// every migration from scratch, so each run proves the migrations work on an
// empty database.
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { TEST_DATABASE_URL } from '../env';

export default async function setup() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await pool.query('drop schema if exists public cascade; create schema public;');
    await pool.query('drop schema if exists drizzle cascade;');
    await migrate(drizzle(pool), { migrationsFolder: 'src/db/migrations' });
  } finally {
    await pool.end();
  }
}
