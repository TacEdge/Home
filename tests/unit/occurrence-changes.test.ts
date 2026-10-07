import { describe, expect, it } from 'vitest';
import { agenda } from '@/domain/engines/agenda';
import { regularWeek } from '@/domain/engines/profile';
import { expandEvent } from '@/domain/engines/recurrence';
import {
  hiddenOccurrenceChanges,
  isOccurrenceChange,
  isSkippedOccurrence,
  occurrenceIdentity,
  occurrenceOf,
  overriddenOriginals,
  recurringOf,
  recurringWithOverrides,
} from '@/domain/events/occurrences';
import type { Event } from '@/domain/events/service';
import { occurrenceChangePeople } from '@/domain/events/who';

// Package 8a (M4 contract §3.7, ADR 0007 §46): one occurrence of a repeating
// manual event, changed on its own. Its identity is the ORIGINAL occurrence
// in the series' terms (a date, or a UTC instant to the second), proved by
// the engine; the agenda skips the original and shows the change once.

const NZ = 'Pacific/Auckland';

const timed = (
  id: string,
  startsAt: string,
  timeZone: string,
  rrule: string | null,
  extra: Partial<Event> = {},
): Event =>
  ({
    id,
    title: id,
    source: 'manual',
    allDay: false,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 45 * 60_000),
    timeZone,
    startDate: null,
    endDate: null,
    rrule,
    exdates: null,
    calendarSourceId: null,
    externalUid: null,
    recurrenceParentId: null,
    recurrenceOriginal: null,
    archivedAt: null,
    ...extra,
  }) as unknown as Event;

const allDay = (id: string, startDate: string, endDate: string, rrule: string | null): Event =>
  ({
    ...timed(id, '2026-01-01T00:00:00Z', NZ, rrule),
    allDay: true,
    startsAt: null,
    endsAt: null,
    timeZone: null,
    startDate,
    endDate,
  }) as unknown as Event;

/** A manual change of `series`' occurrence `original`, at its own (moved) time. */
const change = (
  id: string,
  series: Event,
  original: string,
  startsAt: string,
  extra: Partial<Event> = {},
): Event =>
  timed(id, startsAt, series.timeZone ?? NZ, null, {
    recurrenceParentId: series.id,
    recurrenceOriginal: original,
    ...extra,
  });

/** What the agenda shows, as the loader composes it. */
const shown = (rows: Event[], from: string, to: string) => {
  const hidden = hiddenOccurrenceChanges(rows);
  const live = rows.filter((e) => e.archivedAt === null && !hidden.has(e.id));
  const overridden = overriddenOriginals(rows);
  return agenda({
    from,
    to,
    timeZone: NZ,
    events: live.map((e) => ({
      ...recurringWithOverrides(e, overridden),
      id: e.id,
      title: e.title,
    })),
  }).flatMap((d) =>
    d.items.map((i) =>
      i.kind === 'event'
        ? `${d.date} ${i.allDay ? 'all day' : i.startsAt.toISOString()} ${i.eventId}`
        : `${d.date} ${i.kind}`,
    ),
  );
};

/** The identities of a series' occurrences from `from` to `to` (the event's own dates). */
const identities = (e: Event, from: string, to: string) =>
  expandEvent(recurringOf(e), from, to).map(occurrenceIdentity);

// Wednesday swimming, 15:30 in Auckland (NZDT, UTC+13) from 14 October 2026.
const swim = timed('swim', '2026-10-14T02:30:00Z', NZ, 'FREQ=WEEKLY;BYDAY=WE');
const WED_21 = '2026-10-21T02:30:00Z';

describe('occurrence identity', () => {
  it('is the original start instant in UTC, to the second, for a timed series', () => {
    expect(identities(swim, '2026-10-14', '2026-10-28')).toEqual([
      '2026-10-14T02:30:00Z',
      WED_21,
      '2026-10-28T02:30:00Z',
    ]);
  });

  it('is the occurrence date for an all-day series', () => {
    const bins = allDay('bins', '2026-10-13', '2026-10-14', 'FREQ=WEEKLY');
    expect(identities(bins, '2026-10-13', '2026-10-20')).toEqual(['2026-10-13', '2026-10-20']);
    expect(occurrenceOf(bins, '2026-10-20')?.date).toBe('2026-10-20');
  });

  it('is whole seconds, as the engine places occurrences, and as the column stores it', () => {
    const odd = timed('odd', '2026-10-14T02:30:00.250Z', NZ, 'FREQ=WEEKLY');
    expect(identities(odd, '2026-10-14', '2026-10-14')).toEqual(['2026-10-14T02:30:00Z']);
    expect(occurrenceOf(odd, '2026-10-14T02:30:00Z')).not.toBeNull();
  });
});

