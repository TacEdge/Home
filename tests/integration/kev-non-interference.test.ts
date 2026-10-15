import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assembleBundle } from '@/kev/context/assemble';
import { createToolRunner, REGISTRY } from '@/kev/tools/registry';
import type { UserActor } from '@/trust/actor';
import { SENSITIVE_MARK } from '../fixtures/family';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { adminDb, testDb } from './db';
import {
  addPrivateFor,
  buildKevFixture,
  clearKevFixture,
  NOW,
  SAT,
  SUN,
  THU,
  ZONE,
  type Adult,
  type KevFixture,
} from './kev-fixture';

// The privacy invariant, extended to Kev (M8 contract §9.2, §15.2; matrix
// rows S1, S2 and S3 for every tool and the bundle). For each adult, §15.2's
// records only the other adult can see are added: private events inside the
// weekend and on Thursday evening, a private task with an estimate and
// `dry_weather`, a private project with a note, a private person, private
// context, a private stale calendar, their responses on a conflict and an
// opening, and their conversation naming the reader's records. Then:
//
//   S1  the reader's every tool output (the JSON the model is sent), its
//       refs (the ledger's entries), its trace entry, and the reader's
//       volatile bundle with its refs are byte-identical before and after;
//   S2  the same records change the other adult's own outputs, tool by tool
//       (non-vacuous: the probes do reach those records), except the
//       forecast, which is household-level and has no private record;
//   S3  sensitive household and private context appear in neither adult's
//       bundle or any tool output.
//
// Through the real services as `home_app`, with the contract's fixture.
// Synthetic only.

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
const ATTEMPT = '0b5e2f61-3c44-4d9a-9a7e-5f1d2c3b4a50';
const savedEnv = { ...process.env };

/** Many calls per tool, aimed where the other adult's records land. */
const PROBES = (f: KevFixture, reader: Adult): [string, unknown][] => {
  const self = reader === 'sam' ? f.id.sam : f.id.alex;
  const other = reader === 'sam' ? f.id.alex : f.id.sam;
  return [
    ['get_today', {}],
    ['get_agenda', { from: '2026-10-14', to: '2026-10-20' }],
    ['get_agenda', { from: SAT, to: SUN, person_ids: [self, other] }],
    ['get_agenda', { from: '2026-10-07', to: '2026-11-06' }],
    ['get_conflicts', { from: THU, to: THU }],
    ['get_conflicts', { from: '2026-10-14', to: '2027-01-11' }],
    ['get_insights', { surface: 'today' }],
    ['get_insights', { surface: 'forward_week' }],
    ['get_tasks', {}],
    ['get_tasks', { assignee: 'me' }],
    ['get_tasks', { assignee: other }],
    ['get_tasks', { status: 'done' }],
    ['get_projects', {}],
    ['get_projects', { project_id: f.id.fence }],
    ['get_people', {}],
    ['get_people', { person_id: f.id.milo }],
    ['get_context', {}],
    ['get_context', { subject_type: 'household' }],
    ['get_context', { subject_type: 'person' }],
    ['get_calendar_health', {}],
    ['get_weather', { from: '2026-10-14', to: '2026-10-21' }],
    ['get_gaps', { from: SAT, to: SUN, scope: 'household' }],
    ['get_gaps', { from: THU, to: THU, scope: 'household' }],
    ['get_gaps', { from: THU, to: SUN, scope: self }],
    ['get_gaps', { from: THU, to: THU, scope: other }],
    [
      'get_gaps',
      {
        from: SAT,
        to: SUN,
        scope: 'household',
        min_minutes: 120,
        needs: ['dry_weather', 'daylight'],
      },
    ],
    ['search', { query: 'ni-' }],
    ['search', { query: 'an' }],
    ['search', { query: 'thursday' }],
  ];
};

type Snapshot = Map<string, string>;

/** Everything Kev could carry for one adult: each call's JSON, refs and trace; the bundle and its refs. */
async function snapshot(f: KevFixture, actor: UserActor, reader: Adult): Promise<Snapshot> {
  const out: Snapshot = new Map();
  const runner = createToolRunner({ actor, now: NOW, timeZone: ZONE, deps, attemptId: ATTEMPT });
  for (const [name, input] of PROBES(f, reader)) {
    const r = await runner.run(name, input);
    if (r.kind !== 'ran') throw new Error(`${name} refused`);
    expect(r.result.ok, `${reader} ${name} ${JSON.stringify(input)}`).toBe(true);
    out.set(
      `${name} ${JSON.stringify(input)}`,
      JSON.stringify({
        content: r.content,
        refs: r.result.ok ? r.result.refs : null,
        trace: r.trace,
      }),
    );
  }
  const bundle = await assembleBundle({ actor, now: NOW, timeZone: ZONE, deps });
  out.set('bundle', JSON.stringify({ text: bundle.text, refs: bundle.refs }));
  return out;
}

const toolOf = (k: string) => k.split(' ')[0]!;

beforeAll(() => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
});
afterAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await clearKevFixture(db, admin.db);
  await close();
  await admin.close();
});

describe.each([
  ['sam', 'alex'],
  ['alex', 'sam'],
] as const)('%s reads; %s adds private records', (reader, other) => {
  let before: Snapshot;
  let after: Snapshot;
  let otherBefore: Snapshot;
  let otherAfter: Snapshot;
  let f: KevFixture;

  beforeAll(async () => {
    f = await buildKevFixture(db, admin.db);
    before = await snapshot(f, f.kev[reader], reader);
    otherBefore = await snapshot(f, f.kev[other], other);
    await addPrivateFor(f, other, db, admin.db);
    after = await snapshot(f, f.kev[reader], reader);
    otherAfter = await snapshot(f, f.kev[other], other);
  });

  it('probes every tool', () => {
    const tools = new Set([...before.keys()].filter((k) => k !== 'bundle').map(toolOf));
    expect([...tools].sort()).toEqual([...REGISTRY.keys()].filter((n) => n !== 'escalate').sort());
  });

  it(`S1: ${reader}'s every tool output, ref, trace entry and bundle is byte-identical`, () => {
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [k, v] of before) expect(after.get(k), k).toBe(v);
    const all = [...after.values()].join('\n');
    expect(all).not.toContain(`ni-${other}-`);
  });

  it(`S2: the same records change ${other}'s own outputs, tool by tool (the forecast is household-level)`, () => {
    const changed = new Set<string>();
    for (const [k, v] of otherBefore)
      if (otherAfter.get(k) !== v) changed.add(k === 'bundle' ? k : toolOf(k));
    const expected = [...REGISTRY.keys()].filter((n) => n !== 'escalate' && n !== 'get_weather');
    for (const t of [...expected, 'bundle']) expect(changed.has(t), t).toBe(true);
    expect(changed.has('get_weather')).toBe(false);
    expect([...otherAfter.values()].join('\n')).toContain(`ni-${other}-`);
  });

  it('S3: sensitive household and private context appear in neither adult’s bundle or tool output', () => {
    for (const s of [before, after, otherBefore, otherAfter])
      for (const [k, v] of s) expect(v, k).not.toContain(SENSITIVE_MARK);
  });
});
