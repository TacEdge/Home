import { describe, expect, it } from 'vitest';
import { agenda, type AgendaEventInput } from '@/domain/engines/agenda';
import { forward, forwardPlacements, HORIZONS, type Horizon } from '@/domain/engines/forward';
import { conflicts } from '@/domain/engines/conflicts';
import {
  conflictMarks,
  insights,
  type InsightKind,
  type InsightPerson,
} from '@/domain/engines/insights';
import { placement, type TodayCalendar } from '@/domain/engines/today';
import { addDays, isoDateInZone } from '@/lib/dates';
import { at, fresh, ID, NZ, PEOPLE, ROUTINE, timed } from '../today/household';

// Forward's Worth knowing and its marks (M6 Package 4; contract §4.1, §4.5,
// §5.8; ADR 0009 §18): the page's composition, pure, with an injected `now`.
// Week lists only a calendar's health, and says its conflicts on its rows;
// Month and Season list theirs and show no marks; two are shown before
// "+ N more". A response hides a conflict from every horizon. Times are
// NZDT. Synthetic fixture family only.

const att = (...ids: string[]) => ids.map((personId) => ({ personId, role: 'attending' as const }));
const resp = (...ids: string[]) =>
  ids.map((personId) => ({ personId, role: 'responsible' as const }));
const WED_0703 = at('2026-10-14T07:03:00+13:00');
// A calendar last updated in the first week of October: stale on the 14th.
const STALE = fresh(at('2026-10-01T00:00:00Z'), { id: 'c-old', name: 'Old' });
const pair = (day: string, person: string, ids = ['e-art', 'e-dentist']) => [
  timed(ids[0]!, 'Art club', `${day}T15:00:00+13:00`, `${day}T16:00:00+13:00`, {
    people: att(person),
  }),
  timed(ids[1]!, 'Dentist', `${day}T15:30:00+13:00`, `${day}T16:30:00+13:00`, {
    people: att(person),
  }),
];

const FENCE = { id: 'pr-fence', title: 'Back fence', status: 'active', targetDate: '2026-10-17' };

type House = {
  events: AgendaEventInput[];
  calendars?: TodayCalendar[];
  people?: InsightPerson[];
  /** The reader's responses: Dismiss and Not useful both put the key here. */
  responded?: ReadonlySet<string>;
  /** Back fence: an active project, target Saturday 17th, with one open task. */
  fence?: boolean;
  now?: Date;
};

// What Forward's Worth knowing lists on each horizon (src/domain/insights/forward.ts),
// written out so a change to the service's table is a change to this test.
const LISTED: Record<Horizon, ReadonlySet<InsightKind>> = {
  week: new Set(['data_health']),
  month: new Set(['data_health', 'conflict']),
  season: new Set(['data_health', 'conflict']),
};
const HORIZON_DAYS: Record<Horizon, number> = { week: 7, month: 30, season: 90 };

/** The page's composition, exactly: 90-day agenda, conflicts, insights, the engine, the marks. */
function page(h: House, horizon: Horizon) {
  const now = h.now ?? WED_0703;
  const people = h.people ?? PEOPLE;
  const calendars = h.calendars ?? [fresh(now)];
  const responded = h.responded ?? new Set<string>();
  const projects = h.fence ? [FENCE] : [];
  const today = isoDateInZone(now, NZ);
  const coverage = { from: today, to: addDays(today, 89) };
  const days = agenda({
    ...coverage,
    timeZone: NZ,
    events: h.events,
    people: people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: [],
    projects,
  });
  const found = conflicts({
    now,
    timeZone: NZ,
    window: coverage,
    days,
    coverage,
    events: h.events,
    people,
  });
  const worth = insights({
    now,
    timeZone: NZ,
    days,
    events: h.events,
    people,
    tasks: h.fence ? [{ id: 't-paint', projectId: 'pr-fence' }] : [],
    projects,
    calendars,
    dismissed: responded,
    conflicts: found,
    through: addDays(today, HORIZON_DAYS[horizon] - 1),
    listed: LISTED[horizon],
    shown: 2,
  });
  const current = found.filter((c) => !responded.has(c.key));
  const model = forward({
    now,
    timeZone: NZ,
    horizon,
    days,
    coverage,
    events: h.events,
    people,
    calendars,
    conflicts: current.map((c) => ({
      key: c.key,
      occurrences: c.occurrences.map((o) => o.occurrence),
    })),
  });
  const placed = forwardPlacements(model);
  const marks = conflictMarks(worth, responded, placed, NZ);
  return { found, worth, model, placed, marks };
}

