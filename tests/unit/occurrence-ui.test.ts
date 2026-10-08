import { describe, expect, it } from 'vitest';
import { readOccurrenceForm } from '@/app/(home)/events/event-form-data';
import { occurrenceDefaults } from '@/app/(home)/events/form-defaults';
import {
  backToSeriesQuestion,
  changedFromUsual,
  occurrenceWhen,
  putAwayDetail,
  putAwayLine,
  usuallyLine,
} from '@/app/(home)/events/copy';
import { expandEvent } from '@/domain/engines/recurrence';
import {
  nextTimes,
  originalDateOf,
  putAwayChanges,
  putAwayStatus,
  recurringOf,
} from '@/domain/events/occurrences';
import type { Event } from '@/domain/events/service';

// Package 8b (M4 contract §5.3): what the series' page composes for its
// next few times (one-off changes in place of what they replace, once), the
// changes it lists as put away, the "Change this one" form's reading and
// prefill, and the words. Synthetic only.

const NZ = 'Pacific/Auckland';
const row = (id: string, startsAt: string, extra: Partial<Event> = {}): Event =>
  ({
    id,
    title: 'Swimming',
    source: 'manual',
    allDay: false,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 45 * 60_000),
    timeZone: NZ,
    startDate: null,
    endDate: null,
    rrule: null,
    exdates: null,
    calendarSourceId: null,
    externalUid: null,
    recurrenceParentId: null,
    recurrenceOriginal: null,
    archivedAt: null,
    ...extra,
  }) as unknown as Event;
const swim = row('swim', '2026-10-14T02:30:00Z', { rrule: 'FREQ=WEEKLY;BYDAY=WE' });
const WED_21 = '2026-10-21T02:30:00Z';
const WED_28 = '2026-10-28T02:30:00Z';
const change = (id: string, original: string, startsAt: string, extra: Partial<Event> = {}) =>
  row(id, startsAt, { recurrenceParentId: swim.id, recurrenceOriginal: original, ...extra });

const show = (times: ReturnType<typeof nextTimes>) =>
  times.map((t) =>
    t.kind === 'changed'
      ? `changed ${t.change.id} ${t.occurrence.allDay ? t.occurrence.date : t.occurrence.startsAt.toISOString()}`
      : `regular ${t.identity}`,
  );

describe('the next few times of a manual series', () => {
  it('without changes: the rule’s occurrences, each with its identity', () => {
    expect(show(nextTimes(swim, [], '2026-10-14', '2026-10-28', NZ))).toEqual([
      'regular 2026-10-14T02:30:00Z',
      `regular ${WED_21}`,
      `regular ${WED_28}`,
    ]);
  });

  it('a change replaces its original, once, at its own time; moved to another day it sorts there', () => {
    const later = change('later', WED_21, '2026-10-21T04:00:00Z');
    const friday = change('fri', WED_28, '2026-10-30T02:30:00Z');
    expect(show(nextTimes(swim, [later, friday], '2026-10-14', '2026-11-04', NZ))).toEqual([
      'regular 2026-10-14T02:30:00Z',
      'changed later 2026-10-21T04:00:00.000Z',
      'changed fri 2026-10-30T02:30:00.000Z',
      'regular 2026-11-04T02:30:00Z',
    ]);
  });

  it('a put-away change replaces nothing; the original shows again', () => {
    const gone = change('gone', WED_21, '2026-10-21T04:00:00Z', { archivedAt: new Date() });
    expect(show(nextTimes(swim, [gone], '2026-10-21', '2026-10-21', NZ))).toEqual([
      `regular ${WED_21}`,
    ]);
  });

  it('a change moved out of the window, or into it from outside, is placed by its own date', () => {
    const out = change('out', WED_21, '2026-12-01T02:30:00Z');
    expect(show(nextTimes(swim, [out], '2026-10-14', '2026-10-28', NZ))).toEqual([
      'regular 2026-10-14T02:30:00Z',
      `regular ${WED_28}`,
    ]);
    expect(show(nextTimes(swim, [out], '2026-12-01', '2026-12-01', NZ))).toEqual([
      'changed out 2026-12-01T02:30:00.000Z',
    ]);
  });

  it('an all-day change sorts before the timed times of its day', () => {
    const wholeDay = {
      ...change('day', WED_21, '2026-10-21T02:30:00Z'),
      allDay: true,
      startsAt: null,
      endsAt: null,
      timeZone: null,
      startDate: '2026-10-21',
      endDate: '2026-10-22',
    } as unknown as Event;
    const other = change('other', WED_28, '2026-10-21T06:00:00Z'); // the 28th, moved to the 21st
    expect(show(nextTimes(swim, [wholeDay, other], '2026-10-21', '2026-10-21', NZ))).toEqual([
      'changed day 2026-10-21',
      'changed other 2026-10-21T06:00:00.000Z',
    ]);
  });

  it('a change dated at home on the next day (a UTC series) sits on its home day', () => {
    const utc = row('utc', '2026-10-19T20:00:00Z', {
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      timeZone: 'UTC',
    });
    const c = row('c', '2026-10-26T21:00:00Z', {
      timeZone: 'UTC',
      recurrenceParentId: utc.id,
      recurrenceOriginal: '2026-10-26T20:00:00Z',
    });
    // The 26th 20:00Z is the 27th at home: within a window that starts on the 27th.
    expect(show(nextTimes(utc, [c], '2026-10-27', '2026-10-27', NZ))).toEqual([
      'changed c 2026-10-26T21:00:00.000Z',
    ]);
  });
});

