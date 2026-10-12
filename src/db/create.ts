import 'server-only';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// Builds a Drizzle instance for a given connection string. The app uses the
// singleton in ./client.ts; integration tests build their own against the
// test database.
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 5 });
  // A connection the server ends while it is checked out (an idle-in-
  // transaction timeout, a restart) emits 'error' on that client, which
  // pg-pool listens for only while the client is idle. Unhandled, it exits a
  // plain Node process (scripts, tests) and, inside Next.js, is logged raw by
  // the framework's process handler, bypassing src/lib/log.ts. The query in
  // flight (or the next one) still fails, so its transaction rolls back, and
  // the pool discards the client when it is released. Nothing is logged here:
  // a database error can carry a query's parameters (M7 contract §5.1).
  // Idle clients' errors reach the pool itself: issue #74.
  pool.on('connect', (client) => {
    client.on('error', () => undefined);
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}

export type Db = ReturnType<typeof createDb>['db'];

/** A database handle or a transaction on one: what services and audit accept. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
