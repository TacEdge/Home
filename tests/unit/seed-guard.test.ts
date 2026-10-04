import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { assertSeedTarget, SeedRefusedError, type SeedRefusal } from '../../scripts/seed-guard.mts';

// The fixture seed writes only to a database on this machine (M2 contract
// §7, D-M2-5): never home-dev (preview), never production, never anything
// hosted. Each refusal is proven, and no refusal ever prints the URL.

// A marker that must never appear in output (stands in for a real password).
const MARKER = 'hidden-marker-7f3a';
const local = `postgres://home_app:${MARKER}@localhost:5432/home`;
const reasonOf = (url: string | undefined, env: Record<string, string | undefined> = {}) => {
  try {
    assertSeedTarget(url, env);
    return 'allowed';
  } catch (e) {
    expect(e).toBeInstanceOf(SeedRefusedError);
    expect((e as Error).message).not.toContain(MARKER);
    expect((e as Error).message).not.toMatch(/postgres(ql)?:\/\//);
    return (e as SeedRefusedError).reason;
  }
};

describe('seed target guard', () => {
  it.each([
    ['localhost', local],
    ['127.0.0.1', `postgres://u:${MARKER}@127.0.0.1:5432/home`],
    ['::1', `postgresql://u:${MARKER}@[::1]:5432/home_test`],
  ])('allows a local database (%s)', (_l, url) => {
    expect(reasonOf(url)).toBe('allowed');
  });

  it.each<[string, string | undefined, Record<string, string>, SeedRefusal]>([
    ['production on Vercel', local, { VERCEL_ENV: 'production' }, 'vercel_environment'],
    ['a Vercel preview', local, { VERCEL_ENV: 'preview' }, 'vercel_environment'],
    ['any Vercel runtime', local, { VERCEL: '1' }, 'vercel_environment'],
    ['NODE_ENV=production', local, { NODE_ENV: 'production' }, 'production_node_env'],
    [
      'a Neon host',
      `postgres://u:${MARKER}@ep-cool-name-123456.ap-southeast-2.aws.neon.tech/neondb?sslmode=require`,
      {},
      'neon_host',
    ],
    [
      'a Neon pooler host',
      `postgres://u:${MARKER}@ep-x-pooler.c-2.ap-southeast-2.aws.neon.tech/home`,
      {},
      'neon_host',
    ],
    [
      'another remote host',
      `postgres://u:${MARKER}@db.example.com:5432/home`,
      {},
      'not_local_host',
    ],
    ['a docker service name', `postgres://u:${MARKER}@postgres:5432/home`, {}, 'not_local_host'],
    [
      'a host that only looks local',
      `postgres://u:${MARKER}@localhost.example.com/home`,
      {},
      'not_local_host',
    ],
    ['no URL', undefined, {}, 'no_database_url'],
    ['a non-Postgres URL', `mysql://u:${MARKER}@localhost/home`, {}, 'not_postgres'],
    ['an unparseable URL', `not a url ${MARKER}`, {}, 'unparseable_url'],
  ])('refuses %s', (_l, url, env, reason) => {
    expect(reasonOf(url, env)).toBe(reason);
  });

  it('refuses in a Vercel environment even when the URL is local', () => {
    expect(reasonOf(local, { VERCEL_ENV: 'development' })).toBe('vercel_environment');
  });
});

describe('pnpm db:seed:fixtures', () => {
  const run = (env: Record<string, string>) =>
    spawnSync('node', ['scripts/seed-fixtures.mts'], {
      env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
      encoding: 'utf8',
    });

  it.each([
    [
      'a Neon (production-like) URL',
      { DATABASE_URL: `postgres://u:${MARKER}@ep-x.ap-southeast-2.aws.neon.tech/home` },
    ],
    ['a preview deployment', { DATABASE_URL: local, VERCEL_ENV: 'preview' }],
    ['no database at all', {}],
  ])('exits non-zero before connecting, for %s, and never prints the URL', (_l, env) => {
    const r = run(env);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Refusing to seed fixtures/);
    expect(`${r.stdout}${r.stderr}`).not.toContain(MARKER);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/neon\.tech|postgres:\/\//);
  });
});
