import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agenda, type AgendaEventInput, type AgendaTaskInput } from '@/domain/engines/agenda';
import {
  entryKey,
  FORWARD_RULES,
  forward,
  IncompleteAgendaError,
  HORIZONS,
  unitsOf,
  type ForwardConflict,
  type ForwardModel,
  type Horizon,
} from '@/domain/engines/forward';
import type { TodayCalendar } from '@/domain/engines/today';
import { addDays, isoDateInZone } from '@/lib/dates';
import { allDay, at, fresh, ID, NZ, PEOPLE, ROUTINE, timed, WEDNESDAY } from '../today/household';

// The Forward engine (M6 contract §5.1–§5.5, ADR 0009 §15, §16, §22): one
// composition of the next 7, 30 or 90 days, grouped by day, week or month,
// from the shared agenda and the regular week, with an injected `now`.

const att = (...ids: string[]) => ids.map((personId) => ({ personId, role: 'attending' as const }));

type House = {
  events: AgendaEventInput[];
  tasks?: AgendaTaskInput[];
  projects?: { id: string; title: string; status: string; targetDate: string | null }[];
  calendars?: TodayCalendar[];
  conflicts?: ForwardConflict[];
  timeZone?: string;
  people?: typeof PEOPLE;
};

/** The shared agenda for 90 days from today, then the engine: exactly as the loader will. */
function run(h: House, now: Date, horizon: Horizon = 'week'): ForwardModel {
  const timeZone = h.timeZone ?? NZ;
  const people = h.people ?? PEOPLE;
  const from = isoDateInZone(now, timeZone);
  const days = agenda({
    from,
    to: addDays(from, 89),
    timeZone,
    events: h.events,
    people: people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: h.tasks ?? [],
    projects: h.projects ?? [],
  });
  return forward({
    now,
    timeZone,
    horizon,
    days,
    coverage: { from, to: addDays(from, 89) },
    events: h.events,
    people,
    calendars: h.calendars ?? [fresh(now)],
    conflicts: h.conflicts ?? [],
  });
}

const WED_0703 = at('2026-10-14T07:03:00+13:00');
const HOUSE = [...ROUTINE, ...WEDNESDAY];
const titles = (m: ForwardModel, k: number) =>
  m.units[k]!.notable.map((e) => ('title' in e.item ? e.item.title : `${e.item.name}’s birthday`));
const allText = (m: ForwardModel) => [
  m.headline.text,
  m.headline.conflicts?.text ?? '',
  ...m.units.flatMap((u) => [u.label, u.load.text]),
];

describe('horizons and units (§5.1)', () => {
  it('Week: seven days, Today and Tomorrow, then weekday and date', () => {
    expect(unitsOf('week', '2026-10-14').map((u) => u.label)).toEqual([
      'Today',
      'Tomorrow',
      'Fri 16',
      'Sat 17',
      'Sun 18',
      'Mon 19',
      'Tue 20',
    ]);
  });

  it('Month: this week to Sunday, then Monday to Sunday, clipped at day 30', () => {
    const u = unitsOf('month', '2026-10-14');
    expect(u.map((x) => [x.label, x.from, x.to])).toEqual([
      ['This week', '2026-10-14', '2026-10-18'],
      ['19–25 Oct', '2026-10-19', '2026-10-25'],
      ['26 Oct–1 Nov', '2026-10-26', '2026-11-01'],
      ['2–8 Nov', '2026-11-02', '2026-11-08'],
      ['9–12 Nov', '2026-11-09', '2026-11-12'],
    ]);
  });

  it('Month starting on a Sunday: this week is one day; across a year end', () => {
    const u = unitsOf('month', '2026-12-20'); // a Sunday
    expect(u[0]).toMatchObject({ label: 'This week', from: '2026-12-20', to: '2026-12-20' });
    expect(u.map((x) => x.label)).toContain('28 Dec–3 Jan');
    expect(u.at(-1)!.to).toBe('2027-01-18');
  });

  it('Season: calendar months clipped to 90 days, with the year when it changes', () => {
    expect(unitsOf('season', '2026-10-14').map((x) => [x.label, x.from, x.to])).toEqual([
      ['October', '2026-10-14', '2026-10-31'],
      ['November', '2026-11-01', '2026-11-30'],
      ['December', '2026-12-01', '2026-12-31'],
      ['January 2027', '2027-01-01', '2027-01-11'],
    ]);
  });

  it.each(HORIZONS)('%s: units are contiguous and cover exactly the range', (h) => {
    for (const today of ['2026-10-14', '2026-02-28', '2028-02-28', '2026-12-31']) {
      const u = unitsOf(h, today);
      expect(u[0]!.from).toBe(today);
      for (let k = 1; k < u.length; k++) expect(u[k]!.from).toBe(addDays(u[k - 1]!.to, 1));
      const days = { week: 7, month: 30, season: 90 }[h];
      expect(u.at(-1)!.to).toBe(addDays(today, days - 1));
    }
  });
});

