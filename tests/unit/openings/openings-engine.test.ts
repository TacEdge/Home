import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INSIGHT_RULES } from '@/domain/engines/insights';
import {
  estimateWords,
  OPENING_LIMIT,
  OPENING_MIN_MINUTES,
  OPENING_RULES,
  openings,
  type Opening,
} from '@/domain/engines/insights/openings';
import { FORWARD_LISTED } from '@/domain/insights/forward';
import { insightKey } from '@/domain/insights/schema';
import { clockOf } from '@/lib/dates';
import { timed } from '../today/household';
import {
  at,
  att,
  BACK_FENCE,
  CALENDAR,
  calendarAt,
  compose,
  EVENTS,
  F0,
  F0_VALUES,
  F1,
  F2,
  FENCE,
  forecastOf,
  GARAGE,
  ID,
  listed,
  mulberry32,
  NZ,
  on,
  OUTPUTS,
  PEOPLE,
  run,
  shuffle,
  STALE_CALENDAR,
  surface,
  task,
  TASKS,
  WED_0703,
  withHours,
  withoutHour,
  type Run,
} from './fixture';

// The openings engine and its listing (M7 Package 3; contract §5.6–§5.8,
// §8.1, §8.6 O1–O26; ADR 0011 §29–§35), composed exactly as `openingsOver`
// and the Today and Forward Week insights read compose it. Each matrix row is
// a test named with its id and its expectation as the matrix writes it. F0
// and `now` Wednesday 14 October 07:03 unless a row says otherwise.

const SAT = '2026-10-17';
const SUN = '2026-10-18';
const SAT_TASK = `open_window:household:${SAT}:1000-1930:task:${FENCE.id}`;
const SAT_PLAIN = `open_window:household:${SAT}:1000-1930`;
const SUN_PLAIN = `open_window:household:${SUN}:0800-1930`;
const O2 =
  'Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–19:30, and the forecast for Saturday as of 06:55 looks dry.';
const O3 =
  'Nothing is recorded for the household on Sunday, 08:00–19:30. The forecast for Sunday as of 06:55 has showers possible.';

const keys = (os: readonly Opening[]) => os.map((o) => o.key);
const byDate = (os: readonly Opening[], date: string) => os.find((o) => o.date === date);
/** F0 fetched at another time (the matrix's "F0's values fetched at 06:55 that morning"). */
const f0At = (fetchedAt: Date) => forecastOf(fetchedAt, F0_VALUES);

describe('the fixture stands (§8.6)', () => {
  it('daylight for 17 and 18 October is 06:30–19:30 after rounding; Saturday’s gaps are 08:00–09:00 and 10:00–20:00', () => {
    const c = compose();
    for (const d of c.daylight.filter((x) => x.date === SAT || x.date === SUN)) {
      expect(clockOf(d.from, NZ)).toBe('06:30');
      expect(clockOf(d.to, NZ)).toBe('19:30');
    }
    expect(c.gaps.coverage.rule).toBe('coverage.recorded');
    expect(
      c.gaps.gaps
        .filter((g) => g.date === SAT)
        .map((g) => `${clockOf(g.stretch.from, NZ)}–${clockOf(g.stretch.to, NZ)}`),
    ).toEqual(['08:00–09:00', '10:00–20:00']);
  });
});

