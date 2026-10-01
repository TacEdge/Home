import { describe, expect, it } from 'vitest';
import { assertTestDatabase, NotATestDatabaseError } from '../db-guard';
import { resetTestDatabase } from '../integration/global-setup';

const PASSWORD = 'hunter2-not-for-logs';

describe('assertTestDatabase', () => {
  it.each([
    'postgres://home:home@localhost:5432/home_test',
    'postgres://home:home@127.0.0.1:5432/home_test',
    'postgresql://home:home@postgres:5432/home_test',
    'postgres://home_app:home_app@localhost:5432/home_test',
  ])('accepts a local *_test database: %s', (url) => {
    expect(assertTestDatabase(url)).toBe(url);
  });

  it.each([
    [
      'a Neon-style host',
      `postgres://neondb_owner:${PASSWORD}@ep-x.ap-southeast-2.aws.neon.tech/neondb`,
    ],
    [
      'a remote host even with a test database name',
      `postgres://home:${PASSWORD}@db.example.test/home_test`,
    ],
    ['localhost with the development database', `postgres://home:${PASSWORD}@localhost:5432/home`],
    ['a malformed URL', `not a url ${PASSWORD}`],
    ['a non-postgres URL', `https://home:${PASSWORD}@localhost/home_test`],
  ])('rejects %s without echoing the password', (_label, url) => {
    expect(() => assertTestDatabase(url)).toThrow(NotATestDatabaseError);
    try {
      assertTestDatabase(url);
    } catch (e) {
      expect((e as Error).message).not.toContain(PASSWORD);
      expect((e as Error).message).not.toContain('neon.tech');
    }
  });

  it('rejects an empty value', () => {
    expect(() => assertTestDatabase(undefined)).toThrow(NotATestDatabaseError);
    expect(() => assertTestDatabase('')).toThrow(NotATestDatabaseError);
  });
});

describe('integration global setup', () => {
  it('refuses a non-test database before running any query', async () => {
    const queries: string[] = [];
    const fakePool = {
      query: async (q: string) => {
        queries.push(q);
        return { rows: [] };
      },
      end: async () => undefined,
    };
    await expect(
      resetTestDatabase({
        url: `postgres://home:${PASSWORD}@db.example.test/home`,
        createPool: () => fakePool,
        migrate: async () => undefined,
      }),
    ).rejects.toThrow(NotATestDatabaseError);
    expect(queries).toEqual([]);
  });
});
