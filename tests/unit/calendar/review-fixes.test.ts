import { describe, expect, it } from 'vitest';
import { importWindow, type ExternalEvent, type FetchResult } from '@/domain/calendar/provider';
import { expandEvent, occursWithin, type RecurringEvent } from '@/domain/engines/recurrence';
import { readFeed } from '@/integrations/calendar/ics/feed';
import { normaliseFeed } from '@/integrations/calendar/ics/normalise';
import { googleFeed, nzEvent, vevent } from '../../fixtures/calendars/google';
import { SEQUENCES, TODAY } from '../../fixtures/calendars/sequences';

// Regressions for the Opus review of PR #44 (ADR 0007 §24–26, §28, §32):
// a start in the spring-forward gap keeps the event's length; the feed is
// unfolded before HOME isolates its own properties; an override's identity
// never depends on its series; recurrence and EXDATE work is bounded.

const RANGE = importWindow(TODAY);
const read = (feed: string, home = 'Pacific/Auckland'): FetchResult =>
  normaliseFeed(readFeed(feed), RANGE, home);
const byUid = (r: FetchResult, uid: string, rid: string | null = null) =>
  r.events.find((e) => e.uid === uid && e.recurrenceId === rid)!;
const minutes = (e: ExternalEvent) => {
  if (e.time.allDay) throw new Error('timed only');
  return (e.time.endsAt.getTime() - e.time.startsAt.getTime()) / 60_000;
};
const startOf = (e: ExternalEvent) => (e.time.allDay ? '' : e.time.startsAt.toISOString());
const asRecurring = (e: ExternalEvent): RecurringEvent =>
  e.time.allDay
    ? { ...e.time, rrule: e.rrule, exdates: e.exdates }
    : { ...e.time, rrule: e.rrule, exdates: e.exdates };

