import { describe, expect, it } from 'vitest';
import { HEADLINE_RULES, todo, type TodayModel } from '@/domain/engines/today';
import {
  allDay,
  at,
  fresh,
  ID,
  NZ,
  PEOPLE,
  ROUTINE,
  run,
  TASKS,
  timed,
  WEDNESDAY,
} from './household';

// The Today engine (M5 contract §5, ADR 0008 §5–§19, M5 Package 2): what
// Today says, as traced statements over the agenda, with an injected `now`.

const WED = [...ROUTINE, ...WEDNESDAY];
const lines = (m: TodayModel) =>
  m.personLines.map(
    (l) => `${l.name}: ${l.shown.map((e) => e.text).join(' · ')}${l.more ? ` +${l.more}` : ''}`,
  );

describe('headline', () => {
  it('counts what is on beyond the routine, and says who has something on after 6', () => {
    const { today } = run({ events: WED }, at('2026-10-14T07:03:00+13:00'));
    expect(today.state).toBe('day');
    expect(today.headline).toMatchObject({
      rule: 'headline.counted',
      text: 'Four things on today, besides the usual.',
      qualified: false,
    });
    // The four counted: swimming, pilates, the board meeting and Isla's 15:00 item.
    expect(today.headline.facts.map((f) => (f.kind === 'event' ? f.id : f.kind)).sort()).toEqual([
      'e-board',
      'e-pickup',
      'e-pilates',
      'e-swim',
    ]);
    expect(today.headline.late).toMatchObject({
      rule: 'headline.late',
      text: 'Alex and Sam both have something on after 6.',
    });
  });

  it('names one or two things with their times', () => {
    const one = [...ROUTINE.filter((e) => e.id !== 'e-pilates')];
    expect(run({ events: one }, at('2026-10-14T07:03:00+13:00')).today.headline).toMatchObject({
      rule: 'headline.listed',
      text: 'Swimming at 15:30.',
    });
    expect(run({ events: ROUTINE }, at('2026-10-14T07:03:00+13:00')).today.headline).toMatchObject({
      rule: 'headline.listed',
      text: 'Swimming at 15:30, then Pilates at 18:15.',
    });
  });

  it('says "just the usual" on a routine day and "nothing on" on an empty one', () => {
    const thu = run({ events: WED }, at('2026-10-15T07:00:00+13:00')).today;
    expect(thu.headline).toMatchObject({ rule: 'headline.usual', text: 'Just the usual today.' });
    const sun = run({ events: WED }, at('2026-10-18T09:00:00+13:00')).today;
    expect(sun.headline).toMatchObject({ rule: 'headline.nothing', text: 'Nothing on today.' });
    // What it stands on: the day it looked at and the calendars it consulted.
    expect(sun.headline.facts).toEqual([
      { kind: 'range', from: '2026-10-18', to: '2026-10-18' },
      { kind: 'calendar', id: 'c-sam-work' },
    ]);
  });

  it('first run: no calendars and no events at all', () => {
    const r = run({ events: [], calendars: [] }, at('2026-10-14T07:03:00+13:00')).today;
    expect(r.state).toBe('first_run');
    expect(r.headline).toMatchObject({ rule: 'headline.first_run', qualified: false });
    // A household with a calendar but nothing on is not a first run, only a quiet day.
    expect(run({ events: [] }, at('2026-10-14T07:03:00+13:00')).today.headline.rule).toBe(
      'headline.nothing',
    );
    // Nor is one with events but no calendar.
    expect(run({ events: WED, calendars: [] }, at('2026-10-18T09:00:00+13:00')).today.state).toBe(
      'day',
    );
  });

  it('qualifies counts and absences "as far as HOME knows" while a visible calendar is stale or failing', () => {
    const now = at('2026-10-18T09:00:00+13:00');
    const stale = fresh(now, { lastSyncedAt: at('2026-10-16T20:00:00+13:00') });
    const quiet = run({ events: WED, calendars: [stale] }, now).today;
    expect(quiet.headline).toMatchObject({
      rule: 'headline.nothing',
      text: 'Nothing on today, as far as HOME knows.',
      qualified: true,
    });
    expect(quiet.incomplete).toEqual([{ kind: 'calendar', id: 'c-sam-work' }]);
    const failing = fresh(at('2026-10-14T07:03:00+13:00'), { lastSyncStatus: 'unreachable' });
    expect(
      run({ events: WED, calendars: [failing] }, at('2026-10-14T07:03:00+13:00')).today.headline
        .text,
    ).toBe('Four things on today, besides the usual, as far as HOME knows.');
    // Archived or never-refreshed calendars vouch for nothing either way: no qualifier.
    const archived = { ...stale, archivedAt: now };
    const never = fresh(now, { lastSyncedAt: null, lastAttemptAt: null, lastSyncStatus: null });
    expect(run({ events: WED, calendars: [archived, never] }, now).today.headline.qualified).toBe(
      false,
    );
  });

  it('a late evening needs two adults recorded on something ending after 18:00', () => {
    const now = at('2026-10-14T07:03:00+13:00');
    const noBoard = [...ROUTINE, WEDNESDAY[1]!];
    expect(run({ events: noBoard }, now).today.headline.late).toBeNull(); // only Alex
    const endsAtSix = timed(
      'e-six',
      'Meeting',
      '2026-10-14T17:00:00+13:00',
      '2026-10-14T18:00:00+13:00',
      {
        people: [{ personId: ID.sam, role: 'attending' }],
      },
    );
    expect(run({ events: [...noBoard, endsAtSix] }, now).today.headline.late).toBeNull(); // 18:00 is not after
    const childLate = timed(
      'e-kid',
      'Sleepover',
      '2026-10-14T19:00:00+13:00',
      '2026-10-15T09:00:00+13:00',
      {
        people: [{ personId: ID.milo, role: 'attending' }],
      },
    );
    expect(run({ events: [...noBoard, childLate] }, now).today.headline.late).toBeNull(); // a child is not an adult
  });

  it('every headline rule is one of the documented set', () => {
    for (const t of ['07:03', '12:00', '20:40', '23:30'])
      for (const d of ['14', '15', '17', '18'])
        expect(HEADLINE_RULES).toContain(
          run({ events: WED }, at(`2026-10-${d}T${t}:00+13:00`)).today.headline.rule,
        );
  });
});