describe('occurrenceOf proves an occurrence against the current rule', () => {
  it('finds a real occurrence, skipped or not', () => {
    expect(occurrenceOf(swim, WED_21)).toMatchObject({ date: '2026-10-21' });
    expect(occurrenceOf({ ...swim, exdates: ['2026-10-21'] }, WED_21)).not.toBeNull();
  });

  it.each([
    ['a time the rule does not reach that day', '2026-10-21T03:00:00Z'],
    ['a day the rule does not reach', '2026-10-22T02:30:00Z'],
    ['before the series began', '2026-10-07T02:30:00Z'],
    ['a date for a timed series', '2026-10-21'],
    ['a non-canonical instant', '2026-10-21T02:30:00.000Z'],
    ['an offset instant', '2026-10-21T15:30:00+13:00'],
    ['an impossible date', '2026-02-30T02:30:00Z'],
    ['nonsense', 'next wednesday'],
    ['empty', ''],
  ])('names nothing for %s', (_, value) => {
    expect(occurrenceOf(swim, value)).toBeNull();
  });

  it('names nothing on a one-off event, after the rule ends, or an instant on an all-day series', () => {
    expect(occurrenceOf({ ...swim, rrule: null }, '2026-10-14T02:30:00Z')).toBeNull();
    const ended = { ...swim, rrule: 'FREQ=WEEKLY;BYDAY=WE;COUNT=1' } as Event;
    expect(occurrenceOf(ended, WED_21)).toBeNull();
    const bins = allDay('bins', '2026-10-13', '2026-10-14', 'FREQ=WEEKLY');
    expect(occurrenceOf(bins, '2026-10-20T00:00:00Z')).toBeNull();
  });

  it('knows a skipped occurrence from the series exdates, by date or instant', () => {
    const o = occurrenceOf(swim, WED_21)!;
    expect(isSkippedOccurrence(swim, o)).toBe(false);
    expect(isSkippedOccurrence({ ...swim, exdates: ['2026-10-21'] } as Event, o)).toBe(true);
    expect(isSkippedOccurrence({ ...swim, exdates: [WED_21] } as Event, o)).toBe(true);
    expect(isSkippedOccurrence({ ...swim, exdates: ['2026-10-28'] } as Event, o)).toBe(false);
  });
});