describe('O — openings (contract §8.6)', () => {
  it('O1: the fixture on Forward Week gives two openings, in order: Saturday’s task opening and Sunday’s plain one', () => {
    expect(keys(run())).toEqual([SAT_TASK, SUN_PLAIN]);
    expect(listed(surface('forward'))).toEqual({ shown: [SAT_TASK, SUN_PLAIN], rest: [], more: 0 });
  });

  it('O2: Saturday reads as the matrix writes it, and there is no plain opening on Saturday', () => {
    const os = run();
    const sat = byDate(os, SAT)!;
    expect(sat.rule).toBe('open_window.task');
    expect(sat.text).toBe(O2);
    expect(os.filter((o) => o.date === SAT)).toHaveLength(1);
    expect(keys(os)).not.toContain(SAT_PLAIN);
  });

  it('O3: Sunday reads as the matrix writes it', () => {
    const sun = byDate(run(), SUN)!;
    expect(sun.rule).toBe('open_window.plain');
    expect(sun.text).toBe(O3);
  });

  it('O4: F1 at 08:10 with Saturday showery: the task opening is gone; Saturday’s plain opening reads as the matrix writes it', () => {
    const os = run({ forecast: F1, now: at('2026-10-14', '08:12') });
    expect(keys(os)).not.toContain(SAT_TASK);
    const sat = byDate(os, SAT)!;
    expect(sat.key).toBe(SAT_PLAIN);
    expect(sat.text).toBe(
      'Nothing is recorded for the household on Saturday, 10:00–19:30. The forecast for Saturday as of 08:10 has showers possible.',
    );
  });

  it('O5: back to a dry Saturday (F2): the task key of O1 returns, with any response on it', () => {
    const now = at('2026-10-14', '09:25');
    expect(keys(run({ forecast: F2, now }))).toEqual([SAT_TASK, SUN_PLAIN]);
    // A response given on O1's key still hides it.
    const r = surface('forward', { forecast: F2, now, responded: new Set([SAT_TASK]) });
    expect(listed(r).shown).toEqual([SUN_PLAIN]);
    expect(r.all.map((i) => i.key)).toContain(SAT_TASK);
  });

  it('O6: Sunday’s forecast changes to rain likely: the same key as O3; the sentence ends “has rain likely.”', () => {
    const wet = withHours(F0, (s) =>
      s.getTime() === at(SUN, '15:00').getTime() ? { precipitationProbability: 70 } : null,
    );
    const sun = byDate(run({ forecast: wet }), SUN)!;
    expect(sun.key).toBe(SUN_PLAIN);
    expect(sun.text).toBe(
      'Nothing is recorded for the household on Sunday, 08:00–19:30. The forecast for Sunday as of 06:55 has rain likely.',
    );
  });

  it('O7: Alex dismisses Sunday’s opening; the forecast is refreshed: still hidden for Alex; shown for Sam', () => {
    const now = at('2026-10-14', '08:12');
    const alex = surface('forward', { forecast: F1, now, responded: new Set([SUN_PLAIN]) });
    const sam = surface('forward', { forecast: F1, now });
    expect(listed(alex).shown).not.toContain(SUN_PLAIN);
    expect(listed(sam).shown).toContain(SUN_PLAIN);
  });

  it('O8: Milo, Sunday 13:00–14:00: candidates 08:00–13:00 and 14:00–19:30; the opening is 14:00–19:30, eligible despite O7’s dismissal', () => {
    const events = [
      ...EVENTS,
      on('e-milo', 'Milo thing', SUN, '13:00', '14:00', { people: att(ID.milo) }),
    ];
    const sun = byDate(run({ events }), SUN)!;
    expect(sun.key).toBe(`open_window:household:${SUN}:1400-1930`);
    const r = surface('forward', { events, responded: new Set([SUN_PLAIN]) });
    expect(listed(r).shown).toEqual([SAT_TASK, `open_window:household:${SUN}:1400-1930`]);
  });

  it('O9: Thursday 15 and Friday 16 with nothing recorded: no openings on either', () => {
    const c = compose();
    // Not vacuous: both days have a whole-day household gap.
    for (const d of ['2026-10-15', '2026-10-16'])
      expect(c.gaps.gaps.some((g) => g.date === d && g.key.endsWith('0800-2000'))).toBe(true);
    expect(c.openings.map((o) => o.date)).toEqual([SAT, SUN]);
  });

  it('O10: Saturday’s candidate 10:00–11:59 / 10:00–12:00: no opening / an opening', () => {
    const until = (clock: string) => [
      ...EVENTS,
      on('e-later', 'Later', SAT, clock, '20:00', { people: att(ID.milo) }),
    ];
    expect(byDate(run({ events: until('11:59') }), SAT)).toBeUndefined();
    const sat = byDate(run({ events: until('12:00') }), SAT)!;
    expect(sat.key).toBe(`open_window:household:${SAT}:1000-1200`);
    expect(sat.rule).toBe('open_window.plain'); // the fence's three hours do not fit two
  });

  it('O11: the fence’s estimate 600 minutes: no task opening; Saturday’s plain opening', () => {
    const os = run({ tasks: [{ ...FENCE, estimateMinutes: 600 }, GARAGE] });
    expect(keys(os)).toEqual([SAT_PLAIN, SUN_PLAIN]);
  });

  it('an estimate one minute longer than the candidate (571 of 570) is not matched; the candidate’s own length (570) is', () => {
    expect(byDate(run({ tasks: [{ ...FENCE, estimateMinutes: 571 }] }), SAT)!.key).toBe(SAT_PLAIN);
    expect(byDate(run({ tasks: [{ ...FENCE, estimateMinutes: 570 }] }), SAT)!.key).toBe(SAT_TASK);
  });

  it.each([
    ['needs two_people', { needs: ['two_people'] }],
    ['needs dry weather and two_people', { needs: ['dry_weather', 'two_people'] }],
    ['needs []', { needs: [] }],
    ['no estimate', { estimateMinutes: null }],
    [
      'scheduled',
      {
        scheduledStartsAt: at('2026-10-15', '10:00'),
        scheduledEndsAt: at('2026-10-15', '13:00'),
      },
    ],
    ['done', { status: 'done' }],
    ['dropped', { status: 'dropped' }],
  ] as const)('O12: the fence %s: no task opening', (_, change) => {
    expect(keys(run({ tasks: [{ ...FENCE, ...change } as typeof FENCE, GARAGE] }))).toEqual([
      SAT_PLAIN,
      SUN_PLAIN,
    ]);
  });

  it.each(['paused', 'done'])('O12: the fence’s project %s: no task opening', (status) => {
    expect(keys(run({ projects: [{ ...BACK_FENCE, status }] }))).toEqual([SAT_PLAIN, SUN_PLAIN]);
  });

  it('O13: a task with daylight only, 120 minutes, forecast unusable: task openings on Saturday and Sunday naming it, with no weather sentence; the fence is not matched', () => {
    const windows = task('t-windows', 'Clean the windows', {
      estimateMinutes: 120,
      needs: ['daylight'],
    });
    const unusable = forecastOf(new Date(WED_0703.getTime() - (12 * 60 + 1) * 60_000));
    const os = run({ tasks: [...TASKS, windows], forecast: unusable });
    expect(keys(os)).toEqual([`${SAT_PLAIN}:task:t-windows`, `${SUN_PLAIN}:task:t-windows`]);
    expect(os[0]!.text).toBe(
      'Clean the windows is recorded as about two hours, in daylight. Nothing is recorded for the household on Saturday, 10:00–19:30.',
    );
    expect(os[1]!.text).toBe(
      'Clean the windows is recorded as about two hours, in daylight. Nothing is recorded for the household on Sunday, 08:00–19:30.',
    );
    for (const o of os) {
      expect(o.forecast).toBeNull();
      expect(o.others).toEqual([]);
      expect(o.facts.some((f) => f.kind === 'forecast')).toBe(false);
    }
  });

  it('O14: the fence with the forecast 12:01 old: no task opening; Saturday plain, with no weather sentence', () => {
    const os = run({ forecast: forecastOf(new Date(WED_0703.getTime() - (12 * 60 + 1) * 60_000)) });
    const sat = byDate(os, SAT)!;
    expect(sat.key).toBe(SAT_PLAIN);
    expect(sat.text).toBe('Nothing is recorded for the household on Saturday, 10:00–19:30.');
    // 12:00 old is still usable (older): the fence matches, worded with its time.
    const twelve = run({ forecast: forecastOf(new Date(WED_0703.getTime() - 12 * 3_600_000)) });
    expect(byDate(twelve, SAT)!.key).toBe(SAT_TASK);
    expect(byDate(twelve, SAT)!.text).toContain('as of yesterday 19:03 looks dry.');
  });

  it('O15: no location configured: openings bounded by planning hours (Saturday 10:00–20:00); no task needing daylight is matched; no weather sentence', () => {
    const windows = task('t-windows', 'Clean the windows', {
      estimateMinutes: 120,
      needs: ['daylight'],
    });
    const os = run({ point: null, forecast: null, tasks: [...TASKS, windows] });
    expect(keys(os)).toEqual([
      `open_window:household:${SAT}:1000-2000`,
      `open_window:household:${SUN}:0800-2000`,
    ]);
    expect(os[0]!.text).toBe('Nothing is recorded for the household on Saturday, 10:00–20:00.');
    for (const o of os) {
      expect(o.daylight).toBeNull();
      expect(o.edges.to).toBe('planning');
      expect(o.facts.some((f) => f.kind === 'daylight')).toBe(false);
    }
  });

  it('O16: the calendar’s last success 24:01 ago: each opening’s “Nothing is recorded” clause is qualified; Why names the calendar; data_health.stale is listed first', () => {
    const os = run({ calendars: [STALE_CALENDAR] });
    expect(byDate(os, SUN)!.text).toBe(
      'Nothing is recorded for the household on Sunday, 08:00–19:30, as far as HOME knows. The forecast for Sunday as of 06:55 has showers possible.',
    );
    expect(byDate(os, SAT)!.text).toBe(
      'Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–19:30, as far as HOME knows, and the forecast for Saturday as of 06:55 looks dry.',
    );
    for (const o of os) {
      expect(o.qualified).toBe(true);
      expect(o.coverage.rule).toBe('coverage.partial');
      expect(o.facts).toContainEqual(
        expect.objectContaining({ kind: 'calendar', id: CALENDAR.id }),
      );
    }
    const r = surface('forward', { calendars: [STALE_CALENDAR] });
    expect(r.shown[0]!.rule).toBe('data_health.stale');
    const today = surface('today', { calendars: [STALE_CALENDAR] });
    expect(today.shown[0]!.rule).toBe('data_health.stale');
  });

  it('O17: no live calendar: no openings on any surface', () => {
    for (const calendars of [[], [{ ...CALENDAR, archivedAt: at('2026-10-10', '09:00') }]]) {
      expect(run({ calendars })).toEqual([]);
      expect(surface('forward', { calendars }).all.filter((i) => i.kind === 'open_window')).toEqual(
        [],
      );
      const sat = at(SAT, '07:30');
      expect(
        surface('today', { calendars, now: sat, forecast: f0At(at(SAT, '06:55')) }).all.filter(
          (i) => i.kind === 'open_window',
        ),
      ).toEqual([]);
    }
  });

  it('O18: now Saturday 17 07:30, Today, F0’s values fetched at 06:55 that morning: one opening, Saturday’s; Sunday’s not listed and not counted', () => {
    const now = at(SAT, '07:30');
    const r = surface('today', { now, forecast: f0At(at(SAT, '06:55')) });
    const opens = [...r.shown, ...r.rest].filter((i) => i.kind === 'open_window');
    expect(opens.map((i) => i.key)).toEqual([SAT_TASK]);
    expect(opens[0]!.text).toBe(
      'Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household today, 10:00–19:30, and the forecast as of 06:55 looks dry then.',
    );
    expect(r.more).toBe(0);
    // Sunday's is derived (for the responses query) but neither listed nor counted.
    expect(r.all.map((i) => i.key)).toContain(SUN_PLAIN);
  });

  it('O19: O18, then Saturday’s is dismissed: Sunday’s appears, worded with “tomorrow”', () => {
    const now = at(SAT, '07:30');
    const r = surface('today', {
      now,
      forecast: f0At(at(SAT, '06:55')),
      responded: new Set([SAT_TASK]),
    });
    const opens = r.shown.filter((i) => i.kind === 'open_window');
    expect(opens.map((i) => i.key)).toEqual([SUN_PLAIN]);
    expect(opens[0]!.text).toBe(
      'Nothing is recorded for the household tomorrow, 08:00–19:30. The forecast as of 06:55 has showers possible then.',
    );
  });

  it('O20: now Friday 16 07:03, Today, F0’s values fetched at 06:55 that morning: Saturday’s opening, worded with “tomorrow”', () => {
    const now = at('2026-10-16', '07:03');
    const r = surface('today', { now, forecast: f0At(at('2026-10-16', '06:55')) });
    const opens = r.shown.filter((i) => i.kind === 'open_window');
    expect(opens.map((i) => i.key)).toEqual([SAT_TASK]);
    expect(opens[0]!.text).toBe(
      'Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household tomorrow, 10:00–19:30, and the forecast as of 06:55 looks dry then.',
    );
  });

  it('O21: now Saturday 17 17:45: Saturday’s opening is not current (1 h 45 min left) and is not derived', () => {
    const now = at(SAT, '17:45');
    expect(byDate(run({ now, forecast: f0At(at(SAT, '06:55')) }), SAT)).toBeUndefined();
    // At 17:30 (two hours left) it still is, from now, and keeps its key (stretch before clipping).
    const r = run({ now: at(SAT, '17:30'), forecast: f0At(at(SAT, '06:55')) });
    const sat = byDate(r, SAT)!;
    // The fence's three hours no longer fit the two left, so it is the plain opening, with the same bounds.
    expect(sat.key).toBe(SAT_PLAIN);
    expect(clockOf(sat.shown.from, NZ)).toBe('17:30');
    expect(sat.text).toContain(
      'Nothing is recorded for the household for the rest of today, until 19:30',
    );
  });

  it('O22: Forward Week with one stale calendar: data_health.stale, then Saturday’s opening shown; Sunday’s under “+ 1 more”', () => {
    const r = surface('forward', { calendars: [STALE_CALENDAR] });
    expect(r.shown.map((i) => i.rule)).toEqual(['data_health.stale', 'open_window.task']);
    expect(r.shown[1]!.key).toBe(SAT_TASK);
    expect(r.rest.map((i) => i.key)).toEqual([SUN_PLAIN]);
    expect(r.more).toBe(1);
  });

  it('O24: Alex dismisses tomorrow’s opening at 23:59; now moves to 00:01: the same key, still hidden', () => {
    const before = at('2026-10-16', '23:59');
    const after = at(SAT, '00:01');
    const forecast = f0At(at('2026-10-16', '21:00'));
    const k = surface('today', { now: before, forecast }).shown.find(
      (i) => i.kind === 'open_window',
    )!.key;
    expect(k).toBe(SAT_TASK);
    const r = surface('today', { now: after, forecast, responded: new Set([k]) });
    expect(r.all.map((i) => i.key)).toContain(k);
    expect(r.shown.map((i) => i.key)).not.toContain(k);
  });

  it('O25: a second task, Stain the deck (120 minutes, dry weather, due 30 October), and the fence (no due date): Saturday names Stain the deck; Why lists the fence', () => {
    const deck = task('t-deck', 'Stain the deck', {
      estimateMinutes: 120,
      needs: ['dry_weather'],
      dueDate: '2026-10-30',
    });
    const sat = byDate(run({ tasks: [...TASKS, deck] }), SAT)!;
    expect(sat.key).toBe(`${SAT_PLAIN}:task:t-deck`);
    expect(sat.text).toBe(
      'Stain the deck is recorded as about two hours, in dry weather. Nothing is recorded for the household on Saturday, 10:00–19:30, and the forecast for Saturday as of 06:55 looks dry.',
    );
    expect(sat.task).toEqual({ id: 't-deck', estimateMinutes: 120, needs: ['dry_weather'] });
    expect(sat.others).toEqual([
      { id: FENCE.id, estimateMinutes: 180, needs: ['dry_weather', 'daylight'] },
    ]);
    expect(sat.facts.filter((f) => f.kind === 'task')).toEqual([
      { kind: 'task', id: 't-deck' },
      { kind: 'task', id: FENCE.id },
    ]);
  });
});

