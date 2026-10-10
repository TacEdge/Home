import { describe, expect, it } from 'vitest';
import { agenda, type AgendaEventInput } from '@/domain/engines/agenda';
import { conflicts } from '@/domain/engines/conflicts';
import { forward } from '@/domain/engines/forward';
import {
  compareInsights,
  conflictMarks,
  insights,
  SHOWN,
  type Insight,
} from '@/domain/engines/insights';
import { placement } from '@/domain/engines/today';
import { addDays } from '@/lib/dates';
import { at, fresh, ID, NZ, PEOPLE, run, timed, WEDNESDAY } from '../today/household';

// Conflicts as insights and on Today's items (M6 Package 3; contract §4.5,
// §5.8; ADR 0009 §18): the conflict engine's observations become the
// `conflict` family, ranked after data_health; today's are said on their
// items where Today shows them and listed where it does not; tomorrow's
// onwards are listed; a response hides one everywhere; very many are
// bounded with exact counts and nothing dropped; Forward takes the same
// keys. Times are NZDT. Synthetic only.

const att = (...ids: string[]) => ids.map((personId) => ({ personId, role: 'attending' as const }));
const resp = (...ids: string[]) =>
  ids.map((personId) => ({ personId, role: 'responsible' as const }));
const WED_0703 = at('2026-10-14T07:03:00+13:00');
const pair = (day: string, person: string, ids = ['e-art', 'e-dentist']) => [
  timed(ids[0]!, 'Art club', `${day}T15:00:00+13:00`, `${day}T16:00:00+13:00`, {
    people: att(person),
  }),
  timed(ids[1]!, 'Dentist', `${day}T15:30:00+13:00`, `${day}T16:30:00+13:00`, {
    people: att(person),
  }),
];
const conflictsOf = (r: ReturnType<typeof run>) =>
  r.insights.all.filter((i) => i.kind === 'conflict');
const listed = (r: ReturnType<typeof run>) => [...r.insights.shown, ...r.insights.rest];

describe('the conflict family (ADR 0009 §18)', () => {
  it('each conflict is an insight with the engine’s key, rule, sentence and facts', () => {
    const r = run({ events: pair('2026-10-15', ID.milo) }, WED_0703);
    const [c] = conflictsOf(r);
    const [engine] = r.conflicts;
    expect(c).toMatchObject({
      key: engine!.key,
      kind: 'conflict',
      rule: 'conflict.overlap',
      when: '2026-10-15',
      text: 'Milo has Art club and Dentist at the same time tomorrow, 15:30–16:00.',
      onObject: false,
    });
    expect(c!.facts).toEqual(engine!.facts);
    expect(c!.conflict).toBe(engine);
  });

  it('ranks after data_health and before preparation and busy_day; responsible before overlap; total', () => {
    const r = run(
      {
        events: [
          ...pair('2026-10-16', ID.milo),
          timed('e-r1', 'Meeting', '2026-10-17T10:00:00+13:00', '2026-10-17T11:00:00+13:00', {
            people: resp(ID.alex),
          }),
          timed('e-r2', 'Shift', '2026-10-17T10:30:00+13:00', '2026-10-17T11:30:00+13:00', {
            people: resp(ID.alex),
          }),
        ],
        calendars: [fresh(at('2026-10-01T00:00:00Z'), { id: 'c-1', name: 'Old' })],
      },
      WED_0703,
    );
    const kinds = r.insights.all.map((i) => i.kind);
    expect(kinds.indexOf('data_health')).toBeLessThan(kinds.indexOf('conflict'));
    const lastConflict = kinds.lastIndexOf('conflict');
    expect(
      kinds.slice(lastConflict + 1).every((k) => k === 'preparation' || k === 'busy_day'),
    ).toBe(true);
    // The responsible one is later in time, but first in its family.
    expect(conflictsOf(r).map((i) => i.rule)).toEqual(['conflict.responsible', 'conflict.overlap']);
    const all = r.insights.all;
    for (const a of all)
      for (const b of all) if (a !== b) expect(compareInsights(a, b)).not.toBe(0);
  });

  it('looks only as far as Today’s window: a conflict ten days out is not a Today insight', () => {
    const r = run({ events: pair('2026-10-24', ID.milo) }, WED_0703);
    expect(conflictsOf(r)).toEqual([]);
  });

  it('a response (Dismiss or Not useful alike) hides it: not listed, not counted', () => {
    const events = pair('2026-10-15', ID.milo);
    const key = run({ events }, WED_0703).conflicts[0]!.key;
    const r = run({ events, dismissed: new Set([key]) }, WED_0703);
    expect(listed(r).map((i) => i.key)).not.toContain(key);
    expect(r.insights.more).toBe(0);
  });
});

