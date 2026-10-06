import { describe, expect, it } from 'vitest';
import { importWindow } from '@/domain/calendar/provider';
import { agenda, type AgendaEventInput } from '@/domain/engines/agenda';
import {
  expandEvent,
  isReadableRRule,
  occursWithin,
  readRRule,
  toRRule,
  type RecurringEvent,
} from '@/domain/engines/recurrence';
import { readFeed } from '@/integrations/calendar/ics/feed';
import { normaliseFeed } from '@/integrations/calendar/ics/normalise';
import { SEQUENCES, TODAY } from '../../fixtures/calendars/sequences';

// The recurrence engine's M4 extension (contract §3.5): bounded window
// checks, rules that parse but cannot be built, a timed UNTIL read as an
// instant, and imported overrides flowing through the agenda unchanged.

const weekly = (rrule: string | null, exdates: string[] = []): RecurringEvent => ({
  allDay: false,
  startsAt: new Date('2026-10-14T02:30:00Z'), // Wednesday 15:30 NZDT
  endsAt: new Date('2026-10-14T03:30:00Z'),
  timeZone: 'Pacific/Auckland',
  rrule,
  exdates,
});

describe('occursWithin', () => {
  it('agrees with expandEvent on whether anything starts in the window', () => {
    const rules = [
      null,
      'FREQ=WEEKLY;BYDAY=WE',
      'FREQ=WEEKLY;BYDAY=WE;COUNT=2',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20261111T023000Z',
      'FREQ=MONTHLY;BYDAY=2TU',
      'FREQ=YEARLY',
      'FREQ=SOMETIMES',
    ];
    const windows: [string, string][] = [
      ['2026-10-01', '2026-10-13'],
      ['2026-10-14', '2026-10-14'],
      ['2026-10-15', '2026-10-20'],
      ['2026-10-22', '2026-10-27'],
      ['2026-11-01', '2026-11-30'],
      ['2027-10-13', '2027-10-15'],
      ['2030-01-01', '2030-12-31'],
    ];
    for (const rule of rules)
      for (const [from, to] of windows) {
        const ev = weekly(rule, ['2026-10-28T02:30:00Z']);
        expect(occursWithin(ev, from, to, 100_000).occurs, `${rule} ${from}…${to}`).toBe(
          expandEvent(ev, from, to).length > 0,
        );
      }
  });

  it('an exdated occurrence does not count', () => {
    const ev = weekly('FREQ=WEEKLY;BYDAY=WE;COUNT=1', ['2026-10-14T02:30:00Z']);
    expect(occursWithin(ev, '2026-10-01', '2026-12-31', 100).occurs).toBe(false);
  });

  it('stops at the first occurrence in the window, and reports the work it did', () => {
    const r = occursWithin(weekly('FREQ=WEEKLY;BYDAY=WE'), '2026-11-01', '2026-11-30', 1000);
    expect(r).toEqual({ occurs: true, steps: 4, exhausted: false }); // 14, 21, 28 Oct, then 4 Nov
  });

  it('gives up, saying so, when the rule needs more steps than allowed to reach the window', () => {
    const daily = {
      ...weekly('FREQ=DAILY'),
      startsAt: new Date('1990-01-01T00:00:00Z'),
      endsAt: new Date('1990-01-01T01:00:00Z'),
    };
    expect(occursWithin(daily, '2026-10-01', '2026-10-31', 1000)).toEqual({
      occurs: false,
      steps: 1000,
      exhausted: true,
    });
    expect(occursWithin(daily, '2026-10-01', '2026-10-31', 20_000).occurs).toBe(true);
  });
});

