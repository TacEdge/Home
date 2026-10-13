import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { NotPermittedError } from '@/domain/common/errors';
import { daylightFor } from '@/domain/engines/daylight';
import { staleSentence, todaySentence } from '@/domain/engines/weather';
import { WeatherUnexpectedError, readForecast, refreshForecast } from '@/domain/weather/service';
import { exportFor } from '@/domain/export/service';
import {
  fakeWeatherProvider,
  syntheticOpenMeteoBody,
  utcDayStart,
  type FakeWeatherStep,
} from '@/integrations/weather/fake';
import { weatherConfig } from '@/lib/env';
import { listAudit } from '@/trust/audit';
import type { UserActor } from '@/trust/actor';
import {
  CHRISTCHURCH,
  FINGERPRINT_VECTORS,
  TEST_WEATHER_KEY_ROTATED,
  WEATHER_VARIABLES,
  WELLINGTON_UNROUNDED,
  locationLeaksIn,
  weatherEnv,
} from '../fixtures/weather';
import { assertTestDatabase } from '../db-guard';
import { TEST_APP_DATABASE_URL } from '../env';
import { adminDb, testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// The forecast service through the real database as home_app (M7 contract
// §5.1, §8.3, §8.6 W2–W4, W8–W13, W18, W20–W23, P4, P5, P8). The provider is
// always the fake: no test reaches the network. Synthetic points and a
// test-only key only.

const { db, pool, close } = testDb();
const admin = adminDb();
/** A second home_app pool, for the concurrent and interrupted cases. */
const other = testDb();
const deps = { db };
let h: Household;

/** The statements a db handle sends (Drizzle's logger; BEGIN and COMMIT are not counted). */
const queries: string[] = [];
const counting = drizzle(pool, {
  schema,
  casing: 'snake_case',
  logger: { logQuery: (q) => void queries.push(q) },
});

const H = 3_600_000;
const MIN = 60_000;
const T0 = new Date('2026-10-13T17:55:00Z'); // 06:55 NZDT, Wednesday 14 October
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);
const BODY = syntheticOpenMeteoBody(utcDayStart(T0), () => ({}), {
  // The provider echoes a location back; HOME must never keep it.
  echo: { latitude: -41.29, longitude: 174.78, elevation: 23 },
});
const fake = (...steps: FakeWeatherStep[]) =>
  fakeWeatherProvider(steps.length ? steps : [{ body: BODY }]);

const savedEnv = { ...process.env };
const setWeatherEnv = (vars: Record<string, string>) => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, vars);
};

/** Every log line written while a test runs (the logger writes JSON lines to stdout/stderr). */
let logs: string[] = [];
const spies: { mockRestore: () => void }[] = [];

type Stored = {
  id: string;
  hours: unknown;
  location_fingerprint: string | null;
  fetched_at: Date | null;
  first_hour: Date | null;
  last_hour: Date | null;
  last_attempt_at: Date | null;
  last_attempt_status: string | null;
};
const TIMES = [
  'fetched_at',
  'first_hour',
  'last_hour',
  'last_attempt_at',
  'created_at',
  'updated_at',
];
const stored = async (): Promise<Stored | null> => {
  const row = (
    await admin.db.execute(sql`select * from weather_forecast where provider = 'open_meteo'`)
  ).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  for (const k of TIMES) if (typeof row[k] === 'string') row[k] = new Date(row[k] as string);
  return row as Stored;
};
/** The weather.refresh audit rows written since the test began, oldest first. */
const audits = async () =>
  (
    await admin.db.execute<{
      meta: unknown;
      actor_user_id: string;
      visibility: string;
      visible_to_user_id: string;
      subject_type: string;
    }>(
      sql`select meta, actor_user_id, visibility, visible_to_user_id, subject_type from audit_log
          where event = 'weather.refresh' and at > ${auditMark}::timestamptz order by at, id`,
    )
  ).rows;
const advisoryLocks = async () =>
  Number(
    (
      await admin.db.execute<{ n: string }>(
        sql`select count(*) as n from pg_locks where locktype = 'advisory' and granted`,
      )
    ).rows[0]?.n,
  );

/** The database clock when the test began: audit rows after it are this test's. */
let auditMark = '';

