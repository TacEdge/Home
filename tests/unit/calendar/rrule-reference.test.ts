import { readFileSync } from 'node:fs';
import { RRule } from 'rrule';
import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  expandEvent,
  occursWithin,
  type RecurringEvent,
} from '@/domain/engines/recurrence';

// The recurrence engine stops the rrule library's search at the end of each
// query by relying on how rrule 2.8 iterates (src/domain/engines/recurrence.ts,
// searchNoFurtherThan; ADR 0007 §32). This compares HOME's bounded expansion
// with the library used plainly, with no bound, across rules, starts and
// windows, including windows that end exactly on an occurrence. If an rrule
// upgrade changed the iteration HOME relies on, so the bound cut early, this
// fails (the hostile-rule timing tests in review-fixes.test.ts catch the bound
// no longer working at all). Events are in UTC, so a wall clock and an instant
// are the same and the comparison needs no zone arithmetic.

const RULES = [
  'FREQ=DAILY',
  'FREQ=DAILY;INTERVAL=3',
  'FREQ=DAILY;COUNT=40',
  'FREQ=DAILY;UNTIL=20270315T090000Z',
  'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU',
  'FREQ=WEEKLY;INTERVAL=3;BYDAY=SA;WKST=SU',
  'FREQ=WEEKLY;BYDAY=TU;COUNT=60',
  'FREQ=MONTHLY',
  'FREQ=MONTHLY;BYMONTHDAY=31',
  'FREQ=MONTHLY;BYMONTHDAY=-1',
  'FREQ=MONTHLY;INTERVAL=5;BYDAY=-1FR',
  'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1',
  'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,-1',
  'FREQ=YEARLY',
  'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
  'FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29',
  'FREQ=YEARLY;BYWEEKNO=53;BYDAY=TH',
  'FREQ=YEARLY;BYWEEKNO=1,26;BYDAY=MO',
  'FREQ=YEARLY;BYMONTH=12;BYDAY=-1SU;UNTIL=20301231T235959Z',
];
const STARTS = [
  '2026-02-28T09:00:00',
  '2024-02-29T23:30:00',
  '2001-12-31T00:00:00',
  '2026-10-04T06:00:00',
];

const utc = (iso: string) => new Date(`${iso}Z`);
const event = (start: string, rrule: string): RecurringEvent => ({
  allDay: false,
  startsAt: utc(start),
  endsAt: new Date(utc(start).getTime() + 3_600_000),
  timeZone: 'UTC',
  rrule,
  exdates: [],
});
/** The plain library: every occurrence start (as a date) within the days, inclusive, unbounded search. */
const reference = (start: string, rule: string, from: string, to: string) =>
  new RRule({ ...RRule.parseString(rule), dtstart: utc(start) })
    .between(utc(`${from}T00:00:00`), utc(`${to}T23:59:59`), true)
    .map((d) => d.toISOString().slice(0, 10));

describe('bounded expansion matches the rrule library used plainly', () => {
  it('the rrule version is the one whose iteration HOME relies on', () => {
    const pkg = JSON.parse(readFileSync('node_modules/rrule/package.json', 'utf8')) as {
      version: string;
    };
    // An upgrade must re-run this file and review searchNoFurtherThan first.
    expect(pkg.version).toBe('2.8.1');
  });

  it.each(RULES)('fixed windows, short and long, near and far from the start: %s', (rule) => {
    const windows: [string, string][] = [
      ['2026-10-01', '2026-10-31'],
      ['2027-02-27', '2027-03-01'],
      ['2026-12-31', '2027-01-01'],
      ['2028-02-01', '2028-03-31'],
      ['2026-09-14', '2027-11-18'], // the import window around the scenario date
      ['2032-12-01', '2032-12-31'],
    ];
    for (const start of STARTS)
      for (const [from, to] of windows) {
        const ev = event(start, rule);
        const want = reference(start, rule, from, to);
        expect(
          expandEvent(ev, from, to).map((o) => o.date),
          `${start} ${from}…${to}`,
        ).toEqual(want);
        expect(occursWithin(ev, from, to, 1_000_000).occurs, `${start} ${from}…${to}`).toBe(
          want.length > 0,
        );
      }
  });

  it.each(RULES)('windows that end, and start, exactly on an occurrence keep it: %s', (rule) => {
    let edges = 0;
    for (const start of STARTS) {
      const all = reference(start, rule, '2026-01-01', '2031-12-31');
      // A spread of real occurrence dates: the first, a middle one, the last.
      for (const day of [...new Set([all[0], all[Math.floor(all.length / 2)], all.at(-1)])]) {
        if (!day) continue;
        const ev = event(start, rule);
        for (const [from, to] of [
          ['2026-01-01', day], // ends on it
          [day, '2031-12-31'], // starts on it
          [day, day], // only that day
        ] as const) {
          expect(
            expandEvent(ev, from, to).map((o) => o.date),
            `${start} ${from}…${to}`,
          ).toEqual(reference(start, rule, from, to));
          edges++;
        }
      }
    }
    expect(edges).toBeGreaterThan(0);
  });
});