describe('notable and the usual (§5.2)', () => {
  it('the regular week is usual; one-offs, birthdays and targets are notable', () => {
    const m = run({ events: HOUSE }, WED_0703);
    const today = m.units[0]!;
    expect(today.notable.map((e) => 'title' in e.item && e.item.title).sort()).toEqual([
      'Board meeting',
      'Isla pickup',
    ]);
    expect(today.usual.map((e) => 'title' in e.item && e.item.title)).toEqual([
      'Client site',
      'School',
      'Work',
      'Swimming',
      'Pilates',
    ]);
    // Nana Jo's birthday (20 Oct) is notable.
    expect(titles(m, 6)).toEqual(['Nana Jo’s birthday']);
  });

  it('a changed occurrence is its own row with no rule, so it is notable', () => {
    const change = timed(
      'e-swim-moved',
      'Swimming',
      '2026-10-21T16:00:00+13:00',
      '2026-10-21T16:45:00+13:00',
      {
        kind: 'activity',
        people: att(ID.milo),
      },
    );
    const swim = { ...ROUTINE.find((e) => e.id === 'e-swim')!, exdates: ['2026-10-21'] };
    const events = [...ROUTINE.filter((e) => e.id !== 'e-swim'), swim, change];
    const m = run({ events }, WED_0703, 'month');
    const week2 = m.units[1]!;
    expect(week2.notable.map((e) => e.key)).toContain('e-swim-moved:2026-10-21');
    expect(week2.usual.some((e) => e.key === 'e-swim:2026-10-21')).toBe(false); // skipped
    expect(week2.usual.some((e) => e.key === 'e-swim:2026-10-14')).toBe(false); // other unit
    expect(m.units[2]!.usual.some((e) => e.key === 'e-swim:2026-10-28')).toBe(true); // series still usual
  });

  it('routine is never read from a title: a one-off called "School" is notable', () => {
    const fake = timed(
      'e-fake',
      'School',
      '2026-10-15T09:00:00+13:00',
      '2026-10-15T10:00:00+13:00',
      {
        kind: 'school',
        people: att(ID.milo),
      },
    );
    const m = run({ events: [...HOUSE, fake] }, WED_0703);
    expect(m.units[1]!.notable.map((e) => e.key)).toContain('e-fake:2026-10-15');
  });

  it('series outside the household’s regular week are notable: monthly, not yet begun, others’ only', () => {
    const monthly = timed(
      'e-book',
      'Book club',
      '2026-10-15T19:00:00+13:00',
      '2026-10-15T21:00:00+13:00',
      {
        rrule: 'FREQ=MONTHLY',
        people: att(ID.alex),
      },
    );
    const later = timed(
      'e-tutor',
      'Tutoring',
      '2026-11-04T15:45:00+13:00',
      '2026-11-04T16:30:00+13:00',
      {
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        people: att(ID.milo),
      },
    );
    const nanas = timed(
      'e-nana',
      'Nana’s choir',
      '2026-10-15T10:00:00+13:00',
      '2026-10-15T11:00:00+13:00',
      {
        rrule: 'FREQ=WEEKLY;BYDAY=TH',
        people: att(ID.nana),
      },
    );
    const m = run({ events: [...HOUSE, monthly, later, nanas] }, WED_0703, 'season');
    const notable = new Set(m.units.flatMap((u) => u.notable.map((e) => e.key.split(':')[0])));
    expect([...notable]).toEqual(expect.arrayContaining(['e-book', 'e-tutor', 'e-nana']));
    const usual = new Set(m.units.flatMap((u) => u.usual.map((e) => e.key.split(':')[0])));
    expect(usual.has('e-book') || usual.has('e-tutor') || usual.has('e-nana')).toBe(false);
  });

  it('a usual occurrence in a current conflict is notable, and first in its row', () => {
    const dentist = timed(
      'e-dentist',
      'Dentist',
      '2026-10-14T15:45:00+13:00',
      '2026-10-14T16:30:00+13:00',
      {
        people: att(ID.milo),
      },
    );
    const conflicts = [{ key: 'k', occurrences: ['e-swim:2026-10-14', 'e-dentist:2026-10-14'] }];
    const m = run({ events: [...HOUSE, dentist], conflicts }, WED_0703);
    const today = m.units[0]!;
    expect(today.notable.slice(0, 2).map((e) => e.key)).toEqual([
      'e-swim:2026-10-14',
      'e-dentist:2026-10-14',
    ]);
    expect(today.notable.every((e, k) => e.conflicted === k < 2)).toBe(true);
    expect(today.usual.some((e) => e.key === 'e-swim:2026-10-14')).toBe(false);
    expect(m.headline.conflicts).toMatchObject({
      rule: 'forward.headline.conflicts',
      text: 'There is one overlap.',
    });
    expect(run({ events: HOUSE }, WED_0703).headline.conflicts).toBeNull();
  });

  it.each(HORIZONS)(
    '%s: nothing is lost — every agenda item in range is in exactly one place per unit',
    (h) => {
      // A real project target (Saturday 17th), on a day with enough else that caps bite.
      const projects = [
        { id: 'pr-fence', title: 'Back fence', status: 'active', targetDate: '2026-10-17' },
      ];
      const crowd = Array.from({ length: 4 }, (_, k) =>
        timed(
          `e-sat${k}`,
          `Sat ${k}`,
          `2026-10-17T${10 + k}:00:00+13:00`,
          `2026-10-17T${10 + k}:30:00+13:00`,
          { people: att(ID.sam) },
        ),
      );
      const events = [...HOUSE, ...crowd];
      const m = run({ events, tasks: SCHEDULED, projects }, WED_0703, h);
      const days = agenda({
        from: '2026-10-14',
        to: m.to,
        timeZone: NZ,
        events,
        people: PEOPLE.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
        tasks: SCHEDULED,
        projects,
      });
      for (const u of m.units) {
        const placed = [...u.notable, ...u.usual].map((e) => e.key);
        expect(new Set(placed).size).toBe(placed.length);
        // The engine's own identities, so every kind (targets included) is compared exactly.
        const expected = new Set(
          days
            .filter((d) => d.date >= u.from && d.date <= u.to)
            .flatMap((d) => d.items.map(entryKey)),
        );
        expect(new Set(placed)).toEqual(expected);
        expect(u.shown.length + u.rest.length).toBe(u.notable.length);
        expect(u.more).toBe(u.rest.length);
      }
      // The target survives grouping and the cap, with its exact identity.
      const target = 'project_target:pr-fence:2026-10-17';
      const unit = m.units.find((u) => u.from <= '2026-10-17' && u.to >= '2026-10-17')!;
      expect(unit.notable.map((e) => e.key)).toContain(target);
      expect(unit.notable.find((e) => e.key === target)!.facts).toEqual([
        { kind: 'project', id: 'pr-fence' },
      ]);
      const cap = { week: 2, month: 3, season: 3 }[h];
      expect(unit.notable.length).toBeGreaterThan(cap);
      // Ordered by kind: the target comes before the timed events, so it is on the surface.
      expect(unit.shown.map((e) => e.key)).toContain(target);
      expect(unit.rest.map((e) => e.key)).not.toContain(target);
      expect(unit.more).toBe(unit.notable.length - cap);
    },
  );
});

