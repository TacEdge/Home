// Drops and recreates the integration-test schema, then applies all migrations.
// Uses TEST_DATABASE_URL or the local default, and refuses anything that is
// not a local *_test database (tests/db-guard.ts) before connecting.
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { assertTestDatabase } from '../tests/db-guard.ts';

const url = assertTestDatabase(
  process.env.TEST_DATABASE_URL ?? 'postgres://home:home@localhost:5432/home_test',
);
const pool = new Pool({ connectionString: url, max: 1 });
try {
  await pool.query('drop schema if exists public cascade; create schema public;');
  await pool.query('drop schema if exists drizzle cascade;');
  await migrate(drizzle(pool), { migrationsFolder: 'src/db/migrations' });
  console.log('test database reset and migrated');
} finally {
  await pool.end();
}
