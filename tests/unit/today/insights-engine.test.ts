import { describe, expect, it } from 'vitest';
import {
  BUSY_DAY_COUNT,
  compareInsights,
  INSIGHT_RULES,
  type Insight,
} from '@/domain/engines/insights';
import { insightKey } from '@/domain/insights/schema';
import { at, fresh, ID, PEOPLE, PROJECTS, ROUTINE, run, timed, WEDNESDAY } from './household';

// The insights engine (M5 contract §5.4, ADR 0008 §16): busy_day,
// preparation and data_health, each traced to records and a rule, ranked
// deterministically, never inferring a need.

const WED = [...ROUTINE, ...WEDNESDAY];
const said = (xs: Insight[]) => xs.map((i) => `${i.rule}: ${i.text}`);

/** n one-off events for the household on a date, recorded for Sam. */
const many = (date: string, n: number) =>
  Array.from({ length: n }, (_, k) =>
    timed(
      `e-${date}-${k}`,
      `Thing ${k + 1}`,
      `${date}T${String(8 + k).padStart(2, '0')}:00:00+13:00`,
      `${date}T${String(8 + k).padStart(2, '0')}:30:00+13:00`,
      { people: [{ personId: ID.sam, role: 'attending' }] },
    ),
  );

describe('the families', () => {
  it('a normal Wednesday: a project target and a birthday this week; today’s late evening is the headline’s', () => {
    const { insights } = run({ events: WED }, at('2026-10-14T07:03:00+13:00'));
    expect(said(insights.shown)).toEqual([
      'preparation.project_target: Back fence’s target date is Saturday; one task is open.',
      'preparation.birthday: Nana Jo’s birthday is Tuesday.',
    ]);
    expect(insights.all.find((i) => i.rule === 'busy_day.late')).toMatchObject({
      onObject: true,
      when: '2026-10-14',
    });
    expect(insights.more).toBe(0);
  });

  it('busy_day.count: tomorrow at the provisional threshold, not one below; today’s is on the headline', () => {
    const now = at('2026-10-17T07:00:00+13:00'); // Saturday; tomorrow is Sunday 18th
    const at6 = run({ events: many('2026-10-18', BUSY_DAY_COUNT) }, now).insights;
    expect(said(at6.all.filter((i) => i.kind === 'busy_day'))).toEqual([
      'busy_day.count: Tomorrow has six things on.',
    ]);
    expect(at6.all.find((i) => i.rule === 'busy_day.count')!.basis).toEqual({
      count: 6,
      threshold: 6,
    });
    const at5 = run({ events: many('2026-10-18', BUSY_DAY_COUNT - 1) }, now).insights;
    expect(at5.all.filter((i) => i.kind === 'busy_day')).toEqual([]);
    const today = run({ events: many('2026-10-17', 7) }, now).insights;
    expect(today.all.find((i) => i.rule === 'busy_day.count')).toMatchObject({
      onObject: true,
      text: 'Seven things on today.',
    });
    expect(today.shown.some((i) => i.rule === 'busy_day.count')).toBe(false);
  });

  it('busy_day.count leaves routine out', () => {
    // Thursday: school and Alex's work only, plus five one-offs: five counted, not seven.
    const now = at('2026-10-14T07:03:00+13:00');
    const r = run({ events: [...ROUTINE, ...many('2026-10-15', 5)] }, now).insights;
    expect(r.all.filter((i) => i.rule === 'busy_day.count')).toEqual([]);
  });

  it('busy_day.late tomorrow: two adults recorded on something ending after 18:00', () => {
    // Tuesday 20th: tomorrow is Wednesday, with Alex's Pilates and Sam's board meeting (a weekly one here).
    const board = { ...WEDNESDAY[0]!, rrule: 'FREQ=WEEKLY;BYDAY=WE' };
    const r = run({ events: [...ROUTINE, board] }, at('2026-10-20T07:00:00+13:00')).insights;
    expect(r.all.find((i) => i.rule === 'busy_day.late')).toMatchObject({
      text: 'Alex and Sam both have something on after 6 tomorrow.',
      key: `busy_day.late:${ID.alex}.${ID.sam}:2026-10-21`,
      onObject: false,
    });
  });

  it('preparation.birthday: up to a week ahead; today’s is on its item; eight days is too far', () => {
    expect(
      said(run({ events: [] }, at('2026-10-13T07:00:00+13:00')).insights.all).find((s) =>
        s.includes('Nana Jo'),
      ),
    ).toBe('preparation.birthday: Nana Jo’s birthday is next Tuesday.');
    expect(
      run({ events: [] }, at('2026-10-12T07:00:00+13:00')).insights.all.some((i) =>
        i.text.includes('Nana Jo'),
      ),
    ).toBe(false);
    const day = run({ events: [] }, at('2026-10-20T07:00:00+13:00')).insights;
    expect(day.all.find((i) => i.text.includes('Nana Jo'))).toMatchObject({
      text: 'Nana Jo’s birthday is today.',
      onObject: true,
    });
    expect(day.shown.some((i) => i.text.includes('Nana Jo'))).toBe(false);
  });

  it('preparation.project_target: an active project with recorded open tasks only', () => {
    const now = at('2026-10-14T07:03:00+13:00');
    const noTasks = run({ events: [], tasks: [] }, now).insights;
    expect(noTasks.all.some((i) => i.rule === 'preparation.project_target')).toBe(false);
    const paused = run(
      { events: [], projects: PROJECTS.map((p) => ({ ...p, status: 'paused' })) },
      now,
    ).insights;
    expect(paused.all.some((i) => i.rule === 'preparation.project_target')).toBe(false);
    // The Garage is an idea with a target date: not active, so nothing is said.
    expect(
      run({ events: [] }, now).insights.all.filter((i) => i.rule === 'preparation.project_target'),
    ).toHaveLength(1);
  });

  it('data_health: stale or failed, one per calendar (failed wins); archived and never-refreshed say nothing', () => {
    const now = at('2026-10-14T07:03:00+13:00');
    const stale = fresh(now, {
      id: 'c-a',
      name: 'Alex’s calendar',
      lastSyncedAt: at('2026-10-13T06:00:00+13:00'),
    });
    const failing = fresh(now, {
      id: 'c-b',
      name: 'School calendar',
      lastSyncStatus: 'unreachable',
      lastSyncedAt: at('2026-10-01T06:00:00+13:00'),
    });
    const archived = { ...stale, id: 'c-c', archivedAt: now };
    const never = fresh(now, {
      id: 'c-d',
      lastSyncedAt: null,
      lastAttemptAt: null,
      lastSyncStatus: null,
    });
    const r = run({ events: [], calendars: [stale, failing, archived, never] }, now).insights;
    expect(said(r.all.filter((i) => i.kind === 'data_health'))).toEqual([
      'data_health.failed: School calendar didn’t update the last time it was checked.',
      'data_health.stale: Alex’s calendar hasn’t updated since yesterday.',
    ]);
    // A day old exactly is not stale.
    const day = fresh(now, { lastSyncedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000) });
    expect(
      run({ events: [], calendars: [day] }, now).insights.all.some((i) => i.kind === 'data_health'),
    ).toBe(false);
  });

  it('no transport family, and nothing said about a child’s event with nobody recorded as responsible', () => {
    expect(INSIGHT_RULES.some((r) => r.startsWith('coordination_gap'))).toBe(false);
    const { insights } = run({ events: WED }, at('2026-10-13T07:00:00+13:00')); // the pickup is tomorrow
    expect(
      insights.all.some((i) => i.facts.some((f) => f.kind === 'event' && f.id === 'e-pickup')),
    ).toBe(false);
  });
});