beforeAll(async () => {
  h = await ensureFixtureUsers(db);
});
beforeEach(async () => {
  await db.execute(sql`delete from weather_forecast`);
  setWeatherEnv(weatherEnv(WELLINGTON_UNROUNDED));
  auditMark = String(
    (await admin.db.execute<{ t: string }>(sql`select clock_timestamp()::text as t`)).rows[0]?.t,
  );
  logs = [];
  for (const stream of [process.stdout, process.stderr])
    spies.push(
      vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
        logs.push(String(chunk));
        return true;
      }),
    );
  queries.length = 0;
});
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});
afterAll(async () => {
  await db.execute(sql`delete from weather_forecast`);
  await close();
  await other.close();
  await admin.close();
});

const refresh = (p = fake(), now = T0, actor: UserActor = h.sam, d: { db: typeof db } = deps) =>
  refreshForecast(actor, p, { now }, d);
const read = (now = T0, actor: UserActor = h.sam) => readForecast(actor, { now }, deps);

/**
 * Asserts nothing location-bearing in a text: a coordinate only as a
 * standalone number, so a timestamp's or a uuid's digits never trip it (Q8).
 */
const clean = (label: string, text: string) => {
  expect(locationLeaksIn(text), label).toEqual([]);
};

describe('a successful refresh, and reading it', () => {
  it('stores the hours, the fingerprint and the times; one audit row { status, hours }; nothing echoed', async () => {
    const p = fake();
    expect(await refresh(p)).toEqual({ status: 'ok', changed: true });
    expect(p.calls).toBe(1);
    expect(p.points).toEqual([{ lat: -41.29, lon: 174.78, elevation: null }]);
    const row = (await stored())!;
    expect(row.location_fingerprint).toBe(FINGERPRINT_VECTORS[0].hex);
    expect(row.fetched_at).toEqual(T0);
    expect(row.last_attempt_at).toEqual(T0);
    expect(row.last_attempt_status).toBe('ok');
    expect((row.hours as unknown[]).length).toBe(191);
    expect(row.first_hour).toEqual(utcDayStart(T0));
    expect(row.last_hour).toEqual(new Date(utcDayStart(T0).getTime() + 190 * H));
    expect((row.hours as Record<string, unknown>[])[0]).toEqual({
      start: utcDayStart(T0).toISOString(),
      temperatureC: 14,
      precipitationMm: 0,
      precipitationProbability: 5,
      windKmh: 15,
      gustKmh: 30,
    });
    const a = await audits();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      meta: { status: 'ok', hours: 191 },
      actor_user_id: h.sam.userId,
      visibility: 'private',
      visible_to_user_id: h.sam.userId,
      subject_type: 'weather_forecast',
    });
    clean('row', JSON.stringify(row).replace(row.location_fingerprint!, ''));
    expect(logs.filter((l) => l.includes('weather'))).toEqual([]);
  });

  it('W2: HOME_ELEVATION=23 with unrounded coordinates: the provider gets the rounded point; nothing exact is stored, audited or logged', async () => {
    setWeatherEnv(weatherEnv(WELLINGTON_UNROUNDED, { HOME_ELEVATION: '23' }));
    const p = fake();
    expect(await refresh(p)).toMatchObject({ status: 'ok' });
    expect(p.points).toEqual([{ lat: -41.29, lon: 174.78, elevation: 20 }]);
    const row = (await stored())!;
    expect(row.location_fingerprint).toBe(FINGERPRINT_VECTORS[1].hex);
    const everything = [
      JSON.stringify(row).replace(row.location_fingerprint!, ''),
      JSON.stringify(await audits()),
      logs.join(''),
      JSON.stringify(await read(at(1))),
    ].join('\n');
    clean('W2', everything);
    expect(everything).not.toMatch(/elevation/i);
  });

  it('the read: one query, no provider, the hours, span, freshness, fetch time and last attempt', async () => {
    const p = fake();
    await refresh(p);
    queries.length = 0;
    const r = await readForecast(h.alex, { now: at(10) }, { db: counting });
    expect(queries).toHaveLength(1);
    expect(p.calls).toBe(1);
    if (!r.configured) throw new Error('configured');
    expect(r.freshness).toBe('fresh');
    expect(r.hours).toHaveLength(191);
    expect(r.span).toEqual({
      from: utcDayStart(T0),
      to: new Date(utcDayStart(T0).getTime() + 191 * H),
    });
    expect(r.fetchedAt).toEqual(T0);
    expect(r.lastAttempt).toEqual({ at: T0, status: 'ok' });
    expect(r.refreshDue).toBe(false);
    expect(
      todaySentence(
        r.fetchedAt && { fetchedAt: r.fetchedAt, hours: r.hours },
        at(8),
        'Pacific/Auckland',
      )?.text,
    ).toBe('Looks dry today.');
  });

  it('no row yet: none, a refresh due, one query', async () => {
    const r = await readForecast(h.sam, { now: T0 }, { db: counting });
    expect(queries).toHaveLength(1);
    expect(r).toEqual({
      configured: true,
      freshness: 'none',
      hours: [],
      span: null,
      fetchedAt: null,
      lastAttempt: null,
      refreshDue: true,
    });
  });

  it('freshness follows fetched_at: fresh, older, unusable (W7 through the service)', async () => {
    await refresh();
    const f = async (m: number) => {
      const r = await read(at(m));
      return r.configured ? r.freshness : null;
    };
    expect([await f(179), await f(180), await f(720), await f(721)]).toEqual([
      'fresh',
      'older',
      'older',
      'unusable',
    ]);
    const unusable = await read(at(721));
    expect(unusable.configured && unusable.hours).toEqual([]);
  });

  it('P4: both adults read the same row; no actor data in it', async () => {
    await refresh();
    expect(JSON.stringify(await read(at(5), h.sam))).toBe(
      JSON.stringify(await read(at(5), h.alex)),
    );
    const row = JSON.stringify(await stored());
    for (const id of [h.sam.userId, h.alex.userId, h.sam.email, h.alex.email])
      expect(row).not.toContain(id);
  });
});

