import { appendFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assembleBundle } from '@/kev/context/assemble';
import { createToolRunner } from '@/kev/tools/registry';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { adminDb, testDb } from './db';
import {
  buildKevFixture,
  clearKevFixture,
  NOW,
  SAT,
  SUN,
  THU,
  ZONE,
  type KevFixture,
} from './kev-fixture';

// Kev's tools at scale (M8 contract §6.1 "Performance", §13, §15.3 "Query
// counts per tool, constant in record counts"; T21's large half). The
// contract's fixture, measured; then a large synthetic household added in
// bulk (2,000 events, 200 of them weekly series, half of them private to
// Alex, each with a person; 500 tasks, some due, some scheduled), measured
// again as Sam. Per tool: the queries one call makes (equal at both sizes:
// no N+1, one recurrence expansion per call), its result size (always
// within 50 items and 12 KiB, truncated and counted when cut) and its time.
// The bundle the same. Timings are recorded, not asserted (the 200 ms p95
// target is measured in Package 6 on the deployed database); set
// KEV_PERF_OUT to a file to keep the table. Synthetic only.

const { db, pool, close } = testDb();
const admin = adminDb();
const deps = { db };
let f: KevFixture;
const savedEnv = { ...process.env };

let queries = 0;
const send = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof send>) => {
  queries++;
  return send(...args);
}) as typeof pool.query;

const CALLS = (fx: KevFixture): [string, unknown][] => [
  ['get_today', {}],
  ['get_agenda', { from: '2026-10-14', to: '2026-11-13' }],
  ['get_conflicts', { from: '2026-10-14', to: '2027-01-11' }],
  ['get_insights', { surface: 'today' }],
  ['get_insights', { surface: 'forward_week' }],
  ['get_tasks', {}],
  ['get_projects', {}],
  ['get_projects', { project_id: fx.id.fence }],
  ['get_people', {}],
  ['get_context', {}],
  ['get_calendar_health', {}],
  ['get_weather', { from: '2026-10-14', to: '2026-10-21' }],
  ['get_gaps', { from: THU, to: '2026-10-21', scope: 'household' }],
  ['get_gaps', { from: SAT, to: SUN, scope: 'household', needs: ['dry_weather', 'daylight'] }],
  ['search', { query: 'scale' }],
];

type Row = {
  call: string;
  queries: number;
  bytes: number;
  p50: number;
  p95: number;
  truncated: boolean;
};

async function measure(label: string, repeat = 10): Promise<Row[]> {
  const rows: Row[] = [];
  const runner = createToolRunner({
    actor: f.kev.sam,
    now: NOW,
    timeZone: ZONE,
    deps,
    attemptId: crypto.randomUUID(),
  });
  for (const [name, input] of CALLS(f)) {
    const times: number[] = [];
    let q = 0;
    let bytes = 0;
    let truncated = false;
    for (let i = 0; i < repeat; i++) {
      const before = queries;
      const t0 = performance.now();
      const out = await runner.run(name, input);
      times.push(performance.now() - t0);
      q = queries - before;
      if (out.kind !== 'ran' || !out.result.ok) throw new Error(`${name} failed`);
      bytes = Buffer.byteLength(out.content);
      truncated = (out.result.data as { truncated?: boolean }).truncated === true;
    }
    times.sort((a, b) => a - b);
    rows.push({
      call: `${name} ${JSON.stringify(input).replace(/[0-9a-f-]{36}/g, 'id')}`,
      queries: q,
      bytes,
      p50: Math.round(times[Math.floor(repeat / 2)]!),
      p95: Math.round(times[Math.ceil(repeat * 0.95) - 1]!),
      truncated,
    });
  }
  const times: number[] = [];
  let q = 0;
  let bytes = 0;
  for (let i = 0; i < repeat; i++) {
    const before = queries;
    const t0 = performance.now();
    const b = await assembleBundle({ actor: f.kev.sam, now: NOW, timeZone: ZONE, deps });
    times.push(performance.now() - t0);
    q = queries - before;
    bytes = Buffer.byteLength(b.text);
  }
  times.sort((a, b) => a - b);
  rows.push({
    call: 'bundle',
    queries: q,
    bytes,
    p50: Math.round(times[Math.floor(repeat / 2)]!),
    p95: Math.round(times[Math.ceil(repeat * 0.95) - 1]!),
    truncated: false,
  });
  if (process.env.KEV_PERF_OUT)
    appendFileSync(
      process.env.KEV_PERF_OUT,
      `\n${label}\n${rows.map((r) => `${r.call}\tq=${r.queries}\t${r.bytes}B\tp50=${r.p50}ms\tp95=${r.p95}ms${r.truncated ? '\ttruncated' : ''}`).join('\n')}\n`,
    );
  return rows;
}

