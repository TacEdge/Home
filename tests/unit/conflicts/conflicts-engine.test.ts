import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agenda, type AgendaEventInput } from '@/domain/engines/agenda';
import {
  CONFLICT_RULES,
  ConflictWindowError,
  conflicts,
  type Conflict,
  type ConflictPerson,
} from '@/domain/engines/conflicts';
import { insightKey } from '@/domain/insights/schema';
import { addDays, isoDateInZone } from '@/lib/dates';
import { allDay, ID, NZ, PEOPLE, ROUTINE, timed } from '../today/household';

// The conflict engine (M6 Package 2; contract §5.6–§5.7, ADR 0009 §9–§14),
// over the shared agenda exactly as a page will run it. The fixture is the
// contract's (§5.7.4): Swimming and Tutoring weekly on Wednesdays, Art club
// and Dentist on Thursday. Times are NZDT (UTC+13) unless a test says so.

const att = (...ids: string[]) => ids.map((personId) => ({ personId, role: 'attending' as const }));
const resp = (...ids: string[]) =>
  ids.map((personId) => ({ personId, role: 'responsible' as const }));
const WEEKLY_WE = 'FREQ=WEEKLY;BYDAY=WE';

const VISIBLE: ConflictPerson[] = PEOPLE.map((p) => ({
  id: p.id,
  name: p.name,
  inHousehold: p.inHousehold,
}));

/** Wednesday 14 October 2026, 07:03 at home. */
const WED_0703 = new Date('2026-10-14T07:03:00+13:00');

const swimming = (extra: Partial<AgendaEventInput> = {}) =>
  timed('e-swim', 'Swimming', '2026-10-14T15:30:00+13:00', '2026-10-14T16:15:00+13:00', {
    kind: 'activity',
    rrule: WEEKLY_WE,
    people: [...att(ID.milo), ...resp(ID.alex)],
    ...extra,
  });
const tutoring = (extra: Partial<AgendaEventInput> = {}) =>
  timed('e-tutor', 'Tutoring', '2026-10-14T15:45:00+13:00', '2026-10-14T16:30:00+13:00', {
    kind: 'activity',
    rrule: WEEKLY_WE,
    people: att(ID.milo),
    ...extra,
  });
const artClub = () =>
  timed('e-art', 'Art club', '2026-10-15T15:00:00+13:00', '2026-10-15T16:00:00+13:00', {
    kind: 'activity',
    people: att(ID.milo),
  });
const dentist = (start = '15:30', end = '16:30') =>
  timed('e-dentist', 'Dentist', `2026-10-15T${start}:00+13:00`, `2026-10-15T${end}:00+13:00`, {
    kind: 'appointment',
    people: att(ID.milo),
  });

type Run = {
  events: AgendaEventInput[];
  now?: Date;
  days?: number;
  people?: ConflictPerson[];
  timeZone?: string;
};

/** The shared agenda over the window, then the engine: exactly as a page will. */
function run({ events, now = WED_0703, days = 90, people = VISIBLE, timeZone = NZ }: Run) {
  const from = isoDateInZone(now, timeZone);
  const to = addDays(from, days - 1);
  const placed = agenda({
    from,
    to,
    timeZone,
    events,
    people: people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: null })),
  });
  return conflicts({
    now,
    timeZone,
    window: { from, to },
    days: placed,
    coverage: { from, to },
    events,
    people,
  });
}

const keys = (cs: Conflict[]) => cs.map((c) => c.key);
const about = (cs: Conflict[], personId: string) => cs.filter((c) => c.person.id === personId);

