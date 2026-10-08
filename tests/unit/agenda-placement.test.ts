import { describe, expect, it } from 'vitest';
import { timedRow } from '@/app/_agenda/agenda-list';
import { agenda, type AgendaEventInput, type AgendaItem } from '@/domain/engines/agenda';
import { clockOf } from '@/lib/dates';

// Where the agenda puts timed events and in what order (ADR 0008 §24, M5
// Package 1): every home day an occurrence covers, one occurrence however
// many days it shows on, ordered by the real start instant whatever zone the
// event keeps. Synthetic only.

const NZ = 'Pacific/Auckland';
const timed = (
  id: string,
  startsAt: string,
  endsAt: string,
  extra: Partial<AgendaEventInput> = {},
): AgendaEventInput =>
  ({
    id,
    title: id,
    allDay: false,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    timeZone: NZ,
    rrule: null,
    exdates: null,
    ...extra,
  }) as AgendaEventInput;

type Timed = Extract<AgendaItem, { kind: 'event'; allDay: false }>;
const placed = (events: AgendaEventInput[], from: string, to: string, timeZone = NZ) =>
  agenda({ timeZone, from, to, events }).flatMap((d) =>
    d.items
      .filter((i): i is Timed => i.kind === 'event' && !i.allDay)
      .map((i) => `${d.date} ${i.eventId} ${i.day}/${i.days} ${clockOf(i.startsAt, timeZone)}`),
  );

describe('overnight and multi-day timed events', () => {
  it('a same-day event is on its one day, 1 of 1', () => {
    // Wednesday 14 October 2026, 15:30–16:15 NZDT
    expect(
      placed(
        [timed('swim', '2026-10-14T02:30:00Z', '2026-10-14T03:15:00Z')],
        '2026-10-13',
        '2026-10-15',
      ),
    ).toEqual(['2026-10-14 swim 1/1 15:30']);
  });

  it('23:00 Tuesday to 01:00 Wednesday is on both days: one occurrence, two places', () => {
    const e = timed('late', '2026-10-13T10:00:00Z', '2026-10-13T12:00:00Z'); // 23:00–01:00 NZDT
    expect(placed([e], '2026-10-12', '2026-10-15')).toEqual([
      '2026-10-13 late 1/2 23:00',
      '2026-10-14 late 2/2 23:00',
    ]);
    const items = agenda({
      timeZone: NZ,
      from: '2026-10-13',
      to: '2026-10-14',
      events: [e],
    }).flatMap((d) => d.items) as Timed[];
    // The same event and occurrence on both days: nothing is duplicated or invented.
    expect(
      new Set(
        items.map(
          (i) =>
            `${i.eventId}|${i.occurrenceDate}|${i.startsAt.toISOString()}|${i.endsAt.toISOString()}`,
        ),
      ).size,
    ).toBe(1);
  });

  it('the carried-over day is found even when the range starts on it', () => {
    const e = timed('late', '2026-10-13T10:00:00Z', '2026-10-13T12:00:00Z');
    expect(placed([e], '2026-10-14', '2026-10-14')).toEqual(['2026-10-14 late 2/2 23:00']);
  });

  it('an end exactly at midnight does not reach the next day', () => {
    const e = timed('dinner', '2026-10-13T07:00:00Z', '2026-10-13T11:00:00Z'); // 20:00–00:00
    expect(placed([e], '2026-10-13', '2026-10-14')).toEqual(['2026-10-13 dinner 1/1 20:00']);
  });

  it('a timed event over a weekend is on each day it covers, including from its last day', () => {
    // Friday 16 Oct 18:00 to Sunday 18 Oct 14:00 NZDT
    const camp = timed('camp', '2026-10-16T05:00:00Z', '2026-10-18T01:00:00Z');
    expect(placed([camp], '2026-10-15', '2026-10-19')).toEqual([
      '2026-10-16 camp 1/3 18:00',
      '2026-10-17 camp 2/3 18:00',
      '2026-10-18 camp 3/3 18:00',
    ]);
    expect(placed([camp], '2026-10-18', '2026-10-18')).toEqual(['2026-10-18 camp 3/3 18:00']);
  });

  it('a weekly overnight series is on each Saturday and the Sunday after, skips included', () => {
    // Saturdays 22:00–02:00 NZDT from 17 October; the 24th skipped.
    const shift = timed('shift', '2026-10-17T09:00:00Z', '2026-10-17T13:00:00Z', {
      rrule: 'FREQ=WEEKLY;BYDAY=SA',
      exdates: ['2026-10-24T09:00:00Z'],
    });
    expect(placed([shift], '2026-10-18', '2026-11-01')).toEqual([
      '2026-10-18 shift 2/2 22:00',
      '2026-10-31 shift 1/2 22:00',
      '2026-11-01 shift 2/2 22:00',
    ]);
  });

  it('crosses the spring-forward gap and the autumn overlap on the right home days', () => {
    // NZ clocks go forward at 02:00 on Sunday 27 September 2026.
    const gap = timed('gap', '2026-09-26T11:30:00Z', '2026-09-26T13:30:00Z'); // 23:30 Sat – 02:30 UTC… 03:30 NZDT Sun
    expect(placed([gap], '2026-09-25', '2026-09-28')).toEqual([
      '2026-09-26 gap 1/2 23:30',
      '2026-09-27 gap 2/2 23:30',
    ]);
    // NZ clocks go back at 03:00 on Sunday 5 April 2026.
    const overlap = timed('overlap', '2026-04-04T10:00:00Z', '2026-04-04T14:30:00Z'); // 23:00 Sat NZDT – 02:30 Sun NZST
    expect(placed([overlap], '2026-04-03', '2026-04-06')).toEqual([
      '2026-04-04 overlap 1/2 23:00',
      '2026-04-05 overlap 2/2 23:00',
    ]);
  });

  it('leaves all-day events as they were', () => {
    const away = {
      id: 'away',
      title: 'away',
      allDay: true,
      startDate: '2026-10-16',
      endDate: '2026-10-18',
      rrule: null,
      exdates: null,
    } as AgendaEventInput;
    const days = agenda({ timeZone: NZ, from: '2026-10-15', to: '2026-10-19', events: [away] });
    expect(
      days.map((d) =>
        d.items.map((i) => (i.kind === 'event' ? `${d.date} ${i.day}/${i.days}` : '')),
      ),
    ).toEqual([['2026-10-16 1/2'], ['2026-10-17 2/2']]);
  });
});