const listing = (p: ReturnType<typeof page>) => [...p.worth.shown, ...p.worth.rest];
const unitFrom = (p: ReturnType<typeof page>, from: string) =>
  p.model.units.find((u) => u.from === from)!;
const markTexts = (p: ReturnType<typeof page>, key: string) =>
  (p.marks.get(placement(null, key)) ?? []).map((m) => m.text);

describe('Week lists a calendar’s health only (contract §5.8)', () => {
  // A stale calendar; a conflict (Milo, Friday); Nana Jo’s birthday on the 20th
  // (preparation); six things on tomorrow (busy_day).
  const six = Array.from({ length: 6 }, (_, k) =>
    timed(
      `e-six${k}`,
      `Thing ${k}`,
      `2026-10-15T0${k + 1}:00:00+13:00`,
      `2026-10-15T0${k + 1}:30:00+13:00`,
      {
        people: att(ID.sam),
      },
    ),
  );
  const events = [...pair('2026-10-16', ID.milo), ...six];

  it('lists the stale calendar; the conflict, the birthday and the busy day are said on their objects', () => {
    const p = page({ events, calendars: [STALE], fence: true }, 'week');
    const byKind = (k: InsightKind) => p.worth.all.filter((i) => i.kind === k);
    expect(byKind('data_health').map((i) => [i.rule, i.onObject])).toEqual([
      ['data_health.stale', false],
    ]);
    expect(byKind('conflict')).toHaveLength(1);
    expect(
      byKind('preparation')
        .map((i) => i.rule)
        .sort(),
    ).toEqual(['preparation.birthday', 'preparation.project_target']);
    expect(byKind('busy_day').map((i) => i.rule)).toEqual(['busy_day.count']);
    // They are still in `all`, with their keys (the one responses query, the marks), but marked on-object.
    for (const k of ['conflict', 'preparation', 'busy_day'] as const)
      for (const i of byKind(k)) expect(i.onObject).toBe(true);
    expect(p.worth.shown.map((i) => i.rule)).toEqual(['data_health.stale']);
    expect(p.worth.rest).toEqual([]);
    expect(p.worth.more).toBe(0);
  });

  it('with a fresh calendar, Week lists nothing at all', () => {
    const p = page({ events }, 'week');
    expect(listing(p)).toEqual([]);
    expect(p.worth.more).toBe(0);
  });
});

describe('Month and Season list data_health, then conflicts; two shown, an exact "+ N more"', () => {
  // Responsible (Alex, Sat 17th 10:00), overlap Milo (Fri 16th), overlap Isla
  // (Thu 22nd): the responsible one is last in time and first in its family.
  const events = [
    ...pair('2026-10-16', ID.milo, ['e-art-m', 'e-dentist-m']),
    ...pair('2026-10-22', ID.isla, ['e-art-i', 'e-dentist-i']),
    timed('e-r1', 'Meeting', '2026-10-17T10:00:00+13:00', '2026-10-17T11:00:00+13:00', {
      people: resp(ID.alex),
    }),
    timed('e-r2', 'Shift', '2026-10-17T10:30:00+13:00', '2026-10-17T11:30:00+13:00', {
      people: resp(ID.alex),
    }),
  ];

  it.each(['month', 'season'] as const)(
    '%s: stale calendar, responsible, overlap by start, then key',
    (h) => {
      const p = page({ events, calendars: [STALE] }, h);
      expect(listing(p).map((i) => i.rule)).toEqual([
        'data_health.stale',
        'conflict.responsible',
        'conflict.overlap',
        'conflict.overlap',
      ]);
      expect(p.worth.shown.map((i) => i.rule)).toEqual([
        'data_health.stale',
        'conflict.responsible',
      ]);
      expect(p.worth.rest.map((i) => i.when)).toEqual(['2026-10-16', '2026-10-22']);
      expect(p.worth.more).toBe(2);
      expect(p.worth.rest.map((i) => i.text)).toEqual([
        'Milo has Art club and Dentist at the same time on Friday 16 October, 15:30–16:00.',
        'Isla has Art club and Dentist at the same time on Thursday 22 October, 15:30–16:00.',
      ]);
      // Conflicts are listed, so there are no marks on any row.
      expect(p.marks.size).toBe(0);
    },
  );

  it('two overlaps that start together are ordered by key', () => {
    const same = [
      ...pair('2026-10-16', ID.milo, ['e-art-m', 'e-dentist-m']),
      ...pair('2026-10-16', ID.isla, ['e-art-i', 'e-dentist-i']),
    ];
    const p = page({ events: same }, 'month');
    const keys = listing(p).map((i) => i.key);
    expect(keys).toHaveLength(2);
    expect(keys).toEqual([...keys].sort());
  });

  it('nothing past the horizon: Season sees a conflict Month does not', () => {
    const far = pair('2026-12-02', ID.milo);
    expect(listing(page({ events: far }, 'month'))).toEqual([]);
    expect(listing(page({ events: far }, 'season')).map((i) => i.rule)).toEqual([
      'conflict.overlap',
    ]);
  });
});