describe('everyone’s day', () => {
  it('one line per household person with something on, routine as a word, the rest with a time', () => {
    const { today } = run({ events: WED }, at('2026-10-14T07:03:00+13:00'));
    expect(lines(today)).toEqual([
      'Alex: Work till 14:30 · 15:30 Swimming +1',
      'Isla: School · 15:00 Isla pickup',
      'Milo: School · 15:30 Swimming',
      'Sam: Client site · 19:00 Board meeting',
    ]);
    const alex = today.personLines[0]!;
    expect(alex.entries.map((e) => [e.rule, e.text])).toEqual([
      ['person_line.routine', 'Work till 14:30'],
      ['person_line.item', '15:30 Swimming'],
      ['person_line.item', '18:15 Pilates'],
    ]);
    // Nana Jo is not in the household and has nothing on: no line.
    expect(today.personLines.map((l) => l.personId)).not.toContain(ID.nana);
  });

  it('only who is recorded on an item: nothing from its title, its calendar or a missing record', () => {
    // An event titled for Milo but recorded for nobody is Milo's in title only.
    const named = timed(
      'e-named',
      'Milo dentist',
      '2026-10-15T10:00:00+13:00',
      '2026-10-15T11:00:00+13:00',
    );
    const { today } = run({ events: [named] }, at('2026-10-15T07:00:00+13:00'));
    expect(today.personLines).toEqual([]);
    expect(today.alsoToday.map((i) => (i.kind === 'event' ? i.eventId : i.kind))).toEqual([
      'e-named',
    ]);
  });

  it('a changed occurrence of a routine series is said in full, and work ending after 17:00 is "Work"', () => {
    const moved = timed(
      'e-school-moved',
      'School',
      '2026-10-15T10:00:00+13:00',
      '2026-10-15T15:00:00+13:00',
      {
        kind: 'school',
        people: [
          { personId: ID.milo, role: 'attending' },
          { personId: ID.isla, role: 'attending' },
        ],
      },
    );
    const late = timed(
      'e-work-sam',
      'Work',
      '2026-10-15T09:00:00+13:00',
      '2026-10-15T18:00:00+13:00',
      {
        kind: 'work',
        rrule: 'FREQ=WEEKLY;BYDAY=TH',
        people: [{ personId: ID.sam, role: 'attending' }],
      },
    );
    const school = { ...ROUTINE[0]!, exdates: ['2026-10-14T19:45:00Z'] }; // Thursday's moved to 10:00
    const { today } = run({ events: [school, moved, late] }, at('2026-10-15T07:00:00+13:00'));
    expect(lines(today)).toEqual(['Isla: 10:00 School', 'Milo: 10:00 School', 'Sam: Work']);
    expect(today.headline.text).toBe('School at 10:00.');
  });

  it('overnight: the carried-over day says how it runs', () => {
    const late = timed(
      'e-late',
      'Late one',
      '2026-10-14T23:00:00+13:00',
      '2026-10-15T01:00:00+13:00',
      {
        people: [{ personId: ID.sam, role: 'attending' }],
      },
    );
    const wed = run({ events: [late] }, at('2026-10-14T07:00:00+13:00')).today;
    expect(lines(wed)).toEqual(['Sam: 23:00 Late one']);
    const thu = run({ events: [late] }, at('2026-10-15T00:30:00+13:00')).today;
    expect(lines(thu)).toEqual(['Sam: Late one until 01:00']);
    expect(thu.state).toBe('day'); // still running at 00:30
    expect(thu.headline.rule).toBe('headline.counted'); // carried over, so not "at" a start time
  });
});