describe('task matching reads only the recorded fields', () => {
  it('several undated tasks: by title (en-NZ), then id; dated ones first, earliest first', () => {
    const t = (id: string, title: string, dueDate: string | null = null) =>
      task(id, title, { estimateMinutes: 60, needs: ['daylight'], dueDate });
    const tasks = [
      t('t-b', 'b task'),
      t('t-a2', 'A task'),
      t('t-a1', 'A task'),
      t('t-late', 'Z late', '2026-11-30'),
      t('t-soon', 'Z soon', '2026-10-20'),
    ];
    const sat = byDate(run({ tasks }), SAT)!;
    expect([sat.task!.id, ...sat.others.map((o) => o.id)]).toEqual([
      't-soon',
      't-late',
      't-a1',
      't-a2',
      't-b',
    ]);
  });

  it('a requirement is never inferred from a title: “Paint the shed” with no needs is not matched; a plainly titled task with needs is', () => {
    const shed = task('t-shed', 'Paint the shed outside in the sun', { estimateMinutes: 120 });
    expect(keys(run({ tasks: [shed] }))).toEqual([SAT_PLAIN, SUN_PLAIN]);
    const plain = task('t-x', 'Job', { estimateMinutes: 120, needs: ['dry_weather'] });
    expect(byDate(run({ tasks: [plain] }), SAT)!.key).toBe(`${SAT_PLAIN}:task:t-x`);
  });

  it('the assignee is not read: the fence assigned to anyone, or no one, matches the same', () => {
    const base = JSON.stringify(run());
    for (const assigneePersonId of [null, ID.alex, ID.milo, ID.nana])
      expect(JSON.stringify(run({ tasks: [{ ...FENCE, assigneePersonId }, GARAGE] }))).toBe(base);
  });

  it('a task opening sits on the longest candidate the task matches; a plain one on the longest candidate; the earliest on a tie', () => {
    // Friday 07:03, so Saturday is tomorrow and each candidate's own hours are described.
    // Saturday: 10:00–12:00 (2 h, dry) and 13:00–19:30 (6.5 h, a shower at 15:00).
    const now = at('2026-10-16', '07:03');
    const events = [
      ...EVENTS,
      on('e-noon', 'Noon thing', SAT, '12:00', '13:00', { people: att(ID.milo) }),
    ];
    const forecast = forecastOf(at('2026-10-16', '06:55'), (s) =>
      s.getTime() === at(SAT, '15:00').getTime()
        ? { precipitationProbability: 40, precipitationMm: 0.1 }
        : F0_VALUES(s),
    );
    const deck = task('t-deck', 'Stain the deck', { estimateMinutes: 120, needs: ['dry_weather'] });
    expect(byDate(run({ now, events, forecast, tasks: [deck] }), SAT)!.key).toBe(
      `open_window:household:${SAT}:1000-1200:task:t-deck`,
    );
    expect(byDate(run({ now, events, forecast, tasks: [] }), SAT)!.key).toBe(
      `open_window:household:${SAT}:1300-1930`,
    );
    // Equal lengths: the earliest. Sunday 08:00–12:00 and 15:30–19:30 (four hours each).
    const tie = [...EVENTS, on('e-mid', 'Middle', SUN, '12:00', '15:30', { people: att(ID.milo) })];
    expect(byDate(run({ events: tie, tasks: [] }), SUN)!.key).toBe(
      `open_window:household:${SUN}:0800-1200`,
    );
  });
});