describe('a start in the spring-forward gap keeps the event’s length (Sunday 27 September 2026, Pacific/Auckland)', () => {
  const r = read(
    googleFeed([
      nzEvent({ uid: 'gap', start: '20260927T023000', end: '20260927T033000', summary: 'x' }),
      nzEvent({ uid: 'gap-hour', start: '20260927T020000', end: '20260927T030000', summary: 'x' }),
      nzEvent({ uid: 'gap-short', start: '20260927T020000', end: '20260927T023000', summary: 'x' }),
      nzEvent({ uid: 'gap-long', start: '20260927T023000', end: '20260927T050000', summary: 'x' }),
      nzEvent({ uid: 'span', start: '20260927T013000', end: '20260927T033000', summary: 'x' }),
      nzEvent({
        uid: 'end-in-gap',
        start: '20260927T013000',
        end: '20260927T023000',
        summary: 'x',
      }),
      nzEvent({
        uid: 'series',
        start: '20260927T023000',
        end: '20260927T033000',
        summary: 'x',
        rrule: 'FREQ=WEEKLY;COUNT=3',
      }),
      nzEvent({
        uid: 'swim',
        start: '20260920T023000',
        end: '20260920T033000',
        summary: 'x',
        rrule: 'FREQ=WEEKLY;COUNT=3',
      }),
      nzEvent({
        uid: 'swim',
        recurrenceId: '20260927T023000',
        start: '20260927T023000',
        end: '20260927T040000',
        summary: 'moved',
      }),
      nzEvent({ uid: 'fallback', start: '20270404T023000', end: '20270404T033000', summary: 'x' }),
    ]),
  );

  it('a one-off 02:30–03:30 starts at 03:30 NZDT and still lasts an hour', () => {
    const e = byUid(r, 'gap');
    expect(startOf(e)).toBe('2026-09-26T14:30:00.000Z'); // 03:30 NZDT
    expect(minutes(e)).toBe(60);
  });

  it('02:00–03:00 lasts an hour, 02:00–02:30 half an hour, 02:30–05:00 two and a half', () => {
    expect([
      minutes(byUid(r, 'gap-hour')),
      minutes(byUid(r, 'gap-short')),
      minutes(byUid(r, 'gap-long')),
    ]).toEqual([60, 30, 150]);
  });

  it('a series beginning in the gap: every occurrence keeps its hour', () => {
    const occ = expandEvent(asRecurring(byUid(r, 'series')), '2026-09-01', '2026-10-31');
    expect(
      occ.map((o) => (o.allDay ? 0 : (o.endsAt.getTime() - o.startsAt.getTime()) / 60_000)),
    ).toEqual([60, 60, 60]);
  });

  it('a moved override beginning in the gap keeps its ninety minutes', () => {
    const e = byUid(r, 'swim', '2026-09-26T14:30:00Z');
    expect(minutes(e)).toBe(90);
  });

  it('a start that exists keeps the real elapsed time: 01:30–03:30 across the change is one hour', () => {
    expect(minutes(byUid(r, 'span'))).toBe(60);
    expect(minutes(byUid(r, 'end-in-gap'))).toBe(60);
  });

  it('fall-back is unchanged: 02:30 is its first instance, so 02:30–03:30 on 4 April 2027 lasts two hours', () => {
    const e = byUid(r, 'fallback');
    expect(startOf(e)).toBe('2027-04-03T13:30:00.000Z'); // 02:30 NZDT
    expect(minutes(e)).toBe(120);
  });

  it('a start in a non-NZ gap behaves the same (New York, 14 March 2027)', () => {
    const e = read(
      googleFeed([
        vevent({
          UID: 'ny',
          DTSTART: ';TZID=America/New_York:20270314T023000',
          DTEND: ';TZID=America/New_York:20270314T033000',
          SUMMARY: 'x',
        }),
      ]),
    ).events[0]!;
    expect(startOf(e)).toBe('2027-03-14T07:30:00.000Z'); // 03:30 EDT
    expect(minutes(e)).toBe(60);
  });

  it('genuinely zero-length sources stay zero-length; nothing is lengthened from nothing', () => {
    const z = read(
      googleFeed([
        vevent({ UID: 'z1', DTSTART: ';TZID=Pacific/Auckland:20260927T023000', SUMMARY: 'x' }),
        vevent({
          UID: 'z2',
          DTSTART: ';TZID=Pacific/Auckland:20260927T023000',
          DTEND: ';TZID=Pacific/Auckland:20260927T023000',
          SUMMARY: 'x',
        }),
      ]),
    );
    expect(z.events.map(minutes)).toEqual([0, 0]);
  });

  it('corpus invariant: every source with a positive length keeps a positive length, at every quarter hour of both change days', () => {
    const events: string[] = [];
    const expected = new Map<string, number>();
    for (const day of ['20260927', '20270404'])
      for (let h = 0; h < 5; h++)
        for (const m of [0, 15, 30, 45])
          for (const len of [15, 30, 60, 90, 180]) {
            const startMin = h * 60 + m;
            const endMin = startMin + len;
            const hm = (t: number) =>
              `${String(Math.floor(t / 60)).padStart(2, '0')}${String(t % 60).padStart(2, '0')}00`;
            const uid = `inv-${day}-${hm(startMin)}-${len}`;
            events.push(
              nzEvent({
                uid,
                start: `${day}T${hm(startMin)}`,
                end: `${day}T${hm(endMin)}`,
                summary: 'x',
              }),
            );
            expected.set(uid, len);
          }
    const out = read(googleFeed(events));
    expect(out.events).toHaveLength(expected.size);
    for (const e of out.events) expect(minutes(e), e.uid).toBeGreaterThan(0);
    // And across the corpus sequences: no accepted timed event ends before it starts.
    for (const feeds of Object.values(SEQUENCES))
      for (const f of feeds)
        for (const e of read(f).events)
          if (!e.time.allDay) expect(minutes(e), e.uid).toBeGreaterThanOrEqual(0);
  });
});