describe('what is on the surface of a person’s line (Package 3 review, ADR 0008 §32)', () => {
  const line = (m: TodayModel, name: string) => m.personLines.find((l) => l.name === name)!;
  const texts = (es: { text: string }[]) => es.map((e) => e.text);
  /** Alex on Wednesday: Work 09:00–14:30, Swimming 15:30–16:15, Pilates 18:15–19:15. */
  const alexAt = (clock: string) =>
    line(run({ events: WED }, at(`2026-10-14T${clock}:00+13:00`)).today, 'Alex');

  it('in the morning, everything is still to come: the first two, the third under “+ 1 more”', () => {
    const a = alexAt('07:03');
    expect(texts(a.shown)).toEqual(['Work till 14:30', '15:30 Swimming']);
    expect(texts(a.rest)).toEqual(['18:15 Pilates']);
  });

  it('mid-afternoon, what is under way and what is next, not what is over', () => {
    const a = alexAt('15:45'); // Work over, Swimming under way, Pilates to come
    expect(texts(a.shown)).toEqual(['15:30 Swimming', '18:15 Pilates']);
    expect(texts(a.rest)).toEqual(['Work till 14:30']);
  });

  it('regression: at 17:00 the appointment still to come stays visible after the earlier ones finish', () => {
    const a = alexAt('17:00');
    expect(texts(a.shown)).toContain('18:15 Pilates');
    // The other place goes to the one that finished most recently.
    expect(texts(a.shown)).toEqual(['15:30 Swimming', '18:15 Pilates']);
    expect(a.more).toBe(1);
  });

  it('when all of it is over, the two that finished last', () => {
    const a = alexAt('21:40');
    expect(texts(a.shown)).toEqual(['15:30 Swimming', '18:15 Pilates']);
    expect(texts(a.rest)).toEqual(['Work till 14:30']);
  });

  it('an overnight carry-over still running is still to come; once over, it gives way', () => {
    const events = [
      timed('e-shift', 'Late shift', '2026-10-13T22:00:00+13:00', '2026-10-14T01:00:00+13:00', {
        people: [{ personId: ID.sam, role: 'attending' }],
      }),
      timed('e-bfast', 'Breakfast', '2026-10-14T07:00:00+13:00', '2026-10-14T07:30:00+13:00', {
        people: [{ personId: ID.sam, role: 'attending' }],
      }),
      timed('e-dent', 'Dentist', '2026-10-14T10:00:00+13:00', '2026-10-14T10:30:00+13:00', {
        people: [{ personId: ID.sam, role: 'attending' }],
      }),
    ];
    const night = line(run({ events }, at('2026-10-14T00:30:00+13:00')).today, 'Sam');
    expect(texts(night.shown)).toEqual(['Late shift until 01:00', '07:00 Breakfast']);
    const morning = line(run({ events }, at('2026-10-14T08:00:00+13:00')).today, 'Sam');
    expect(texts(morning.shown)).toEqual(['07:00 Breakfast', '10:00 Dentist']);
    expect(texts(morning.rest)).toEqual(['Late shift until 01:00']);
  });

  it('an all-day item is never finished, so it stays on the surface all day', () => {
    const events = [
      ...WED,
      timed('e-lunch', 'Lunch', '2026-10-14T12:00:00+13:00', '2026-10-14T13:00:00+13:00', {
        people: [{ personId: ID.sam, role: 'attending' }],
      }),
    ];
    const sam = line(run({ events }, at('2026-10-14T21:40:00+13:00')).today, 'Sam');
    expect(texts(sam.shown)).toEqual(['Client site', '19:00 Board meeting']);
    expect(texts(sam.rest)).toEqual(['12:00 Lunch']);
  });

  it('ties at the same time are broken the same way whatever order the records came in', () => {
    const milo = (title: string, id: string) =>
      timed(id, title, '2026-10-14T10:00:00+13:00', '2026-10-14T11:00:00+13:00', {
        people: [{ personId: ID.milo, role: 'attending' }],
      });
    const later = timed('e-z', 'Art', '2026-10-14T16:00:00+13:00', '2026-10-14T17:00:00+13:00', {
      people: [{ personId: ID.milo, role: 'attending' }],
    });
    const events = [milo('Chess', 'e-a'), milo('Band', 'e-b'), later];
    const now = at('2026-10-14T12:00:00+13:00');
    const one = line(run({ events }, now).today, 'Milo');
    const two = line(run({ events: [...events].reverse() }, now).today, 'Milo');
    expect(texts(one.shown)).toEqual(texts(two.shown));
    expect(texts(one.rest)).toEqual(texts(two.rest));
    expect(one.shown).toHaveLength(2);
    expect(texts(one.shown)).toContain('16:00 Art');
  });

  it('“+ N more” counts and holds exactly the rest, and nothing is dropped from the day', () => {
    for (const clock of ['07:03', '12:00', '15:45', '17:00', '21:40']) {
      const m = run({ events: WED }, at(`2026-10-14T${clock}:00+13:00`)).today;
      for (const l of m.personLines) {
        expect(l.shown.length).toBeLessThanOrEqual(2);
        expect(l.more).toBe(l.rest.length);
        expect(l.shown.length + l.rest.length).toBe(l.entries.length);
        // Both halves keep agenda order, and together they are the whole line.
        const order = (es: typeof l.entries) => es.map((e) => l.entries.indexOf(e));
        expect(order(l.shown)).toEqual([...order(l.shown)].sort((a, b) => a - b));
        expect(order(l.rest)).toEqual([...order(l.rest)].sort((a, b) => a - b));
        expect(new Set([...l.shown, ...l.rest])).toEqual(new Set(l.entries));
      }
    }
  });
});