describe('weather composition (ADR 0011 §31)', () => {
  it('weather never creates or removes a plain opening: the same plain keys with no forecast, a dry one, a wet one and an unusable one', () => {
    const tasks = [GARAGE];
    const wet = forecastOf(F0.fetchedAt, () => ({
      precipitationProbability: 90,
      precipitationMm: 3,
    }));
    const unusable = forecastOf(new Date(WED_0703.getTime() - 13 * 3_600_000));
    const base = keys(run({ tasks, forecast: null }));
    expect(base).toEqual([SAT_PLAIN, SUN_PLAIN]);
    for (const forecast of [F0, wet, unusable])
      expect(keys(run({ tasks, forecast }))).toEqual(base);
    expect(byDate(run({ tasks, forecast: wet }), SAT)!.text).toBe(
      'Nothing is recorded for the household on Saturday, 10:00–19:30. The forecast for Saturday as of 06:55 has rain likely.',
    );
  });

  it('an older forecast (fetched yesterday 21:00) is said with its time; windy is said when gusts reach 50 km/h', () => {
    const older = forecastOf(at('2026-10-13', '21:00'), (s) => ({
      ...F0_VALUES(s),
      ...(s.getTime() === at(SUN, '16:00').getTime() ? { gustKmh: 50 } : {}),
    }));
    const os = run({ forecast: older });
    expect(byDate(os, SAT)!.text).toBe(O2.replace('as of 06:55', 'as of yesterday 21:00'));
    expect(byDate(os, SUN)!.text).toBe(
      'Nothing is recorded for the household on Sunday, 08:00–19:30. The forecast for Sunday as of yesterday 21:00 has showers possible, and windy.',
    );
    expect(byDate(os, SUN)!.forecast).toMatchObject({ age: 'older', windy: true, maxGustKmh: 50 });
  });

  it('a forecast missing an hour in the candidate (tomorrow) or the day (days 2–6): no dry match and no band words', () => {
    // Days 2–6: Saturday's 15:00 hour missing.
    const gap = withoutHour(F0, at(SAT, '15:00'));
    const sat = byDate(run({ forecast: gap }), SAT)!;
    expect(sat.key).toBe(SAT_PLAIN);
    expect(sat.text).toBe('Nothing is recorded for the household on Saturday, 10:00–19:30.');
    // A missing probability is the same as a missing hour.
    const nullish = withHours(F0, (s) =>
      s.getTime() === at(SAT, '15:00').getTime() ? { precipitationProbability: null } : null,
    );
    expect(byDate(run({ forecast: nullish }), SAT)!.key).toBe(SAT_PLAIN);
    // Tomorrow: the candidate's own hours. Friday 07:03, Saturday's 19:00 hour missing.
    const now = at('2026-10-16', '07:03');
    const fri = withoutHour(f0At(at('2026-10-16', '06:55')), at(SAT, '19:00'));
    const tomorrow = byDate(run({ now, forecast: fri }), SAT)!;
    expect(tomorrow.key).toBe(SAT_PLAIN);
    expect(tomorrow.text).toBe('Nothing is recorded for the household tomorrow, 10:00–19:30.');
    // A missing hour outside the candidate (Saturday 08:00) changes nothing tomorrow.
    const outside = withoutHour(f0At(at('2026-10-16', '06:55')), at(SAT, '08:00'));
    expect(byDate(run({ now, forecast: outside }), SAT)!.key).toBe(SAT_TASK);
  });

  it('today and tomorrow describe the candidate’s hours; days 2–6 the day’s planning hours', () => {
    // A shower at 08:00 Saturday, outside the candidate (10:00–19:30) but inside planning hours.
    const early = (fetchedAt: Date) =>
      forecastOf(fetchedAt, (s) =>
        s.getTime() === at(SAT, '08:00').getTime()
          ? { precipitationProbability: 40, precipitationMm: 0.1 }
          : F0_VALUES(s),
      );
    // Days 2–6 (from Wednesday): the day's band is showers, so no dry match.
    expect(byDate(run({ forecast: early(F0.fetchedAt) }), SAT)!.key).toBe(SAT_PLAIN);
    // Tomorrow (from Friday): the candidate's hours are dry, so the fence matches.
    const now = at('2026-10-16', '07:03');
    const sat = byDate(run({ now, forecast: early(at('2026-10-16', '06:55')) }), SAT)!;
    expect(sat.key).toBe(SAT_TASK);
    expect(sat.forecast).toMatchObject({
      over: 'span',
      from: at(SAT, '10:00'),
      to: at(SAT, '20:00'),
    });
    expect(byDate(run(), SAT)!.forecast).toMatchObject({
      over: 'day',
      from: at(SAT, '08:00'),
      to: at(SAT, '20:00'),
    });
  });

  it('no words beyond the forecast’s hours: a forecast that ends before Sunday gives Sunday no clause and no dry match', () => {
    const short = {
      fetchedAt: F0.fetchedAt,
      hours: F0.hours.filter((h) => h.start < at(SUN, '12:00')),
    };
    const deck = task('t-deck', 'Stain the deck', { estimateMinutes: 120, needs: ['dry_weather'] });
    const sun = byDate(run({ forecast: short, tasks: [deck] }), SUN)!;
    expect(sun.key).toBe(SUN_PLAIN);
    expect(sun.text).toBe('Nothing is recorded for the household on Sunday, 08:00–19:30.');
  });
});