describe('Week marks (contract §4.5)', () => {
  const events = pair('2026-10-16', ID.milo);

  it('one conflict is marked on both of its row entries, one key behind both, naming the person', () => {
    const p = page({ events }, 'week');
    const friday = unitFrom(p, '2026-10-16');
    // Conflicted entries lead their row.
    expect(friday.shown.map((e) => [e.key, e.conflicted])).toEqual([
      ['e-art:2026-10-16', true],
      ['e-dentist:2026-10-16', true],
    ]);
    expect(markTexts(p, 'e-art:2026-10-16')).toEqual(['overlaps Dentist 15:30 · Milo']);
    expect(markTexts(p, 'e-dentist:2026-10-16')).toEqual(['overlaps Art club 15:00 · Milo']);
    const keys = [...p.marks.values()].flat().map((m) => m.insight.key);
    expect(keys).toEqual([p.found[0]!.key, p.found[0]!.key]);
    expect(p.model.headline.conflicts?.text).toBe('There is one overlap.');
    expect(p.model.counts.conflicts).toBe(1);
    // It is not listed: Week’s Worth knowing is a calendar’s health only.
    expect(listing(p)).toEqual([]);
  });

  it.each(['month', 'season'] as const)('%s: no marks, and the conflict is listed instead', (h) => {
    const p = page({ events }, h);
    expect(p.marks.size).toBe(0);
    expect(listing(p).map((i) => i.key)).toEqual([p.found[0]!.key]);
    // The row still leads with the conflicted entries, as the engine orders it.
    const row = p.model.units.find((u) => u.notable.some((e) => e.key === 'e-art:2026-10-16'))!;
    expect(row.notable.slice(0, 2).map((e) => e.conflicted)).toEqual([true, true]);
  });

  it('the marks are on shared Forward rows only: with no placed entries, nothing is marked', () => {
    const p = page({ events }, 'week');
    expect(conflictMarks(p.worth, new Set(), new Set(), NZ).size).toBe(0);
  });
});

describe('a response is a response on every horizon', () => {
  const events = pair('2026-10-16', ID.milo);
  const key = page({ events }, 'week').found[0]!.key;

  it.each(HORIZONS)('%s: gone from the headline, the row flag, the listing and the marks', (h) => {
    const before = page({ events }, h);
    expect(before.model.headline.conflicts?.text).toBe('There is one overlap.');
    const after = page({ events, responded: new Set([key]) }, h);
    expect(after.model.headline.conflicts).toBeNull();
    expect(after.model.counts.conflicts).toBe(0);
    const entries = after.model.units
      .flatMap((u) => u.notable)
      .filter((e) => e.key.startsWith('e-'));
    expect(entries.map((e) => e.conflicted)).toEqual([false, false]);
    expect(listing(after)).toEqual([]);
    expect(after.worth.more).toBe(0);
    expect(after.marks.size).toBe(0);
    // The record itself is still in `all`, marked as responded by its key only.
    expect(after.worth.all.some((i) => i.key === key)).toBe(true);
  });

  it('a second, unanswered conflict is unaffected', () => {
    const two = [...events, ...pair('2026-10-17', ID.isla, ['e-art-i', 'e-dentist-i'])];
    const p = page({ events: two, responded: new Set([key]) }, 'month');
    expect(p.model.headline.conflicts?.text).toBe('There is one overlap.');
    expect(listing(p).map((i) => i.when)).toEqual(['2026-10-17']);
  });
});

