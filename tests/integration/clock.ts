import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { assertTestDatabase } from '../db-guard';
import { TEST_APP_DATABASE_URL } from '../env';
import type { adminDb } from './db';

// A database clock a test can move, without passing the application's
// (M8 Package 1b; the bookkeeping path's money tests, and the privacy
// suite's Kev bookkeeping calls). A test-only schema, `home_test_clock`,
// holds a `now()` that returns a stored instant (or the real one when none
// is set). Connections of a clocked pool put that schema before pg_catalog
// in their search_path, so every unqualified now() the bookkeeping path
// writes or compares (a reservation's period and created_at, the sweep, the
// month, each usage row's at) and the born-open trigger read the moved
// clock. The code under test is unchanged and never receives a time.
//
// The household's month is shared by every suite that writes usage at the
// real now (M2's usage suite records a cost beyond Number's safe integers
// there), so a test that needs the cap's room runs in a month of its own.

type Admin = ReturnType<typeof adminDb>;

export async function createTestClock(admin: Admin): Promise<void> {
  await admin.db.execute(
    sql.raw(`
    drop schema if exists home_test_clock cascade;
    create schema home_test_clock;
    create table home_test_clock.clock (now timestamptz);
    insert into home_test_clock.clock values (null);
    create function home_test_clock.now() returns timestamptz language sql stable
      as $$ select coalesce((select c.now from home_test_clock.clock c), pg_catalog.now()) $$;
    grant usage on schema home_test_clock to home_app;
    grant select on home_test_clock.clock to home_app;
    grant execute on function home_test_clock.now() to home_app;
  `),
  );
}

export async function setTestClock(admin: Admin, instant: string | null): Promise<void> {
  await admin.db.execute(sql`update home_test_clock.clock set now = ${instant}::timestamptz`);
}

export async function dropTestClock(admin: Admin): Promise<void> {
  await admin.db.execute(sql.raw('drop schema if exists home_test_clock cascade'));
}

/** A home_app pool whose now() is the test clock's. */
export function clockedPool(max = 60): {
  pool: Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
} {
  const pool = new Pool({
    connectionString: assertTestDatabase(TEST_APP_DATABASE_URL),
    max,
    options: '-c search_path=home_test_clock,public,pg_catalog',
  });
  pool.on('connect', (c) => c.on('error', () => undefined));
  return { pool, db: drizzle(pool, { schema, casing: 'snake_case' }) };
}
