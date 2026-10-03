import 'server-only';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// Builds a Drizzle instance for a given connection string. The app uses the
// singleton in ./client.ts; integration tests build their own against the
// test database.
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 5 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}

export type Db = ReturnType<typeof createDb>['db'];

/** A database handle or a transaction on one: what services and audit accept. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