/** A seeded generator (mulberry32): the same seed, the same sequence. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates over a copy. */
function shuffle<T>(xs: readonly T[], random: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A one-off pair on Thursday 15 October, for boundary tests. */
function pair(a: [string, string], b: [string, string], extraB: Partial<AgendaEventInput> = {}) {
  return [
    timed('e-a', 'First', `2026-10-15T${a[0]}:00+13:00`, `2026-10-15T${a[1]}:00+13:00`, {
      people: att(ID.milo),
    }),
    timed('e-b', 'Second', `2026-10-15T${b[0]}:00+13:00`, `2026-10-15T${b[1]}:00+13:00`, {
      people: att(ID.milo),
      ...extraB,
    }),
  ];
}

describe('overlap: instants, strictly', () => {
  it('ends that touch do not overlap', () => {
    expect(run({ events: pair(['15:00', '16:00'], ['16:00', '17:00']) })).toEqual([]);
  });
  it('one minute of overlap is an overlap, of exactly that minute', () => {
    const [c] = run({ events: pair(['15:00', '16:01'], ['16:00', '17:00']) });
    expect(c!.overlap).toEqual({
      from: new Date('2026-10-15T16:00:00+13:00'),
      to: new Date('2026-10-15T16:01:00+13:00'),
    });
  });
  it('identical times overlap for their whole length', () => {
    const [c] = run({ events: pair(['15:00', '16:00'], ['15:00', '16:00']) });
    expect(c!.overlap.to.getTime() - c!.overlap.from.getTime()).toBe(60 * 60_000);
  });
  it('one inside the other overlaps for the inner one', () => {
    const [c] = run({ events: pair(['14:00', '18:00'], ['15:00', '16:00']) });
    expect(c!.key).toBe('conflict.overlap:p-milo:e-a.e-b:20261015T0200Z-20261015T0300Z');
  });
  it('different event zones are compared as instants; the key is UTC', () => {
    // 03:30–04:30 in London (BST, UTC+1) is 15:30–16:30 in Auckland (NZDT).
    const london = timed(
      'e-call',
      'Call',
      '2026-10-15T03:30:00+01:00',
      '2026-10-15T04:30:00+01:00',
      {
        timeZone: 'Europe/London',
        people: att(ID.milo),
      },
    );
    const [c] = run({ events: [artClub(), london] });
    expect(c!.key).toBe('conflict.overlap:p-milo:e-art.e-call:20261015T0230Z-20261015T0300Z');
    expect(c!.text).toContain('15:30–16:00');
  });
  it('an overnight occurrence placed on two home days is one occurrence: one conflict, not two', () => {
    const late = timed(
      'e-late',
      'Late shift',
      '2026-10-15T23:00:00+13:00',
      '2026-10-16T01:00:00+13:00',
      {
        people: att(ID.sam),
      },
    );
    const early = timed(
      'e-early',
      'Flight',
      '2026-10-16T00:30:00+13:00',
      '2026-10-16T02:00:00+13:00',
      {
        people: att(ID.sam),
      },
    );
    const cs = run({ events: [late, early] });
    expect(cs).toHaveLength(1);
    expect(cs[0]!.when).toBe('2026-10-16');
    expect(cs[0]!.instances).toHaveLength(1);
  });
  it('a multi-day timed event overlapping a one-off on its second day', () => {
    const camp = timed('e-camp', 'Camp', '2026-10-15T09:00:00+13:00', '2026-10-17T15:00:00+13:00', {
      people: att(ID.milo),
    });
    const [c] = run({ events: [camp, dentist()] });
    expect(c!.when).toBe('2026-10-15');
    const [d] = run({
      events: [
        camp,
        timed('e-x', 'Haircut', '2026-10-16T10:00:00+13:00', '2026-10-16T10:30:00+13:00', {
          people: att(ID.milo),
        }),
      ],
    });
    expect(d!.when).toBe('2026-10-16');
  });
  it('an overlap that has ended at `now` is not current; one still running is', () => {
    const events = pair(['15:00', '16:00'], ['15:30', '16:30']);
    expect(run({ events, now: new Date('2026-10-15T16:00:00+13:00') })).toEqual([]);
    expect(run({ events, now: new Date('2026-10-15T15:59:00+13:00') })).toHaveLength(1);
  });
  it('a zero-length occurrence overlaps nothing', () => {
    expect(run({ events: pair(['15:00', '15:00'], ['14:00', '16:00']) })).toEqual([]);
  });
});

describe('exclusions (ADR 0009 §10)', () => {
  it('all-day events take part in no conflict (T16: travel and Football)', () => {
    const travel = allDay('e-trip', 'Wellington', '2026-10-17', '2026-10-18', {
      kind: 'travel',
      people: att(ID.sam),
    });
    const football = timed(
      'e-fb',
      'Football',
      '2026-10-17T09:00:00+13:00',
      '2026-10-17T10:00:00+13:00',
      {
        people: att(ID.sam),
      },
    );
    expect(run({ events: [travel, football] })).toEqual([]);
  });
  it('Today’s routine occurrences (weekly school or work with a household person) are excluded', () => {
    const assembly = timed(
      'e-assembly',
      'Assembly',
      '2026-10-15T10:00:00+13:00',
      '2026-10-15T11:00:00+13:00',
      {
        kind: 'school',
        people: att(ID.milo),
      },
    );
    expect(run({ events: [...ROUTINE, assembly] }).filter((c) => c.person.id === ID.milo)).toEqual(
      [],
    );
  });
  it('the same school series is not routine without a household person on it', () => {
    const school = { ...ROUTINE[0]!, people: att(ID.nana) };
    const visit = timed(
      'e-visit',
      'Visit',
      '2026-10-15T10:00:00+13:00',
      '2026-10-15T11:00:00+13:00',
      {
        people: att(ID.nana),
      },
    );
    expect(run({ events: [school, visit] })).toHaveLength(1);
  });
  it('two work occurrences never conflict; work with something else does', () => {
    expect(
      run({
        events: pair(['15:00', '16:00'], ['15:30', '16:30'], { kind: 'work' }).map((e) => ({
          ...e,
          kind: 'work' as const,
        })),
      }),
    ).toEqual([]);
    expect(
      run({ events: pair(['15:00', '16:00'], ['15:30', '16:30'], { kind: 'work' }) }),
    ).toHaveLength(1);
  });
  it('a series never conflicts with itself (occurrences of the same event)', () => {
    const shifts = timed(
      'e-shift',
      'Volunteer shift',
      '2026-10-15T20:00:00+13:00',
      '2026-10-16T21:00:00+13:00',
      {
        rrule: 'FREQ=DAILY;COUNT=5',
        people: att(ID.sam),
      },
    );
    expect(run({ events: [shifts] })).toEqual([]);
  });
  it('two overlapping occurrences with no shared recorded person: no conflict', () => {
    expect(run({ events: [artClub(), { ...dentist(), people: att(ID.isla) }] })).toEqual([]);
  });
  it('a person the reader cannot see is on no occurrence for that reader', () => {
    const notMilo = VISIBLE.filter((p) => p.id !== ID.milo);
    expect(run({ events: [artClub(), dentist()], people: notMilo })).toEqual([]);
  });
  it('a child’s occurrences with nobody else recorded state only the child’s own overlap', () => {
    const cs = run({ events: [artClub(), dentist()] });
    expect(cs.map((c) => c.person.id)).toEqual([ID.milo]);
  });
});

describe('the contract’s identity and lifecycle tests (§5.7.4, engine level)', () => {
  const T1 = () => [swimming(), tutoring()];
  const STANDING = 'conflict.overlap:p-milo:e-swim.e-tutor:w1545-1615';

  it('T1: one standing conflict for Milo over 90 days, said once at the next Wednesday', () => {
    const cs = run({ events: T1() });
    expect(keys(cs)).toEqual([STANDING]);
    const [c] = cs;
    expect(c!).toMatchObject({
      rule: 'conflict.overlap',
      identity: 'standing',
      when: '2026-10-14',
    });
    expect(c!.instances.length).toBe(13); // every Wednesday in the window, one key
    expect(c!.text).toBe(
      'Milo’s Swimming and Tutoring overlap regularly, 15:45–16:15; next today.',
    );
  });

  it('T2: Alex made responsible on Tutoring too: Milo’s key unchanged; a new standing responsible conflict for Alex', () => {
    const cs = run({
      events: [swimming(), tutoring({ people: [...att(ID.milo), ...resp(ID.alex)] })],
    });
    expect(keys(about(cs, ID.milo))).toEqual([STANDING]);
    expect(keys(about(cs, ID.alex))).toEqual([
      'conflict.responsible:p-alex:e-swim.e-tutor:w1545-1615',
    ]);
    expect(cs[0]!.rule).toBe('conflict.responsible'); // responsible first
  });

  it('T3: four weeks later (`now` advanced) the key is the same; nothing is re-raised by date', () => {
    const later = run({ events: T1(), now: new Date('2026-11-11T07:03:00+13:00') });
    expect(keys(later)).toEqual([STANDING]);
    expect(later[0]!.when).toBe('2026-11-11');
  });

  /** T4's change: the 28 October Swimming moved to 16:00–16:45 (its own row; the series skips the original). */
  const T4 = () => [
    swimming({ exdates: ['2026-10-28T02:30:00Z'] }),
    tutoring(),
    timed('e-swim-28', 'Swimming', '2026-10-28T16:00:00+13:00', '2026-10-28T16:45:00+13:00', {
      kind: 'activity',
      people: [...att(ID.milo), ...resp(ID.alex)],
    }),
  ];

  it('T4: a changed occurrence is its own conflict (the change’s id, that day’s UTC window); the standing one continues', () => {
    const cs = about(run({ events: T4() }), ID.milo);
    expect(keys(cs).sort()).toEqual(
      [STANDING, 'conflict.overlap:p-milo:e-swim-28.e-tutor:20261028T0300Z-20261028T0330Z'].sort(),
    );
    const standing = cs.find((c) => c.key === STANDING)!;
    expect(standing.instances.map((i) => i.when)).not.toContain('2026-10-28');
    expect(standing.instances).toHaveLength(12);
  });

  it('T5 (engine level): the change returned to the series: the standing key covers that week again', () => {
    expect(run({ events: T1() })[0]!.instances.map((i) => i.when)).toContain('2026-10-28');
  });

  // T6 at engine level only: the inputs the reads give before, during and after a
  // put-away and restore. That the database put-away and restore produce exactly
  // these inputs (the same change row, the same times) is Package 3's service-level
  // acceptance test (contract §5.7.4, marked P3); this test does not prove it.
  it('T6 (engine level): the change put away, then restored as the same row and times: the T4 key returns', () => {
    const changeKey = 'conflict.overlap:p-milo:e-swim-28.e-tutor:20261028T0300Z-20261028T0330Z';
    expect(keys(about(run({ events: T4() }), ID.milo))).toContain(changeKey);
    // Put away: the change row is gone and the series shows its own 28 October again.
    const away = about(run({ events: T1() }), ID.milo);
    expect(keys(away)).toEqual([STANDING]);
    expect(away[0]!.instances.map((i) => i.when)).toContain('2026-10-28');
    // Restored: built afresh, the same row id and times, a non-material field changed.
    const restored = [
      swimming({ exdates: ['2026-10-28T02:30:00Z'] }),
      tutoring(),
      timed(
        'e-swim-28',
        'Swimming lesson',
        '2026-10-28T16:00:00+13:00',
        '2026-10-28T16:45:00+13:00',
        {
          kind: 'activity',
          people: [...att(ID.milo), ...resp(ID.alex)],
        },
      ),
    ];
    expect(keys(about(run({ events: restored }), ID.milo)).sort()).toEqual(
      [STANDING, changeKey].sort(),
    );
  });

  it('T7: the 21 October Tutoring skipped: no conflict that day; next date 28 October; same key', () => {
    const events = [swimming(), tutoring({ exdates: ['2026-10-21T02:45:00Z'] })];
    const cs = run({ events, now: new Date('2026-10-15T07:03:00+13:00') });
    expect(keys(cs)).toEqual([STANDING]);
    expect(cs[0]!.when).toBe('2026-10-28');
    expect(cs[0]!.instances.map((i) => i.when)).not.toContain('2026-10-21');
  });

  it('T8 (engine level): the skip put back: 21 October is under the standing key again', () => {
    const cs = run({ events: T1(), now: new Date('2026-10-15T07:03:00+13:00') });
    expect(keys(cs)).toEqual([STANDING]);
    expect(cs[0]!.when).toBe('2026-10-21');
  });

  it('T9: Tutoring’s series moves to 16:00–16:45: a new standing key, w1600-1615', () => {
    const moved = timed(
      'e-tutor',
      'Tutoring',
      '2026-10-14T16:00:00+13:00',
      '2026-10-14T16:45:00+13:00',
      {
        kind: 'activity',
        rrule: WEEKLY_WE,
        people: att(ID.milo),
      },
    );
    expect(keys(run({ events: [swimming(), moved] }))).toEqual([
      'conflict.overlap:p-milo:e-swim.e-tutor:w1600-1615',
    ]);
  });

  it('T10: Tutoring adds Mondays (no Swimming on Mondays): the same key, no new conflict', () => {
    const cs = run({ events: [swimming(), tutoring({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' })] });
    expect(keys(cs)).toEqual([STANDING]);
  });

  const T11 = 'conflict.overlap:p-milo:e-art.e-dentist:20261015T0230Z-20261015T0300Z';
  it('T11: Art club and Dentist on Thursday: one occurrence-level conflict for Milo, window 15:30–16:00 in UTC', () => {
    const cs = run({ events: [artClub(), dentist()] });
    expect(keys(cs)).toEqual([T11]);
    expect(cs[0]!).toMatchObject({ identity: 'occurrence', when: '2026-10-15' });
    expect(cs[0]!.text).toBe(
      'Milo has Art club and Dentist at the same time tomorrow, 15:30–16:00.',
    );
  });
  it('T12: Dentist’s end moves to 17:00: the same key', () => {
    expect(keys(run({ events: [artClub(), dentist('15:30', '17:00')] }))).toEqual([T11]);
  });
  it('T13: Dentist moves to 15:45–16:45: a new key, window 15:45–16:00', () => {
    expect(keys(run({ events: [artClub(), dentist('15:45', '16:45')] }))).toEqual([
      'conflict.overlap:p-milo:e-art.e-dentist:20261015T0245Z-20261015T0300Z',
    ]);
  });
  it('T14 (engine level): Dentist archived, then restored: gone, then back with T11’s key', () => {
    expect(run({ events: [artClub()] })).toEqual([]);
    expect(keys(run({ events: [artClub(), dentist()] }))).toEqual([T11]);
  });
  it('T15: Dentist moves to start at 16:00: ends touch, no conflict', () => {
    expect(run({ events: [artClub(), dentist('16:00', '17:00')] })).toEqual([]);
  });
  // T16 is under exclusions; T17 is Package 3 (two adults' responses through the real services);
  // T18 is the privacy invariant below and in tests/integration/conflicts-engine.test.ts.

  it('T19: seeded shuffles of events, people and the agenda’s days and items give identical output', () => {
    const events = [
      ...T4(),
      artClub(),
      dentist(),
      ...ROUTINE,
      ...pair(['18:00', '19:00'], ['18:30', '19:30']),
    ];
    const from = '2026-10-14';
    const to = addDays(from, 89);
    const placed = agenda({ from, to, timeZone: NZ, events });
    const engine = (ev: AgendaEventInput[], people: ConflictPerson[], days: typeof placed) =>
      conflicts({
        now: WED_0703,
        timeZone: NZ,
        window: { from, to },
        days,
        coverage: { from, to },
        events: ev,
        people,
      });
    const base = engine(events, VISIBLE, placed);
    expect(base.length).toBeGreaterThan(3);
    const SEEDS = [1, 7, 42, 2026, 31337, 65_000, 123_457, 999_983];
    const orders = new Set<string>();
    const original = events.map((e) => e.id).join(',');
    for (const seed of SEEDS) {
      const random = mulberry32(seed);
      const ev = shuffle(events, random);
      const people = shuffle(VISIBLE, random);
      // The agenda's own output reordered too: days, and the items within each day.
      const days = shuffle(placed, random).map((d) => ({ ...d, items: shuffle(d.items, random) }));
      orders.add(ev.map((e) => e.id).join(','));
      const out = engine(ev, people, days);
      // Complete output: keys, ranking, instances, facts and wording.
      expect(out).toEqual(base);
      expect(JSON.stringify(out)).toBe(JSON.stringify(base));
    }
    // The shuffles really are different orders: not the input, not just its reverse.
    expect(orders.size).toBe(SEEDS.length);
    orders.delete(original);
    orders.delete(
      [...events]
        .reverse()
        .map((e) => e.id)
        .join(','),
    );
    expect(orders.size).toBeGreaterThanOrEqual(SEEDS.length - 2);
    expect(orders.size).toBeGreaterThan(2);
  });

  it('T20: every key matches insightKey, fits 200 characters and carries no record text', () => {
    const all = [
      ...run({ events: T4() }),
      ...run({ events: [artClub(), dentist()] }),
      ...run({ events: [swimming(), tutoring({ people: [...att(ID.milo), ...resp(ID.alex)] })] }),
    ];
    for (const c of all) {
      expect(insightKey.safeParse(c.key).success, c.key).toBe(true);
      expect(c.key.length).toBeLessThanOrEqual(200);
      expect(c.key).not.toMatch(/Swimming|Tutoring|Art|Dentist|Milo|Alex/);
    }
  });

  it('T20: the longest key (responsible, occurrence level, uuid ids) is 161 characters', () => {
    const u = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
    const a = timed(u(1), 'A', '2026-10-15T15:00:00+13:00', '2026-10-15T16:00:00+13:00', {
      people: resp(u(9)),
    });
    const b = timed(u(2), 'B', '2026-10-15T15:30:00+13:00', '2026-10-15T16:30:00+13:00', {
      people: resp(u(9)),
    });
    const [c] = run({ events: [a, b], people: [{ id: u(9), name: 'Pat', inHousehold: true }] });
    expect(c!.key).toHaveLength(161);
    expect(insightKey.safeParse(c!.key).success).toBe(true);
  });
});

describe('material and non-material changes (§5.7.2)', () => {
  const base = () => [artClub(), dentist()];
  const key0 = keys(run({ events: base() }));

  it('titles, kinds (other than into work or routine) and other people are not material', () => {
    const renamed = [
      { ...artClub(), title: 'Art & craft club', kind: 'social' as const },
      { ...dentist(), people: [...att(ID.milo), ...att(ID.isla)] },
    ];
    expect(about(run({ events: renamed }), ID.milo).map((c) => c.key)).toEqual(key0);
  });
  it('attending to responsible on both changes the rule, so the key', () => {
    const both = [
      { ...artClub(), people: resp(ID.milo) },
      { ...dentist(), people: resp(ID.milo) },
    ];
    expect(keys(run({ events: both }))[0]).toMatch(/^conflict\.responsible:p-milo:/);
  });
  it('a different person responsible on both: one conflict ends, another begins', () => {
    const alex = [
      { ...artClub(), people: resp(ID.alex) },
      { ...dentist(), people: resp(ID.alex) },
    ];
    const sam = [
      { ...artClub(), people: resp(ID.sam) },
      { ...dentist(), people: resp(ID.sam) },
    ];
    expect(keys(run({ events: alex }))[0]).toContain(':p-alex:');
    expect(keys(run({ events: sam }))[0]).toContain(':p-sam:');
    expect(keys(run({ events: sam }))).not.toEqual(keys(run({ events: alex })));
  });
  it('a series rule change that keeps the window keeps the standing key; one that moves it does not', () => {
    const fortnightly = [swimming(), tutoring({ rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE' })];
    expect(keys(run({ events: fortnightly }))).toEqual([
      'conflict.overlap:p-milo:e-swim.e-tutor:w1545-1615',
    ]);
  });
  it('an archived series (absent from the reads) ends the conflict; restored, the same key returns', () => {
    expect(run({ events: [swimming()] })).toEqual([]);
    expect(keys(run({ events: [swimming(), tutoring()] }))).toEqual([
      'conflict.overlap:p-milo:e-swim.e-tutor:w1545-1615',
    ]);
  });
  it('an unchanged series occurrence paired with a one-off is occurrence-level, named by its series id', () => {
    const party = timed(
      'e-party',
      'Party',
      '2026-10-21T16:00:00+13:00',
      '2026-10-21T17:00:00+13:00',
      {
        people: att(ID.milo),
      },
    );
    const cs = run({ events: [swimming(), party] });
    expect(keys(cs)).toEqual([
      'conflict.overlap:p-milo:e-party.e-swim:20261021T0300Z-20261021T0315Z',
    ]);
    expect(cs[0]!.identity).toBe('occurrence');
  });
});

describe('a standing window and the clocks', () => {
  it('a home-zone series keeps its key across a DST change (NZ, April 2027)', () => {
    const swim = timed(
      'e-swim',
      'Swimming',
      '2027-03-17T15:30:00+13:00',
      '2027-03-17T16:15:00+13:00',
      {
        rrule: WEEKLY_WE,
        people: att(ID.milo),
      },
    );
    const tutor = timed(
      'e-tutor',
      'Tutoring',
      '2027-03-17T15:45:00+13:00',
      '2027-03-17T16:30:00+13:00',
      {
        rrule: WEEKLY_WE,
        people: att(ID.milo),
      },
    );
    const cs = run({ events: [swim, tutor], now: new Date('2027-03-17T07:00:00+13:00'), days: 42 });
    expect(keys(cs)).toEqual(['conflict.overlap:p-milo:e-swim.e-tutor:w1545-1615']);
    const offsets = new Set(cs[0]!.instances.map((i) => i.overlap.from.getUTCHours()));
    expect(offsets).toEqual(new Set([2, 3])); // NZDT then NZST: same wall clock, two UTC hours
  });
  it('a series kept in another zone moves on the home clock when that zone changes: two windows, two standing conflicts', () => {
    // A London series at 04:00–05:00 BST/GMT against a home series at 16:00–17:00 NZDT.
    const call = timed('e-call', 'Call', '2026-10-21T04:00:00+01:00', '2026-10-21T05:00:00+01:00', {
      timeZone: 'Europe/London',
      rrule: WEEKLY_WE,
      people: att(ID.sam),
    });
    const club = timed('e-club', 'Club', '2026-10-21T16:00:00+13:00', '2026-10-21T17:30:00+13:00', {
      rrule: WEEKLY_WE,
      people: att(ID.sam),
    });
    const cs = run({ events: [call, club], now: new Date('2026-10-20T07:00:00+13:00'), days: 21 });
    expect(keys(cs).sort()).toEqual([
      'conflict.overlap:p-sam:e-call.e-club:w1600-1700',
      'conflict.overlap:p-sam:e-call.e-club:w1700-1730',
    ]);
  });
});

describe('people and pairs', () => {
  it('two people on both events: one conflict each, each decided by their own roles', () => {
    const events = [
      { ...artClub(), people: [...att(ID.milo), ...resp(ID.alex)] },
      { ...dentist(), people: [...att(ID.milo), ...resp(ID.alex)] },
    ];
    const cs = run({ events });
    expect(cs.map((c) => [c.person.id, c.rule])).toEqual([
      [ID.alex, 'conflict.responsible'],
      [ID.milo, 'conflict.overlap'],
    ]);
  });
  it('responsible on one and attending on the other: overlap, never responsible', () => {
    const events = [
      { ...artClub(), people: resp(ID.alex) },
      { ...dentist(), people: att(ID.alex) },
    ];
    expect(run({ events }).map((c) => c.rule)).toEqual(['conflict.overlap']);
  });
  it('responsible replaces overlap for that person and pair: never both', () => {
    const events = [
      { ...artClub(), people: resp(ID.alex) },
      { ...dentist(), people: resp(ID.alex) },
    ];
    const cs = run({ events });
    expect(cs).toHaveLength(1);
    expect(cs[0]!.rule).toBe('conflict.responsible');
    expect(cs[0]!.text).toBe(
      'Alex is recorded as responsible for both Art club and Dentist, which overlap tomorrow, 15:30–16:00.',
    );
  });
  it('a person listed twice on one event (attending and responsible) is one person, responsible', () => {
    const events = [
      { ...artClub(), people: [...att(ID.alex), ...resp(ID.alex)] },
      { ...dentist(), people: resp(ID.alex) },
    ];
    expect(run({ events }).map((c) => c.rule)).toEqual(['conflict.responsible']);
  });
  it('three mutually overlapping events: one conflict per pair, not merged', () => {
    const third = timed(
      'e-music',
      'Music',
      '2026-10-15T15:45:00+13:00',
      '2026-10-15T16:15:00+13:00',
      {
        people: att(ID.milo),
      },
    );
    const cs = run({ events: [artClub(), dentist(), third] });
    expect(
      cs
        .map((c) =>
          c.occurrences
            .map((o) => o.eventId)
            .sort()
            .join('+'),
        )
        .sort(),
    ).toEqual(['e-art+e-dentist', 'e-art+e-music', 'e-dentist+e-music']);
  });
  it('two separate overlapping pairs stay two conflicts', () => {
    const later = pair(['18:00', '19:00'], ['18:30', '19:30']).map((e) => ({
      ...e,
      id: `${e.id}2`,
    }));
    expect(run({ events: [artClub(), dentist(), ...later] })).toHaveLength(2);
  });
  it('a household person and someone outside the household are each stated', () => {
    const events = [
      { ...artClub(), people: att(ID.milo, ID.nana) },
      { ...dentist(), people: att(ID.milo, ID.nana) },
    ];
    expect(
      run({ events })
        .map((c) => c.person.id)
        .sort(),
    ).toEqual([ID.milo, ID.nana]);
  });
});

describe('order (§5.6, ADR 0009 §13)', () => {
  it('responsible first, then the earlier overlap, then the key: a total order', () => {
    const events = [
      artClub(),
      dentist(),
      timed('e-r1', 'Meeting', '2026-10-20T10:00:00+13:00', '2026-10-20T11:00:00+13:00', {
        people: resp(ID.sam),
      }),
      timed('e-r2', 'Shift', '2026-10-20T10:30:00+13:00', '2026-10-20T11:30:00+13:00', {
        people: resp(ID.sam),
      }),
      // Isla's pair is later than Milo's, though her key sorts first: time decides.
      ...pair(['18:00', '19:00'], ['18:30', '19:30']).map((e) => ({
        ...e,
        id: `${e.id}x`,
        people: att(ID.isla),
      })),
    ];
    const cs = run({ events });
    expect(cs.map((c) => [c.rule, c.person.id])).toEqual([
      ['conflict.responsible', ID.sam],
      ['conflict.overlap', ID.milo],
      ['conflict.overlap', ID.isla],
    ]);
  });
});

describe('explanation and traceability', () => {
  it('every conflict carries both occurrences, their recorded times, the person, the overlap and the rule', () => {
    const [c] = run({ events: [artClub(), dentist()] });
    expect(c!.occurrences.map((o) => [o.eventId, o.occurrence, o.role])).toEqual([
      ['e-art', 'e-art:2026-10-15', 'attending'],
      ['e-dentist', 'e-dentist:2026-10-15', 'attending'],
    ]);
    expect(c!.occurrences[1].startsAt).toEqual(new Date('2026-10-15T15:30:00+13:00'));
    expect(c!.facts).toEqual([
      { kind: 'person', id: ID.milo },
      { kind: 'event', id: 'e-art', occurrenceDate: '2026-10-15' },
      { kind: 'event', id: 'e-dentist', occurrenceDate: '2026-10-15' },
    ]);
  });
  it('every rule is a known one and documented in the contract', () => {
    const contract = readFileSync('docs/m6/M6-BUILD-CONTRACT.md', 'utf8');
    for (const r of CONFLICT_RULES) expect(contract, r).toContain(`\`${r}\``);
  });
  it('the wording never infers: no availability, transport, need, reason or judgement', () => {
    const forbidden =
      /\b(busy|free|available|unavailable|away|needs?|should|must|can['’]t|cannot|double-booked|clash|in two places|lift|drive|pick(ing)? up|drop(ping)? off|cover|instead|problem|impossible|stressful|packed|worth deciding|probably|because)\b/i;
    const scenarios = [
      [swimming(), tutoring({ people: [...att(ID.milo), ...resp(ID.alex)] })],
      [artClub(), dentist()],
      [
        { ...artClub(), people: resp(ID.alex) },
        { ...dentist(), people: resp(ID.alex) },
      ],
      [...ROUTINE, artClub(), dentist()],
    ];
    for (const events of scenarios)
      for (const now of [WED_0703, new Date('2026-10-15T07:00:00+13:00')])
        for (const c of run({ events, now })) {
          const own = c.occurrences
            .reduce((t, o) => t.replaceAll(o.title, ''), c.text)
            .replace(c.person.name, '');
          expect(own, c.text).not.toMatch(forbidden);
        }
  });
});

describe('the window and purity', () => {
  it('refuses an agenda that does not cover the window', () => {
    const placed = agenda({ from: '2026-10-14', to: '2026-10-21', timeZone: NZ, events: [] });
    expect(() =>
      conflicts({
        now: WED_0703,
        timeZone: NZ,
        window: { from: '2026-10-14', to: '2027-01-11' },
        days: placed,
        coverage: { from: '2026-10-14', to: '2026-10-21' },
        events: [],
        people: VISIBLE,
      }),
    ).toThrow(ConflictWindowError);
  });
  it('looks only inside the window, even when the agenda covers more', () => {
    const events = [swimming(), tutoring()];
    const placed = agenda({ from: '2026-10-14', to: '2027-01-11', timeZone: NZ, events });
    const week = conflicts({
      now: WED_0703,
      timeZone: NZ,
      window: { from: '2026-10-14', to: '2026-10-21' },
      days: placed,
      coverage: { from: '2026-10-14', to: '2027-01-11' },
      events,
      people: VISIBLE,
    });
    expect(week[0]!.instances.map((i) => i.when)).toEqual(['2026-10-14', '2026-10-21']);
  });
  it('imports no database, app, Kev, UI or integration code, and reads no clock', () => {
    const src = readFileSync('src/domain/engines/conflicts.ts', 'utf8');
    expect(src).not.toMatch(/Date\.now\(|new Date\(|Math\.random/);
    expect(src).not.toMatch(/from '@\/(db|app|kev|ui|integrations|trust)|from '\.\.\/(?!engines)/);
  });
});