describe('ranking, the count of more, dismissals', () => {
  // Saturday 17th: two failing calendars, the fence today (on object), Nana Jo Tuesday, tomorrow busy.
  const now = at('2026-10-17T07:00:00+13:00');
  const cals = [
    fresh(now, { id: 'c-1', name: 'One', lastSyncStatus: 'too_large' }),
    fresh(now, { id: 'c-2', name: 'Two', lastSyncStatus: 'unreachable' }),
  ];
  const h = { events: many('2026-10-18', 6), calendars: cals };

  it('data health, then preparation, then busy days; by date; by key; three shown and the rest counted', () => {
    const r = run(h, now).insights;
    expect(r.shown.map((i) => i.rule)).toEqual([
      'data_health.failed',
      'data_health.failed',
      'preparation.birthday',
    ]);
    expect(r.shown.map((i) => i.key.split(':')[1])).toEqual(['c-1', 'c-2', ID.nana]);
    expect(r.more).toBe(1); // tomorrow's busy day; the fence (today, on object) is not counted
    expect(r.all.find((i) => i.rule === 'preparation.project_target')).toMatchObject({
      onObject: true,
    });
    expect([...r.all].sort(compareInsights)).toEqual(r.all);
  });

  it('a dismissed insight is neither shown nor counted, and the next one moves up', () => {
    const dismissed = new Set([`data_health.failed:c-1:2026-10-17`]);
    const r = run({ ...h, dismissed }, now).insights;
    expect(r.shown.map((i) => i.key)).not.toContain([...dismissed][0]);
    expect(r.shown.map((i) => i.rule)).toEqual([
      'data_health.failed',
      'preparation.birthday',
      'busy_day.count',
    ]);
    expect(r.more).toBe(0);
    expect(r.all).toHaveLength(5); // still known, marked by the caller's set, never deleted
  });

  it('keys: valid, stable across runs and input order, new when the facts change', () => {
    const a = run(h, now).insights.all.map((i) => i.key);
    const b = run(
      { ...h, events: [...h.events].reverse(), calendars: [...cals].reverse() },
      now,
    ).insights.all.map((i) => i.key);
    expect(b).toEqual(a);
    for (const k of a) expect(insightKey.safeParse(k).success).toBe(true);
    expect(new Set(a).size).toBe(a.length); // no duplicates
    const seven = run({ ...h, events: many('2026-10-18', 7) }, now).insights.all.find(
      (i) => i.rule === 'busy_day.count',
    )!.key;
    expect(seven).not.toBe(a.find((k) => k.startsWith('busy_day.count'))); // the count changed
  });
});