describe('a changed occurrence of a usual series (ADR 0009 §13)', () => {
  // Swimming (Wed 15:30–16:15, Milo) and a weekly Tutoring (Wed 15:45–16:30, Milo):
  // a standing conflict. The 21st’s Swimming is moved to 16:00, overlapping
  // that day’s Tutoring: a conflict of its own, by occurrence.
  const tutoring = timed(
    'e-tutor',
    'Tutoring',
    '2026-10-14T15:45:00+13:00',
    '2026-10-14T16:30:00+13:00',
    { kind: 'activity', rrule: 'FREQ=WEEKLY;BYDAY=WE', people: att(ID.milo) },
  );
  const swim = { ...ROUTINE.find((e) => e.id === 'e-swim')!, exdates: ['2026-10-21'] };
  const moved = timed(
    'e-swim-moved',
    'Swimming',
    '2026-10-21T16:00:00+13:00',
    '2026-10-21T16:45:00+13:00',
    { kind: 'activity', people: att(ID.milo) },
  );
  const events = [...ROUTINE.filter((e) => e.id !== 'e-swim'), swim, tutoring, moved];

  it('is notable with an occurrence key, and the standing conflict’s old response does not hide it', () => {
    const open = page({ events }, 'month');
    const standing = open.found.filter((c) => c.identity === 'standing');
    const occurrence = open.found.filter((c) => c.identity === 'occurrence');
    expect(standing).toHaveLength(1);
    expect(occurrence).toHaveLength(1);
    expect(occurrence[0]!.key).toMatch(/^conflict\.overlap:p-milo:e-swim-moved\.e-tutor:/);

    const answered = page({ events, responded: new Set([standing[0]!.key]) }, 'month');
    expect(listing(answered).map((i) => i.key)).toEqual([occurrence[0]!.key]);
    expect(answered.model.headline.conflicts?.text).toBe('There is one overlap.');
    // The moved occurrence is notable on its own entry key; the series stays usual elsewhere.
    const week2 = answered.model.units[1]!;
    const entry = week2.notable.find((e) => e.key === 'e-swim-moved:2026-10-21')!;
    expect(entry.rule).toBe('forward.notable');
    expect(entry.conflicted).toBe(true);
    // The standing pair is no longer flagged: Swimming and Tutoring go back to the usual.
    expect(week2.usual.some((e) => e.key === 'e-swim:2026-10-28')).toBe(false);
    expect(answered.model.units[2]!.usual.some((e) => e.key === 'e-swim:2026-10-28')).toBe(true);
  });
});

describe('a three-way overlap', () => {
  // Sam on A 15:00–16:00, B 15:15–16:15, C 15:30–16:30 tomorrow: three pairs.
  const events = [
    timed('e-a', 'Alpha', '2026-10-15T15:00:00+13:00', '2026-10-15T16:00:00+13:00', {
      people: att(ID.sam),
    }),
    timed('e-b', 'Bravo', '2026-10-15T15:15:00+13:00', '2026-10-15T16:15:00+13:00', {
      people: att(ID.sam),
    }),
    timed('e-c', 'Charlie', '2026-10-15T15:30:00+13:00', '2026-10-15T16:30:00+13:00', {
      people: att(ID.sam),
    }),
  ];

  it('three pairs, three keys; each entry is marked by the two it is in, with no duplicates', () => {
    const p = page({ events }, 'week');
    const keys = p.found.map((c) => c.key);
    expect(new Set(keys).size).toBe(3);
    expect(p.model.headline.conflicts?.text).toBe('There are three overlaps.');
    for (const id of ['e-a', 'e-b', 'e-c']) {
      const marks = p.marks.get(placement(null, `${id}:2026-10-15`))!;
      expect(marks).toHaveLength(2);
      expect(new Set(marks.map((m) => m.insight.key)).size).toBe(2);
      expect(new Set(marks.map((m) => m.text)).size).toBe(2);
    }
    expect(markTexts(p, 'e-a:2026-10-15').sort()).toEqual([
      'overlaps Bravo 15:15 · Sam',
      'overlaps Charlie 15:30 · Sam',
    ]);
    expect(markTexts(p, 'e-b:2026-10-15').sort()).toEqual([
      'overlaps Alpha 15:00 · Sam',
      'overlaps Charlie 15:30 · Sam',
    ]);
    expect(markTexts(p, 'e-c:2026-10-15').sort()).toEqual([
      'overlaps Alpha 15:00 · Sam',
      'overlaps Bravo 15:15 · Sam',
    ]);
    // Six marks in all: three conflicts, each on two entries.
    expect([...p.marks.values()].flat()).toHaveLength(6);
  });
});

