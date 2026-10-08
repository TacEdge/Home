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
    expect(r.headline).toMatchObject({ rule: 'headline.evening', text: 'Nothing else on today.' });
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