const SCHEDULED: AgendaTaskInput[] = [
  {
    id: 't-plumber',
    title: 'Call the plumber',
    status: 'open',
    dueDate: null,
    scheduledStartsAt: at('2026-10-15T10:00:00+13:00'),
    scheduledEndsAt: at('2026-10-15T11:00:00+13:00'),
  },
  {
    id: 't-wof',
    title: 'Book the WOF',
    status: 'open',
    dueDate: '2026-10-15',
  },
  {
    id: 't-done',
    title: 'Already done',
    status: 'done',
    dueDate: null,
    scheduledStartsAt: at('2026-10-15T12:00:00+13:00'),
    scheduledEndsAt: at('2026-10-15T13:00:00+13:00'),
  },
];

describe('scheduled tasks (ADR 0009 §26)', () => {
  it('open scheduled tasks are notable, counted and ordered after tasks due, before timed events', () => {
    const lunch = timed(
      'e-lunch',
      'Lunch',
      '2026-10-15T09:00:00+13:00',
      '2026-10-15T09:30:00+13:00',
      {
        people: att(ID.sam),
      },
    );
    const m = run({ events: [...HOUSE, lunch], tasks: SCHEDULED }, WED_0703);
    const tomorrow = m.units[1]!;
    expect(tomorrow.notable.map((e) => e.key)).toEqual([
      'task_due:t-wof',
      'task_scheduled:t-plumber',
      'e-lunch:2026-10-15',
    ]);
    expect(tomorrow.notable.some((e) => e.key === 'task_scheduled:t-done')).toBe(false);
    expect(m.counts).toMatchObject({ tasksScheduled: 1, tasksDue: 1 });
    expect(tomorrow.notable[1]!.facts).toEqual([{ kind: 'task', id: 't-plumber' }]);
  });
});