describe('W8: at most hourly, by attempt; 3 hours after rate_limited', () => {
  it('59 minutes: not due, no request; 60: a request', async () => {
    const p = fake();
    await refresh(p);
    expect(await refresh(p, at(59))).toEqual({ status: 'not_due', changed: false });
    expect(p.calls).toBe(1);
    expect(await refresh(p, at(60))).toEqual({ status: 'ok', changed: true });
    expect(p.calls).toBe(2);
    expect(await audits()).toHaveLength(2);
  });

  it('rate_limited: 2:59 no request; 3:00 a request', async () => {
    const p = fake({ fail: 'rate_limited' }, { body: BODY });
    expect(await refresh(p)).toEqual({ status: 'rate_limited', changed: false });
    p.advance();
    expect(await refresh(p, at(179))).toMatchObject({ status: 'not_due' });
    expect(await read(at(179))).toMatchObject({ configured: true, refreshDue: false });
    expect(p.calls).toBe(1);
    expect(await refresh(p, at(180))).toEqual({ status: 'ok', changed: true });
    expect(p.calls).toBe(2);
  });
});

describe('W9: single flight', () => {
  it('two adults and two tabs of one adult at once: one provider call, the others busy, no duplicate rows', async () => {
    const p = fake();
    const held = p.hold();
    const first = refresh(p, T0, h.sam);
    await held.reached;
    // The first holds the lock inside its transaction, across the fetch.
    expect(await advisoryLocks()).toBe(1);
    const second = await refresh(p, T0, h.alex, { db: other.db });
    const thirdTab = await refresh(p, T0, h.sam, { db: other.db });
    expect(second).toEqual({ status: 'busy', changed: false });
    expect(thirdTab).toEqual({ status: 'busy', changed: false });
    held.release();
    expect(await first).toEqual({ status: 'ok', changed: true });
    expect(p.calls).toBe(1);
    expect(await audits()).toHaveLength(1);
    const n = await admin.db.execute(sql`select count(*)::int as n from weather_forecast`);
    expect(n.rows[0]?.n).toBe(1);
    expect(await advisoryLocks()).toBe(0);
  });
});