describe('also today', () => {
  it('birthdays outside the household, project targets, and events with no household person', () => {
    const nobody = timed(
      'e-nobody',
      'Rates due',
      '2026-10-17T09:00:00+13:00',
      '2026-10-17T09:30:00+13:00',
    );
    const { today } = run({ events: [...WED, nobody] }, at('2026-10-17T07:00:00+13:00'));
    expect(
      today.alsoToday.map((i) =>
        i.kind === 'event' ? i.eventId : i.kind === 'project_target' ? i.projectId : i.kind,
      ),
    ).toEqual(['pr-fence', 'e-nobody']);
    const tue = run({ events: WED }, at('2026-10-20T07:00:00+13:00')).today;
    expect(tue.alsoToday.map((i) => (i.kind === 'birthday' ? i.personId : i.kind))).toEqual([
      ID.nana,
    ]);
    // A household person's birthday is on their own line instead.
    const milo = run({ events: [] }, at('2027-02-08T07:00:00+13:00')).today;
    expect(lines(milo)).toEqual(['Milo: Birthday']);
    expect(milo.alsoToday).toEqual([]);
  });
});

describe('to do', () => {
  it('scheduled today by time, then due today by title, then carried over oldest first; three shown', () => {
    const extra = [
      ...TASKS,
      { id: 't-a', title: 'A thing due today', dueDate: '2026-10-14', scheduledStartsAt: null },
      { id: 't-old', title: 'Very old', dueDate: '2026-09-01', scheduledStartsAt: null },
    ];
    const all = todo(extra, '2026-10-14', NZ);
    expect(all.map((t) => `${t.rule} ${t.task.id}`)).toEqual([
      'todo.scheduled_today t-plumber',
      'todo.due_today t-a',
      'todo.due_today t-fees',
      'todo.carried_over t-old',
      'todo.carried_over t-books',
    ]);
    const { today } = run({ events: WED, tasks: extra }, at('2026-10-14T07:03:00+13:00'));
    expect(today.todo.shown.map((t) => t.task.id)).toEqual(['t-plumber', 't-a', 't-fees']);
    expect(today.todo.more).toBe(2);
    expect(today.todo.all).toHaveLength(5); // nothing silently dropped
    // Tasks with no date, or due later, are not Today's.
    expect(all.map((t) => t.task.id)).not.toContain('t-paint');
    expect(all.map((t) => t.task.id)).not.toContain('t-camp');
  });
});

