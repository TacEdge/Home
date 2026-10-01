import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { Db } from '@/db/create';

// Sliding-window counter in Better Auth's rate_limit table, used for HOME's
// own limits on link requests (M1.1 contract §2.3). One atomic statement:
// concurrent requests cannot slip past the limit between a read and a write,
// because the upsert serialises on the key and returns the new count.

export type RateLimitOptions = { max: number; windowMs: number; now?: number; db?: Db };

/** Counts one hit against `key` and reports whether it is still within `max`. */
export async function consumeRateLimit(key: string, opts: RateLimitOptions): Promise<boolean> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const windowStart = now - opts.windowMs;
  const result = await db.execute<{ count: number }>(
    sql`insert into rate_limit (id, key, count, last_request)
        values (${key}, ${key}, 1, ${now})
        on conflict (key) do update set
          count = case when rate_limit.last_request > ${windowStart} then rate_limit.count + 1 else 1 end,
          last_request = ${now}
        returning count`,
  );
  const count = Number(result.rows[0]?.count ?? Number.POSITIVE_INFINITY);
  return count <= opts.max;
}