describe('W9, §5.1: the timeouts take effect inside the refresh’s own transaction', () => {
  it('during the fetch, on the connection holding the lock: statement_timeout 5s cancels a statement after about 5 s; idle_in_transaction_session_timeout 25s; both gone after commit', async () => {
    // One connection only, so the read outside, the transaction and the
    // checks after commit all run on the same backend. The provider runs
    // inside the transaction (before any write), on that idle connection.
    const single = new Pool({
      connectionString: assertTestDatabase(TEST_APP_DATABASE_URL),
      max: 1,
    });
    single.on('connect', (c) => void c.on('error', () => undefined));
    let client: PoolClient | null = null;
    single.on('acquire', (c) => void (client = c));
    const singleDb = drizzle(single, { schema, casing: 'snake_case' });
    const show = async (c: { query: PoolClient['query'] }) => {
      const r = await c.query<{ s: string; i: string; pid: number }>(
        `select current_setting('statement_timeout') as s,
                current_setting('idle_in_transaction_session_timeout') as i,
                pg_backend_pid() as pid`,
      );
      return r.rows[0]!;
    };
    try {
      const baseline = await show(single);
      expect(baseline.s).not.toBe('5s');
      expect(baseline.i).not.toBe('25s');
      const inner = fake();
      const seen: Record<string, unknown> = {};
      const probing = {
        kind: 'open_meteo' as const,
        async fetchForecast(point: Parameters<typeof inner.fetchForecast>[0]) {
          const c = client!;
          const during = await show(c);
          // This connection is the refresh's: it holds the advisory lock, in a transaction.
          const own = await c.query<{ locks: number; tx: boolean }>(
            `select (select count(*)::int from pg_locks where pid = pg_backend_pid() and locktype = 'advisory' and granted) as locks,
                    now() <> statement_timestamp() as tx`,
          );
          // A slow statement on it is cancelled by the 5 s timeout (a savepoint
          // keeps the refresh's transaction usable afterwards).
          await c.query('savepoint q1');
          const t = performance.now();
          const cancelled = await c
            .query('select pg_sleep(8)')
            .then(() => null)
            .catch((e: { code?: string }) => e.code ?? 'unknown');
          const elapsed = performance.now() - t;
          await c.query('rollback to savepoint q1');
          Object.assign(seen, { during, own: own.rows[0], cancelled, elapsed });
          return inner.fetchForecast(point);
        },
      };
      expect(await refresh(probing, T0, h.sam, { db: singleDb as typeof db })).toEqual({
        status: 'ok',
        changed: true,
      });
      expect(seen.during).toEqual({ s: '5s', i: '25s', pid: baseline.pid });
      expect(seen.own).toEqual({ locks: 1, tx: true });
      // 57014: query_canceled ("canceling statement due to statement timeout").
      expect(seen.cancelled).toBe('57014');
      expect(seen.elapsed as number).toBeGreaterThan(4_900);
      expect(seen.elapsed as number).toBeLessThan(6_500);
      expect(inner.calls).toBe(1);
      // SET LOCAL: after commit the same backend is back to its own settings.
      expect(await show(single)).toEqual(baseline);
      expect(await audits()).toHaveLength(1);
    } finally {
      await single.end();
    }
  }, 30_000);
});