// The agenda bound (ADR 0007 §39): expansion restarts a long-running rule two
// of its periods before the window instead of walking from DTSTART. These
// rules and starts are chosen to stress what the restart must keep: weeks
// that start on another day (WKST) with an INTERVAL, a DTSTART mid-week,
// week 1 of a year that begins in December, BYSETPOS over a week and a
// month, the last day of the month, leap days and nth weekdays.
const ANCHOR_RULES = [
  'FREQ=DAILY;INTERVAL=3;BYDAY=TH,SA',
  'FREQ=DAILY;INTERVAL=5',
  'FREQ=WEEKLY;INTERVAL=3;BYDAY=MO,TH,SU;WKST=SU',
  'FREQ=WEEKLY;INTERVAL=2;WKST=TH',
  'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
  'FREQ=MONTHLY;INTERVAL=7;BYMONTHDAY=-1',
  'FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU,-1SA',
  'FREQ=MONTHLY;BYMONTHDAY=29,30,31;BYSETPOS=1',
  'FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO,SU',
  'FREQ=YEARLY;INTERVAL=3;BYYEARDAY=60,-1',
  'FREQ=YEARLY;INTERVAL=2;BYMONTH=2;BYMONTHDAY=29',
  'FREQ=YEARLY;BYDAY=20MO',
  'FREQ=YEARLY;BYWEEKNO=53;BYDAY=FR;UNTIL=20400101T000000Z',
  // Not restarted (a part anchorFor does not carry): expanded from DTSTART.
  'FREQ=YEARLY;BYEASTER=0',
  'FREQ=YEARLY;BYEASTER=-2',
];
const OLD_STARTS = [
  '1999-12-30T07:15:00', // a Thursday, in week 52 of 1999
  '2004-02-29T18:00:00', // a leap day, a Sunday
  '2009-08-12T09:30:00', // a Wednesday
  '1987-01-01T00:00:00',
];
const FAR_WINDOWS: [string, string][] = [
  ['2026-10-14', '2026-10-20'], // a week, as Today and Forward ask
  ['2026-12-28', '2027-01-10'], // over a year boundary
  ['2027-01-01', '2027-01-07'], // from New Year's Day: 2026's week 53 reaches into it
  ['2028-02-26', '2028-03-02'], // a leap day
  ['2026-09-14', '2027-11-18'], // the import window
  ['2039-12-20', '2040-01-05'],
];

describe('the agenda bound: expansion near the window equals expansion from the start', () => {
  it.each([...RULES, ...ANCHOR_RULES])('%s', (rule) => {
    for (const start of OLD_STARTS)
      for (const [from, to] of FAR_WINDOWS) {
        const ev = event(start, rule);
        expect(
          expandEvent(ev, from, to).map((o) => o.date),
          `${start} ${from}…${to}`,
        ).toEqual(reference(start, rule, from, to));
      }
  });

  it.each(ANCHOR_RULES.filter((r) => !r.includes('BYEASTER')))(
    'restarts within three periods of the window, never with COUNT: %s',
    (rule) => {
      const o = RRule.parseString(rule);
      const dtstart = utc('1987-01-01T00:00:00');
      const windowStart = utc('2026-10-14T00:00:00');
      const anchored = anchorFor(o, dtstart, windowStart);
      expect(anchored, 'a rule decades old is restarted').not.toBeNull();
      const period = ([366, 31, 7, 1] as const)[o.freq as 0 | 1 | 2 | 3] * (o.interval ?? 1);
      const gapDays = (windowStart.getTime() - anchored!.dtstart!.getTime()) / 86_400_000;
      expect(gapDays).toBeGreaterThan(0);
      expect(gapDays).toBeLessThanOrEqual(3 * period + 7);
      expect(anchorFor({ ...o, count: 10 }, dtstart, windowStart)).toBeNull();
      // Near the start, nothing to gain: no restart.
      expect(anchorFor(o, dtstart, utc('1987-01-02T00:00:00'))).toBeNull();
    },
  );

  it('keeps a Today read of a series begun decades ago small', () => {
    const ev = event('1950-01-01T08:00:00', 'FREQ=DAILY');
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) expandEvent(ev, '2026-10-14', '2026-10-20');
    const perRead = (performance.now() - t0) / 200;
    // Walking 76 years of days was about 28,000 steps (~120 ms) a read.
    expect(perRead).toBeLessThan(5);
    expect(expandEvent(ev, '2026-10-14', '2026-10-20')).toHaveLength(7);
  });
});

describe('rules the restart does not carry are never rewritten (ADR 0007 §42)', () => {
  it('Easter: the right Sunday in 2026 and 2027, from a series begun decades ago', () => {
    const ev = event('1990-04-15T09:00:00', 'FREQ=YEARLY;BYEASTER=0');
    expect(expandEvent(ev, '2026-01-01', '2027-12-31').map((o) => o.date)).toEqual([
      '2026-04-05',
      '2027-03-28',
    ]);
    expect(expandEvent(ev, '2026-04-05', '2026-04-05').map((o) => o.date)).toEqual(['2026-04-05']);
  });

  it('a rule with any part outside the carried set falls back to expansion from DTSTART', () => {
    const o = RRule.parseString('FREQ=YEARLY;BYEASTER=0');
    expect(anchorFor(o, utc('1990-04-15T09:00:00'), utc('2026-10-14T00:00:00'))).toBeNull();
    // A supported rule of the same age is restarted.
    expect(
      anchorFor(
        RRule.parseString('FREQ=YEARLY'),
        utc('1990-04-15T09:00:00'),
        utc('2026-10-14T00:00:00'),
      ),
    ).not.toBeNull();
  });
});
