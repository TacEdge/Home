import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { consumeRateLimit } from '@/trust/rate-limit';
import { testDb } from './db';

const { db, close } = testDb();
afterAll(close);
beforeEach(() => db.execute(sql`delete from rate_limit`));

describe('consumeRateLimit (atomic)', () => {
  it('allows exactly `max` of 20 concurrent calls (contract §2.3)', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit('test:concurrent', { max: 5, windowMs: 60_000, db }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it('starts a new window once the last request is older than the window', async () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) {
      expect(
        await consumeRateLimit('test:window', { max: 5, windowMs: 1000, now: t0 + i, db }),
      ).toBe(true);
    }
    expect(
      await consumeRateLimit('test:window', { max: 5, windowMs: 1000, now: t0 + 10, db }),
    ).toBe(false);
    expect(
      await consumeRateLimit('test:window', { max: 5, windowMs: 1000, now: t0 + 2000, db }),
    ).toBe(true);
  });

  it('keeps keys independent', async () => {
    for (let i = 0; i < 6; i++) await consumeRateLimit('test:a', { max: 5, windowMs: 1000, db });
    expect(await consumeRateLimit('test:b', { max: 5, windowMs: 1000, db })).toBe(true);
  });
});