describe('Today: today’s conflicts on their items (contract §4.5)', () => {
  // Wednesday's own pair, for Milo: both on Milo's line.
  const today = () => run({ events: [...WEDNESDAY, ...pair('2026-10-14', ID.milo)] }, WED_0703);

  it('a conflict of today with a place on Today is said on its items, not listed', () => {
    const r = today();
    const [c] = conflictsOf(r);
    expect(c!.onObject).toBe(true);
    expect(listed(r).map((i) => i.key)).not.toContain(c!.key);
  });

  it('it is marked on both of its entries on the person’s line, naming the other commitment as recorded', () => {
    const r = today();
    const marks = conflictMarks(r.insights, new Set(), r.placed, NZ);
    expect(marks.get(placement(ID.milo, 'e-art:2026-10-14'))!.map((m) => m.text)).toEqual([
      'overlaps Dentist 15:30',
    ]);
    expect(marks.get(placement(ID.milo, 'e-dentist:2026-10-14'))!.map((m) => m.text)).toEqual([
      'overlaps Art club 15:00',
    ]);
    // One conflict, two marks: the same insight, not a duplicate.
    const keys = [...marks.values()].flat().map((m) => m.insight.key);
    expect(new Set(keys).size).toBe(1);
  });

  it('a responded conflict is not marked', () => {
    const r = today();
    const key = conflictsOf(r)[0]!.key;
    expect(conflictMarks(r.insights, new Set([key]), r.placed, NZ).size).toBe(0);
  });

  it('someone outside the household is marked on the Also today row', () => {
    const r = run({ events: pair('2026-10-14', ID.nana) }, WED_0703);
    const marks = conflictMarks(r.insights, new Set(), r.placed, NZ);
    expect([...marks.keys()].sort()).toEqual([
      placement(null, 'e-art:2026-10-14'),
      placement(null, 'e-dentist:2026-10-14'),
    ]);
  });

  it('a conflict of today with no place on the screen is listed, not lost', () => {
    const events = pair('2026-10-14', ID.milo);
    const days = agenda({ from: '2026-10-14', to: '2026-10-21', timeZone: NZ, events });
    const window = { from: '2026-10-14', to: '2026-10-21' };
    const found = conflicts({
      now: WED_0703,
      timeZone: NZ,
      window,
      days,
      coverage: window,
      events,
      people: PEOPLE,
    });
    const r = insights({
      now: WED_0703,
      timeZone: NZ,
      days,
      events,
      people: PEOPLE,
      tasks: [],
      projects: [],
      calendars: [fresh(WED_0703)],
      conflicts: found,
      placed: new Set(), // the evening, or first run: nowhere to mark it
    });
    // Listed, and first: the fixture's birthday (preparation) ranks after it.
    expect(r.shown[0]!.key).toBe(found[0]!.key);
    expect(r.shown[0]!.onObject).toBe(false);
  });

  it('two same-titled occurrences (a moved one on its own series) are told apart by their starts', () => {
    const swim = timed(
      'e-swim',
      'Swimming',
      '2026-10-14T15:30:00+13:00',
      '2026-10-14T16:15:00+13:00',
      {
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        exdates: ['2026-10-21T02:30:00Z'],
        people: att(ID.milo),
      },
    );
    const moved = timed(
      'e-swim-21',
      'Swimming',
      '2026-10-28T15:45:00+13:00',
      '2026-10-28T16:30:00+13:00',
      {
        people: att(ID.milo),
      },
    );
    const window = { from: '2026-10-14', to: addDays('2026-10-14', 89) };
    const [c] = conflicts({
      now: WED_0703,
      timeZone: NZ,
      window,
      days: agenda({ ...window, timeZone: NZ, events: [swim, moved] }),
      coverage: window,
      events: [swim, moved],
      people: PEOPLE,
    });
    expect(c!.text).toBe(
      'Milo has Swimming (from 15:30) and Swimming (from 15:45) at the same time on Wednesday 28 October, 15:45–16:15.',
    );
  });
});

describe('bounding very many conflicts', () => {
  it('30 occurrences all overlapping tomorrow (435 conflicts): three shown, the rest held with an exact count, none lost, no duplicate', () => {
    const many: AgendaEventInput[] = Array.from({ length: 30 }, (_, k) =>
      timed(
        `e-m${String(k).padStart(2, '0')}`,
        `Thing ${k}`,
        '2026-10-15T09:00:00+13:00',
        '2026-10-15T17:00:00+13:00',
        {
          people: att(ID.sam),
        },
      ),
    );
    const r = run({ events: many }, WED_0703);
    const found = r.conflicts.length;
    expect(found).toBe((30 * 29) / 2);
    const shown = r.insights.shown.filter((i) => i.kind === 'conflict');
    const rest = r.insights.rest.filter((i) => i.kind === 'conflict');
    expect(shown.length).toBeLessThanOrEqual(SHOWN);
    expect(shown.length + rest.length).toBe(found);
    expect(r.insights.more).toBe(r.insights.rest.length);
    const keys = conflictsOf(r).map((i: Insight) => i.key);
    expect(new Set(keys).size).toBe(found);
  });
});

describe('Forward takes the same keys (Package 4 data)', () => {
  it('the Forward engine marks a conflict’s occurrences and counts it; a responded one is gone from it', () => {
    const events = pair('2026-10-16', ID.milo);
    const window = { from: '2026-10-14', to: addDays('2026-10-14', 89) };
    const days = agenda({ ...window, timeZone: NZ, events });
    const found = conflicts({
      now: WED_0703,
      timeZone: NZ,
      window,
      days,
      coverage: window,
      events,
      people: PEOPLE,
    });
    const model = (keys: { key: string; occurrences: string[] }[]) =>
      forward({
        now: WED_0703,
        timeZone: NZ,
        horizon: 'week',
        days,
        coverage: window,
        events,
        people: PEOPLE,
        calendars: [fresh(WED_0703)],
        conflicts: keys,
      });
    const keys = found.map((c) => ({
      key: c.key,
      occurrences: c.occurrences.map((o) => o.occurrence),
    }));
    expect(model(keys).headline.conflicts?.text).toBe('There is one overlap.');
    // After the reader's response, the caller passes it no more: nothing of it remains.
    expect(model([]).headline.conflicts).toBeFalsy();
  });
});
