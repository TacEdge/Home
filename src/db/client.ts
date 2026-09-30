import 'server-only';
import { env } from '@/lib/env';
import { createDb, type Db } from './create';

// The application's single database handle, created on first use from the
// validated environment. Only src/trust (M1) and src/domain (M2+) may use it.
let instance: ReturnType<typeof createDb> | undefined;

export function getDb(): Db {
  instance ??= createDb(env.DATABASE_URL);
  return instance.db;
}