describe('candidates (contract §5.6)', () => {
  it('weekends only: Friday and Monday, each with nothing recorded, give none; Saturday and Sunday do', () => {
    const now = at('2026-10-16', '07:03'); // Friday … Thursday 22
    const c = compose({ now, forecast: f0At(at('2026-10-16', '06:55')) });
    for (const d of ['2026-10-16', '2026-10-19'])
      expect(c.gaps.gaps.some((g) => g.date === d && g.key.endsWith('0800-2000'))).toBe(true);
    expect(c.openings.map((o) => o.date)).toEqual([SAT, SUN]);
  });

  it(`exactly ${OPENING_MIN_MINUTES} minutes is kept and 119 dropped, measured on the shown span (clipped to now on today)`, () => {
    const forecast = f0At(at(SAT, '06:55'));
    expect(byDate(run({ now: at(SAT, '17:30'), forecast }), SAT)).toBeDefined();
    expect(byDate(run({ now: at(SAT, '17:31'), forecast }), SAT)).toBeUndefined();
  });

  it('coverage unknown gives none; partial qualifies every opening; recorded does not', () => {
    expect(run({ calendars: [] })).toEqual([]);
    expect(
      run({ calendars: [{ ...CALENDAR, lastSyncStatus: 'unreachable' }] }).every(
        (o) => o.qualified,
      ),
    ).toBe(true);
    expect(
      run({ calendars: [{ ...CALENDAR, lastSyncedAt: null, lastSyncStatus: null }] }).every(
        (o) => o.qualified,
      ),
    ).toBe(true);
    expect(run().every((o) => !o.qualified && !o.text.includes('as far as'))).toBe(true);
  });

  it('daylight across both Pacific/Auckland DST change dates: Sunday 27 September 2026 and Sunday 4 April 2027', () => {
    const tasks: Run['tasks'] = [];
    const sep = run({
      now: at('2026-09-24', '07:03', '+12:00'),
      forecast: null,
      tasks,
      events: [],
    });
    // Saturday 26 (NZST): daylight 06:15–18:15; Sunday 27 (DST starts at 02:00): 07:15–19:15.
    expect(keys(sep)).toEqual([
      'open_window:household:2026-09-26:0800-1815',
      'open_window:household:2026-09-27:0800-1915',
    ]);
    const s27 = byDate(sep, '2026-09-27')!;
    expect(s27.stretch.to).toEqual(new Date('2026-09-27T19:15:00+13:00'));
    expect(s27.edges).toEqual({ from: 'planning', to: 'daylight' });
    expect(s27.facts).toContainEqual({ kind: 'daylight', date: '2026-09-27' });
    const apr = run({ now: at('2027-04-01', '07:03'), forecast: null, tasks, events: [] });
    // Saturday 3 (NZDT): 07:45–19:00; Sunday 4 (DST ends at 03:00): 06:45–18:00.
    expect(keys(apr)).toEqual([
      'open_window:household:2027-04-03:0800-1900',
      'open_window:household:2027-04-04:0800-1800',
    ]);
    expect(byDate(apr, '2027-04-04')!.stretch.to).toEqual(new Date('2027-04-04T18:00:00+12:00'));
    // An occurrence across the change (Milo 01:30–09:00 on 27 September) starts it at 09:00.
    const across = run({
      now: at('2026-09-24', '07:03', '+12:00'),
      forecast: null,
      tasks,
      events: [
        timed('e-dst', 'Early', '2026-09-27T01:30:00+12:00', '2026-09-27T09:00:00+13:00', {
          people: att(ID.milo),
        }),
      ],
    });
    expect(byDate(across, '2026-09-27')!.key).toBe('open_window:household:2026-09-27:0900-1915');
  });

  it('winter daylight bounds both ends: Sunday 20 June 2027 is 08:00–16:45 (sunrise 07:46, sunset 16:58)', () => {
    const os = run({
      now: at('2027-06-17', '07:03', '+12:00'),
      forecast: null,
      tasks: [],
      events: [],
    });
    const sun = byDate(os, '2027-06-20')!;
    expect(sun.key).toBe('open_window:household:2027-06-20:0800-1645');
    expect(sun.edges).toEqual({ from: 'planning', to: 'daylight' });
    expect(clockOf(sun.daylight!.sunset, NZ)).toBe('16:58');
  });
});