describe('events kept in another zone', () => {
  it('are placed by home date and ordered by their real start', () => {
    const home = timed('home', '2026-10-14T07:00:00Z', '2026-10-14T08:00:00Z'); // 20:00 NZDT 14th
    const london = timed('london', '2026-10-14T08:00:00Z', '2026-10-14T09:00:00Z', {
      timeZone: 'Europe/London', // 09:00 BST 14th = 21:00 NZDT 14th
    });
    const utc = timed('utc', '2026-10-14T06:30:00Z', '2026-10-14T07:30:00Z', { timeZone: 'UTC' }); // 19:30 NZDT
    const newYork = timed('ny', '2026-10-14T12:00:00Z', '2026-10-14T13:00:00Z', {
      timeZone: 'America/New_York', // 08:00 EDT 14th = 01:00 NZDT 15th
    });
    expect(placed([london, newYork, home, utc], '2026-10-14', '2026-10-15')).toEqual([
      '2026-10-14 utc 1/1 19:30',
      '2026-10-14 home 1/1 20:00',
      '2026-10-14 london 1/1 21:00',
      '2026-10-15 ny 1/1 01:00',
    ]);
  });

  it('follow their own zone across its clock change, and are placed at home', () => {
    // London goes back on 25 October 2026: Saturdays at 19:00 London time.
    const london = timed('club', '2026-10-17T18:00:00Z', '2026-10-17T19:00:00Z', {
      timeZone: 'Europe/London',
      rrule: 'FREQ=WEEKLY;BYDAY=SA',
    });
    expect(placed([london], '2026-10-18', '2026-11-01')).toEqual([
      '2026-10-18 club 1/1 07:00', // 19:00 BST Sat 17th
      '2026-10-25 club 1/1 07:00', // 19:00 BST Sat 24th
      '2026-11-01 club 1/1 08:00', // 19:00 GMT Sat 31st
    ]);
    // New York goes back on 1 November 2026: Sundays at 09:00 New York time.
    const ny = timed('call', '2026-10-25T13:00:00Z', '2026-10-25T14:00:00Z', {
      timeZone: 'America/New_York',
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
    });
    expect(placed([ny], '2026-10-26', '2026-11-09')).toEqual([
      '2026-10-26 call 1/1 02:00', // 09:00 EDT Sun 25th
      '2026-11-02 call 1/1 03:00', // 09:00 EST Sun 1st
      '2026-11-09 call 1/1 03:00',
    ]);
  });

  it('can be overnight at home while same-day in their own zone', () => {
    // 10:00–14:00 UTC is 23:00–03:00 NZDT.
    const e = timed('utcday', '2026-10-14T10:00:00Z', '2026-10-14T14:00:00Z', { timeZone: 'UTC' });
    expect(placed([e], '2026-10-14', '2026-10-15')).toEqual([
      '2026-10-14 utcday 1/2 23:00',
      '2026-10-15 utcday 2/2 23:00',
    ]);
  });
});

