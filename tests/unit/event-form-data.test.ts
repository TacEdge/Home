import { describe, expect, it } from 'vitest';
import { FormFieldError } from '@/app/_forms/errors';
import { KIND_LABEL, repeatLabel, whenLabel } from '@/app/(home)/events/copy';
import { readEventForm, recurrenceFields } from '@/app/(home)/events/event-form-data';
import { createEventInput, updateEventInput } from '@/domain/events/schema';
import type { Event } from '@/domain/events/service';
import { readRRule } from '@/domain/engines/recurrence';

// The event form reader (M3 contract §3.6, §4.1): times in the home zone
// into instants, an inclusive end date into the stored exclusive one, the
// recurrence controls into the engine's model, and people by their ids.

const NZ = 'Pacific/Auckland';
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const base = { title: 'Swimming', kind: 'activity', allDay_present: '1', startDate: '2026-10-14' };
const people = ['p-milo', 'p-sam'];
const refusal = (f: FormData) => {
  try {
    readEventForm(f, { timeZone: NZ, peopleIds: people });
  } catch (e) {
    if (e instanceof FormFieldError) return e.fields;
    throw e;
  }
  return null;
};

describe('readEventForm: time', () => {
  it('a timed event: date and times in the home zone become UTC instants', () => {
    const { input } = readEventForm(form({ ...base, startTime: '15:30', endTime: '16:15' }), {
      timeZone: NZ,
      peopleIds: people,
    });
    expect(createEventInput.parse(input).time).toEqual({
      allDay: false,
      startsAt: new Date('2026-10-14T02:30:00.000Z'),
      endsAt: new Date('2026-10-14T03:15:00.000Z'),
      timeZone: NZ,
    });
  });

  it('runs past midnight when an end date is given', () => {
    const { input } = readEventForm(
      form({ ...base, startTime: '22:00', endDate: '2026-10-15', endTime: '01:00' }),
      { timeZone: NZ, peopleIds: people },
    );
    const t = createEventInput.parse(input).time;
    expect(t.allDay === false && t.endsAt.toISOString()).toBe('2026-10-14T12:00:00.000Z');
  });

  it('an all-day event: the shown last day is inclusive, stored exclusive', () => {
    const one = readEventForm(form({ ...base, allDay: 'on' }), { timeZone: NZ, peopleIds: people });
    expect(createEventInput.parse(one.input).time).toEqual({
      allDay: true,
      startDate: '2026-10-14',
      endDate: '2026-10-15',
    });
    const span = readEventForm(form({ ...base, allDay: 'on', endDate: '2026-10-16' }), {
      timeZone: NZ,
      peopleIds: people,
    });
    expect(createEventInput.parse(span.input).time).toMatchObject({ endDate: '2026-10-17' });
  });

  it('an existing event keeps its own zone', () => {
    const current = { timeZone: 'Australia/Sydney' } as Event;
    const { input } = readEventForm(form({ ...base, startTime: '09:00', endTime: '10:00' }), {
      timeZone: NZ,
      peopleIds: people,
      current,
    });
    expect(updateEventInput.parse(input).time).toMatchObject({
      timeZone: 'Australia/Sydney',
      startsAt: new Date('2026-10-13T22:00:00.000Z'),
    });
  });

  it('refuses a bad date, a bad time and an end before the start, naming the field', () => {
    expect(
      refusal(form({ ...base, startDate: '2026-02-30', startTime: '09:00', endTime: '10:00' })),
    ).toEqual({
      startDate: 'This needs a real date.',
    });
    expect(refusal(form({ ...base, startTime: '9am', endTime: '10:00' }))).toEqual({
      startTime: 'This needs a time, like 15:30.',
    });
    expect(refusal(form({ ...base, startTime: '10:00', endTime: '09:00' }))).toEqual({
      endTime: 'The end is before the start.',
    });
    expect(refusal(form({ ...base, allDay: 'on', endDate: '2026-10-01' }))).toEqual({
      endDate: 'The end is before the start.',
    });
  });
});