/** 2,000 events (200 weekly series), each with a person, half private to Alex; 500 tasks. */
async function bulk() {
  const sam = f.h.sam.userId;
  const alex = f.h.alex.userId;
  await admin.db.execute(sql`
    insert into event (created_by, created_via, visibility, title, kind, all_day, starts_at, ends_at, time_zone, rrule)
    select case when n % 2 = 0 then ${sam} else ${alex} end, 'ui',
           case when n % 2 = 0 then 'household' else 'private' end,
           'scale event ' || n, 'activity', false,
           timestamptz '2026-09-14 08:00:00+12' + (n % 150) * interval '1 day' + (n % 11) * interval '1 hour',
           timestamptz '2026-09-14 08:45:00+12' + (n % 150) * interval '1 day' + (n % 11) * interval '1 hour',
           'Pacific/Auckland',
           case when n <= 200 then 'FREQ=WEEKLY' else null end
    from generate_series(1, 2000) as n`);
  await admin.db.execute(sql`
    insert into event_person (event_id, person_id, role, created_by, created_via)
    select e.id,
           (array[${f.id.milo}::uuid, ${f.id.isla}::uuid, ${f.id.sam}::uuid, ${f.id.alex}::uuid])[1 + (row_number() over (order by e.id)) % 4],
           'attending', e.created_by, 'ui'
    from event e where e.title like 'scale event %'`);
  await admin.db.execute(sql`
    insert into task (created_by, created_via, visibility, title, status, due_date, scheduled_starts_at, scheduled_ends_at, assignee_person_id)
    select case when n % 3 = 0 then ${alex} else ${sam} end, 'ui',
           case when n % 3 = 0 then 'private' else 'household' end,
           'scale task ' || n, 'open',
           case when n % 4 = 0 then date '2026-10-14' + (n % 40) else null end,
           case when n % 25 = 0 then timestamptz '2026-10-15 09:00:00+13' + (n % 30) * interval '1 day' else null end,
           case when n % 25 = 0 then timestamptz '2026-10-15 10:00:00+13' + (n % 30) * interval '1 day' else null end,
           case when n % 5 = 0 then ${f.id.sam}::uuid else null end
    from generate_series(1, 500) as n`);
}

beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  f = await buildKevFixture(db, admin.db);
});
afterAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await clearKevFixture(db, admin.db);
  await close();
  await admin.close();
});

describe('the bundle’s people: counted before the cut, cut at 50, within budget', () => {
  /** Sam's visible people made up to `total` with household people; Alex's private ones never count. */
  async function peopleUpTo(total: number) {
    await admin.db.execute(sql`delete from person where name like 'bp %'`);
    const base = 6; // Sam, Alex, Milo, Isla, Nana Jo and Sam's own private canary.
    await admin.db.execute(sql`
      insert into person (created_by, created_via, visibility, name, role, in_household)
      select ${f.h.sam.userId}, 'ui', 'household', 'bp ' || lpad(n::text, 3, '0'), 'other', false
      from generate_series(1, ${total - base}) as n`);
    // The other adult's private people: the reader's count must not move.
    await admin.db.execute(sql`
      insert into person (created_by, created_via, visibility, name, role, in_household)
      select ${f.h.alex.userId}, 'ui', 'private', 'bp alex ' || n, 'other', false
      from generate_series(1, 25) as n`);
    return assembleBundle({ actor: f.kev.sam, now: NOW, timeZone: ZONE, deps });
  }

  afterAll(async () => {
    await admin.db.execute(sql`delete from person where name like 'bp %'`);
  });

  it('fewer than, exactly and one more than 50; and 300: the count is the reader’s, the flag exact', async () => {
    const fixture = await assembleBundle({ actor: f.kev.sam, now: NOW, timeZone: ZONE, deps });
    expect(fixture.bundle).toMatchObject({ people_count: 6, people_truncated: false });
    expect(fixture.bundle.people).toHaveLength(6);
    for (const [total, listed, cut] of [
      [49, 49, false],
      [50, 50, false],
      [51, 50, true],
      [300, 50, true],
    ] as const) {
      const b = await peopleUpTo(total);
      expect(b.bundle.people_count, String(total)).toBe(total);
      expect(b.bundle.people, String(total)).toHaveLength(listed);
      expect(b.bundle.people_truncated, String(total)).toBe(cut);
      expect(Buffer.byteLength(b.text), String(total)).toBeLessThanOrEqual(12 * 1024);
      expect(b.text).not.toContain('bp alex');
      // Every listed person is in the ledger's refs.
      for (const p of b.bundle.people) expect(b.refs).toContainEqual(p.ref);
    }
  });
});

describe('T21: cost per tool, at the fixture’s size and at scale', () => {
  it('queries per call are equal at both sizes; every result stays within 50 items and 12 KiB', async () => {
    const small = await measure('fixture (contract §15.6)');
    await bulk();
    const large = await measure('large (2,000 events incl. 200 weekly series; 500 tasks)');
    expect(large.map((r) => [r.call, r.queries])).toEqual(small.map((r) => [r.call, r.queries]));
    for (const r of large) expect(r.bytes, r.call).toBeLessThanOrEqual(12 * 1024);
    // At scale the long lists are cut, and say so.
    const cut = large.filter((r) => r.truncated).map((r) => r.call.split(' ')[0]);
    expect(cut).toEqual(expect.arrayContaining(['get_agenda', 'get_tasks', 'search']));
  }, 120_000);
});