describe('the feed is unfolded before HOME isolates its own properties', () => {
  /** Folds a content line inside its property name, as RFC 5545 allows. */
  const foldName = (feed: string, name: string, at: number) =>
    feed.replace(
      new RegExp(`\\r\\n${name}([;:])`, 'g'),
      `\r\n${name.slice(0, at)}\r\n ${name.slice(at)}$1`,
    );
  const base = googleFeed([
    nzEvent({
      uid: 's',
      start: '20261014T090000',
      end: '20261014T100000',
      summary: 'Series',
      rrule: 'FREQ=DAILY;COUNT=5',
      exdate: ['20261015T090000'],
    }),
    nzEvent({
      uid: 's',
      recurrenceId: '20261016T090000',
      start: '20261016T120000',
      end: '20261016T130000',
      summary: 'Moved',
    }),
  ]);
  const days = (r: FetchResult) =>
    expandEvent(asRecurring(byUid(r, 's')), '2026-10-01', '2026-10-31').map((o) => o.date);
  const want = read(base);

  it('the unfolded control: an exdate, a moved occurrence, the rest of the series', () => {
    expect(days(want)).toEqual(['2026-10-14', '2026-10-17', '2026-10-18']);
    expect(want.events.map((e) => e.recurrenceId)).toEqual([null, '2026-10-15T20:00:00Z']);
  });

  it('a folded EXDATE name cannot invent the occurrence it removes', () => {
    const f = foldName(base, 'EXDATE', 3);
    expect(f).toContain('EXD\r\n ATE;TZID');
    expect(read(f)).toEqual(want);
  });

  it('a folded RRULE name keeps the series', () => {
    const f = foldName(base, 'RRULE', 2);
    expect(f).toContain('RR\r\n ULE:FREQ');
    expect(read(f)).toEqual(want);
  });

  it('a folded RECURRENCE-ID name stays an override, never a second series', () => {
    const f = foldName(base, 'RECURRENCE-ID', 5);
    expect(f).toContain('RECUR\r\n RENCE-ID;TZID');
    expect(read(f)).toEqual(want);
  });

  it('a folded DTSTART name still reads the start', () => {
    const f = foldName(base, 'DTSTART', 4);
    expect(f).toContain('DTST\r\n ART;TZID');
    expect(read(f)).toEqual(want);
  });

  it('folded BEGIN and END lines still delimit events; a cut-off feed still fails safely', () => {
    const f = base
      .replace(/\r\nBEGIN:VEVENT/g, '\r\nBEG\r\n IN:VEVENT')
      .replace(/\r\nEND:VEVENT/g, '\r\nEND:VEV\r\n ENT');
    expect(read(f)).toEqual(want);
    expect(() => readFeed(base.slice(0, base.length / 2))).toThrow('not_a_calendar');
    expect(() => readFeed(`${base.replace(/END:VCALENDAR\r\n$/, '')}END:VCAL`)).toThrow(
      'not_a_calendar',
    );
  });

  it('only allowlisted properties reach node-ical: a repeated DUE or any other stray property no longer sinks the event', () => {
    const r = read(
      googleFeed([
        vevent(
          {
            UID: 'd',
            DTSTART: '20261015T090000Z',
            SUMMARY: 'Due twice',
            DUE: ['20261015T090000Z', '20261016T090000Z'],
          },
          [
            'COMPLETED:notadate',
            'GEO:not;a;geo',
            'X-UNKNOWN;P="a:b":c',
            'BEGIN:VALARM',
            'TRIGGER:-PT5M',
            'END:VALARM',
          ],
        ),
      ]),
    );
    expect(r.events.map((e) => e.title)).toEqual(['Due twice']);
    expect(r.skipped).toBe(0);
  });
});

describe('an override’s identity is its RECURRENCE-ID, whether or not its series is present', () => {
  const series = nzEvent({
    uid: 'o',
    start: '20261014T153000',
    end: '20261014T163000',
    summary: 'S',
    rrule: 'FREQ=WEEKLY',
  });
  const dateOverride = vevent({
    UID: 'o',
    'RECURRENCE-ID': ';VALUE=DATE:20261021',
    DTSTART: ';TZID=Pacific/Auckland:20261021T180000',
    DTEND: ';TZID=Pacific/Auckland:20261021T190000',
    SUMMARY: 'Moved by date',
  });
  const timeOverride = nzEvent({
    uid: 'o',
    recurrenceId: '20261028T153000',
    start: '20261028T170000',
    end: '20261028T180000',
    summary: 'Moved',
  });
  const ids = (r: FetchResult) => r.events.filter((e) => e.recurrenceId).map((e) => e.recurrenceId);

  it('orphans keep their own identities: a DATE stays a date, a DATE-TIME the instant its own zone names', () => {
    const r = read(googleFeed([dateOverride, timeOverride]));
    expect(ids(r)).toEqual(['2026-10-21', '2026-10-28T02:30:00Z']);
    expect(r.notes.orphanOverride).toBe(2);
  });

  it('when the series appears, the same overrides have identical identities; only the series’ exdates are in its terms', () => {
    const r = read(googleFeed([series, dateOverride, timeOverride]));
    expect(ids(r)).toEqual(['2026-10-21', '2026-10-28T02:30:00Z']);
    expect(byUid(r, 'o').exdates).toEqual(['2026-10-21T02:30:00Z', '2026-10-28T02:30:00Z']);
  });

  it('a DATE-TIME identity is the same instant whatever zone spelling names it', () => {
    const utc = vevent({
      UID: 'o',
      'RECURRENCE-ID': '20261028T023000Z',
      DTSTART: '20261028T040000Z',
      SUMMARY: 'Moved',
    });
    expect(ids(read(googleFeed([series, utc])))).toEqual(['2026-10-28T02:30:00Z']);
  });

  it('feed order never changes an identity', () => {
    const a = read(googleFeed([series, dateOverride, timeOverride]));
    const b = read(googleFeed([timeOverride, dateOverride, series]));
    expect(b).toEqual(a);
  });

  it('two revisions of one override are one identity, the latest kept', () => {
    const v2 = timeOverride
      .replace('SEQUENCE:0', 'SEQUENCE:4')
      .replace('SUMMARY:Moved', 'SUMMARY:Moved again');
    for (const order of [
      [timeOverride, v2],
      [v2, timeOverride],
    ]) {
      const r = read(googleFeed(order));
      expect(r.events.map((e) => e.title)).toEqual(['Moved again']);
      expect(r.notes.duplicate).toBe(1);
    }
  });
});