describe('rows and caps (§5.3)', () => {
  const many = Array.from({ length: 7 }, (_, k) =>
    timed(
      `e-m${k}`,
      `Thing ${k}`,
      `2026-10-15T${10 + k}:00:00+13:00`,
      `2026-10-15T${10 + k}:30:00+13:00`,
      {
        people: att(ID.sam),
      },
    ),
  );

  it('Week shows two per day; the rest are held, and "+ N" is exact', () => {
    const m = run({ events: [...HOUSE, ...many] }, WED_0703);
    const tomorrow = m.units[1]!;
    expect(tomorrow.shown.map((e) => e.key)).toEqual(['e-m0:2026-10-15', 'e-m1:2026-10-15']);
    expect(tomorrow.more).toBe(5);
    expect(tomorrow.rest.map((e) => e.key)).toEqual(
      [2, 3, 4, 5, 6].map((k) => `e-m${k}:2026-10-15`),
    );
  });

  it('Month and Season show three per unit', () => {
    for (const h of ['month', 'season'] as const) {
      const u = run({ events: [...HOUSE, ...many] }, WED_0703, h).units[0]!;
      expect(u.shown).toHaveLength(3);
      expect(u.more).toBe(u.notable.length - 3);
    }
  });

  it('within a unit: birthdays, all-day and multi-day, targets, tasks due, scheduled, timed', () => {
    const camp = allDay('e-camp', 'Camp', '2026-10-19', '2026-10-22', { people: att(ID.milo) });
    const late = timed(
      'e-late',
      'Early start',
      '2026-10-19T06:00:00+13:00',
      '2026-10-19T07:00:00+13:00',
      {
        people: att(ID.sam),
      },
    );
    const m = run(
      {
        events: [...HOUSE, camp, late],
        projects: [
          { id: 'pr-fence', title: 'Back fence', status: 'active', targetDate: '2026-10-19' },
        ],
        tasks: [
          { id: 't-due', title: 'Due thing', status: 'open', dueDate: '2026-10-19' },
          {
            id: 't-sch',
            title: 'Scheduled thing',
            status: 'open',
            dueDate: null,
            scheduledStartsAt: at('2026-10-19T05:00:00+13:00'),
            scheduledEndsAt: at('2026-10-19T05:30:00+13:00'),
          },
        ],
      },
      WED_0703,
      'month',
    );
    expect(m.units[1]!.notable.map((e) => e.key)).toEqual([
      'birthday:p-nana:2026-10-20',
      'e-camp:2026-10-19',
      'project_target:pr-fence:2026-10-19',
      'task_due:t-due',
      'task_scheduled:t-sch',
      'e-late:2026-10-19',
    ]);
  });

  it.each(HORIZONS)('%s: input order never changes the model', (h) => {
    const events = [...HOUSE, ...many];
    const a = run({ events, tasks: SCHEDULED }, WED_0703, h);
    for (let n = 0; n < 5; n++) {
      const shuffled = [...events].sort(() => (n % 2 ? 1 : -1)).reverse();
      const b = run(
        { events: shuffled, tasks: [...SCHEDULED].reverse(), people: [...PEOPLE] },
        WED_0703,
        h,
      );
      expect(b).toEqual(a);
    }
  });
});

describe('load indicators (§5.4, provisional bands)', () => {
  const day = (n: number) =>
    Array.from({ length: n }, (_, k) =>
      timed(
        `e-d${k}`,
        `Thing ${k}`,
        `2026-10-16T${10 + k}:00:00+13:00`,
        `2026-10-16T${10 + k}:30:00+13:00`,
      ),
    );
  it.each([
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [9, 3],
  ])('a day with %i notable things is band %i', (n, band) => {
    const u = run({ events: [...ROUTINE, ...day(n)] }, WED_0703).units[2]!;
    expect(u.load).toMatchObject({ rule: 'forward.load', count: n, band });
    expect(u.load.facts).toHaveLength(n);
  });

  it.each([
    [0, 0],
    [1, 1],
    [4, 1],
    [5, 2],
    [9, 2],
    [10, 3],
  ])('a week with %i notable things is band %i', (n, band) => {
    const people = PEOPLE.filter((p) => p.id !== ID.nana);
    const u = run({ events: [...ROUTINE, ...day(n)], people }, WED_0703, 'month').units[0]!;
    expect(u.load).toMatchObject({ count: n, band });
  });

  it('the text says counts, or that nothing is recorded; never character', () => {
    const m = run({ events: HOUSE }, WED_0703);
    expect(m.units[0]!.load.text).toBe('Two things recorded');
    expect(m.units[3]!.load.text).toBe('Nothing recorded besides the usual'); // Saturday: Football
    expect(m.units[4]!.load.text).toBe('Nothing recorded'); // Sunday
    expect(run({ events: [], calendars: [fresh(WED_0703)] }, WED_0703).units[0]!.load.text).toBe(
      'Nothing recorded',
    );
  });
});