describe('identity across zones and DST', () => {
  it('NZ spring-forward: the Sunday after the change has its own instant', () => {
    // Sundays 09:00 in Auckland from 20 Sep 2026 (NZST, +12); the clocks go
    // forward on 27 Sep, so that Sunday's 09:00 is 20:00Z, not 21:00Z.
    const s = timed('s', '2026-09-19T21:00:00Z', NZ, 'FREQ=WEEKLY;BYDAY=SU');
    expect(identities(s, '2026-09-20', '2026-09-27')).toEqual([
      '2026-09-19T21:00:00Z',
      '2026-09-26T20:00:00Z',
    ]);
    expect(occurrenceOf(s, '2026-09-26T20:00:00Z')?.date).toBe('2026-09-27');
    expect(occurrenceOf(s, '2026-09-26T21:00:00Z')).toBeNull();
  });

  it('NZ spring-forward: an occurrence in the skipped hour is the engine’s instant', () => {
    // 02:30 does not exist in Auckland on 27 Sep 2026; whatever instant the
    // engine gives it is the identity, and it is proved the same way.
    const s = timed('gap', '2026-09-19T14:30:00Z', NZ, 'FREQ=WEEKLY;BYDAY=SU');
    const [id] = identities(s, '2026-09-27', '2026-09-27');
    expect(id).toMatch(/^2026-09-2\dT\d{2}:\d{2}:00Z$/);
    expect(occurrenceOf(s, id!)?.date).toBe('2026-09-27');
  });

  it('NZ fall-back: the Sunday after the change has its own instant', () => {
    // Sundays 09:00 from 28 Mar 2027 (NZDT, +13); back to +12 on 4 Apr.
    const s = timed('s', '2027-03-27T20:00:00Z', NZ, 'FREQ=WEEKLY;BYDAY=SU');
    expect(identities(s, '2027-03-28', '2027-04-04')).toEqual([
      '2027-03-27T20:00:00Z',
      '2027-04-03T21:00:00Z',
    ]);
    expect(occurrenceOf(s, '2027-04-03T21:00:00Z')?.date).toBe('2027-04-04');
  });

  it('a UTC series: identity is UTC, dated in UTC, though home calls it the next day', () => {
    const s = timed('utc', '2026-10-19T20:00:00Z', 'UTC', 'FREQ=WEEKLY;BYDAY=MO');
    expect(occurrenceOf(s, '2026-10-26T20:00:00Z')?.date).toBe('2026-10-26'); // Tue 09:00 at home
    expect(shown([s], '2026-10-27', '2026-10-27')).toEqual([
      '2026-10-27 2026-10-26T20:00:00.000Z utc',
    ]);
  });

  it('a New York series across its own DST change (1 Nov 2026)', () => {
    const s = timed('ny', '2026-10-19T22:00:00Z', 'America/New_York', 'FREQ=WEEKLY;BYDAY=MO');
    expect(identities(s, '2026-10-26', '2026-11-02')).toEqual([
      '2026-10-26T22:00:00Z',
      '2026-11-02T23:00:00Z',
    ]);
    expect(occurrenceOf(s, '2026-11-02T22:00:00Z')).toBeNull();
  });

  it('a London series (non-NZ DST, 25 Oct 2026) whose home date is a day later', () => {
    const s = timed('ldn', '2026-10-20T21:00:00Z', 'Europe/London', 'FREQ=WEEKLY;BYDAY=TU');
    expect(identities(s, '2026-10-20', '2026-10-27')).toEqual([
      '2026-10-20T21:00:00Z',
      '2026-10-27T22:00:00Z',
    ]);
    // Tuesday in London is Wednesday at home; the identity does not care.
    const moved = change('ldn-x', s, '2026-10-27T22:00:00Z', '2026-10-27T23:00:00Z');
    expect(shown([s, moved], '2026-10-28', '2026-10-28')).toEqual([
      '2026-10-28 2026-10-27T23:00:00.000Z ldn-x',
    ]);
  });
});

describe('the agenda with manual occurrence changes', () => {
  it('a later time the same day replaces the original, once', () => {
    const later = change('later', swim, WED_21, '2026-10-21T03:00:00Z');
    expect(isOccurrenceChange(later)).toBe(true);
    expect(overriddenOriginals([swim, later])).toEqual(new Map([['swim', [WED_21]]]));
    expect(shown([swim, later], '2026-10-14', '2026-10-28')).toEqual([
      '2026-10-14 2026-10-14T02:30:00.000Z swim',
      '2026-10-21 2026-10-21T03:00:00.000Z later',
      '2026-10-28 2026-10-28T02:30:00.000Z swim',
    ]);
  });

  it('moved to another date: gone from the original day, shown once on the new one', () => {
    const thu = change('thu', swim, WED_21, '2026-10-22T02:30:00Z');
    expect(shown([swim, thu], '2026-10-21', '2026-10-22')).toEqual([
      '2026-10-22 2026-10-22T02:30:00.000Z thu',
    ]);
  });

  it('timed to all-day, and all-day to timed', () => {
    const wholeDay = {
      ...change('wd', swim, WED_21, '2026-10-21T02:30:00Z'),
      allDay: true,
      startsAt: null,
      endsAt: null,
      timeZone: null,
      startDate: '2026-10-21',
      endDate: '2026-10-22',
    } as unknown as Event;
    expect(shown([swim, wholeDay], '2026-10-21', '2026-10-21')).toEqual(['2026-10-21 all day wd']);
    const bins = allDay('bins', '2026-10-13', '2026-10-14', 'FREQ=WEEKLY');
    const timedBins = change('tb', bins, '2026-10-20', '2026-10-19T19:00:00Z'); // Tue 08:00
    expect(shown([bins, timedBins], '2026-10-20', '2026-10-20')).toEqual([
      '2026-10-20 2026-10-19T19:00:00.000Z tb',
    ]);
  });

  it('several changes on one series act independently', () => {
    const a = change('a', swim, WED_21, '2026-10-21T04:00:00Z');
    const b = change('b', swim, '2026-10-28T02:30:00Z', '2026-10-29T02:30:00Z');
    expect(shown([swim, a, b], '2026-10-21', '2026-11-04')).toEqual([
      '2026-10-21 2026-10-21T04:00:00.000Z a',
      '2026-10-29 2026-10-29T02:30:00.000Z b',
      '2026-11-04 2026-11-04T02:30:00.000Z swim',
    ]);
  });

  it('an archived change (back to the series) suppresses nothing: the original returns', () => {
    const gone = change('gone', swim, WED_21, '2026-10-21T04:00:00Z', {
      archivedAt: new Date(),
    });
    expect(overriddenOriginals([swim, gone])).toEqual(new Map());
    expect(shown([swim, gone], '2026-10-21', '2026-10-21')).toEqual([
      '2026-10-21 2026-10-21T02:30:00.000Z swim',
    ]);
  });

  it('a change whose series is archived, or not there, is not shown', () => {
    const later = change('later', swim, WED_21, '2026-10-21T03:00:00Z');
    const archived = { ...swim, archivedAt: new Date() } as Event;
    expect(hiddenOccurrenceChanges([archived, later])).toEqual(new Set(['later']));
    expect(shown([archived, later], '2026-10-21', '2026-10-21')).toEqual([]);
    expect(shown([later], '2026-10-21', '2026-10-21')).toEqual([]);
    const orphan = { ...later, recurrenceParentId: null } as Event;
    expect(hiddenOccurrenceChanges([swim, orphan])).toEqual(new Set([orphan.id]));
  });

  it('a synced override with no series is still its own event (Package 6, unchanged)', () => {
    const synced = change('synced', swim, WED_21, '2026-10-21T03:00:00Z', {
      source: 'synced',
      recurrenceParentId: null,
    });
    expect(hiddenOccurrenceChanges([synced])).toEqual(new Set());
  });

  it('a change the rule no longer reaches suppresses nothing it could be confused with', () => {
    const later = change('later', swim, WED_21, '2026-10-21T03:00:00Z');
    const thursdays = { ...swim, rrule: 'FREQ=WEEKLY;BYDAY=TH' } as Event;
    expect(occurrenceOf(thursdays, WED_21)).toBeNull();
    // (The service archives it with the series edit; were it live, it would
    // simply be an event at its own time and the series would be whole.)
    expect(shown([thursdays, later], '2026-10-21', '2026-10-22')).toEqual([
      '2026-10-21 2026-10-21T03:00:00.000Z later',
      '2026-10-22 2026-10-22T02:30:00.000Z swim',
    ]);
  });
});