describe('W4, W10, W18: failures keep the last good forecast and carry codes only', () => {
  const nonMonotonic = BODY.replace(/"time":\[(\d+),(\d+)/, '"time":[$2,$1');
  it.each([
    ['timeout', { fail: 'timeout' }],
    ['rate_limited', { fail: 'rate_limited' }],
    ['unreachable', { fail: 'unreachable' }],
    ['too_large', { fail: 'too_large' }],
    ['bad_response', { body: nonMonotonic }],
    ['bad_response', { body: 'not json' }],
    ['bad_response', { hours: [] }],
  ] as [string, FakeWeatherStep][])('%s', async (code, step) => {
    await refresh();
    const before = (await stored())!;
    const p = fake(step);
    let thrown: unknown = null;
    const outcome = await refresh(p, at(61)).catch((e: unknown) => (thrown = e));
    expect(thrown).toBeNull();
    expect(outcome).toEqual({ status: code, changed: false });
    const after = (await stored())!;
    expect(after.hours).toEqual(before.hours);
    expect(after.fetched_at).toEqual(before.fetched_at);
    expect(after.location_fingerprint).toBe(before.location_fingerprint);
    expect(after.last_attempt_at).toEqual(at(61));
    expect(after.last_attempt_status).toBe(code);
    const a = await audits();
    expect(a.map((r) => r.meta)).toEqual([
      { status: 'ok', hours: 191 },
      { status: code, hours: 0 },
    ]);
    // W18: exactly one log line, the event and the code; nothing else.
    const lines = logs.filter((l) => l.trim().startsWith('{'));
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(Object.keys(entry).sort()).toEqual(['code', 'event', 'level', 'ts']);
    expect(entry).toMatchObject({ event: 'weather_refresh_failed', code, level: 'warn' });
    clean('logs', logs.join(''));
    clean('audit', JSON.stringify(a));
    clean('row', JSON.stringify(after).replace(after.location_fingerprint!, ''));
    clean('outcome', JSON.stringify(outcome));
    // The forecast still reads as before.
    const r = await read(at(62));
    expect(r.configured && r.freshness).toBe('fresh');
  });
});

describe('W11: retention', () => {
  it('a failure when the last success is 24:01 old clears the hours, keeps fetched_at; Today says it hasn’t updated', async () => {
    await refresh();
    const p = fake({ fail: 'unreachable' });
    expect(await refresh(p, at(24 * 60 + 1))).toEqual({ status: 'unreachable', changed: true });
    const row = (await stored())!;
    expect(row.hours).toBeNull();
    expect(row.first_hour).toBeNull();
    expect(row.fetched_at).toEqual(T0);
    expect(row.location_fingerprint).toBe(FINGERPRINT_VECTORS[0].hex);
    const r = await read(at(24 * 60 + 2));
    if (!r.configured) throw new Error('configured');
    expect(r).toMatchObject({ freshness: 'unusable', hours: [], fetchedAt: T0 });
    expect(staleSentence(r.fetchedAt, at(24 * 60 + 2), 'Pacific/Auckland')?.text).toBe(
      "The forecast hasn't updated since yesterday.",
    );
  });

  it('a failure at 23:59 keeps the hours', async () => {
    await refresh();
    await refresh(fake({ fail: 'timeout' }), at(23 * 60 + 59));
    expect((await stored())!.hours).not.toBeNull();
  });
});

describe('W12, W21: no location or no valid key is weather unconfigured', () => {
  it.each([
    ['HOME_LAT unset', {}],
    ['HOME_LAT=95', weatherEnv({ lat: '95', lon: '174.78' })],
    ['key unset', { HOME_LAT: '-41.29', HOME_LON: '174.78' }],
    ['key invalid', weatherEnv(undefined, { HOME_WEATHER_LOCATION_KEY: 'short' })],
    [
      'key equal to HOME_FINGERPRINT_KEY',
      weatherEnv(undefined, { HOME_WEATHER_LOCATION_KEY: process.env.HOME_FINGERPRINT_KEY! }),
    ],
  ])('%s: no query, no request, no forecast; refresh not_configured', async (_n, vars) => {
    await refresh(); // a stored forecast exists
    setWeatherEnv(vars);
    queries.length = 0;
    const p = fake();
    expect(await readForecast(h.sam, { now: at(5) }, { db: counting })).toEqual({
      configured: false,
    });
    expect(await refreshForecast(h.sam, p, { now: at(120) }, { db: counting })).toEqual({
      status: 'not_configured',
      changed: false,
    });
    expect(queries).toEqual([]);
    expect(p.calls).toBe(0);
  });

  it('key missing: daylight still comes from the location', () => {
    setWeatherEnv({ HOME_LAT: '-41.29', HOME_LON: '174.78' });
    const c = weatherConfig();
    expect(c.status).toBe('key_missing');
    expect(daylightFor('2026-10-17', 'point' in c ? c.point : null)).not.toBeNull();
  });
});

describe('W13, P7, P8: the gate and Kev, before any query or request', () => {
  it('W13: Production with the gate closed refuses with real_data_closed; nothing read, fetched or written', async () => {
    process.env.VERCEL_ENV = 'production';
    delete process.env.HOME_REAL_DATA;
    const p = fake();
    const e = await refreshForecast(h.sam, p, { now: T0 }, { db: counting }).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(NotPermittedError);
    expect((e as NotPermittedError).code).toBe('real_data_closed');
    expect(queries).toEqual([]);
    expect(p.calls).toBe(0);
    expect(await stored()).toBeNull();
    expect(await audits()).toEqual([]);
    for (const value of ['', 'OPEN', ' open', 'true']) {
      process.env.HOME_REAL_DATA = value;
      await expect(refreshForecast(h.sam, p, { now: T0 }, { db: counting })).rejects.toMatchObject({
        code: 'real_data_closed',
      });
    }
    expect(p.calls).toBe(0);
  });

  it('P8: Kev, a hand-made sync actor and the system are refused before any query', async () => {
    const p = fake();
    for (const [actor, code] of [
      [h.samViaKev, 'kev_cannot_write'],
      [{ ...h.sam, via: 'sync' }, 'sync_actor'],
      [{ kind: 'system', via: 'system' }, 'not_a_user'],
    ] as [UserActor, string][]) {
      const e = await refreshForecast(actor, p, { now: T0 }, { db: counting }).catch(
        (x: unknown) => x,
      );
      expect((e as NotPermittedError).code).toBe(code);
    }
    expect(queries).toEqual([]);
    expect(p.calls).toBe(0);
    expect(await stored()).toBeNull();
  });

  it('the read requires a person: the system actor is refused', async () => {
    await expect(
      readForecast({ kind: 'system', via: 'system' } as unknown as UserActor, {}, deps),
    ).rejects.toMatchObject({ code: 'not_a_user' });
  });
});

describe('W20, W21: a location, elevation or key change', () => {
  it('W20: another location shows no forecast, is due at once, and the first attempt clears the old hours (failure)', async () => {
    await refresh();
    setWeatherEnv(weatherEnv(CHRISTCHURCH));
    const r = await read(at(1));
    expect(r).toMatchObject({
      configured: true,
      freshness: 'none',
      hours: [],
      fetchedAt: null,
      refreshDue: true,
    });
    // Daylight is Christchurch's, from configuration.
    const c = weatherConfig();
    expect('point' in c && c.point).toEqual({ lat: -43.53, lon: 172.64, elevation: null });
    const p = fake({ fail: 'unreachable' });
    expect(await refresh(p, at(1))).toEqual({ status: 'unreachable', changed: false });
    expect(p.points).toEqual([{ lat: -43.53, lon: 172.64, elevation: null }]);
    const row = (await stored())!;
    expect(row).toMatchObject({
      hours: null,
      location_fingerprint: null,
      fetched_at: null,
      first_hour: null,
      last_hour: null,
      last_attempt_status: 'unreachable',
    });
    expect(await read(at(2))).toMatchObject({ freshness: 'none', hours: [] });
    // The next attempt waits the normal 60 minutes.
    expect(await refresh(p, at(60))).toMatchObject({ status: 'not_due' });
    expect(await refresh(fake(), at(61))).toEqual({ status: 'ok', changed: true });
    expect((await stored())!.location_fingerprint).toBe(FINGERPRINT_VECTORS[2].hex);
  });

  it('W20: on success the new fingerprint is stored and words return', async () => {
    await refresh();
    setWeatherEnv(weatherEnv(CHRISTCHURCH));
    expect(await refresh(fake(), at(1))).toEqual({ status: 'ok', changed: true });
    expect((await stored())!.location_fingerprint).toBe(FINGERPRINT_VECTORS[2].hex);
    expect(await read(at(2))).toMatchObject({ freshness: 'fresh', fetchedAt: at(1) });
  });

  it('W20: within 3 hours of rate_limited, no request, and still no forecast', async () => {
    await refresh();
    await refresh(fake({ fail: 'rate_limited' }), at(60));
    setWeatherEnv(weatherEnv(CHRISTCHURCH));
    const p = fake();
    expect(await refresh(p, at(61))).toMatchObject({ status: 'not_due' });
    expect(p.calls).toBe(0);
    expect(await read(at(61))).toMatchObject({ freshness: 'none', refreshDue: false });
    expect(await refresh(p, at(240))).toMatchObject({ status: 'ok' });
  });

  it.each([
    [
      'a rotated key',
      weatherEnv(undefined, { HOME_WEATHER_LOCATION_KEY: TEST_WEATHER_KEY_ROTATED }),
    ],
    ['HOME_ELEVATION changed alone', weatherEnv(undefined, { HOME_ELEVATION: '40' })],
  ])('W21: %s is a mismatch, behaving as W20', async (_n, vars) => {
    await refresh();
    setWeatherEnv(vars);
    expect(await read(at(1))).toMatchObject({ freshness: 'none', hours: [], refreshDue: true });
    const p = fake({ fail: 'timeout' });
    await refresh(p, at(1));
    expect(p.calls).toBe(1);
    expect((await stored())!).toMatchObject({
      hours: null,
      location_fingerprint: null,
      fetched_at: null,
    });
  });
});

describe('W22: a refresh stopped after the fetch, before commit', () => {
  const lockHolders = async () =>
    (
      await other.db.execute<{ pid: number }>(
        sql`select l.pid from pg_locks l where l.locktype = 'advisory' and l.granted`,
      )
    ).rows.map((r) => r.pid);

  it('the connection closed: nothing written, no audit row, the lock released at once, the next request fetches', async () => {
    await refresh();
    const before = (await stored())!;
    const p = fake();
    const held = p.hold();
    const stopped = refresh(p, at(61)).catch((e: unknown) => e);
    await held.reached;
    const [pid] = await lockHolders();
    expect(pid).toBeTypeOf('number');
    // The function's connection goes away (the instance stopped, the client gone).
    await other.db.execute(sql`select pg_terminate_backend(${pid}::int)`);
    held.release();
    const e = await stopped;
    expect(e).toBeInstanceOf(WeatherUnexpectedError);
    expect(await lockHolders()).toEqual([]);
    const after = (await stored())!;
    expect(after.hours).toEqual(before.hours);
    expect(after.fetched_at).toEqual(before.fetched_at);
    expect(after.last_attempt_at).toEqual(before.last_attempt_at);
    expect(await audits()).toHaveLength(1);
    const next = fake();
    expect(await refresh(next, at(62))).toEqual({ status: 'ok', changed: true });
    expect(next.calls).toBe(1);
  });

  it('the session left idle in its transaction (a frozen instance): ended within 25 seconds, nothing written, the next request proceeds', async () => {
    await refresh();
    const before = (await stored())!;
    const p = fake();
    const held = p.hold();
    const frozen = refresh(p, at(61)).catch((e: unknown) => e);
    await held.reached;
    expect(await lockHolders()).toHaveLength(1);
    const started = Date.now();
    while ((await lockHolders()).length && Date.now() - started < 35_000)
      await new Promise((r) => setTimeout(r, 250));
    const released = Date.now() - started;
    expect(await lockHolders()).toEqual([]);
    expect(released).toBeLessThan(27_000);
    expect(released).toBeGreaterThan(20_000);
    // Meanwhile nothing was recorded, so the next eligible request fetches.
    const next = fake();
    expect(await refresh(next, at(62), h.alex, { db: other.db })).toEqual({
      status: 'ok',
      changed: true,
    });
    expect(next.calls).toBe(1);
    // The frozen one wakes to a closed session: it fails and writes nothing.
    held.release();
    expect(await frozen).toBeInstanceOf(WeatherUnexpectedError);
    const a = await audits();
    expect(a.map((r) => r.actor_user_id)).toEqual([h.sam.userId, h.alex.userId]);
    expect((await stored())!.last_attempt_at).toEqual(at(62));
    expect(before.last_attempt_at).toEqual(T0);
  }, 60_000);
});

describe('W23: an unexpected exception inside the service', () => {
  it('rolls back, logs `unexpected` only, carries nothing', async () => {
    await refresh();
    const before = (await stored())!;
    const raw = new Error(
      'boom at https://api.open-meteo.com/v1/forecast?latitude=-41.29&longitude=174.78',
    );
    const p = fake({ throws: raw });
    const e = (await refresh(p, at(61)).catch((x: unknown) => x)) as Error;
    expect(e).toBeInstanceOf(WeatherUnexpectedError);
    expect(e.message).toBe('weather_unexpected');
    expect(e.cause).toBeUndefined();
    clean('thrown', `${e.message} ${e.stack} ${JSON.stringify(e)}`);
    expect(await stored()).toEqual(before);
    expect(await audits()).toHaveLength(1);
    const lines = logs.filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      event: 'weather_refresh_failed',
      code: 'unexpected',
    });
    expect(Object.keys(lines[0]).sort()).toEqual(['code', 'event', 'level', 'ts']);
    clean('logs', logs.join(''));
    expect(await advisoryLocks()).toBe(0);
  });
});