describe('identity and lifecycle (contract §5.7)', () => {
  const sat = (o: Run = {}) => byDate(run(o), SAT)!.key;

  it('a refreshed forecast with different numbers keeps a plain opening’s key; the sentence changes', () => {
    const a = byDate(run(), SUN)!;
    const b = byDate(run({ forecast: F1, now: at('2026-10-14', '08:12') }), SUN)!;
    expect(b.key).toBe(a.key);
    expect(b.text).not.toBe(a.text);
  });

  it('wet: the task opening is no longer derived and the plain one appears; dry again: the task key returns (O4, O5)', () => {
    expect(sat()).toBe(SAT_TASK);
    expect(sat({ forecast: F1, now: at('2026-10-14', '08:12') })).toBe(SAT_PLAIN);
    expect(sat({ forecast: F2, now: at('2026-10-14', '09:25') })).toBe(SAT_TASK);
  });

  it('a commitment added, moved or archived so the bounds move: a new key; restored: the old key', () => {
    const later = EVENTS.map((e) =>
      e.id === 'e-football' ? { ...e, endsAt: at(SAT, '10:30') } : e,
    );
    expect(sat({ events: later })).toBe(`open_window:household:${SAT}:1030-1930:task:${FENCE.id}`);
    const added = [...EVENTS, on('e-new', 'New', SAT, '19:00', '20:00', { people: att(ID.sam) })];
    expect(sat({ events: added })).toBe(`open_window:household:${SAT}:1000-1900:task:${FENCE.id}`);
    const archived = EVENTS.filter((e) => e.id !== 'e-football');
    expect(sat({ events: archived })).toBe(
      `open_window:household:${SAT}:0800-1930:task:${FENCE.id}`,
    );
    expect(sat({ events: EVENTS })).toBe(SAT_TASK);
  });

  it('a commitment’s title, kind or people change with the same times and blocking: the same key', () => {
    const changed = EVENTS.map((e) =>
      e.id === 'e-football'
        ? { ...e, title: 'Football (renamed)', kind: 'school' as const, people: att(ID.milo) }
        : e,
    );
    expect(sat({ events: changed })).toBe(SAT_TASK);
  });

  it('daylight’s rounded edge moves with the location: a new key for that candidate', () => {
    // Christchurch's Cathedral Square (the second public synthetic point): sunset later.
    const chch = run({ point: { lat: -43.53, lon: 172.64 } });
    expect(byDate(chch, SAT)!.key).not.toBe(SAT_TASK);
    expect(byDate(chch, SAT)!.key).toMatch(
      /^open_window:household:2026-10-17:1000-\d{4}:task:t-fence$/,
    );
  });

  it('the matched task done, scheduled or edited out of matching: its opening ends; the next task’s (or the plain) opening has its own key', () => {
    const deck = task('t-deck', 'Stain the deck', { estimateMinutes: 120, needs: ['dry_weather'] });
    expect(sat({ tasks: [FENCE, deck] })).toBe(SAT_TASK); // undated: by title, Paint before Stain
    expect(sat({ tasks: [{ ...FENCE, status: 'done' }, deck] })).toBe(`${SAT_PLAIN}:task:t-deck`);
    expect(sat({ tasks: [{ ...FENCE, needs: [] }] })).toBe(SAT_PLAIN);
  });

  it('the task’s title or estimate changes and it still matches: the same key', () => {
    expect(sat({ tasks: [{ ...FENCE, title: 'Paint the fence', estimateMinutes: 240 }] })).toBe(
      SAT_TASK,
    );
  });

  it('midnight passes: the same key (the opening’s date, not the viewing date)', () => {
    const forecast = f0At(at('2026-10-16', '21:00'));
    expect(sat({ now: at('2026-10-16', '23:59'), forecast })).toBe(
      sat({ now: at(SAT, '00:01'), forecast }),
    );
  });

  it('keys: at most 200 characters (the longest, with a uuid, 84), insightKey-valid, no text, no forecast value or fetch time', () => {
    const uuid = '0f8e1c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
    const os = run({ tasks: [{ ...FENCE, id: uuid }] });
    const longest = os.find((o) => o.key.includes(uuid))!.key;
    expect(longest.length).toBe(84);
    for (const o of [...os, ...OUTPUTS.flat()]) {
      expect(insightKey.safeParse(o.key).success, o.key).toBe(true);
      expect(o.key.length).toBeLessThanOrEqual(200);
      expect(o.key).toMatch(
        /^open_window:household:\d{4}-\d{2}-\d{2}:\d{4}-\d{4}(:task:[A-Za-z0-9-]+)?$/,
      );
    }
  });
});