// The household without Nana Jo, whose birthday (20 October) would otherwise be notable.
const NO_BIRTHDAYS = PEOPLE.filter((p) => p.id !== ID.nana);

describe('the headline (§5.5)', () => {
  it('first run: no live calendar and no events at all', () => {
    const m = run({ events: [], calendars: [] }, WED_0703);
    expect(m.headline).toMatchObject({
      rule: 'forward.headline.first_run',
      text: 'HOME doesn’t know your calendars yet.',
    });
    expect(m.firstRun).toBe(true);
  });

  it('nothing recorded: names the range and the calendars consulted', () => {
    const m = run({ events: [], people: NO_BIRTHDAYS }, WED_0703, 'month');
    expect(m.headline.rule).toBe('forward.headline.nothing');
    expect(m.headline.text).toBe('Nothing recorded in the next 30 days.');
    expect(m.headline.facts).toEqual([
      { kind: 'range', from: '2026-10-14', to: '2026-11-12' },
      { kind: 'calendar', id: 'c-sam-work' },
    ]);
  });

  it('only the usual', () => {
    expect(run({ events: ROUTINE, people: NO_BIRTHDAYS }, WED_0703).headline).toMatchObject({
      rule: 'forward.headline.usual',
      text: 'Just the usual in the next seven days.',
    });
  });

  it('listed: one or two notable events or birthdays on Week, named as recorded', () => {
    const one = timed(
      'e-pi',
      'Parent interviews',
      '2026-10-14T16:00:00+13:00',
      '2026-10-14T17:00:00+13:00',
    );
    expect(run({ events: [...ROUTINE, one] }, WED_0703).headline.text).toBe(
      'Parent interviews today, then Nana Jo’s birthday on Tuesday.',
    );
    const people = PEOPLE.filter((p) => p.id !== ID.nana);
    expect(run({ events: [...ROUTINE, one], people }, WED_0703).headline.text).toBe(
      'Parent interviews today.',
    );
    // Month never lists.
    expect(run({ events: [...ROUTINE, one], people }, WED_0703, 'month').headline.rule).toBe(
      'forward.headline.counted',
    );
  });

  it('counted, besides the usual when there is any; numbers in words to ten', () => {
    expect(run({ events: HOUSE }, WED_0703).headline.text).toBe(
      'Three things in the next seven days, besides the usual.',
    );
    const lots = Array.from({ length: 11 }, (_, k) =>
      timed(
        `e-x${k}`,
        `X${k}`,
        `2026-10-16T${String(8 + k).padStart(2, '0')}:00:00+13:00`,
        `2026-10-16T${String(8 + k).padStart(2, '0')}:30:00+13:00`,
      ),
    );
    const m = run({ events: lots, people: PEOPLE.filter((p) => p.id !== ID.nana) }, WED_0703);
    expect(m.headline.text).toBe('11 things in the next seven days.');
    expect(m.headline.facts).toHaveLength(11);
  });

  it('qualified when a visible calendar is stale or failing; never on first run', () => {
    const stale = [fresh(WED_0703, { lastSyncedAt: at('2026-10-12T09:00:00+13:00') })];
    const m = run({ events: HOUSE, calendars: stale }, WED_0703);
    expect(m.headline.qualified).toBe(true);
    expect(m.headline.text).toBe(`${m.headline.sentence} As far as HOME knows.`);
    expect(m.headline.facts).toContainEqual({ kind: 'calendar', id: 'c-sam-work' });
    expect(m.incomplete).toEqual([{ kind: 'calendar', id: 'c-sam-work' }]);
  });

  it('two overlaps', () => {
    const conflicts = [
      { key: 'a', occurrences: ['e-board:2026-10-14', 'e-pickup:2026-10-14'] },
      { key: 'b', occurrences: ['e-swim:2026-10-21', 'e-pilates:2026-10-21'] },
      { key: 'c', occurrences: ['e-swim:2027-03-03', 'e-pilates:2027-03-03'] }, // outside 90 days
    ];
    expect(run({ events: HOUSE, conflicts }, WED_0703, 'month').headline.conflicts?.text).toBe(
      'There are two overlaps.',
    );
    expect(run({ events: HOUSE, conflicts }, WED_0703, 'week').headline.conflicts?.text).toBe(
      'There is one overlap.',
    );
  });

  it('no character, availability or need words anywhere, on any horizon or day', () => {
    const forbidden =
      /\b(busy|easy|full|calm|stressful|overwhelming|packed|steady|clear|free|available|quiet|needs?|should|probably|covered|sorted|away|unavailable|double-booked|can['’]t|clash)\b/i;
    for (const h of HORIZONS)
      for (const events of [[], ROUTINE, HOUSE])
        for (const iso of ['2026-10-14T07:03:00+13:00', '2026-10-17T21:00:00+13:00'])
          for (const t of allText(run({ events }, at(iso), h))) expect(t).not.toMatch(forbidden);
  });
});

describe('time zones, DST and overnight (shared agenda)', () => {
  it('an overnight event is on both days in Week, once in its Month unit', () => {
    const shift = timed(
      'e-shift',
      'Night shift',
      '2026-10-15T22:00:00+13:00',
      '2026-10-16T06:00:00+13:00',
      {
        people: att(ID.sam),
      },
    );
    const week = run({ events: [...HOUSE, shift] }, WED_0703);
    expect(week.units[1]!.notable.map((e) => e.key)).toContain('e-shift:2026-10-15');
    expect(week.units[2]!.notable.map((e) => e.key)).toContain('e-shift:2026-10-15');
    const month = run({ events: [...HOUSE, shift] }, WED_0703, 'month');
    expect(month.units[0]!.notable.filter((e) => e.key === 'e-shift:2026-10-15')).toHaveLength(1);
    expect(month.counts.events).toBe(week.counts.events - 0); // once over the range
  });

  it('a carry-over from last night is shown on today but no longer counted once it has ended', () => {
    const late = timed(
      'e-late',
      'Late gig',
      '2026-10-13T22:00:00+13:00',
      '2026-10-14T01:00:00+13:00',
      {
        people: att(ID.alex),
      },
    );
    const m = run({ events: [...HOUSE, late] }, WED_0703);
    const entry = m.units[0]!.notable.find((e) => e.key === 'e-late:2026-10-13')!;
    expect(entry.counts).toBe(false);
    expect(m.units[0]!.load.count).toBe(2);
    const early = run({ events: [...HOUSE, late] }, at('2026-10-14T00:30:00+13:00'));
    expect(early.units[0]!.notable.find((e) => e.key === 'e-late:2026-10-13')!.counts).toBe(true);
  });

  it('across the NZ DST start (27 Sep 2026): a 09:00 weekly series stays 09:00 and on its days', () => {
    const work = timed('e-w', 'Work', '2026-09-07T09:00:00+12:00', '2026-09-07T14:30:00+12:00', {
      kind: 'work',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      people: att(ID.alex),
    });
    const m = run({ events: [work] }, at('2026-09-24T08:00:00+12:00'));
    expect(m.units.map((u) => u.from)).toEqual([
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
    ]);
    const usual = m.units.flatMap((u) => u.usual);
    expect(usual.map((e) => e.date)).toEqual([
      '2026-09-24',
      '2026-09-25',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
    ]);
    // 09:00 NZST before the change (UTC+12), 09:00 NZDT after it (UTC+13).
    const starts = usual.map((e) =>
      e.item.kind === 'event' && !e.item.allDay ? e.item.startsAt.toISOString() : '',
    );
    expect(starts[0]).toBe('2026-09-23T21:00:00.000Z');
    expect(starts[2]).toBe('2026-09-27T20:00:00.000Z');
  });

  it('across the NZ DST end (5 Apr 2026, 3:00 → 2:00): days stay whole', () => {
    const now = at('2026-04-02T08:00:00+13:00');
    const m = run({ events: [] }, now, 'month');
    expect(m.units[0]).toMatchObject({ from: '2026-04-02', to: '2026-04-05' });
  });

  it.each([
    ['UTC', '2026-10-14T23:30:00Z', '2026-10-14'],
    ['Europe/London', '2026-10-25T00:30:00Z', '2026-10-25'], // London's clocks go back that day
    ['America/New_York', '2026-11-01T05:30:00Z', '2026-11-01'], // New York's do, a week later
    ['Pacific/Auckland', '2026-10-14T23:30:00Z', '2026-10-15'],
  ])('in %s, today and every unit follow the home zone', (zone, iso, today) => {
    const m = run({ events: [], timeZone: zone }, at(iso));
    expect(m.today).toBe(today);
    expect(m.units[0]!.from).toBe(today);
    expect(m.units.every((u) => u.from === u.to)).toBe(true);
  });

  it('an event is placed by the home zone: 23:30 UTC on the 14th is the 15th in Auckland', () => {
    const e = timed('e-z', 'Call', '2026-10-14T23:30:00Z', '2026-10-15T00:00:00Z', {
      timeZone: 'UTC',
    });
    expect(run({ events: [e] }, WED_0703).units[1]!.notable.map((x) => x.key)).toEqual([
      'e-z:2026-10-14',
    ]);
    expect(
      run({ events: [e], timeZone: 'UTC' }, at('2026-10-14T07:00:00Z')).units[0]!.notable.map(
        (x) => x.key,
      ),
    ).toEqual(['e-z:2026-10-14']);
  });
});

describe('traceability', () => {
  it('every entry, load and headline carries a known rule and resolvable facts', () => {
    const rules = new Set<string>(FORWARD_RULES);
    for (const h of HORIZONS) {
      const m = run({ events: HOUSE, tasks: SCHEDULED }, WED_0703, h);
      expect(rules.has(m.headline.rule)).toBe(true);
      expect(m.headline.facts.length).toBeGreaterThan(0);
      for (const u of m.units) {
        expect(u.rule).toBe('forward.row');
        expect(u.load.facts).toHaveLength(u.load.count);
        for (const e of [...u.notable, ...u.usual]) {
          expect(rules.has(e.rule)).toBe(true);
          expect(e.facts).toHaveLength(1);
        }
      }
    }
  });

  it('every rule the engine can give is written down in the contract', () => {
    const contract = readFileSync('docs/m6/M6-BUILD-CONTRACT.md', 'utf8');
    for (const r of FORWARD_RULES) expect(contract, r).toContain(`\`${r}\``);
  });

  it('The usual lists each household person’s regular week, in People order', () => {
    const m = run({ events: HOUSE }, WED_0703);
    expect(m.usual.map((w) => w.name)).toEqual(['Alex', 'Isla', 'Milo', 'Sam']);
    expect(m.usual.find((w) => w.name === 'Milo')!.entries.map((e) => e.title)).toEqual(
      expect.arrayContaining(['School', 'Swimming', 'Football']),
    );
  });
});

describe('the engine is pure', () => {
  it('no clock, no randomness, no database, screen, Kev or server import', () => {
    const src = readFileSync('src/domain/engines/forward.ts', 'utf8');
    expect(src).not.toMatch(/Date\.now\(|new Date\(|Math\.random/);
    for (const m of src.matchAll(/from '([^']+)'/g))
      expect(m[1]).toMatch(/^(\.\/(agenda|day-facts|profile|today)|@\/lib\/dates)$/);
  });
});

describe('performance (measured, M6 contract §3.7)', () => {
  it('a 90-day household of 300 events: agenda once, then all three horizons, well under a second', () => {
    const who = [ID.sam, ID.alex, ID.milo, ID.isla];
    const events = [
      ...Array.from({ length: 60 }, (_, k) =>
        timed(
          `s-${k}`,
          `Series ${k}`,
          `2026-10-${String(12 + (k % 7)).padStart(2, '0')}T${String(7 + (k % 12)).padStart(2, '0')}:00:00+13:00`,
          `2026-10-${String(12 + (k % 7)).padStart(2, '0')}T${String(8 + (k % 12)).padStart(2, '0')}:00:00+13:00`,
          { rrule: 'FREQ=WEEKLY', people: att(who[k % 4]!) },
        ),
      ),
      ...Array.from({ length: 240 }, (_, k) => {
        const d = addDays('2026-10-14', k % 90);
        const h = String(8 + (k % 10)).padStart(2, '0');
        return timed(`o-${k}`, `One-off ${k}`, `${d}T${h}:00:00+13:00`, `${d}T${h}:45:00+13:00`, {
          people: att(who[k % 4]!),
        });
      }),
    ];
    const started = performance.now();
    const days = agenda({ from: '2026-10-14', to: '2027-01-11', timeZone: NZ, events });
    const placed = performance.now();
    const models = HORIZONS.map((horizon) =>
      forward({
        now: WED_0703,
        timeZone: NZ,
        horizon,
        days,
        coverage: { from: '2026-10-14', to: '2027-01-11' },
        events,
        people: PEOPLE,
        calendars: [fresh(WED_0703)],
      }),
    );
    const ms = performance.now() - started;
    console.info(
      `forward: 300 events over 90 days: agenda ${(placed - started).toFixed(0)} ms, three horizons ${(started + ms - placed).toFixed(0)} ms`,
    );
    expect(models[2]!.counts.events).toBe(240 + 0); // every one-off once; series are usual
    expect(ms).toBeLessThan(1000);
  });
});

describe('the coverage invariant (ADR 0009 §32, after the Package 1 review)', () => {
  // The agenda leaves empty days out, so the engine is told what was loaded;
  // a stretch that was never loaded is refused, never shown as "nothing recorded".
  const compose = (horizon: Horizon, coverage: { from: string; to: string }, loaded = coverage) =>
    forward({
      now: WED_0703,
      timeZone: NZ,
      horizon,
      days: agenda({ from: loaded.from, to: loaded.to, timeZone: NZ, events: LATER }),
      coverage,
      events: LATER,
      people: PEOPLE,
      calendars: [fresh(WED_0703)],
    });
  const LATER = [
    ...ROUTINE,
    timed('e-later', 'Later', '2026-10-30T10:00:00+13:00', '2026-10-30T11:00:00+13:00', {
      people: att(ID.sam),
    }),
  ];

  it.each([
    ['week', '2026-10-20'],
    ['month', '2026-11-12'],
    ['season', '2027-01-11'],
  ] as const)('complete %s coverage composes', (h, to) => {
    expect(compose(h, { from: '2026-10-14', to }).to).toBe(to);
  });

  it('coverage wider than the horizon composes, and the extra days are not used', () => {
    expect(compose('week', { from: '2026-10-01', to: '2027-01-11' }).counts).toEqual(
      compose('week', { from: '2026-10-14', to: '2026-10-20' }).counts,
    );
  });

  it('an eight-day agenda is refused for Month and Season; it is enough for Week', () => {
    const eight = { from: '2026-10-14', to: '2026-10-21' };
    expect(() => compose('month', eight)).toThrow(IncompleteAgendaError);
    expect(() => compose('season', eight)).toThrow(IncompleteAgendaError);
    expect(() => compose('week', eight)).not.toThrow();
  });

  it('coverage that starts after today is refused', () => {
    expect(() => compose('week', { from: '2026-10-15', to: '2027-01-11' })).toThrow(
      /agenda covers 2026-10-15\.\.2027-01-11, but the horizon needs 2026-10-14\.\.2026-10-20/,
    );
  });

  it('coverage that ends one day before the horizon ends is refused', () => {
    expect(() => compose('month', { from: '2026-10-14', to: '2026-11-11' })).toThrow(
      IncompleteAgendaError,
    );
    expect(() => compose('month', { from: '2026-10-14', to: '2026-11-12' })).not.toThrow();
  });

  it('a sparse agenda over full coverage composes: absent days were loaded and empty', () => {
    const m = forward({
      now: WED_0703,
      timeZone: NZ,
      horizon: 'season',
      days: [],
      coverage: { from: '2026-10-14', to: '2027-01-11' },
      events: [],
      people: PEOPLE.filter((p) => p.id !== ID.nana),
      calendars: [fresh(WED_0703)],
    });
    expect(m.headline.rule).toBe('forward.headline.nothing');
    expect(m.units.every((u) => u.load.text === 'Nothing recorded')).toBe(true);
  });

  it('no false "nothing recorded": the event on 30 October is either counted or refused', () => {
    expect(() => compose('month', { from: '2026-10-14', to: '2026-10-21' })).toThrow();
    const m = compose('month', { from: '2026-10-14', to: '2026-11-12' });
    expect(m.units[2]!.load.text).toBe('One thing recorded');
    expect(m.headline.text).not.toMatch(/^Just the usual|^Nothing recorded/);
  });
});

describe('finished overnight items (after the Package 1 review)', () => {
  it('a carry-over from last night that has ended never displaces what is still to come', () => {
    const late = timed(
      'e-late',
      'Late gig',
      '2026-10-13T22:00:00+13:00',
      '2026-10-14T01:00:00+13:00',
      {
        people: att(ID.alex),
      },
    );
    const a = timed('e-a', 'Dentist', '2026-10-14T10:00:00+13:00', '2026-10-14T11:00:00+13:00', {
      people: att(ID.alex),
    });
    const b = timed('e-b', 'Haircut', '2026-10-14T12:00:00+13:00', '2026-10-14T13:00:00+13:00', {
      people: att(ID.alex),
    });
    const u = run({ events: [...ROUTINE, late, a, b] }, WED_0703).units[0]!;
    expect(u.notable.map((e) => e.key)).toEqual([
      'e-late:2026-10-13',
      'e-a:2026-10-14',
      'e-b:2026-10-14',
    ]); // the full model, in row order, keeps it
    expect(u.shown.map((e) => e.key)).toEqual(['e-a:2026-10-14', 'e-b:2026-10-14']);
    expect(u.rest.map((e) => e.key)).toEqual(['e-late:2026-10-13']);
    expect(u.more).toBe(1);
    expect(u.load.count).toBe(2); // the count rule is unchanged
    // While it is still running it counts, and it is on the surface again.
    const early = run({ events: [...ROUTINE, late, a, b] }, at('2026-10-14T00:30:00+13:00'))
      .units[0]!;
    expect(early.shown.map((e) => e.key)).toEqual(['e-late:2026-10-13', 'e-a:2026-10-14']);
  });
});
