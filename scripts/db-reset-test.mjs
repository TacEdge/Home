// Drops and recreates the integration-test schema, then applies all migrations.
// Uses TEST_DATABASE_URL or the local default. Never points at production.
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://home:home@localhost:5432/home_test';
if (!/localhost|127\.0\.0\.1|home_test/.test(url)) {
  console.error('Refusing to reset a database that does not look like a local test database.');
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: 1 });
try {
  await pool.query('drop schema if exists public cascade; create schema public;');
  await pool.query('drop schema if exists drizzle cascade;');
  await migrate(drizzle(pool), { migrationsFolder: 'src/db/migrations' });
  console.log('test database reset and migrated');
} finally {
  await pool.end();
}