describe('evening and earlier', () => {
  it('in the day view, past items fold once more than one has passed', () => {
    expect(run({ events: WED }, at('2026-10-14T15:20:00+13:00')).today.earlier.length).toBe(3); // work, pickup, school
    expect(run({ events: WED }, at('2026-10-14T14:40:00+13:00')).today.earlier.length).toBe(0); // only work is over
  });

  it('once everything timed today is over: nothing else on, tomorrow morning, before then', () => {
    const r = run({ events: WED }, at('2026-10-14T22:00:00+13:00')).today;
    expect(r.state).toBe('evening');
    // Sam's all-day Client site is still today's, so only the timed ones are said to be over.
    expect(r.headline).toMatchObject({
      rule: 'headline.evening_all_day',
      text: 'Today’s timed events have finished.',
    });
    expect(r.headline.late).toBeNull();
    expect(r.evening!.tomorrowMorning.map((i) => i.eventId)).toEqual(['e-school', 'e-work-alex']);
    expect(r.evening!.beforeThen.map((t) => [t.rule, t.task.id])).toEqual([
      ['todo.due_tomorrow', 't-camp'],
    ]);
    expect(r.evening!.earlier.length).toBe(7);
    // Something still on tonight keeps the day view.
    expect(run({ events: WED }, at('2026-10-14T20:59:00+13:00')).today.state).toBe('day');
  });

  it('a day with nothing timed is never "evening", whatever the hour', () => {
    const r = run({ events: WED }, at('2026-10-18T23:00:00+13:00')).today;
    expect(r.state).toBe('day');
    expect(r.headline.rule).toBe('headline.nothing');
  });
});