describe('ranking and caps (contract §5.8, D15)', () => {
  it('openings rank after data_health, conflict, preparation and busy_day, by date, then start, then key', () => {
    // Saturday 17 07:30, Today: a stale calendar (data_health), a birthday tomorrow
    // (preparation) and six things tomorrow before planning hours (busy_day).
    const now = at(SAT, '07:30');
    const busy = Array.from({ length: 6 }, (_, i) =>
      on(`e-busy-${i}`, `Busy ${i}`, SUN, `0${i}:00`, `0${i}:30`),
    );
    const people = PEOPLE.map((p) => (p.id === ID.milo ? { ...p, dateOfBirth: '2017-10-18' } : p));
    const r = surface('today', {
      now,
      people,
      events: [...EVENTS, ...busy],
      calendars: [
        {
          ...CALENDAR,
          lastSyncedAt: at('2026-10-14', '07:00'),
          lastAttemptAt: at('2026-10-14', '07:00'),
        },
      ],
      forecast: f0At(at(SAT, '06:55')),
    });
    // Milo's birthday tomorrow and Nana Jo's on Tuesday: two preparations.
    expect(r.all.map((i) => i.kind)).toEqual([
      'data_health',
      'preparation',
      'preparation',
      'busy_day',
      'open_window',
      'open_window',
    ]);
    expect(r.shown.map((i) => i.kind)).toEqual(['data_health', 'preparation', 'preparation']);
    // The first opening is listed (under "+ N more", after busy_day); the second is past the
    // cap, neither listed nor counted.
    expect(r.rest.map((i) => i.kind)).toEqual(['busy_day', 'open_window']);
    expect(r.rest[1]!.key).toBe(SAT_TASK);
    expect(r.more).toBe(2);
    // Within the family: date, then start, then key.
    expect(r.all.filter((i) => i.kind === 'open_window').map((i) => i.when)).toEqual([SAT, SUN]);
  });

  it('caps: Today lists one, Forward Week two; past the cap neither listed nor counted', () => {
    expect(listed(surface('forward'))).toEqual({ shown: [SAT_TASK, SUN_PLAIN], rest: [], more: 0 });
    const sat = at(SAT, '07:30');
    const forecast = f0At(at(SAT, '06:55'));
    const today = surface('today', { now: sat, forecast });
    // Nana Jo's birthday on Tuesday is listed too; of the two openings, only Saturday's.
    expect(listed(today)).toEqual({
      shown: ['preparation.birthday:p-nana:2026-10-20', SAT_TASK],
      rest: [],
      more: 0,
    });
    // Forward with three shown slots taken by data_health would still list at most two openings.
    const calendars = [
      STALE_CALENDAR,
      { ...STALE_CALENDAR, id: 'c-2', name: 'Two' },
      { ...STALE_CALENDAR, id: 'c-3', name: 'Three' },
    ];
    const r = surface('forward', { calendars });
    expect(r.shown.map((i) => i.kind)).toEqual(['data_health', 'data_health']);
    expect(r.rest.map((i) => i.kind)).toEqual(['data_health', 'open_window', 'open_window']);
    expect(r.more).toBe(3);
  });

  it('caps ±1 at the listing boundary: zero, one, two and three allowed, over the same two openings', () => {
    for (const [cap, shown] of [
      [0, []],
      [1, [SAT_TASK]],
      [2, [SAT_TASK, SUN_PLAIN]],
      [3, [SAT_TASK, SUN_PLAIN]],
    ] as const) {
      const r = surface('forward', { cap });
      expect(listed(r), String(cap)).toEqual({ shown, rest: [], more: 0 });
      // The engine's output stays complete: both are in `all`, for the responses query.
      expect(r.all.filter((i) => i.kind === 'open_window')).toHaveLength(2);
    }
  });

  it('Month, Season and a person’s page list no openings, even when given them', () => {
    for (const listedKinds of [FORWARD_LISTED.month, FORWARD_LISTED.season, new Set<never>()]) {
      const r = surface('forward', { listedKinds });
      expect(r.all.filter((i) => i.kind === 'open_window')).toHaveLength(2);
      expect([...r.shown, ...r.rest].some((i) => i.kind === 'open_window')).toBe(false);
    }
  });
});

