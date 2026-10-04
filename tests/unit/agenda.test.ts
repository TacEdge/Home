import { describe, expect, it } from 'vitest';
import {
  agenda,
  agendaDay,
  compareAgendaItems,
  forPerson,
  MAX_AGENDA_DAYS,
  type AgendaEventInput,
  type AgendaItem,
} from '@/domain/engines/agenda';
import { expandEvent } from '@/domain/engines/recurrence';
import { addDays } from '@/lib/dates';

// The agenda engine (M3 contract §5): deterministic dated items for Today,
// Forward and Coming up, in the approved order (ADR 0005 §27).

const NZ = 'Pacific/Auckland';
const timed = (
  id: string,
  title: string,
  startsAt: string,
  endsAt: string,
  rrule: string | null = null,
  extra: Partial<AgendaEventInput> = {},
): AgendaEventInput =>
  ({
    id,
    title,
    allDay: false,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    timeZone: NZ,
    rrule,
    exdates: null,
    ...extra,
  }) as AgendaEventInput;
const allDay = (
  id: string,
  title: string,
  startDate: string,
  endDate: string,
  rrule: string | null = null,
  extra: Partial<AgendaEventInput> = {},
): AgendaEventInput =>
  ({
    id,
    title,
    allDay: true,
    startDate,
    endDate,
    rrule,
    exdates: null,
    ...extra,
  }) as AgendaEventInput;
const label = (i: AgendaItem) =>
  i.kind === 'event'
    ? `${i.allDay ? 'allday' : 'timed'}:${i.title}`
    : i.kind === 'birthday'
      ? `birthday:${i.name}`
      : `${i.kind}:${i.title}`;

// Wednesday 14 October 2026, the fixture scenario day.
const DAY = '2026-10-14';
const sample = {
  timeZone: NZ,
  events: [
    timed(
      'e-swim',
      'Swimming',
      '2026-10-14T02:30:00Z',
      '2026-10-14T03:30:00Z',
      'FREQ=WEEKLY;BYDAY=WE',
      {
        people: [
          { personId: 'p-milo', role: 'attending' },
          { personId: 'p-sam', role: 'responsible' },
        ],
      },
    ),
    timed('e-dentist', 'Dentist', '2026-10-13T20:00:00Z', '2026-10-13T20:30:00Z'), // 09:00 on the 14th
    allDay('e-teacher', 'Teacher only day', DAY, '2026-10-15'),
    allDay('e-camp', 'Camp', '2026-10-13', '2026-10-16'), // 13–15 Oct
  ],
  people: [
    { id: 'p-milo', name: 'Milo', dateOfBirth: '2017-10-14' },
    { id: 'p-nana', name: 'Nana Jo', dateOfBirth: '1958-10-20' },
    { id: 'p-none', name: 'No date', dateOfBirth: null },
  ],
  tasks: [
    { id: 't-1', title: 'Book the WOF', status: 'open', dueDate: DAY },
    { id: 't-2', title: 'Done already', status: 'done', dueDate: DAY },
    { id: 't-3', title: 'Dropped', status: 'dropped', dueDate: DAY },
    { id: 't-4', title: 'No date', status: 'open', dueDate: null },
  ],
  projects: [
    { id: 'pr-1', title: 'Back fence', status: 'active', targetDate: DAY },
    { id: 'pr-2', title: 'Garage', status: 'done', targetDate: DAY },
  ],
};

describe('one day, in the approved order', () => {
  it('all-day items first (events, birthdays, project targets, tasks), then timed by start', () => {
    expect(agendaDay({ ...sample, date: DAY }).map(label)).toEqual([
      'allday:Camp',
      'allday:Teacher only day',
      'birthday:Milo',
      'project_target:Back fence',
      'task_due:Book the WOF',
      'timed:Dentist',
      'timed:Swimming',
    ]);
  });

  it('the order never depends on the order of the inputs', () => {
    const reversed = {
      ...sample,
      events: [...sample.events].reverse(),
      people: [...sample.people].reverse(),
      tasks: [...sample.tasks].reverse(),
      projects: [...sample.projects].reverse(),
    };
    expect(agendaDay({ ...reversed, date: DAY })).toEqual(agendaDay({ ...sample, date: DAY }));
  });

  it('ties break by title, then id', () => {
    const a = timed('b', 'Same', '2026-10-14T02:30:00Z', '2026-10-14T03:00:00Z');
    const b = timed('a', 'Same', '2026-10-14T02:30:00Z', '2026-10-14T03:00:00Z');
    const items = agendaDay({ timeZone: NZ, date: DAY, events: [a, b] });
    expect(items.map((i) => (i.kind === 'event' ? i.eventId : ''))).toEqual(['a', 'b']);
    expect([...items].sort(compareAgendaItems)).toEqual(items);
  });

  it('only open tasks and unfinished projects; the birthday carries the age reached', () => {
    const items = agendaDay({ ...sample, date: DAY });
    expect(items.filter((i) => i.kind === 'task_due')).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'project_target')).toHaveLength(1);
    expect(items.find((i) => i.kind === 'birthday')).toMatchObject({ name: 'Milo', age: 9 });
  });

  it('a timed occurrence carries its own times and people; Swimming is 15:30 NZDT', () => {
    const swim = agendaDay({ ...sample, date: DAY }).find(
      (i) => i.kind === 'event' && i.title === 'Swimming',
    );
    expect(swim).toMatchObject({
      allDay: false,
      occurrenceDate: DAY,
      startsAt: new Date('2026-10-14T02:30:00Z'),
      endsAt: new Date('2026-10-14T03:30:00Z'),
      people: [
        { personId: 'p-milo', role: 'attending' },
        { personId: 'p-sam', role: 'responsible' },
      ],
    });
  });
});