describe('every insight is traced', () => {
  it('a documented rule, facts naming input records, a matching sentence', () => {
    const ids = new Set([
      ...WED.map((e) => e.id),
      ...PEOPLE.map((p) => p.id),
      ...PROJECTS.map((p) => p.id),
      't-paint',
      'c-sam-work',
      'c-1',
      'c-2',
    ]);
    const pattern: Record<(typeof INSIGHT_RULES)[number], RegExp> = {
      'busy_day.count': /^(Tomorrow has \w+ things on|\w+ things on today)\.$/,
      'busy_day.late': /^[\w ,]+ (both|all) have something on after 6( tomorrow)?\.$/,
      'preparation.birthday': /^.+’s birthday is (today|tomorrow|(next )?\w+day)\.$/,
      'preparation.project_target':
        /^.+’s target date is (today|tomorrow|(next )?\w+day); \w+ tasks? (is|are) open\.$/,
      'data_health.stale': /^.+ hasn’t updated since .+\.$/,
      'data_health.failed': /^.+ didn’t update the last time it was checked\.$/,
    };
    const seen = new Set<string>();
    for (const day of ['13', '14', '17', '20', '21'])
      for (const r of [
        run({ events: WED }, at(`2026-10-${day}T07:00:00+13:00`)),
        run(
          {
            events: [...WED, ...many(`2026-10-${String(Number(day) + 1)}`, 6)],
            calendars: [
              fresh(at('2026-10-01T00:00:00Z'), { id: 'c-1', name: 'One' }),
              fresh(at('2026-10-01T00:00:00Z'), {
                id: 'c-2',
                name: 'Two',
                lastSyncStatus: 'unreachable',
              }),
            ],
          },
          at(`2026-10-${day}T07:00:00+13:00`),
        ),
      ])
        for (const i of r.insights.all) {
          seen.add(i.rule);
          expect(INSIGHT_RULES).toContain(i.rule);
          expect(i.text).toMatch(pattern[i.rule]);
          expect(i.facts.length).toBeGreaterThan(0);
          for (const f of i.facts)
            if ('id' in f && !f.id.startsWith('e-2026')) expect(ids.has(f.id)).toBe(true);
        }
    expect([...seen].sort()).toEqual([...INSIGHT_RULES].sort());
  });
});
