import { readFileSync } from 'node:fs';
import { RRule } from 'rrule';
import { describe, expect, it } from 'vitest';
import { expandEvent, occursWithin, type RecurringEvent } from '@/domain/engines/recurrence';

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