describe('order and kind', () => {
  it('is the same whatever order the events arrive in; a carried-over item comes first', () => {
    const late = timed('late', '2026-10-13T10:00:00Z', '2026-10-13T12:00:00Z');
    const early = timed('early', '2026-10-13T19:30:00Z', '2026-10-13T20:30:00Z'); // 08:30 Wed
    const twin = timed('twin', '2026-10-13T19:30:00Z', '2026-10-13T20:30:00Z');
    const a = placed([late, early, twin], '2026-10-14', '2026-10-14');
    const b = placed([twin, early, late], '2026-10-14', '2026-10-14');
    expect(a).toEqual(b);
    expect(a).toEqual([
      '2026-10-14 late 2/2 23:00',
      '2026-10-14 early 1/1 08:30',
      '2026-10-14 twin 1/1 08:30',
    ]);
  });

  it('carries the recorded kind, and says nothing when none was given', () => {
    const kinds = agenda({
      timeZone: NZ,
      from: '2026-10-14',
      to: '2026-10-14',
      events: [
        timed('school', '2026-10-13T19:45:00Z', '2026-10-14T02:00:00Z', { kind: 'school' }),
        timed('plain', '2026-10-14T03:00:00Z', '2026-10-14T04:00:00Z'),
      ],
    })[0]!.items.map((i) => (i.kind === 'event' ? [i.eventId, i.eventKind] : null));
    expect(kinds).toEqual([
      ['school', 'school'],
      ['plain', null],
    ]);
  });
});

describe('how a timed row reads on each day it covers', () => {
  const rows = (e: AgendaEventInput, from: string, to: string) =>
    agenda({ timeZone: NZ, from, to, events: [e] }).flatMap((d) =>
      d.items.map((i) => timedRow(i as Timed, NZ)),
    );

  it('same day as before; overnight says where it runs to and where it began', () => {
    expect(
      rows(
        timed('swim', '2026-10-14T02:30:00Z', '2026-10-14T03:15:00Z'),
        '2026-10-14',
        '2026-10-14',
      ),
    ).toEqual([{ time: '15:30', detail: 'until 16:15' }]);
    expect(
      rows(
        timed('late', '2026-10-13T10:00:00Z', '2026-10-13T12:00:00Z'),
        '2026-10-13',
        '2026-10-14',
      ),
    ).toEqual([
      { time: '23:00', detail: 'until Wednesday 01:00' },
      { time: '01:00', detail: 'Ends · from Tuesday 23:00' },
    ]);
    expect(
      rows(
        timed('camp', '2026-10-16T05:00:00Z', '2026-10-18T01:00:00Z'),
        '2026-10-16',
        '2026-10-18',
      ),
    ).toEqual([
      { time: '18:00', detail: 'until Sunday 14:00' },
      { time: 'All day', detail: 'Day 2 of 3' },
      { time: '14:00', detail: 'Ends · from Friday 18:00' },
    ]);
  });
});