describe('rules that parse but cannot be built are unreadable', () => {
  it('an unknown weekday code: unreadable, and expansion gives the first occurrence instead of throwing', () => {
    expect(isReadableRRule('FREQ=WEEKLY;BYDAY=XX')).toBe(false);
    expect(expandEvent(weekly('FREQ=WEEKLY;BYDAY=XX'), '2026-10-01', '2026-12-31')).toHaveLength(1);
    expect(
      occursWithin(weekly('FREQ=WEEKLY;BYDAY=XX'), '2026-10-01', '2026-12-31', 10).occurs,
    ).toBe(true);
  });

  it('HOME’s own rules are all still readable and read back as their presets', () => {
    const start = {
      allDay: false as const,
      startsAt: new Date('2026-10-14T02:30:00Z'),
      timeZone: 'Pacific/Auckland',
    };
    for (const r of [
      { preset: 'daily', end: { type: 'never' } },
      { preset: 'weekly', weekdays: [2], end: { type: 'count', count: 5 } },
      { preset: 'fortnightly', weekdays: [2, 4], end: { type: 'until', date: '2026-12-31' } },
      { preset: 'monthly', end: { type: 'never' } },
      { preset: 'yearly', end: { type: 'never' } },
    ] as const) {
      const rule = toRRule(r, start)!;
      expect(isReadableRRule(rule), rule).toBe(true);
      expect(readRRule(rule, start), rule).toEqual(r);
    }
  });
});

describe('a timed UNTIL is an instant', () => {
  it('HOME’s own end date still includes the whole last day', () => {
    const start = {
      allDay: false as const,
      startsAt: new Date('2026-10-14T02:30:00Z'),
      timeZone: 'Pacific/Auckland',
    };
    const rule = toRRule(
      { preset: 'weekly', weekdays: [2], end: { type: 'until', date: '2026-10-28' } },
      start,
    )!;
    expect(expandEvent(weekly(rule), '2026-10-01', '2026-12-31').map((o) => o.date)).toEqual([
      '2026-10-14',
      '2026-10-21',
      '2026-10-28',
    ]);
  });

  it('an imported UNTIL earlier in the day than the occurrence excludes it', () => {
    // UNTIL 15:00 NZDT on the 28th; the occurrence is at 15:30.
    expect(
      expandEvent(
        weekly('FREQ=WEEKLY;BYDAY=WE;UNTIL=20261028T020000Z'),
        '2026-10-01',
        '2026-12-31',
      ).map((o) => o.date),
    ).toEqual(['2026-10-14', '2026-10-21']);
  });

  it('a date-only UNTIL on a timed event keeps the whole day', () => {
    expect(
      expandEvent(weekly('FREQ=WEEKLY;BYDAY=WE;UNTIL=20261028'), '2026-10-01', '2026-12-31').map(
        (o) => o.date,
      ),
    ).toEqual(['2026-10-14', '2026-10-21', '2026-10-28']);
  });
});

describe('imported overrides through the agenda engine, unchanged', () => {
  it('the series skips each original; each moved or retitled occurrence appears once, on its own day and time', () => {
    const r = normaliseFeed(
      readFeed(SEQUENCES.seriesWithOverrides[0]),
      importWindow(TODAY),
      'Pacific/Auckland',
    );
    const events: AgendaEventInput[] = r.events.map((e, i) => ({
      id: `e${i}`,
      title: e.title ?? '',
      ...(e.time.allDay
        ? { ...e.time, rrule: e.rrule, exdates: e.exdates }
        : { ...e.time, rrule: e.rrule, exdates: e.exdates }),
    }));
    const days = agenda({
      from: '2026-10-14',
      to: '2026-11-25',
      timeZone: 'Pacific/Auckland',
      events,
    });
    const seen = days.flatMap((d) =>
      d.items.map(
        (it) =>
          `${d.date} ${it.kind === 'event' && !it.allDay ? it.startsAt.toISOString().slice(11, 16) : ''} ${'title' in it ? it.title : ''}`,
      ),
    );
    expect(seen).toEqual([
      '2026-10-14 02:30 Swimming',
      // 21 Oct: the feed's EXDATE
      '2026-10-28 02:30 Swimming',
      '2026-11-04 04:00 Swimming', // moved to 17:00
      '2026-11-11 02:30 Swimming (squad trials)', // retitled
      // 18 Nov: cancelled
      '2026-11-25 02:30 Swimming',
    ]);
  });
});