describe('evening transition and carry-overs (review fixes, ADR 0008 §31)', () => {
  const sam = [{ personId: ID.sam, role: 'attending' as const }];
  const isla = [{ personId: ID.isla, role: 'attending' as const }];
  // Tuesday 22:00 to Wednesday 01:00.
  const shift = timed(
    'e-shift',
    'Late shift',
    '2026-10-13T22:00:00+13:00',
    '2026-10-14T01:00:00+13:00',
    {
      people: sam,
    },
  );
  const trip = allDay('e-trip', 'School trip', '2026-10-14', '2026-10-15', { people: isla });
  // Wednesday 15:00 to 17:00.
  const dentist = timed(
    'e-dentist',
    'Dentist',
    '2026-10-14T15:00:00+13:00',
    '2026-10-14T17:00:00+13:00',
    {
      people: sam,
    },
  );

  it('A: a carry-over that ended at 01:00 does not bring evening at 07:03', () => {
    const r = run({ events: [shift] }, at('2026-10-14T07:03:00+13:00')).today;
    expect(r.state).toBe('day');
    expect(r.evening).toBeNull();
    expect(r.headline.rule).not.toMatch(/^headline\.evening/);
  });

  it('B: nor with an all-day school trip, at 07:03 or 13:00', () => {
    for (const t of ['07:03', '13:00']) {
      const r = run({ events: [shift, trip] }, at(`2026-10-14T${t}:00+13:00`)).today;
      expect(r.state, t).toBe('day');
      expect(r.headline, t).toMatchObject({
        rule: 'headline.counted',
        text: 'One thing on today.',
      });
    }
  });

  it('C: something timed that began today and ended at 17:00 makes 18:00 evening', () => {
    const r = run({ events: [shift, dentist] }, at('2026-10-14T18:00:00+13:00')).today;
    expect(r.state).toBe('evening');
    expect(r.headline).toMatchObject({ rule: 'headline.evening', text: 'Nothing else on today.' });
    expect(run({ events: [dentist] }, at('2026-10-14T16:59:00+13:00')).today.state).toBe('day');
  });

  it('D: with an all-day event today, evening says only that the timed ones have finished', () => {
    const r = run({ events: [dentist, trip] }, at('2026-10-14T18:00:00+13:00')).today;
    expect(r.state).toBe('evening');
    expect(r.headline).toMatchObject({
      rule: 'headline.evening_all_day',
      text: 'Today’s timed events have finished.',
    });
    expect(r.headline.text).not.toMatch(/nothing else/i);
    expect(r.headline.facts).toEqual(
      expect.arrayContaining([
        { kind: 'event', id: 'e-dentist', occurrenceDate: '2026-10-14' },
        { kind: 'event', id: 'e-trip', occurrenceDate: '2026-10-14' },
      ]),
    );
  });

  it('E: an overnight event still running at 00:30 is not over, and counts', () => {
    const r = run({ events: [shift, dentist] }, at('2026-10-14T00:30:00+13:00')).today;
    expect(r.state).toBe('day');
    expect(r.headline).toMatchObject({ rule: 'headline.counted', text: 'Two things on today.' });
    expect(r.personLines.map((l) => l.entries.map((e) => e.text))).toEqual([
      ['Late shift until 01:00', '15:00 Dentist'],
    ]);
  });

  it('F: a carry-over that ended at 01:00 is not counted at 07:03, but stays on the day', () => {
    const r = run({ events: [shift, dentist] }, at('2026-10-14T07:03:00+13:00'));
    expect(r.today.headline).toMatchObject({ rule: 'headline.listed', text: 'Dentist at 15:00.' });
    expect(r.today.headline.facts).toEqual([
      { kind: 'event', id: 'e-dentist', occurrenceDate: '2026-10-14' },
    ]);
    expect(r.today.personLines[0]!.entries.map((e) => e.text)).toEqual([
      'Late shift until 01:00',
      '15:00 Dentist',
    ]);
    // Alone, it leaves nothing on today: it is over, and nothing else is recorded.
    expect(run({ events: [shift] }, at('2026-10-14T07:03:00+13:00')).today.headline.rule).toBe(
      'headline.nothing',
    );
    // busy_day.count: six one-offs tomorrow plus tonight's overnight carry-over into it.
    const into = timed(
      'e-into',
      'Night out',
      '2026-10-14T22:00:00+13:00',
      '2026-10-15T01:00:00+13:00',
      {
        people: sam,
      },
    );
    const five = Array.from({ length: 5 }, (_, k) =>
      timed(`e-t${k}`, `T${k}`, `2026-10-15T1${k}:00:00+13:00`, `2026-10-15T1${k}:30:00+13:00`, {
        people: sam,
      }),
    );
    // Seen on Wednesday morning, the carry-over into Thursday has not happened yet: it counts.
    const wed = run({ events: [into, ...five] }, at('2026-10-14T07:03:00+13:00')).insights;
    expect(wed.all.find((i) => i.rule === 'busy_day.count')?.basis).toEqual({
      count: 6,
      threshold: 6,
    });
    // Seen on Thursday at 07:03 it is over: five things on today, below the threshold.
    const thu = run({ events: [into, ...five] }, at('2026-10-15T07:03:00+13:00'));
    expect(thu.insights.all.some((i) => i.rule === 'busy_day.count')).toBe(false);
    expect(thu.today.headline.text).toBe('Five things on today.');
  });

  it('G: an overnight event that starts tonight is not finished tonight', () => {
    const tonight = timed(
      'e-night',
      'Night out',
      '2026-10-14T21:00:00+13:00',
      '2026-10-15T02:00:00+13:00',
      {
        people: sam,
      },
    );
    for (const t of ['2026-10-14T23:30:00+13:00', '2026-10-15T00:30:00+13:00']) {
      const r = run({ events: [dentist, tonight] }, at(t)).today;
      expect(r.state, t).toBe('day');
      expect(r.headline.rule, t).not.toMatch(/^headline\.evening/);
    }
    // Once it is over, Thursday's own day begins: a carry-over alone never makes evening.
    expect(run({ events: [tonight] }, at('2026-10-15T03:00:00+13:00')).today.state).toBe('day');
  });

  it('H: an ordinary evening is unchanged', () => {
    const noSite = WED.filter((e) => e.id !== 'e-site');
    const r = run({ events: noSite }, at('2026-10-14T22:00:00+13:00')).today;
    expect(r.state).toBe('evening');
    expect(r.headline).toMatchObject({ rule: 'headline.evening', text: 'Nothing else on today.' });
    expect(r.evening!.tomorrowMorning.map((i) => i.eventId)).toEqual(['e-school', 'e-work-alex']);
  });
});