describe('determinism and traceability (contract §3.7, §8.1)', () => {
  it('shuffled inputs over eight seeds, repeated: identical openings, deep and byte for byte', () => {
    const deck = task('t-deck', 'Stain the deck', {
      estimateMinutes: 120,
      needs: ['dry_weather'],
      dueDate: '2026-10-30',
    });
    const events = [
      ...EVENTS,
      on('e-milo', 'Milo thing', SUN, '13:00', '14:00', { people: att(ID.milo) }),
    ];
    const tasks = [
      ...TASKS,
      deck,
      task('t-windows', 'Clean the windows', { estimateMinutes: 120, needs: ['daylight'] }),
    ];
    const base = run({ events, tasks });
    for (let seed = 1; seed <= 8; seed++) {
      const random = mulberry32(seed);
      const c = compose({ events, tasks });
      const shuffled = openings({
        now: WED_0703,
        timeZone: NZ,
        window: { from: '2026-10-14', to: '2026-10-20' },
        gaps: { coverage: c.gaps.coverage, gaps: shuffle(c.gaps.gaps, random) },
        forecast: { fetchedAt: F0.fetchedAt, hours: F0.hours },
        daylight: shuffle(c.daylight, random),
        tasks: shuffle(tasks, random),
        projects: shuffle(
          [BACK_FENCE, { id: 'pr-x', title: 'X', status: 'idea', targetDate: null }],
          random,
        ),
      });
      expect(shuffled).toEqual(base);
      expect(JSON.stringify(shuffled)).toBe(JSON.stringify(base));
      expect(
        JSON.stringify(run({ events: shuffle(events, random), tasks: shuffle(tasks, random) })),
      ).toBe(JSON.stringify(base));
    }
  });

  it('stable order: date, then start, then key; repeated runs are byte-identical', () => {
    const a = run();
    expect(JSON.stringify(run())).toBe(JSON.stringify(a));
    const sorted = [...a].sort((x, y) => (x.date < y.date ? -1 : 1));
    expect(a).toEqual(sorted);
  });

  it('every opening carries a known rule, documented in the contract, and facts that resolve to its inputs', () => {
    const contract = readFileSync('docs/m7/M7-BUILD-CONTRACT.md', 'utf8');
    for (const r of OPENING_RULES) {
      expect(INSIGHT_RULES).toContain(r);
      expect(contract).toContain(`\`${r}\``);
    }
    const c = compose();
    for (const o of c.openings) {
      expect(OPENING_RULES).toContain(o.rule);
      const gap = c.gaps.gaps.find((g) => g.key === o.gap.key)!;
      for (const f of gap.facts) expect(o.facts).toContainEqual(f);
      expect(o.facts).toContainEqual({ kind: 'range', from: o.date, to: o.date });
      expect(o.facts.filter((f) => f.kind === 'person').map((f) => f.id)).toEqual(o.people);
      if (o.task) expect(o.facts).toContainEqual({ kind: 'task', id: o.task.id });
      if (o.forecast)
        expect(o.facts).toContainEqual({
          kind: 'forecast',
          from: o.forecast.from.toISOString(),
          to: o.forecast.to.toISOString(),
          fetchedAt: o.forecast.fetchedAt.toISOString(),
        });
      expect(o.limit).toBe(OPENING_LIMIT);
    }
    // Saturday: Football before it (an event fact); daylight after it.
    const sat = byDate(c.openings, SAT)!;
    expect(sat.gap.before).toEqual({ kind: 'event', id: 'e-football', occurrenceDate: SAT });
    expect(sat.edges).toEqual({ from: 'commitment', to: 'daylight' });
    expect(sat.facts).toContainEqual({ kind: 'daylight', date: SAT });
    expect(clockOf(sat.daylight!.sunset, NZ)).toBe('19:43');
  });

  it('the engines import no db, app, kev, ui, integrations or clock', () => {
    const src = readFileSync('src/domain/engines/insights/openings.ts', 'utf8');
    expect(src).not.toMatch(/@\/(db|app|kev|ui|integrations)|from '\.\.\/\.\.\/(db|app)/);
    expect(src).not.toMatch(/Date\.now\(|new Date\(\)/);
  });

  it('{estimate}: whole hours in words up to ten, otherwise minutes', () => {
    expect([60, 120, 180, 600, 660, 90, 30, 1].map(estimateWords)).toEqual([
      'one hour',
      'two hours',
      'three hours',
      'ten hours',
      '660 minutes',
      '90 minutes',
      '30 minutes',
      '1 minute',
    ]);
  });
});

describe('O26: no word from the M5, M6 or M7 lists, in any template, at every band, age and coverage', () => {
  const FORBIDDEN =
    /\b(needs?|needs you|nobody's down|who\?|lift|pick(ing)? up|drop(ping)? off|taking|driving|free|available|out|easy|busy|full|calm|stress\w*|covered|sorted|nothing needs|should|probably|nothing prepared|urgent|don'?’?t forget|packed|steady|clear|quiet|overwhelming|away|unavailable|in two places|double-booked|can'?’?t|clash|worth deciding|nothing on|everyone can|both of you|you could|a good time|good day|good for|best|ideal|perfect|nice|great|fine|mild|lovely|chance to|opportunity|room for|fits|suitable|recommend|window|out of date|error)\b/i;
  const TITLES = ['Paint the back fence', 'Stain the deck', 'Clean the windows'];

  it('every generated sentence, and the limit sentence', () => {
    const texts = new Set<string>([OPENING_LIMIT]);
    const band = (p: number, mm: number, gust: number) => (s: Date) => ({
      ...(s >= at(SAT, '08:00') && s < at('2026-10-19', '08:00')
        ? { precipitationProbability: p, precipitationMm: mm, gustKmh: gust }
        : {}),
    });
    const tasks = [
      FENCE,
      task('t-deck', 'Stain the deck', { estimateMinutes: 90, needs: ['dry_weather'] }),
      task('t-windows', 'Clean the windows', { estimateMinutes: 660, needs: ['daylight'] }),
    ];
    const nows = [
      WED_0703,
      at('2026-10-16', '07:03'),
      at(SAT, '07:30'),
      at(SAT, '12:10'),
      at(SUN, '09:00'),
    ];
    for (const now of nows)
      for (const [p, mm] of [
        [5, 0],
        [40, 0.1],
        [80, 2],
      ] as const)
        for (const gust of [30, 60])
          for (const ageHours of [0.5, 10, 13, null])
            for (const calendars of [[calendarAt(now)], [STALE_CALENDAR]])
              for (const ts of [tasks, [GARAGE], [tasks[1]!], [tasks[2]!]]) {
                const forecast =
                  ageHours === null
                    ? null
                    : forecastOf(new Date(now.getTime() - ageHours * 3_600_000), band(p, mm, gust));
                for (const o of run({ now, forecast, calendars, tasks: ts })) texts.add(o.text);
              }
    expect(texts.size).toBeGreaterThan(40);
    const all = [...texts];
    // Every template reached: plain and task, today/tomorrow/day, begun, qualified, each band, windy, older.
    for (const re of [
      /^Nothing is recorded for the household on Saturday/,
      /tomorrow, \d/,
      /today, \d/,
      /for the rest of today, until/,
      /, as far as HOME knows/,
      /looks dry/,
      /has showers possible/,
      /has rain likely/,
      /, and windy/,
      /as of yesterday/,
      /in dry weather and daylight/,
      /in dry weather\./,
      /in daylight\./,
      /about 90 minutes/,
      /about 660 minutes/,
    ])
      expect(
        all.some((t) => re.test(t)),
        String(re),
      ).toBe(true);
    for (const t of all) {
      let own = t;
      for (const title of TITLES) own = own.split(title).join('');
      expect(own, t).not.toMatch(FORBIDDEN);
      // "likely" only in "rain likely".
      expect(own.replace(/rain likely/gi, ''), t).not.toMatch(/likely/i);
    }
  });

  it('nothing the engine emits says a forbidden word (rules, edges, fact kinds, ages), recorded needs and ids aside', () => {
    expect(OUTPUTS.length).toBeGreaterThan(40);
    const emitted = JSON.stringify(OUTPUTS)
      .replace(/"(id|key|text|limit|title)":"[^"]*"/g, '"$1":""')
      .replace(/"needs":\[[^\]]*\]/g, '"needs":[]')
      .replace(/"needs"/g, '""');
    expect(emitted).not.toMatch(FORBIDDEN);
  });
});