describe('readEventForm: recurrence', () => {
  const timed = { ...base, startTime: '15:30', endTime: '16:15' };
  const rule = (extra: Record<string, string>) =>
    (
      readEventForm(form({ ...timed, ...extra }), { timeZone: NZ, peopleIds: people }).input as {
        rrule?: string | null;
      }
    ).rrule;

  it('none clears the rule and the skipped dates; no control leaves them alone', () => {
    const none = readEventForm(form({ ...timed, repeat: 'none' }), {
      timeZone: NZ,
      peopleIds: people,
    }).input;
    expect(none).toMatchObject({ rrule: null, exdates: null });
    const untouched = readEventForm(form(timed), { timeZone: NZ, peopleIds: people }).input;
    expect('rrule' in untouched).toBe(false);
    const custom = readEventForm(form({ ...timed, repeat: 'custom' }), {
      timeZone: NZ,
      peopleIds: people,
    }).input;
    expect('rrule' in custom).toBe(false);
  });

  it.each([
    [{ repeat: 'daily' }, 'FREQ=DAILY'],
    [{ repeat: 'weekly', weekdays_0: 'on', weekdays_2: 'on' }, 'FREQ=WEEKLY;BYDAY=MO,WE'],
    [{ repeat: 'fortnightly', weekdays_2: 'on' }, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE'],
    [{ repeat: 'monthly' }, 'FREQ=MONTHLY'],
    [{ repeat: 'yearly' }, 'FREQ=YEARLY'],
    [{ repeat: 'daily', ends: 'after', endsAfter: '4' }, 'FREQ=DAILY;COUNT=4'],
    [
      { repeat: 'weekly', weekdays_2: 'on', ends: 'on', endsOn: '2026-12-31' },
      'FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T105959Z',
    ],
  ])('%j → %s', (extra, expected) => {
    expect(rule(extra)).toBe(expected);
  });

  it('refuses what the model cannot say, naming the control', () => {
    expect(refusal(form({ ...timed, repeat: 'weekly' }))).toEqual({
      weekdays: 'Pick at least one day.',
    });
    expect(refusal(form({ ...timed, repeat: 'daily', ends: 'on', endsOn: '' }))).toEqual({
      endsOn: 'This needs a real date.',
    });
    expect(refusal(form({ ...timed, repeat: 'daily', ends: 'on', endsOn: '2026-10-01' }))).toEqual({
      endsOn: 'That’s before the first one.',
    });
    expect(refusal(form({ ...timed, repeat: 'daily', ends: 'after', endsAfter: '0' }))).toEqual({
      endsAfter: 'How many times? A whole number, 1 or more.',
    });
    expect(
      refusal(form({ ...timed, repeat: 'daily', ends: 'after', endsAfter: '5000' })),
    ).toMatchObject({ endsAfter: expect.stringContaining('1000') });
    expect(refusal(form({ ...timed, repeat: 'hourly' }))).toEqual({
      repeat: 'That doesn’t look right.',
    });
  });
});

describe('readEventForm: people', () => {
  it('reads only the offered people, in both roles', () => {
    const { people: chosen } = readEventForm(
      form({
        ...base,
        allDay: 'on',
        'attending_p-milo': 'on',
        'responsible_p-sam': 'on',
        'attending_p-stranger': 'on',
      }),
      { timeZone: NZ, peopleIds: people },
    );
    expect(chosen).toEqual([
      { personId: 'p-milo', role: 'attending' },
      { personId: 'p-sam', role: 'responsible' },
    ]);
  });
});

describe('recurrenceFields and the labels', () => {
  const timed = {
    allDay: false,
    startsAt: new Date('2026-10-14T02:30:00Z'),
    endsAt: new Date('2026-10-14T03:15:00Z'),
    timeZone: NZ,
    startDate: null,
    endDate: null,
  } as Event;

  it('reads a stored rule into the controls', () => {
    expect(
      recurrenceFields({ ...timed, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6' }),
    ).toMatchObject({
      repeat: 'fortnightly',
      weekdays: new Set(['0', '2']),
      ends: 'after',
      endsAfter: '6',
    });
    expect(
      recurrenceFields({ ...timed, rrule: 'FREQ=DAILY;UNTIL=20261231T105959Z' }),
    ).toMatchObject({ ends: 'on', endsOn: '2026-12-31' });
    expect(recurrenceFields({ ...timed, rrule: null })).toMatchObject({
      repeat: 'none',
      ends: 'never',
    });
    expect(recurrenceFields({ ...timed, rrule: 'FREQ=MONTHLY;BYDAY=2TU' })).toMatchObject({
      repeat: 'custom',
    });
  });

  it('says how an event repeats, in words', () => {
    const start = { allDay: false as const, startsAt: timed.startsAt!, timeZone: NZ };
    const say = (r: string | null) => repeatLabel(readRRule(r, start), '2026-10-14');
    expect(say(null)).toBeNull();
    expect(say('FREQ=DAILY')).toBe('Every day');
    expect(say('FREQ=WEEKLY;BYDAY=WE')).toBe('Every Wednesday');
    expect(say('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR')).toBe(
      'Every fortnight on Monday, Wednesday and Friday',
    );
    expect(say('FREQ=MONTHLY')).toBe('Every month on the 14th');
    expect(
      repeatLabel(
        readRRule('FREQ=MONTHLY', { allDay: true, startDate: '2026-01-31' }),
        '2026-01-31',
      ),
    ).toBe('Every month on the 31st (skipping shorter months)');
    expect(say('FREQ=YEARLY')).toBe('Every year on 14 Oct');
    expect(say('FREQ=WEEKLY;BYDAY=WE;COUNT=4')).toBe('Every Wednesday, 4 times');
    expect(say('FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T105959Z')).toBe(
      'Every Wednesday, until 31 Dec',
    );
    expect(say('FREQ=MONTHLY;BYDAY=2TU')).toBe('Repeats (custom)');
  });

  it('says when, for timed and all-day events', () => {
    expect(whenLabel(timed)).toBe('Wednesday 14 October · 15:30–16:15');
    expect(whenLabel({ ...timed, endsAt: new Date('2026-10-14T12:00:00Z') })).toBe(
      'Wednesday 14 October 15:30 to Thursday 15 October 01:00',
    );
    const day = {
      allDay: true,
      startDate: '2026-10-20',
      endDate: '2026-10-21',
      startsAt: null,
      endsAt: null,
      timeZone: null,
    } as Event;
    expect(whenLabel(day)).toBe('Tuesday 20 October');
    expect(whenLabel({ ...day, endDate: '2026-10-23' })).toBe(
      'Tuesday 20 October to Thursday 22 October',
    );
    expect(KIND_LABEL.activity).toBe('Activity');
  });
});