describe('who a changed occurrence is for', () => {
  const visible = new Set(['milo', 'sam']);
  const series = [
    { personId: 'milo', role: 'attending' as const },
    { personId: 'sam', role: 'responsible' as const },
  ];

  it('with none of its own: its series’ people, roles and all, derived', () => {
    expect(occurrenceChangePeople([], series, visible)).toEqual({ people: series, derived: true });
  });

  it('with its own: only those, in place of the series’', () => {
    const own = [{ personId: 'sam', role: 'attending' as const }];
    expect(occurrenceChangePeople(own, series, visible)).toEqual({ people: own, derived: false });
  });

  it('its own annotation for someone no longer listed shows nobody, not the series’', () => {
    const own = [{ personId: 'archived', role: 'attending' as const }];
    expect(occurrenceChangePeople(own, series, visible)).toEqual({ people: [], derived: false });
  });

  it('never names someone the reader cannot see', () => {
    const withHidden = [...series, { personId: 'hidden', role: 'attending' as const }];
    expect(occurrenceChangePeople([], withHidden, visible).people).toEqual(series);
    expect(occurrenceChangePeople([], [], visible)).toEqual({ people: [], derived: false });
  });
});

describe('the regular week ignores one-off changes', () => {
  it('moving one Wednesday (even to Friday) changes nothing in Usually', () => {
    const milo = [{ personId: 'milo', role: 'attending' as const }];
    const opts = { today: '2026-10-14', timeZone: NZ };
    const asInput = (rows: Event[]) => {
      const overridden = overriddenOriginals(rows);
      return rows.map((e) => ({
        ...recurringWithOverrides(e, overridden),
        id: e.id,
        title: e.title,
        people: milo,
      }));
    };
    const before = regularWeek(asInput([swim]), 'milo', opts);
    const thisWeek = change('fri', swim, '2026-10-14T02:30:00Z', '2026-10-16T05:00:00Z');
    const nextWeek = change('thu', swim, WED_21, '2026-10-22T02:30:00Z');
    expect(regularWeek(asInput([swim, thisWeek, nextWeek]), 'milo', opts)).toEqual(before);
    expect(before).toEqual([
      {
        weekday: 2,
        allDay: false,
        time: '15:30',
        cadence: 'weekly',
        eventId: 'swim',
        title: 'swim',
      },
    ]);
  });
});