describe('a range of days', () => {
  it('leaves empty days out and lists days in order', () => {
    const days = agenda({ ...sample, from: '2026-10-12', to: '2026-10-21' });
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-20',
      '2026-10-21',
    ]);
  });

  it('an all-day event appears on every day it covers, with its day of the span', () => {
    const days = agenda({
      timeZone: NZ,
      from: '2026-10-14',
      to: '2026-10-20',
      events: [sample.events[3]!],
    });
    expect(
      days.map((d) => [
        d.date,
        d.items.map((i) => (i.kind === 'event' && i.allDay ? `${i.day}/${i.days}` : '')),
      ]),
    ).toEqual([
      ['2026-10-14', ['2/3']], // it began on the 13th, before the range
      ['2026-10-15', ['3/3']],
    ]);
  });

  it('a timed event is placed on the day it starts in the home zone', () => {
    // 20:00 UTC on the 14th is 09:00 on the 15th in Auckland.
    const e = timed('e-x', 'Call', '2026-10-14T20:00:00Z', '2026-10-14T20:30:00Z', null, {
      timeZone: 'UTC',
    } as Partial<AgendaEventInput>);
    expect(
      agenda({ timeZone: NZ, from: '2026-10-14', to: '2026-10-15', events: [e] }).map(
        (d) => d.date,
      ),
    ).toEqual(['2026-10-15']);
    expect(
      agenda({ timeZone: 'UTC', from: '2026-10-14', to: '2026-10-15', events: [e] }).map(
        (d) => d.date,
      ),
    ).toEqual(['2026-10-14']);
  });

  it('agrees with the recurrence engine occurrence for occurrence', () => {
    const swim = sample.events[0]!;
    const fromAgenda = agenda({
      timeZone: NZ,
      from: '2026-09-01',
      to: '2026-11-30',
      events: [swim],
    })
      .flatMap((d) => d.items)
      .map((i) => (i.kind === 'event' && !i.allDay ? i.startsAt.toISOString() : ''));
    const fromEngine = expandEvent(swim, '2026-09-01', '2026-11-30').map((o) =>
      o.allDay ? '' : o.startsAt.toISOString(),
    );
    expect(fromAgenda).toEqual(fromEngine);
  });

  it('skipped occurrences are absent', () => {
    const swim = { ...sample.events[0]!, exdates: ['2026-10-21'] } as AgendaEventInput;
    const dates = agenda({
      timeZone: NZ,
      from: '2026-10-14',
      to: '2026-10-28',
      events: [swim],
    }).map((d) => d.date);
    expect(dates).toEqual(['2026-10-14', '2026-10-28']);
  });

  it('birthdays across a year end, including 29 February in common years', () => {
    const people = [
      { id: 'p-leap', name: 'Leap', dateOfBirth: '2020-02-29' },
      { id: 'p-ny', name: 'New Year', dateOfBirth: '2010-01-01' },
      { id: 'p-unborn', name: 'Not yet', dateOfBirth: '2027-06-01' },
    ];
    const lines = (from: string, to: string) =>
      agenda({ timeZone: NZ, from, to, people }).flatMap((d) =>
        d.items.map((i) => `${d.date} ${label(i)} ${i.kind === 'birthday' ? i.age : ''}`),
      );
    expect(lines('2026-12-01', '2027-03-31')).toEqual([
      '2027-01-01 birthday:New Year 17',
      '2027-02-28 birthday:Leap 7', // P-4: 28 February in a common year
    ]);
    expect(lines('2027-12-01', '2028-06-30')).toEqual([
      '2028-01-01 birthday:New Year 18',
      '2028-02-29 birthday:Leap 8',
      '2028-06-01 birthday:Not yet 1', // none before the first birthday
    ]);
  });

  it('refuses a range longer than it expands, and returns nothing for a reversed one', () => {
    expect(() =>
      agenda({ timeZone: NZ, from: '2026-01-01', to: addDays('2026-01-01', MAX_AGENDA_DAYS + 1) }),
    ).toThrow(RangeError);
    expect(agenda({ timeZone: NZ, from: '2026-10-14', to: '2026-10-13' })).toEqual([]);
    expect(() => agenda({ timeZone: NZ, from: '2026-02-30', to: '2026-03-01' })).toThrow(
      RangeError,
    );
  });

  it('a whole DST weekend in order', () => {
    const e = timed(
      'e-early',
      'Early',
      '2026-09-25T14:30:00Z',
      '2026-09-25T15:00:00Z',
      'FREQ=DAILY',
    ); // 02:30 NZST
    const days = agenda({ timeZone: NZ, from: '2026-09-26', to: '2026-09-28', events: [e] });
    expect(days.map((d) => d.date)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28']);
  });
});

describe('forPerson', () => {
  it('keeps the person’s events (any role) and their birthday', () => {
    const days = agenda({ ...sample, from: '2026-10-14', to: '2026-10-21' });
    const sam = forPerson(days, 'p-sam').flatMap((d) => d.items.map(label));
    expect(sam).toEqual(['timed:Swimming', 'timed:Swimming']);
    const milo = forPerson(days, 'p-milo').flatMap((d) => d.items.map(label));
    expect(milo).toEqual(['birthday:Milo', 'timed:Swimming', 'timed:Swimming']);
    expect(forPerson(days, 'p-nobody')).toEqual([]);
  });
});
