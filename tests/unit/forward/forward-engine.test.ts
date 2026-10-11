import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  agenda,
  type AgendaDay,
  type AgendaEventInput,
  type AgendaTaskInput,
} from '@/domain/engines/agenda';
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

/** A seeded generator (mulberry32), as the conflict engine's T19: the same seed, the same sequence. */
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
      ['1–11 Jan', '2027-01-01', '2027-01-11'],
    ]);
  });

  it('a month the horizon ends inside is labelled by the days it covers, never by its name (ADR 0009 §35)', () => {
    // 90 days from 4 October end on 1 January: one day of January, said as one day.
    expect(unitsOf('season', '2026-10-04').at(-1)).toEqual({
      unit: 'month',
      label: '1 Jan',
      from: '2027-01-01',
      to: '2027-01-01',
    });
    // Ending on a month's last day keeps the name: the whole month was looked at.
    expect(unitsOf('season', '2026-10-03').at(-1)).toMatchObject({
      label: 'December',
      to: '2026-12-31',
    });
    // The first month runs from today, as every horizon does, and keeps its name.
    expect(unitsOf('season', '2026-10-14')[0]!.label).toBe('October');
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

  it('a fortnightly series with a household person is usual on its on-weeks across Month and Season, absent on off-weeks, never notable (P1-6)', () => {
    const lessons = timed(
      'e-guitar',
      'Guitar',
      '2026-10-13T16:00:00+13:00',
      '2026-10-13T16:45:00+13:00',
      { kind: 'activity', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', people: att(ID.milo) },
    );
    const onWeeks = (h: Horizon) => {
      const m = run({ events: [...HOUSE, lessons] }, WED_0703, h);
      const keys = (rule: 'notable' | 'usual') =>
        m.units.flatMap((u) => u[rule].map((e) => e.key)).filter((k) => k.startsWith('e-guitar:'));
      expect(keys('notable')).toEqual([]);
      return keys('usual');
    };
    expect(onWeeks('month')).toEqual(['e-guitar:2026-10-27', 'e-guitar:2026-11-10']);
    expect(onWeeks('season')).toEqual([
      'e-guitar:2026-10-27',
      'e-guitar:2026-11-10',
      'e-guitar:2026-11-24',
      'e-guitar:2026-12-08',
      'e-guitar:2026-12-22',
      'e-guitar:2027-01-05',
    ]);
    // Off-weeks (20 October, 3 November, …) have nothing of it.
    expect(
      onWeeks('season').some((k) => k.endsWith('2026-10-20') || k.endsWith('2026-11-03')),
    ).toBe(false);
    const m = run({ events: [...HOUSE, lessons] }, WED_0703);
    expect(m.usual.find((w) => w.name === 'Milo')!.entries.map((e) => e.eventId)).toContain(
      'e-guitar',
    );
  });

  it('Month and Season rows are chronological (ADR 0009 §35): a conflict lists, it does not reorder; the trip and the milestone stay reachable', () => {
    // A recurring conflict (Tutoring beside the usual Swimming), a family trip,
    // a project milestone and a few ordinary commitments across the month.
    const tutor = timed(
      'e-tutor',
      'Tutoring',
      '2026-10-14T15:45:00+13:00',
      '2026-10-14T16:30:00+13:00',
      {
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        people: att(ID.milo),
      },
    );
    const events = [
      ...HOUSE,
      tutor,
      allDay('e-trip', 'Wellington trip', '2026-10-16', '2026-10-18', { people: att(ID.sam) }),
      timed('e-call', 'London call', '2026-10-15T07:00:00+13:00', '2026-10-15T07:30:00+13:00', {
        people: att(ID.alex),
      }),
      timed('e-dent', 'Dentist', '2026-10-15T15:30:00+13:00', '2026-10-15T16:30:00+13:00', {
        people: att(ID.milo),
      }),
      timed('e-bee', 'Working bee', '2026-10-24T10:00:00+13:00', '2026-10-24T12:00:00+13:00', {
        people: att(ID.alex),
      }),
    ];
    const conflicts = [{ key: 'k', occurrences: ['e-swim:2026-10-14', 'e-tutor:2026-10-14'] }];
    const projects = [{ id: 'pr-deck', title: 'Deck', status: 'active', targetDate: '2026-10-20' }];
    for (const horizon of ['month', 'season'] as const) {
      const m = run({ events, conflicts, projects }, WED_0703, horizon);
      for (const u of m.units) {
        // Every row, shown and folded, is in date order: a conflict does not pull its entries ahead.
        const dates = u.notable.map((e) => e.date);
        expect(dates, `${horizon} ${u.label}`).toEqual([...dates].sort());
        expect(u.shown).toEqual(u.notable.slice(0, u.shown.length));
      }
      // Today's conflicted pair sits at its time (15:30), after Isla's 15:00 pickup: not pulled first.
      const first = m.units[0]!;
      expect(first.notable[0]!.key).toBe('e-pickup:2026-10-14');
      expect(first.notable.findIndex((e) => e.conflicted)).toBeGreaterThan(0);
      const all = m.units.flatMap((u) => [...u.shown, ...u.rest]).map((e) => e.key);
      for (const id of ['e-trip', 'pr-deck', 'e-call', 'e-dent', 'e-bee'])
        expect(
          all.some((k) => k.includes(id)),
          `${horizon} ${id}`,
        ).toBe(true);
      expect(m.units.flatMap((u) => u.notable).filter((e) => e.conflicted)).toHaveLength(2);
    }
    // Week keeps the conflicted entries first on their day (their marks are there).
    const w = run({ events, conflicts, projects }, WED_0703, 'week');
    expect(w.units[0]!.notable.slice(0, 2).every((e) => e.conflicted)).toBe(true);
  });

  it('a usual occurrence in a current conflict is notable, and first in its row on Week', () => {
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
      // On Week, ordered by kind: the target comes before the timed events, so it is on the
      // surface. On Month and Season the row is chronological (ADR 0009 §35), so it is on the
      // surface or under "+ N" by its date, and in the model either way.
      if (h === 'week') {
        expect(unit.shown.map((e) => e.key)).toContain(target);
        expect(unit.rest.map((e) => e.key)).not.toContain(target);
      } else expect([...unit.shown, ...unit.rest].map((e) => e.key)).toContain(target);
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

  it('within a unit: on Week by kind (birthdays, all-day and multi-day, targets, tasks due, scheduled, timed); on Month by date, then the agenda’s order', () => {
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
    const house = {
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
    };
    // Week, Monday the 19th: by kind, whatever the times.
    const week = run(house, WED_0703, 'week');
    expect(week.units[5]!.notable.map((e) => e.key)).toEqual([
      'e-camp:2026-10-19',
      'project_target:pr-fence:2026-10-19',
      'task_due:t-due',
      'task_scheduled:t-sch',
      'e-late:2026-10-19',
    ]);
    expect(week.units[6]!.notable.map((e) => e.key)).toEqual([
      'birthday:p-nana:2026-10-20',
      'e-camp:2026-10-19', // its second day
    ]);
    // Month, the week of the 19th: by date (the 20th's birthday last), then the agenda's order.
    const month = run(house, WED_0703, 'month');
    expect(month.units[1]!.notable.map((e) => e.key)).toEqual([
      'e-camp:2026-10-19',
      'project_target:pr-fence:2026-10-19',
      'task_due:t-due',
      'task_scheduled:t-sch',
      'e-late:2026-10-19',
      'birthday:p-nana:2026-10-20',
    ]);
  });

  // Determinism (contract §8.1, matrix U-10): a seeded Fisher–Yates (the
  // conflict engine's T19 helper) over events, tasks, projects and people, and
  // over the items within each of the agenda's days. Every seed gives the
  // same model, deeply and byte for byte, on every horizon. Two inputs keep
  // the order their contracts give them: the agenda's days are in date order
  // (`agenda()`'s documented output; Forward places a multi-day occurrence at
  // its first day in that order), and Forward's people are in People order
  // (`ForwardInput.people`; The usual lists people in it). The people the
  // agenda is given are shuffled.
  it.each(HORIZONS)('%s: seeded shuffles of every input give an identical model', (h) => {
    const events = [
      ...HOUSE,
      ...many,
      allDay('e-camp', 'Camp', '2026-10-19', '2026-10-22', { people: att(ID.milo) }),
      timed('e-shift', 'Night shift', '2026-10-15T22:00:00+13:00', '2026-10-16T06:00:00+13:00', {
        people: att(ID.sam),
      }),
    ];
    const projects = [
      { id: 'pr-fence', title: 'Back fence', status: 'active', targetDate: '2026-10-17' },
      { id: 'pr-shed', title: 'Shed', status: 'active', targetDate: '2026-11-03' },
    ];
    const from = '2026-10-14';
    const to = addDays(from, 89);
    const compose = (
      ev: AgendaEventInput[],
      tasks: AgendaTaskInput[],
      pr: typeof projects,
      people: typeof PEOPLE,
      shuffleItems?: (d: AgendaDay[]) => AgendaDay[],
    ) => {
      const placed = agenda({
        from,
        to,
        timeZone: NZ,
        events: ev,
        people: people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
        tasks,
        projects: pr,
      });
      return forward({
        now: WED_0703,
        timeZone: NZ,
        horizon: h,
        days: shuffleItems ? shuffleItems(placed) : placed,
        coverage: { from, to },
        events: ev,
        people: PEOPLE,
        calendars: [fresh(WED_0703)],
        conflicts: [{ key: 'k', occurrences: ['e-board:2026-10-14', 'e-pickup:2026-10-14'] }],
      });
    };
    const base = compose(events, SCHEDULED, projects, PEOPLE);
    expect(base.counts.notable).toBeGreaterThan(5);
    const SEEDS = [1, 7, 42, 2026, 31337, 65_000, 123_457, 999_983];
    const orders = new Set<string>();
    for (const seed of SEEDS) {
      const random = mulberry32(seed);
      const ev = shuffle(events, random);
      const tasks = shuffle(SCHEDULED, random);
      const pr = shuffle(projects, random);
      const people = shuffle(PEOPLE, random);
      orders.add(ev.map((e) => e.id).join(','));
      const out = compose(ev, tasks, pr, people, (placed) =>
        placed.map((d) => ({ ...d, items: shuffle(d.items, random) })),
      );
      expect(out).toEqual(base);
      expect(JSON.stringify(out)).toBe(JSON.stringify(base));
    }
    // The shuffles really are different orders, not the input and not only its reverse.
    expect(orders.size).toBe(SEEDS.length);
    orders.delete(events.map((e) => e.id).join(','));
    orders.delete(
      [...events]
        .reverse()
        .map((e) => e.id)
        .join(','),
    );
    expect(orders.size).toBeGreaterThanOrEqual(SEEDS.length - 2);
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

  // The owner's wording (ADR 0009 §36, contract §5.5): an event carried in
  // from before today is named by when it ends; one starting today is not.
  it.each([
    ['2026-10-17', 'Camp, until Friday.'], // last day Friday 16
    ['2026-10-16', 'Camp, until tomorrow.'],
    ['2026-10-15', 'Camp, ending today.'],
    ['2026-10-20', 'Camp, until Monday.'], // six days on: a weekday is still unambiguous
    ['2026-10-22', 'Camp, until Wednesday 21 October.'], // seven days on: its date
    ['2026-10-24', 'Camp, until Friday 23 October.'],
  ])(
    'listed: a multi-day event carried in from Monday, ending before %s, is named by its end',
    (end, text) => {
      const camp = allDay('e-camp', 'Camp', '2026-10-12', end, { people: att(ID.milo) });
      const m = run({ events: [...ROUTINE, camp], people: NO_BIRTHDAYS }, WED_0703);
      expect(m.headline).toMatchObject({ rule: 'forward.headline.listed', text });
      expect(m.headline.facts).toEqual([
        { kind: 'event', id: 'e-camp', occurrenceDate: '2026-10-12' },
      ]);
    },
  );

  it('listed: a multi-day event starting today is unchanged ("Camp today."); a timed one carried in is named by its end', () => {
    const today = allDay('e-camp', 'Camp', '2026-10-14', '2026-10-17', { people: att(ID.milo) });
    expect(run({ events: [...ROUTINE, today], people: NO_BIRTHDAYS }, WED_0703).headline.text).toBe(
      'Camp today.',
    );
    const timedCamp = timed(
      'e-camp',
      'Camp',
      '2026-10-13T09:00:00+13:00',
      '2026-10-16T15:00:00+13:00',
      { people: att(ID.milo) },
    );
    expect(
      run({ events: [...ROUTINE, timedCamp], people: NO_BIRTHDAYS }, WED_0703).headline.text,
    ).toBe('Camp, until Friday.');
    // Beside another listed item: each is worded by its own rule.
    expect(run({ events: [...ROUTINE, timedCamp] }, WED_0703).headline.text).toBe(
      'Camp, until Friday, then Nana Jo’s birthday on Tuesday.',
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
    // The full list: M5 contract §8.1 and M6 contract §5.5 (matrix U-13). The
    // household's own titles and names are exempt, as recorded.
    const forbidden =
      /\b(needs?|needs you|nobody['’]?s down|lift|pick(ing)? up|drop(ping)? off|taking|driving|free|available|out|easy|busy|full|calm|covered|sorted|nothing needs|should|probably|nothing prepared|packed|steady|clear|quiet|stressful|overwhelming|away|unavailable|in two places|double-booked|can['’]t|clash|worth deciding|nothing planned)\b|\bwho\?/i;
    const conflicts = [{ key: 'k', occurrences: ['e-board:2026-10-14', 'e-pickup:2026-10-14'] }];
    const carried = allDay('e-camp', 'Camp', '2026-10-12', '2026-10-17', { people: att(ID.milo) });
    let checked = 0;
    for (const h of HORIZONS)
      for (const events of [[], ROUTINE, HOUSE, [...ROUTINE, carried]])
        for (const iso of ['2026-10-14T07:03:00+13:00', '2026-10-17T21:00:00+13:00'])
          for (const calendars of [[fresh(at(iso))], []]) {
            const m = run({ events, calendars, conflicts }, at(iso), h);
            const own = (t: string) =>
              [...events.map((e) => e.title), ...PEOPLE.map((p) => p.name)]
                .sort((a, b) => b.length - a.length)
                .reduce((x, name) => x.split(name).join(''), t);
            for (const t of allText(m)) {
              expect(own(t), t).not.toMatch(forbidden);
              checked++;
            }
          }
    expect(checked).toBeGreaterThan(200);
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

  it('across the NZ DST end (5 Apr 2026) with a weekly 09:00 series: on its days at 09:00, NZDT then NZST; unit counts unchanged', () => {
    const work = timed('e-w', 'Work', '2026-03-02T09:00:00+13:00', '2026-03-02T14:30:00+13:00', {
      kind: 'work',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
      people: att(ID.alex),
    });
    const now = at('2026-04-02T08:00:00+13:00'); // Thursday
    const placedAt = (m: ForwardModel) =>
      m.units
        .flatMap((u) => u.usual)
        .map((e) => [
          e.date,
          e.item.kind === 'event' && !e.item.allDay ? e.item.startsAt.toISOString() : '',
        ]);
    const week = run({ events: [work] }, now, 'week');
    expect(week.units.map((u) => [u.from, u.to])).toEqual(
      unitsOf('week', '2026-04-02').map((u) => [u.from, u.to]),
    );
    expect(week.units).toHaveLength(7);
    // Thursday 2 April, 09:00 NZDT (UTC+13); Monday 6 April, 09:00 NZST (UTC+12).
    expect(placedAt(week)).toEqual([
      ['2026-04-02', '2026-04-01T20:00:00.000Z'],
      ['2026-04-06', '2026-04-05T21:00:00.000Z'],
    ]);
    expect(week.units.map((u) => u.usual.length)).toEqual([1, 0, 0, 0, 1, 0, 0]);
    expect(week.units.every((u) => u.load.count === 0)).toBe(true);

    const season = run({ events: [work] }, now, 'season');
    expect(season.units.map((u) => [u.label, u.from, u.to])).toEqual([
      ['April', '2026-04-02', '2026-04-30'],
      ['May', '2026-05-01', '2026-05-31'],
      ['June', '2026-06-01', '2026-06-30'],
    ]);
    // Every Monday and Thursday: 9 in April (from the 2nd), 8 in May, 9 in June.
    expect(season.units.map((u) => u.usual.length)).toEqual([9, 8, 9]);
    const all = placedAt(season);
    expect(all[0]).toEqual(['2026-04-02', '2026-04-01T20:00:00.000Z']);
    for (const [date, start] of all.slice(1)) {
      expect(isoDateInZone(new Date(start!), NZ)).toBe(date);
      expect(new Date(start!).getUTCHours()).toBe(21); // 09:00 NZST
    }
    // Nothing of the series is notable on either horizon.
    for (const m of [week, season])
      expect(m.units.flatMap((u) => u.notable).some((e) => e.key.startsWith('e-w:'))).toBe(false);
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
