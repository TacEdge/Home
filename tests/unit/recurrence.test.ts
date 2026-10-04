import { describe, expect, it } from 'vitest';
import {
  defaultWeekdays,
  expandEvent,
  readRRule,
  RecurrenceError,
  skipOccurrence,
  toRRule,
  type EventStart,
  type Recurrence,
  type RecurringEvent,
} from '@/domain/engines/recurrence';
import { wallClockOf } from '@/lib/dates';

// The recurrence engine (M3 contract §5, ADR 0006 §3). NZ 2026: daylight
// saving ends Sunday 5 April and starts Sunday 27 September.

const NZ = 'Pacific/Auckland';
const at = (iso: string) => new Date(iso);
const timed = (
  startsAt: string,
  endsAt: string,
  rrule: string | null,
  exdates: string[] | null = null,
  timeZone = NZ,
): RecurringEvent => ({
  allDay: false,
  startsAt: at(startsAt),
  endsAt: at(endsAt),
  timeZone,
  rrule,
  exdates,
});
const allDay = (
  startDate: string,
  endDate: string,
  rrule: string | null,
  exdates: string[] | null = null,
): RecurringEvent => ({ allDay: true, startDate, endDate, rrule, exdates });
const dates = (os: ReturnType<typeof expandEvent>) => os.map((o) => o.date);
const localTimes = (os: ReturnType<typeof expandEvent>) =>
  os.map((o) => {
    if (o.allDay) return o.date;
    const w = wallClockOf(o.startsAt, o.timeZone);
    return `${o.date} ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
  });

// Swimming: Wednesdays 15:30–16:30 NZ, from 14 Oct 2026 (NZDT).
const swimStart: EventStart = { allDay: false, startsAt: at('2026-10-14T02:30:00Z'), timeZone: NZ };
const dayStart: EventStart = { allDay: true, startDate: '2026-10-14' };

describe('toRRule: the model as RFC 5545', () => {
  const never = { type: 'never' } as const;
  it.each<[Recurrence, string | null]>([
    [{ preset: 'none' }, null],
    [{ preset: 'daily', end: never }, 'FREQ=DAILY'],
    [{ preset: 'weekly', weekdays: [2, 0, 2], end: never }, 'FREQ=WEEKLY;BYDAY=MO,WE'],
    [{ preset: 'fortnightly', weekdays: [2], end: never }, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE'],
    [{ preset: 'monthly', end: never }, 'FREQ=MONTHLY'],
    [{ preset: 'yearly', end: never }, 'FREQ=YEARLY'],
    [{ preset: 'daily', end: { type: 'count', count: 10 } }, 'FREQ=DAILY;COUNT=10'],
  ])('%j → %s', (r, rule) => {
    expect(toRRule(r, swimStart)).toBe(rule);
  });

  it('writes UNTIL as a date for all-day events and as UTC for timed ones (end of that local day)', () => {
    const until = { type: 'until', date: '2026-12-31' } as const;
    expect(toRRule({ preset: 'daily', end: until }, dayStart)).toBe('FREQ=DAILY;UNTIL=20261231');
    // 23:59:59 NZDT on 31 Dec = 10:59:59 UTC.
    expect(toRRule({ preset: 'daily', end: until }, swimStart)).toBe(
      'FREQ=DAILY;UNTIL=20261231T105959Z',
    );
    // In winter (NZST, +12) the same local moment is 11:59:59 UTC.
    expect(
      toRRule(
        { preset: 'daily', end: { type: 'until', date: '2026-07-01' } },
        { ...swimStart, startsAt: at('2026-06-01T03:30:00Z') },
      ),
    ).toBe('FREQ=DAILY;UNTIL=20260701T115959Z');
  });

  it('refuses what is outside the model', () => {
    expect(() =>
      toRRule({ preset: 'weekly', weekdays: [], end: { type: 'never' } }, swimStart),
    ).toThrow(RecurrenceError);
    expect(() =>
      toRRule({ preset: 'weekly', weekdays: [7], end: { type: 'never' } }, swimStart),
    ).toThrow(RecurrenceError);
    expect(() => toRRule({ preset: 'daily', end: { type: 'count', count: 0 } }, swimStart)).toThrow(
      RecurrenceError,
    );
    expect(() =>
      toRRule({ preset: 'daily', end: { type: 'count', count: 1001 } }, swimStart),
    ).toThrow(RecurrenceError);
    expect(() =>
      toRRule({ preset: 'daily', end: { type: 'count', count: 2.5 } }, swimStart),
    ).toThrow(RecurrenceError);
    expect(() =>
      toRRule({ preset: 'daily', end: { type: 'until', date: '2026-10-13' } }, swimStart),
    ).toThrow(RecurrenceError);
    expect(() =>
      toRRule({ preset: 'daily', end: { type: 'until', date: '2026-02-30' } }, swimStart),
    ).toThrow(RecurrenceError);
  });

  it('the default weekday is the start day', () => {
    expect(defaultWeekdays(swimStart)).toEqual([2]);
    expect(defaultWeekdays({ allDay: true, startDate: '2026-10-18' })).toEqual([6]);
  });
});

describe('readRRule: stored rules back into the model', () => {
  const ends = [
    { type: 'never' },
    { type: 'count', count: 6 },
    { type: 'until', date: '2027-03-31' },
  ] as const;
  const presets: Recurrence[] = ends.flatMap((end) => [
    { preset: 'daily', end },
    { preset: 'weekly', weekdays: [0, 2, 4], end },
    { preset: 'fortnightly', weekdays: [2], end },
    { preset: 'monthly', end },
    { preset: 'yearly', end },
  ]);
  it.each(presets)('round-trips %j, timed and all-day', (r) => {
    for (const start of [swimStart, dayStart]) {
      expect(readRRule(toRRule(r, start), start)).toEqual(r);
    }
  });

  it('none for no rule', () => {
    expect(readRRule(null, swimStart)).toEqual({ preset: 'none' });
    expect(readRRule('  ', swimStart)).toEqual({ preset: 'none' });
  });

  it.each([
    'FREQ=MONTHLY;BYDAY=2TU', // the second Tuesday
    'FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR',
    'FREQ=WEEKLY;INTERVAL=3;BYDAY=WE',
    'FREQ=WEEKLY', // no days named
    'FREQ=DAILY;INTERVAL=2',
    'FREQ=MONTHLY;BYMONTHDAY=15',
    'FREQ=DAILY;COUNT=3;UNTIL=20261231',
    'FREQ=HOURLY',
    'FREQ=DAILY;WKST=SU',
    'not a rule',
    'FREQ=DAILY;COUNT=5000',
  ])('anything else is custom and kept as written: %s', (rule) => {
    expect(readRRule(rule, swimStart)).toEqual({ preset: 'custom', rrule: rule });
  });

  it('accepts an RRULE: prefix', () => {
    expect(readRRule('RRULE:FREQ=DAILY', swimStart)).toEqual({
      preset: 'daily',
      end: { type: 'never' },
    });
  });
});

describe('expandEvent: timed, across both NZ DST transitions', () => {
  it('a one-off event is its own single occurrence, inside the range only', () => {
    const e = timed('2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z', null);
    expect(dates(expandEvent(e, '2026-10-01', '2026-10-31'))).toEqual(['2026-10-14']);
    expect(expandEvent(e, '2026-10-15', '2026-10-31')).toEqual([]);
    expect(expandEvent(e, '2026-10-31', '2026-10-01')).toEqual([]);
  });

  it('weekly keeps 15:30 local across spring forward; the UTC time moves by an hour', () => {
    const e = timed('2026-09-16T03:30:00Z', '2026-09-16T04:30:00Z', 'FREQ=WEEKLY;BYDAY=WE');
    const os = expandEvent(e, '2026-09-16', '2026-10-07');
    expect(localTimes(os)).toEqual([
      '2026-09-16 15:30',
      '2026-09-23 15:30',
      '2026-09-30 15:30',
      '2026-10-07 15:30',
    ]);
    expect(os.map((o) => (o.allDay ? '' : o.startsAt.toISOString()))).toEqual([
      '2026-09-16T03:30:00.000Z',
      '2026-09-23T03:30:00.000Z',
      '2026-09-30T02:30:00.000Z',
      '2026-10-07T02:30:00.000Z',
    ]);
    // Each is still an hour long.
    for (const o of os)
      if (!o.allDay) expect(o.endsAt.getTime() - o.startsAt.getTime()).toBe(3600_000);
  });

  it('weekly keeps 15:30 local across fall back', () => {
    const e = timed('2026-03-25T02:30:00Z', '2026-03-25T03:30:00Z', 'FREQ=WEEKLY;BYDAY=WE');
    const os = expandEvent(e, '2026-03-25', '2026-04-15');
    expect(localTimes(os)).toEqual([
      '2026-03-25 15:30',
      '2026-04-01 15:30',
      '2026-04-08 15:30',
      '2026-04-15 15:30',
    ]);
    const last = os.at(-1)!;
    expect(last.allDay ? null : last.startsAt.toISOString()).toBe('2026-04-15T03:30:00.000Z');
  });

  it('daily at 02:30: the skipped hour on 27 September moves forward to 03:30, keeping its length', () => {
    const e = timed('2026-09-25T14:30:00Z', '2026-09-25T15:00:00Z', 'FREQ=DAILY'); // 02:30 NZST on the 26th
    const os = expandEvent(e, '2026-09-26', '2026-09-28');
    expect(localTimes(os)).toEqual(['2026-09-26 02:30', '2026-09-27 03:30', '2026-09-28 02:30']);
    for (const o of os)
      if (!o.allDay) expect(o.endsAt.getTime() - o.startsAt.getTime()).toBe(1800_000);
  });

  it('daily at 02:30: the repeated hour on 5 April takes its first instance', () => {
    const e = timed('2026-04-03T13:30:00Z', '2026-04-03T14:00:00Z', 'FREQ=DAILY'); // 02:30 NZDT on the 4th
    const os = expandEvent(e, '2026-04-04', '2026-04-06');
    expect(dates(os)).toEqual(['2026-04-04', '2026-04-05', '2026-04-06']);
    expect(os.map((o) => (o.allDay ? '' : o.startsAt.toISOString()))).toEqual([
      '2026-04-03T13:30:00.000Z',
      '2026-04-04T13:30:00.000Z', // 02:30 NZDT, the first of the two
      '2026-04-05T14:30:00.000Z', // 02:30 NZST
    ]);
  });

  it('fortnightly on chosen days', () => {
    const e = timed(
      '2026-10-14T02:30:00Z',
      '2026-10-14T03:30:00Z',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,FR',
    );
    expect(dates(expandEvent(e, '2026-10-01', '2026-11-13'))).toEqual([
      '2026-10-14',
      '2026-10-16',
      '2026-10-28',
      '2026-10-30',
      '2026-11-11',
      '2026-11-13',
    ]);
  });

  it('UNTIL is inclusive of its whole local day, then stops', () => {
    // An evening event at 20:00 NZDT: its last day is the UNTIL day.
    const e = timed(
      '2026-10-14T07:00:00Z',
      '2026-10-14T08:00:00Z',
      toRRule(
        { preset: 'daily', end: { type: 'until', date: '2026-10-17' } },
        {
          allDay: false,
          startsAt: at('2026-10-14T07:00:00Z'),
          timeZone: NZ,
        },
      ),
    );
    expect(dates(expandEvent(e, '2026-10-01', '2026-10-31'))).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
    ]);
  });

  it('COUNT counts from the first occurrence; exdates then remove some (RFC 5545)', () => {
    const e = timed(
      '2026-10-14T02:30:00Z',
      '2026-10-14T03:30:00Z',
      'FREQ=WEEKLY;BYDAY=WE;COUNT=4',
      ['2026-10-21'],
    );
    expect(dates(expandEvent(e, '2026-10-01', '2027-12-31'))).toEqual([
      '2026-10-14',
      '2026-10-28',
      '2026-11-04',
    ]);
    // A range that starts later still counts from the first.
    expect(dates(expandEvent(e, '2026-11-01', '2027-12-31'))).toEqual(['2026-11-04']);
  });

  it('exdates as a date, an RFC compact date or the exact instant; anything else is ignored', () => {
    const e = timed('2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z', 'FREQ=WEEKLY;BYDAY=WE', [
      '2026-10-21',
      '20261028',
      '2026-11-04T02:30:00Z',
      '2026-11-11T09:00:00Z', // not when it starts: no effect
      'next week',
    ]);
    expect(dates(expandEvent(e, '2026-10-14', '2026-11-18'))).toEqual([
      '2026-10-14',
      '2026-11-11',
      '2026-11-18',
    ]);
  });

  it('expands in the event’s own zone (New York, across 1 November 2026)', () => {
    const e = timed(
      '2026-10-25T13:00:00Z', // 09:00 EDT
      '2026-10-25T14:00:00Z',
      'FREQ=WEEKLY;BYDAY=SU',
      null,
      'America/New_York',
    );
    const os = expandEvent(e, '2026-10-25', '2026-11-08');
    expect(localTimes(os)).toEqual(['2026-10-25 09:00', '2026-11-01 09:00', '2026-11-08 09:00']);
    expect(os.map((o) => (o.allDay ? '' : o.startsAt.toISOString()))).toEqual([
      '2026-10-25T13:00:00.000Z',
      '2026-11-01T14:00:00.000Z',
      '2026-11-08T14:00:00.000Z',
    ]);
  });

  it('a late-evening event belongs to its local date, not its UTC date', () => {
    const e = timed('2026-10-14T10:30:00Z', '2026-10-14T11:00:00Z', 'FREQ=DAILY;COUNT=2'); // 23:30 NZDT
    expect(dates(expandEvent(e, '2026-10-14', '2026-10-15'))).toEqual(['2026-10-14', '2026-10-15']);
  });

  it('a rule HOME cannot read yields only the first occurrence, never a guess', () => {
    const e = timed('2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z', 'FREQ=FORTNIGHTLY');
    expect(dates(expandEvent(e, '2026-10-01', '2026-12-31'))).toEqual(['2026-10-14']);
  });

  it('a custom rule from elsewhere is still expanded, in local time', () => {
    const e = timed(
      '2026-10-30T07:00:00Z',
      '2026-10-30T08:00:00Z',
      'FREQ=MONTHLY;BYDAY=-1FR;COUNT=3',
    ); // last Friday 20:00
    expect(localTimes(expandEvent(e, '2026-10-01', '2027-12-31'))).toEqual([
      '2026-10-30 20:00',
      '2026-11-27 20:00',
      '2026-12-25 20:00',
    ]);
  });
});

describe('expandEvent: all-day', () => {
  it('daily all-day dates are consecutive across DST, never shifted', () => {
    const e = allDay('2026-09-25', '2026-09-26', 'FREQ=DAILY;COUNT=5');
    expect(dates(expandEvent(e, '2026-09-01', '2026-10-31'))).toEqual([
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
    ]);
    const autumn = allDay('2026-04-03', '2026-04-04', 'FREQ=DAILY;COUNT=4');
    expect(dates(expandEvent(autumn, '2026-04-01', '2026-04-30'))).toEqual([
      '2026-04-03',
      '2026-04-04',
      '2026-04-05',
      '2026-04-06',
    ]);
  });

  it('keeps a multi-day length (end exclusive)', () => {
    const e = allDay('2026-10-16', '2026-10-19', 'FREQ=MONTHLY;COUNT=2');
    expect(expandEvent(e, '2026-10-01', '2026-12-31')).toEqual([
      { allDay: true, date: '2026-10-16', startDate: '2026-10-16', endDate: '2026-10-19' },
      { allDay: true, date: '2026-11-16', startDate: '2026-11-16', endDate: '2026-11-19' },
    ]);
  });

  it('monthly on the 31st skips months without one (RFC 5545)', () => {
    const e = allDay('2026-01-31', '2026-02-01', 'FREQ=MONTHLY;COUNT=5');
    expect(dates(expandEvent(e, '2026-01-01', '2026-12-31'))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
      '2026-08-31',
    ]);
    const thirtieth = allDay('2026-01-30', '2026-01-31', 'FREQ=MONTHLY;COUNT=3');
    expect(dates(expandEvent(thirtieth, '2026-01-01', '2026-12-31'))).toEqual([
      '2026-01-30',
      '2026-03-30',
      '2026-04-30',
    ]);
  });

  it('yearly on 29 February occurs only in leap years', () => {
    const e = allDay('2028-02-29', '2028-03-01', 'FREQ=YEARLY;COUNT=3');
    expect(dates(expandEvent(e, '2028-01-01', '2040-12-31'))).toEqual([
      '2028-02-29',
      '2032-02-29',
      '2036-02-29',
    ]);
  });

  it('UNTIL as a date is inclusive', () => {
    const e = allDay('2026-10-14', '2026-10-15', 'FREQ=WEEKLY;BYDAY=WE;UNTIL=20261028');
    expect(dates(expandEvent(e, '2026-10-01', '2026-12-31'))).toEqual([
      '2026-10-14',
      '2026-10-21',
      '2026-10-28',
    ]);
  });

  it('range boundaries are inclusive; exdates skip by date', () => {
    const e = allDay('2026-10-12', '2026-10-13', 'FREQ=DAILY', ['2026-10-14']);
    expect(dates(expandEvent(e, '2026-10-13', '2026-10-15'))).toEqual(['2026-10-13', '2026-10-15']);
    expect(expandEvent(e, '2026-10-01', '2026-10-11')).toEqual([]);
  });
});

describe('skipOccurrence', () => {
  it('adds a date once, in order, keeping what was there', () => {
    expect(skipOccurrence(null, '2026-10-21')).toEqual(['2026-10-21']);
    expect(skipOccurrence(['2026-10-28', '2026-10-21'], '2026-10-21')).toEqual([
      '2026-10-21',
      '2026-10-28',
    ]);
    expect(skipOccurrence(['2026-11-04T02:30:00Z'], '2026-10-21')).toEqual([
      '2026-10-21',
      '2026-11-04T02:30:00Z',
    ]);
    expect(() => skipOccurrence(null, '2026-02-30')).toThrow(RecurrenceError);
  });
  it('a skipped date disappears from the expansion', () => {
    const e = allDay('2026-10-14', '2026-10-15', 'FREQ=WEEKLY;BYDAY=WE');
    const skipped = { ...e, exdates: skipOccurrence(e.exdates, '2026-10-21') };
    expect(dates(expandEvent(skipped, '2026-10-14', '2026-10-28'))).toEqual([
      '2026-10-14',
      '2026-10-28',
    ]);
  });
});

describe('every preset, timed and all-day, across both transitions (model → rule → expansion)', () => {
  const winter: EventStart = { allDay: false, startsAt: at('2026-09-23T03:30:00Z'), timeZone: NZ }; // Wed 15:30 NZST
  const summer: EventStart = { allDay: false, startsAt: at('2026-03-25T02:30:00Z'), timeZone: NZ }; // Wed 15:30 NZDT
  const cases: [string, Recurrence][] = [
    ['daily', { preset: 'daily', end: { type: 'count', count: 10 } }],
    ['weekly', { preset: 'weekly', weekdays: [2], end: { type: 'count', count: 3 } }],
    ['fortnightly', { preset: 'fortnightly', weekdays: [2], end: { type: 'count', count: 3 } }],
    ['monthly', { preset: 'monthly', end: { type: 'count', count: 2 } }],
    ['yearly', { preset: 'yearly', end: { type: 'count', count: 2 } }],
  ];
  it.each(cases)('%s keeps 15:30 local on both sides of each transition', (_name, r) => {
    for (const start of [winter, summer]) {
      if (start.allDay) continue;
      const e = timed(
        start.startsAt.toISOString(),
        new Date(start.startsAt.getTime() + 3600_000).toISOString(),
        toRRule(r, start),
      );
      const os = expandEvent(e, '2026-01-01', '2028-12-31');
      expect(os.length).toBeGreaterThan(1);
      for (const o of os) {
        if (o.allDay) throw new Error('timed expected');
        const w = wallClockOf(o.startsAt, NZ);
        expect([w.hour, w.minute]).toEqual([15, 30]);
      }
    }
  });
  it.each(cases)('%s all-day stays on dates', (_name, r) => {
    const start: EventStart = { allDay: true, startDate: '2026-09-23' };
    const e = allDay('2026-09-23', '2026-09-24', toRRule(r, start));
    const os = expandEvent(e, '2026-01-01', '2028-12-31');
    expect(os.length).toBeGreaterThan(1);
    expect(os[0]!.date).toBe('2026-09-23');
    for (const o of os) expect(o.allDay && o.endDate > o.startDate).toBe(true);
  });
});