describe('time zones and clock changes', () => {
  it('a Sunday series keeps its local time across the spring-forward change', () => {
    const series = timed(
      'e-sun',
      'Church',
      '2026-09-20T09:00:00+12:00',
      '2026-09-20T10:00:00+12:00',
      {
        rrule: 'FREQ=WEEKLY;BYDAY=SU',
        people: [{ personId: ID.sam, role: 'attending' }],
      },
    );
    expect(run({ events: [series] }, at('2026-09-20T07:00:00+12:00')).today.headline.text).toBe(
      'Church at 09:00.',
    );
    expect(run({ events: [series] }, at('2026-09-27T07:00:00+13:00')).today.headline.text).toBe(
      'Church at 09:00.',
    );
  });

  it('an event kept in New York is said at home: its home date and home time', () => {
    // 08:00 EDT Wednesday 14 October is 01:00 NZDT Thursday 15 October.
    const ny = timed('e-ny', 'Call', '2026-10-14T12:00:00Z', '2026-10-14T13:00:00Z', {
      timeZone: 'America/New_York',
      people: [{ personId: ID.sam, role: 'attending' }],
    });
    expect(run({ events: [ny] }, at('2026-10-14T07:00:00+13:00')).today.headline.rule).toBe(
      'headline.nothing',
    );
    expect(run({ events: [ny] }, at('2026-10-15T00:30:00+13:00')).today.headline.text).toBe(
      'Call at 01:00.',
    );
  });

  it('the home date comes from the injected time, not the clock', () => {
    // 23:30 UTC on the 14th is 12:30 on the 15th at home.
    expect(run({ events: WED }, at('2026-10-14T23:30:00Z')).today.date).toBe('2026-10-15');
  });
});

describe('determinism', () => {
  it('the same output whatever order the records arrive in', () => {
    const now = at('2026-10-14T07:03:00+13:00');
    const a = run({ events: WED, tasks: TASKS }, now);
    const b = run({ events: [...WED].reverse(), tasks: [...TASKS].reverse() }, now);
    expect(b.today).toEqual(a.today);
    expect(b.insights).toEqual(a.insights);
    expect(run({ events: WED }, now)).toEqual(run({ events: WED }, now));
  });

  it('people keep the order People gives them', () => {
    const reversed = [...PEOPLE].reverse();
    const { today } = run({ events: WED, people: reversed }, at('2026-10-14T07:03:00+13:00'));
    expect(today.personLines.map((l) => l.name)).toEqual(['Sam', 'Milo', 'Isla', 'Alex']);
  });
});

describe('quiet, first-run and incomplete are told apart', () => {
  it('A: nothing recorded; B: nothing recorded but a calendar is stale; C: a new household', () => {
    const now = at('2026-10-18T09:00:00+13:00');
    const a = run({ events: WED }, now).today;
    const b = run(
      { events: WED, calendars: [fresh(now, { lastSyncedAt: at('2026-10-10T09:00:00+13:00') })] },
      now,
    ).today;
    const c = run({ events: [], calendars: [] }, now).today;
    expect([a, b, c].map((m) => [m.state, m.headline.rule, m.headline.qualified])).toEqual([
      ['day', 'headline.nothing', false],
      ['day', 'headline.nothing', true],
      ['first_run', 'headline.first_run', false],
    ]);
    expect(a.headline.text).not.toBe(b.headline.text);
  });

  it('allDay events count as things on; an all-day routine is said by its title', () => {
    const away = allDay('e-away', 'Sam away', '2026-10-18', '2026-10-19', {
      people: [{ personId: ID.sam, role: 'attending' }],
    });
    const r = run({ events: [away] }, at('2026-10-18T09:00:00+13:00')).today;
    expect(r.headline.text).toBe('One thing on today.');
    expect(lines(r)).toEqual(['Sam: Sam away']);
  });

  it('the To sort count is the reader’s waiting captures, never negative', () => {
    const now = at('2026-10-14T07:03:00+13:00');
    expect(run({ events: WED, capturesWaiting: 2 }, now).today.toSort).toBe(2);
    expect(run({ events: WED, capturesWaiting: -1 }, now).today.toSort).toBe(0);
  });
});
