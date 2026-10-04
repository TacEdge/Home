import { describe, expect, it } from 'vitest';
import { isOccurrence, recurringOf, startOf, upcomingSkips } from '@/domain/events/occurrences';
import type { Event } from '@/domain/events/service';
import { existingEventDefaults, newEventDefaults } from '@/app/(home)/events/form-defaults';

// The one mapping from a stored event to the engine's terms (ADR 0006 §42),
// and the judgements built on it: is a date an occurrence; which skipped
// dates are still ahead and still reached by the rule.

const weekly = {
  id: 'e1',
  title: 'Swimming',
  allDay: false,
  startsAt: new Date('2026-10-14T02:30:00Z'), // Wed 15:30 NZDT
  endsAt: new Date('2026-10-14T03:15:00Z'),
  timeZone: 'Pacific/Auckland',
  startDate: null,
  endDate: null,
  rrule: 'FREQ=WEEKLY;BYDAY=WE',
  exdates: null,
} as unknown as Event;
const oneOff = {
  ...weekly,
  id: 'e2',
  allDay: true,
  startsAt: null,
  endsAt: null,
  timeZone: null,
  startDate: '2026-10-20',
  endDate: '2026-10-21',
  rrule: null,
} as unknown as Event;

describe('recurringOf and startOf', () => {
  it('maps timed and all-day events to the engine', () => {
    expect(startOf(weekly)).toEqual({
      allDay: false,
      startsAt: weekly.startsAt,
      timeZone: 'Pacific/Auckland',
    });
    expect(recurringOf(oneOff)).toEqual({
      allDay: true,
      startDate: '2026-10-20',
      endDate: '2026-10-21',
      rrule: null,
      exdates: null,
    });
  });
});

describe('isOccurrence', () => {
  it('is true only on the dates the rule reaches, skipped or not', () => {
    expect(isOccurrence(weekly, '2026-10-14')).toBe(true);
    expect(isOccurrence(weekly, '2026-10-21')).toBe(true);
    expect(isOccurrence({ ...weekly, exdates: ['2026-10-21'] }, '2026-10-21')).toBe(true);
    expect(isOccurrence(weekly, '2026-10-22')).toBe(false);
    expect(isOccurrence(weekly, '2026-10-07')).toBe(false); // before the first
  });
  it('a one-off event occurs on its own date only', () => {
    expect(isOccurrence(oneOff, '2026-10-20')).toBe(true);
    expect(isOccurrence(oneOff, '2026-10-21')).toBe(false);
  });
});

describe('upcomingSkips', () => {
  it('keeps skipped dates from today on that the rule still reaches, in order', () => {
    const e = {
      ...weekly,
      exdates: ['2026-11-04', '2026-10-21', '2026-10-07', '2026-10-22', '2026-10-14T02:30:00Z'],
    } as Event;
    expect(upcomingSkips(e, '2026-10-20')).toEqual(['2026-10-21', '2026-11-04']);
    expect(upcomingSkips(e, '2026-10-28')).toEqual(['2026-11-04']);
  });
  it('is empty for a one-off event, whatever its exdates say', () => {
    expect(upcomingSkips({ ...oneOff, exdates: ['2026-10-20'] } as Event, '2026-10-01')).toEqual(
      [],
    );
  });
});

describe('form defaults: weekdays', () => {
  it('a new event starts on its date’s weekday', () => {
    expect(newEventDefaults('2026-10-14').weekdays).toEqual(new Set(['2'])); // a Wednesday
  });
  it('an existing event without weekly days starts on its own weekday', () => {
    expect(existingEventDefaults({ ...weekly, rrule: null } as Event, []).weekdays).toEqual(
      new Set(['2']),
    );
    expect(existingEventDefaults(weekly, []).weekdays).toEqual(new Set(['2']));
  });
});
