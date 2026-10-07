import { describe, expect, it } from 'vitest';
import {
  isOccurrence,
  overriddenOriginals,
  recurringOf,
  recurringWithOverrides,
  startOf,
  upcomingSkips,
} from '@/domain/events/occurrences';
import { agenda } from '@/domain/engines/agenda';
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

// Override suppression (ADR 0007 §13, §42; Package 6): a live override's
// original occurrence is skipped on its series, whatever the series' own
// exdates say after a partial refresh.

const synced = (over: Partial<Event>): Event =>
  ({
    ...weekly,
    source: 'synced',
    calendarSourceId: 'src-1',
    externalUid: 'swim@example.test',
    recurrenceOriginal: null,
    recurrenceParentId: null,
    archivedAt: null,
    ...over,
  }) as Event;
const series = synced({ id: 'series' });
// Wed 4 Nov 15:30 NZDT is 02:30Z; moved to 17:00 (04:00Z) the same day.
const ORIGINAL = '2026-11-04T02:30:00Z';
const moved = synced({
  id: 'moved',
  rrule: null,
  startsAt: new Date('2026-11-04T04:00:00Z'),
  endsAt: new Date('2026-11-04T05:00:00Z'),
  recurrenceOriginal: ORIGINAL,
  recurrenceParentId: 'series',
});
const titled = (rows: Event[], from: string, to: string) =>
  agenda({
    from,
    to,
    timeZone: 'Pacific/Auckland',
    events: rows.map((e) => ({
      ...recurringWithOverrides(e, overriddenOriginals(rows)),
      id: e.id,
      title: e.title,
    })),
  }).flatMap((d) =>
    d.items.map((i) =>
      i.kind === 'event'
        ? `${d.date} ${i.allDay ? '' : i.startsAt.toISOString()} ${i.eventId}`.trim()
        : `${d.date} ${i.kind}`,
    ),
  );

describe('override suppression', () => {
  it('a live override names its original on its series, by source and UID', () => {
    expect(overriddenOriginals([series, moved])).toEqual(new Map([['series', [ORIGINAL]]]));
  });

  it('the series is expanded without the overridden occurrence even when its exdates lack it', () => {
    expect(series.exdates).toBeNull(); // the partial-refresh state
    expect(titled([series, moved], '2026-11-04', '2026-11-04')).toEqual([
      '2026-11-04 2026-11-04T04:00:00.000Z moved',
    ]);
    // Other weeks are untouched.
    expect(titled([series, moved], '2026-11-11', '2026-11-11')).toEqual([
      '2026-11-11 2026-11-11T02:30:00.000Z series',
    ]);
  });

  it('a repaired exdate on the series makes no difference: still one', () => {
    const repaired = synced({ id: 'series', exdates: [ORIGINAL] });
    expect(
      recurringWithOverrides(repaired, overriddenOriginals([repaired, moved])).exdates,
    ).toEqual([ORIGINAL]);
    expect(titled([repaired, moved], '2026-11-04', '2026-11-04')).toHaveLength(1);
  });

  it('an archived override suppresses nothing: the regular occurrence is back', () => {
    const archived = synced({ ...moved, archivedAt: new Date() });
    expect(overriddenOriginals([series, archived])).toEqual(new Map());
    expect(titled([series], '2026-11-04', '2026-11-04')).toEqual([
      '2026-11-04 2026-11-04T02:30:00.000Z series',
    ]);
  });

  it('an orphan override (its series gone) is its own event at its moved time', () => {
    expect(overriddenOriginals([moved])).toEqual(new Map());
    expect(titled([moved], '2026-11-04', '2026-11-04')).toEqual([
      '2026-11-04 2026-11-04T04:00:00.000Z moved',
    ]);
  });

  it('identity, not likeness: another calendar’s or UID’s series is untouched', () => {
    const other = synced({ id: 'other', calendarSourceId: 'src-2' });
    const otherUid = synced({ id: 'other-uid', externalUid: 'tennis@example.test' });
    expect(overriddenOriginals([series, other, otherUid, moved])).toEqual(
      new Map([['series', [ORIGINAL]]]),
    );
    expect(titled([other, moved], '2026-11-04', '2026-11-04')).toHaveLength(2);
  });

  it('a manual override (Package 8) is matched by its parent id', () => {
    const manualSeries = {
      ...weekly,
      id: 'm-series',
      source: 'manual',
      calendarSourceId: null,
      externalUid: null,
      recurrenceOriginal: null,
      recurrenceParentId: null,
      archivedAt: null,
    } as Event;
    const manualMoved = {
      ...moved,
      source: 'manual',
      calendarSourceId: null,
      externalUid: null,
      recurrenceParentId: 'm-series',
      id: 'm-moved',
    } as Event;
    expect(overriddenOriginals([manualSeries, manualMoved])).toEqual(
      new Map([['m-series', [ORIGINAL]]]),
    );
  });

  it('an all-day series is suppressed by date', () => {
    const allDaySeries = {
      ...oneOff,
      id: 'ad',
      source: 'synced',
      calendarSourceId: 's',
      externalUid: 'u',
      rrule: 'FREQ=WEEKLY',
      recurrenceOriginal: null,
      recurrenceParentId: null,
      archivedAt: null,
    } as Event;
    const allDayMoved = {
      ...allDaySeries,
      id: 'ad-moved',
      rrule: null,
      startDate: '2026-10-28',
      endDate: '2026-10-29',
      recurrenceOriginal: '2026-10-27',
    } as Event;
    expect(titled([allDaySeries, allDayMoved], '2026-10-27', '2026-10-28')).toEqual([
      '2026-10-28  ad-moved',
    ]);
  });
});