describe('P4, P5: privacy of the refresh', () => {
  it('P4: the audit row is in the triggering adult’s Activity only, with { status, hours }', async () => {
    await refresh(fake(), T0, h.alex);
    const id = (await stored())!.id;
    const about = async (actor: UserActor) =>
      (await listAudit(actor, { limit: 200 })).rows.filter((r) => r.subjectId === id);
    expect((await about(h.alex)).map((r) => [r.event, r.meta])).toEqual([
      ['weather.refresh', { status: 'ok', hours: 191 }],
    ]);
    expect(await about(h.sam)).toEqual([]);
  });

  it('P5: after a refresh, a failed refresh and a location change, no coordinate, URL, key or canonical string anywhere; the fingerprint only in its column', async () => {
    await refresh(fake(), T0, h.sam);
    await refresh(fake({ fail: 'rate_limited' }), at(61), h.alex);
    setWeatherEnv(weatherEnv(CHRISTCHURCH, { HOME_ELEVATION: '37' }));
    await refresh(fake({ fail: 'bad_response' }), at(61 + 180), h.sam);
    await refresh(fake(), at(61 + 240), h.sam);
    const row = (await stored())!;
    const fingerprints = FINGERPRINT_VECTORS.map((v) => v.hex);
    clean('row', JSON.stringify(row).replace(row.location_fingerprint!, ''));
    const a = JSON.stringify(await audits());
    clean('audit', a);
    for (const fp of [...fingerprints, row.location_fingerprint!]) expect(a).not.toContain(fp);
    const logText = logs.join('');
    clean('logs', logText);
    for (const fp of [...fingerprints, row.location_fingerprint!])
      expect(logText).not.toContain(fp);
    // The raw elevation, checked without each line's timestamp, which can hold any digits.
    const withoutTimestamps = logs
      .flatMap((l) => l.split('\n'))
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => {
        const line = JSON.parse(l) as Record<string, unknown>;
        delete line.ts;
        return JSON.stringify(line);
      })
      .join('\n');
    expect(withoutTimestamps).toContain('weather_refresh_failed');
    expect(withoutTimestamps).not.toContain('37');
    for (const adult of [h.sam, h.alex]) {
      const exported = JSON.stringify(await exportFor(adult, {}, deps));
      clean('export', exported);
      expect(exported).not.toContain(row.location_fingerprint!);
      // The forecast itself is not exported (P6); only the adult's own Activity names it.
      expect(Object.keys(JSON.parse(exported).records)).not.toContain('weatherForecast');
    }
    // The schema holds no coordinate, elevation or location column.
    const cols = await admin.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'weather_forecast'`,
    );
    for (const c of cols.rows)
      expect(c.column_name).not.toMatch(/lat|lon|elev|coord|location$|user/);
  });
});

describe('performance (recorded in the PR)', () => {
  it('cache read: one query; refresh: a bounded statement count; payload well under the cap', async () => {
    await refresh(fake(), T0, h.sam, { db: counting });
    const refreshStatements = [...queries];
    queries.length = 0;
    const N = 50;
    const t = performance.now();
    for (let i = 0; i < N; i++) await readForecast(h.sam, { now: at(5) }, { db: counting });
    const perRead = (performance.now() - t) / N;
    expect(queries.length).toBe(N);
    const bytes = Number(
      (
        await admin.db.execute<{ n: string }>(
          sql`select octet_length(hours::text) as n from weather_forecast`,
        )
      ).rows[0]?.n,
    );
    const payload = Buffer.byteLength(BODY);
    expect(bytes).toBeLessThan(512 * 1024);
    // The exact sequence of contract §5.1: one read outside, then one transaction.
    expect(
      refreshStatements.map((q) => q.split(/\s+/).slice(0, 2).join(' ').toLowerCase()),
    ).toEqual([
      'select "id",',
      'begin',
      'set local',
      'set local',
      'select pg_try_advisory_xact_lock(hashtextextended($1,',
      'select "id",',
      'insert into',
      'insert into',
      'commit',
    ]);
    // And the values themselves (contract §5.1).
    expect(refreshStatements[2]).toMatch(/^set local statement_timeout = '5s'$/i);
    expect(refreshStatements[3]).toMatch(
      /^set local idle_in_transaction_session_timeout = '25s'$/i,
    );
    while (spies.length) spies.pop()!.mockRestore();
    console.info(
      `[perf] read: ${queries.length / N} query, ${perRead.toFixed(2)} ms avg over ${N}; refresh: ${refreshStatements.length} statements (BEGIN and COMMIT included); stored hours ${bytes} bytes; provider body ${payload} bytes; cap ${512 * 1024}`,
    );
  });
});