describe('recurrence and EXDATE work is bounded', () => {
  const hostile = [
    'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=DAILY;BYYEARDAY=366;BYMONTH=1',
    'FREQ=WEEKLY;BYSETPOS=5;BYDAY=MO',
  ];
  const old = (rrule: string): RecurringEvent => ({
    allDay: false,
    startsAt: new Date('1990-01-01T00:00:00Z'),
    endsAt: new Date('1990-01-01T01:00:00Z'),
    timeZone: 'Pacific/Auckland',
    rrule,
    exdates: [],
  });
  const timed = <T>(fn: () => T): [T, number] => {
    const t0 = performance.now();
    const v = fn();
    return [v, performance.now() - t0];
  };

  it('a rule that never yields is searched only to the end of the query (it once ran to the year 9999, ~6 s each)', () => {
    for (const rule of hostile) {
      const [occ, expandMs] = timed(() => expandEvent(old(rule), '2026-10-01', '2027-11-30'));
      const [within, withinMs] = timed(() =>
        occursWithin(old(rule), '2026-10-01', '2027-11-30', 100_000),
      );
      expect(occ, rule).toEqual([]);
      expect(within.occurs, rule).toBe(false);
      expect(expandMs, rule).toBeLessThan(500);
      expect(withinMs, rule).toBeLessThan(500);
    }
  });

  it('…and the same on import, for a whole feed of them', () => {
    const feed = googleFeed(
      hostile.flatMap((rule, i) =>
        [0, 1, 2].map((j) =>
          vevent({
            UID: `h${i}-${j}`,
            DTSTART: ';TZID=Pacific/Auckland:19900101T090000',
            RRULE: rule,
            SUMMARY: 'x',
          }),
        ),
      ),
    );
    const [r, ms] = timed(() => read(feed));
    expect(r.events).toEqual([]);
    expect(ms).toBeLessThan(3000);
  });

  it('the bound changes no result: rules expand exactly as across an unlimited window, up to the window’s last day', () => {
    for (const rule of [
      'FREQ=DAILY;INTERVAL=3',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      'FREQ=MONTHLY;BYDAY=-1FR',
      'FREQ=MONTHLY;BYMONTHDAY=31',
      'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
      'FREQ=WEEKLY;BYDAY=TU;COUNT=2000',
      'FREQ=DAILY;UNTIL=20270101T000000Z',
    ]) {
      const narrow = expandEvent(old(rule), '2026-10-01', '2028-03-31');
      const wide = expandEvent(old(rule), '1990-01-01', '2028-03-31').filter(
        (o) => o.date >= '2026-10-01',
      );
      expect(narrow, rule).toEqual(wide);
    }
  });

  it('a huge EXDATE list is counted and refused before any value is read', () => {
    const values = Array.from(
      { length: 300_000 },
      (_, i) =>
        `2027${String(1 + (i % 12)).padStart(2, '0')}${String(1 + (i % 28)).padStart(2, '0')}T090000`,
    );
    const feed = googleFeed([
      vevent({
        UID: 'x',
        DTSTART: ';TZID=Pacific/Auckland:20261014T090000',
        RRULE: 'FREQ=DAILY',
        EXDATE: `;TZID=Pacific/Auckland:${values.join(',')}`,
        SUMMARY: 'x',
      }),
    ]);
    expect(feed.length).toBeGreaterThan(4_000_000);
    const [r, ms] = timed(() => read(feed));
    expect(r.events[0]).toMatchObject({ rrule: null, recurrence: 'unreadable', exdates: [] });
    expect(r.notes.unreadableRecurrence).toBe(1);
    expect(ms).toBeLessThan(2000); // was 47 s when every value was read first
  });

  it('exactly 500 exdates are still read', () => {
    const values = Array.from({ length: 500 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 9, 15 + i));
      return d.toISOString().slice(0, 10).replaceAll('-', '');
    });
    const r = read(
      googleFeed([
        vevent({
          UID: 'x',
          DTSTART: ';VALUE=DATE:20261014',
          RRULE: 'FREQ=DAILY',
          EXDATE: `;VALUE=DATE:${values.join(',')}`,
          SUMMARY: 'x',
        }),
      ]),
    );
    expect(r.events[0]).toMatchObject({ recurrence: 'rule' });
    expect(r.events[0]!.exdates).toHaveLength(500);
  });
});