describe('large data stays bounded and nothing is lost', () => {
  // Thirty back-to-back ten-minute things for Sam on Friday 16th: no overlaps.
  const events = Array.from({ length: 30 }, (_, k) => {
    const start = 6 * 60 + k * 10;
    const hhmm = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return timed(
      `e-d${String(k).padStart(2, '0')}`,
      `Item ${String(k).padStart(2, '0')}`,
      `2026-10-16T${hhmm(start)}:00+13:00`,
      `2026-10-16T${hhmm(start + 10)}:00+13:00`,
      { people: att(ID.sam) },
    );
  });
  const noBirthdays = PEOPLE.map((x) => ({ ...x, dateOfBirth: null }));

  it('Week: two shown on the day, 28 more, every entry present in the rest, and 30 counted', () => {
    const p = page({ events, people: noBirthdays }, 'week');
    const friday = unitFrom(p, '2026-10-16');
    expect(friday.notable).toHaveLength(30);
    expect(friday.shown).toHaveLength(2);
    expect(friday.more).toBe(28);
    expect(friday.rest).toHaveLength(28);
    expect(new Set([...friday.shown, ...friday.rest].map((e) => e.key)).size).toBe(30);
    expect(friday.load.count).toBe(30);
    expect(friday.load.band).toBe(3);
    expect(p.model.counts.events).toBe(30);
    expect(p.model.headline.sentence).toBe('30 things in the next seven days.');
    // Every shown or folded timed event is a place for a mark.
    expect(p.placed.size).toBe(30);
  });

  it('Month: the week unit shows three and holds 27', () => {
    const p = page({ events, people: noBirthdays }, 'month');
    const week = unitFrom(p, '2026-10-14');
    expect(week.notable).toHaveLength(30);
    expect(week.shown).toHaveLength(3);
    expect(week.more).toBe(27);
    expect(week.rest).toHaveLength(27);
  });
});

describe('an empty horizon is still drawn (contract §5.4)', () => {
  const noBirthdays = PEOPLE.map((x) => ({ ...x, dateOfBirth: null }));

  it.each(HORIZONS)('%s: no events and a fresh calendar: every unit, "Nothing recorded"', (h) => {
    const p = page({ events: [], people: noBirthdays }, h);
    expect(p.model.units).toHaveLength({ week: 7, month: 5, season: 4 }[h]);
    for (const u of p.model.units) {
      expect(u.notable).toEqual([]);
      expect(u.load).toMatchObject({ count: 0, band: 0, text: 'Nothing recorded' });
    }
    expect(p.model.headline.rule).toBe('forward.headline.nothing');
    expect(p.model.headline.conflicts).toBeNull();
    expect(listing(p)).toEqual([]);
    expect(p.marks.size).toBe(0);
  });

  it('only a usual series: "Nothing recorded besides the usual", and the usual headline', () => {
    const p = page({ events: ROUTINE, people: noBirthdays }, 'week');
    expect(p.model.headline.rule).toBe('forward.headline.usual');
    expect(p.model.headline.sentence).toBe('Just the usual in the next seven days.');
    expect(unitFrom(p, '2026-10-14').load.text).toBe('Nothing recorded besides the usual');
    // 18 October is a Sunday: no series on it at all.
    expect(unitFrom(p, '2026-10-18').load.text).toBe('Nothing recorded');
  });
});

describe('wording (contract §5.5)', () => {
  const FORBIDDEN =
    /\b(busy|easy|full|calm|stressful|overwhelming|packed|steady|clear|free|available|quiet|needs?|should|probably|covered|sorted|away|unavailable|double-booked|can['’]t|clash)\b/i;

  it('no rendered string the model carries uses a forbidden phrase, on any horizon', () => {
    const events = [
      ...ROUTINE,
      ...pair('2026-10-16', ID.milo),
      ...pair('2026-10-17', ID.nana, ['e-art-n', 'e-dentist-n']),
      timed('e-r1', 'Meeting', '2026-10-18T10:00:00+13:00', '2026-10-18T11:00:00+13:00', {
        people: resp(ID.alex),
      }),
      timed('e-r2', 'Shift', '2026-10-18T10:30:00+13:00', '2026-10-18T11:30:00+13:00', {
        people: resp(ID.alex),
      }),
    ];
    let checked = 0;
    for (const h of HORIZONS)
      for (const calendars of [[fresh(WED_0703)], [STALE]]) {
        const p = page({ events, calendars }, h);
        const strings = [
          p.model.headline.text,
          p.model.headline.conflicts?.text ?? '',
          ...p.model.units.flatMap((u) => [u.label, u.load.text]),
          ...p.worth.all.map((i) => i.text),
          ...[...p.marks.values()].flat().map((m) => m.text),
        ];
        for (const s of strings) {
          expect(s).not.toMatch(FORBIDDEN);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(100);
  });
});