describe('put-away changes', () => {
  const at = (iso: string) => ({ archivedAt: new Date(iso) });

  it('lists archived changes whose original is still ahead, one per time, by original', () => {
    const a = change('a', WED_28, '2026-10-28T04:00:00Z', at('2026-10-10T00:00:00Z'));
    const b = change('b', WED_21, '2026-10-21T04:00:00Z', at('2026-10-10T00:00:00Z'));
    const bLater = change('b2', WED_21, '2026-10-21T05:00:00Z', at('2026-10-12T00:00:00Z'));
    const past = change(
      'p',
      '2026-10-14T02:30:00Z',
      '2026-10-14T04:00:00Z',
      at('2026-10-10T00:00:00Z'),
    );
    const live = change('l', '2026-11-04T02:30:00Z', '2026-11-04T04:00:00Z');
    const rows = putAwayChanges(swim, [a, b, bLater, past, live], '2026-10-20');
    expect(rows.map((r) => [r.change.id, r.status])).toEqual([
      ['b2', 'restorable'], // the most recently put away for the 21st, once
      ['a', 'restorable'],
    ]);
    expect(originalDateOf(swim, b)).toBe('2026-10-21');
    expect(originalDateOf(swim, { recurrenceOriginal: '2026-10-21' })).toBe('2026-10-21');
  });

  it('leaves out a time that has a live change now', () => {
    const old = change('old', WED_21, '2026-10-21T04:00:00Z', at('2026-10-10T00:00:00Z'));
    const now = change('now', WED_21, '2026-10-21T05:00:00Z');
    expect(putAwayChanges(swim, [old, now], '2026-10-20')).toEqual([]);
    expect(putAwayStatus(swim, old, [old, now])).toBe('replaced');
  });

  it('says why one cannot come back: no longer reached, or skipped', () => {
    const c = change('c', WED_21, '2026-10-21T04:00:00Z', at('2026-10-10T00:00:00Z'));
    const thursdays = { ...swim, rrule: 'FREQ=WEEKLY;BYDAY=TH' } as Event;
    expect(putAwayStatus(thursdays, c, [c])).toBe('no_longer');
    expect(putAwayChanges(thursdays, [c], '2026-10-20').map((r) => r.status)).toEqual([
      'no_longer',
    ]);
    const skipping = { ...swim, exdates: ['2026-10-21'] } as Event;
    expect(putAwayStatus(skipping, c, [c])).toBe('skipped');
    expect(putAwayStatus(swim, c, [c])).toBe('restorable');
  });

  it('never claims the usual time is happening when it is not', () => {
    expect(putAwayDetail('no_longer', 'Swimming')).toBe('No longer part of Swimming');
    expect(putAwayLine('no_longer', 'Swimming')).toMatch(/^No longer part of Swimming/);
    expect(putAwayLine('skipped', 'Swimming')).toContain('that time of Swimming is skipped');
    for (const s of ['no_longer', 'skipped', 'replaced'] as const)
      expect(putAwayLine(s, 'Swimming')).not.toContain('happens as usual');
    expect(putAwayLine('restorable', 'Swimming')).toContain('happens as usual that day');
  });
});

describe('the Change this one form', () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it('reads the occurrence’s own fields and nothing about the series', () => {
    const read = readOccurrenceForm(
      form({
        title: 'Swim gala',
        kind: 'activity',
        location: '',
        description: 'Bring togs',
        startDate: '2026-10-21',
        startTime: '16:00',
        endTime: '17:00',
        repeat: 'weekly', // ignored: never an input here
        visibility: 'private', // ignored
      }),
      { timeZone: NZ },
    );
    expect(read).toEqual({
      title: 'Swim gala',
      kind: 'activity',
      location: null,
      description: 'Bring togs',
      time: {
        allDay: false,
        startsAt: '2026-10-21T03:00:00.000Z',
        endsAt: '2026-10-21T04:00:00.000Z',
        timeZone: NZ,
      },
    });
    expect(Object.keys(read)).not.toContain('visibility');
    expect(Object.keys(read)).not.toContain('rrule');
  });

  it('prefills from the occurrence as the engine places it, repeating nothing', () => {
    const [o] = expandEvent(recurringOf(swim), '2026-10-21', '2026-10-21');
    expect(occurrenceDefaults(o!)).toMatchObject({
      allDay: false,
      startDate: '2026-10-21',
      startTime: '15:30',
      endTime: '16:15',
      endDate: '',
      repeat: 'none',
      attending: new Set(),
    });
    const bins = row('bins', '2026-10-13T00:00:00Z', {
      allDay: true,
      startsAt: null,
      endsAt: null,
      timeZone: null,
      startDate: '2026-10-13',
      endDate: '2026-10-15',
      rrule: 'FREQ=WEEKLY',
    } as Partial<Event>);
    const [b] = expandEvent(recurringOf(bins), '2026-10-20', '2026-10-20');
    expect(occurrenceDefaults(b!)).toMatchObject({
      allDay: true,
      startDate: '2026-10-20',
      endDate: '2026-10-21',
    });
  });

  it('says it in household words, never override, original or exdate', () => {
    const [o] = expandEvent(recurringOf(swim), '2026-10-21', '2026-10-21');
    expect(occurrenceWhen(o!)).toBe('Wednesday 21 October · 15:30–16:15');
    expect(usuallyLine(o!)).toBe('Usually Wednesday 21 October · 15:30–16:15.');
    expect(changedFromUsual('Swimming')).toBe('One time of Swimming, changed from the usual.');
    const q = backToSeriesQuestion('Swimming', o!);
    expect(q).toContain('Swimming goes back to the usual: Wednesday 21 October · 15:30–16:15.');
    expect(q).toContain('Nothing is deleted.');
    expect(`${q} ${backToSeriesQuestion('Swimming', null)}`).not.toMatch(
      /override|original|exdate|recurrence/i,
    );
  });
});
