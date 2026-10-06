import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IMPORT_LIMITS,
  importWindow,
  type ExternalEvent,
  type FetchResult,
} from '@/domain/calendar/provider';
import { expandEvent } from '@/domain/engines/recurrence';
import { wallClockOf } from '@/lib/dates';
import { MAX_FEED_STEPS, MAX_RULE_STEPS } from '@/integrations/calendar/ics/normalise';
import { icsProvider, type FeedFetcher } from '@/integrations/calendar/ics/provider';
import { SafeFetchError, type SafeFetchErrorCode } from '@/integrations/net/safe-fetch';
import * as safeFetch from '@/integrations/net/safe-fetch';
import {
  SYNTHETIC_ADDRESS,
  SYNTHETIC_WEBCAL,
  allDayEvent,
  googleFeed,
  nzEvent,
  vevent,
} from '../../fixtures/calendars/google';
import { SEQUENCES, TODAY } from '../../fixtures/calendars/sequences';

// The `ics` adapter beyond the shared contract (M4 contract §3.1, §3.5, §4.3,
// §8.1): the one request path, error mapping, every recurrence and time-zone
// case, the window and limits. Synthetic feeds only, through an injected
// fetcher; no network.

const RANGE = importWindow(TODAY);
const CAL = { id: 'default', name: null };

async function read(
  feed: string,
  opts: { home?: string; range?: typeof RANGE } = {},
): Promise<FetchResult> {
  const p = icsProvider({
    homeTimeZone: opts.home ?? 'Pacific/Auckland',
    fetchFeed: async () => feed,
  });
  return p.fetchEvents({ kind: 'ics', address: SYNTHETIC_ADDRESS }, CAL, opts.range ?? RANGE);
}
const only = (r: FetchResult) => {
  expect(r.events).toHaveLength(1);
  return r.events[0]!;
};
const byUid = (r: FetchResult, uid: string, rid: string | null = null) =>
  r.events.find((e) => e.uid === uid && e.recurrenceId === rid)!;

/** Occurrences as local "YYYY-MM-DD HH:MM" in the event's zone (or the date, all-day). */
function occurrences(e: ExternalEvent, from = '2026-01-01', to = '2028-12-31'): string[] {
  const ev = e.time.allDay
    ? { ...e.time, rrule: e.rrule, exdates: e.exdates }
    : { ...e.time, rrule: e.rrule, exdates: e.exdates };
  return expandEvent(ev, from, to).map((o) => {
    if (o.allDay) return o.date;
    const w = wallClockOf(o.startsAt, o.timeZone);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${o.date} ${p(w.hour)}:${p(w.minute)}`;
  });
}

const timed = (props: Record<string, string | string[] | undefined>, extra: string[] = []) =>
  vevent({ UID: 'e@example.test', SUMMARY: 'Synthetic', ...props }, extra);

afterEach(() => vi.restoreAllMocks());

describe('the one request path', () => {
  it('the fetcher receives only the approved https form of the address (webcal rewritten)', async () => {
    const seen: string[] = [];
    const fetchFeed: FeedFetcher = async (a) => {
      seen.push(a);
      return SEQUENCES.initial[0];
    };
    const p = icsProvider({ homeTimeZone: 'Pacific/Auckland', fetchFeed });
    await p.fetchEvents({ kind: 'ics', address: SYNTHETIC_WEBCAL }, CAL, RANGE);
    await p
      .listCalendars({
        kind: 'ics',
        address: `  ${SYNTHETIC_ADDRESS.toUpperCase().replace('HTTPS://CALENDAR.GOOGLE.COM', 'https://CALENDAR.google.com')}`,
      })
      .catch(() => []);
    expect(seen[0]).toBe(SYNTHETIC_ADDRESS);
  });

  it('a refused address is never fetched', async () => {
    const fetchFeed = vi.fn(async () => SEQUENCES.initial[0]);
    const p = icsProvider({ homeTimeZone: 'Pacific/Auckland', fetchFeed });
    for (const address of [
      'https://evil.example.test/calendar/ical/x/private-0123456789abcdef/basic.ics',
      'https://calendar.google.com.evil.example.test/calendar/ical/x/private-0123456789abcdef/basic.ics',
      'http://169.254.169.254/latest/meta-data/',
      'https://user@calendar.google.com/calendar/ical/x/private-0123456789abcdef/basic.ics',
    ])
      await expect(p.fetchEvents({ kind: 'ics', address }, CAL, RANGE)).rejects.toMatchObject({
        code: 'address_rejected',
      });
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it('without an injected fetcher, the feed comes only through safeGet with the frozen Google policy', async () => {
    const spy = vi.spyOn(safeFetch, 'safeGet').mockResolvedValue({
      text: SEQUENCES.initial[0],
      bytes: 1,
      contentType: 'text/calendar',
    });
    const p = icsProvider({ homeTimeZone: 'Pacific/Auckland' });
    const r = await p.fetchEvents({ kind: 'ics', address: SYNTHETIC_WEBCAL }, CAL, RANGE);
    expect(r.events.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(SYNTHETIC_ADDRESS);
    expect(spy.mock.calls[0]![1]).toEqual({ policy: safeFetch.googleCalendarPolicy });
    expect(Object.isFrozen(spy.mock.calls[0]![1]!.policy)).toBe(true);
  });

  it('the calendar code calls no other network API (no fetch, http, https, net or dns)', () => {
    const dir = 'src/integrations/calendar';
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) =>
      f.endsWith('.ts'),
    );
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/\bfetch\s*\(|from 'node:(http|https|net|dns|tls)'|require\(/);
      expect(src, f).not.toMatch(/\bconsole\.|\blog\.(debug|info|warn|error)\(/);
    }
  });

  it('every fetch failure maps to a §3.8 status, carrying nothing else', async () => {
    const expected: Record<SafeFetchErrorCode, string> = {
      unsupported_destination: 'address_rejected',
      redirect_refused: 'address_rejected',
      address_rejected: 'address_rejected',
      forbidden_destination: 'unreachable',
      timeout: 'unreachable',
      unreachable: 'unreachable',
      too_large: 'too_large',
      bad_response: 'not_a_calendar',
    };
    for (const [code, status] of Object.entries(expected)) {
      const p = icsProvider({
        homeTimeZone: 'Pacific/Auckland',
        fetchFeed: async () => {
          throw new SafeFetchError(code as SafeFetchErrorCode);
        },
      });
      await expect(
        p.fetchEvents({ kind: 'ics', address: SYNTHETIC_ADDRESS }, CAL, RANGE),
      ).rejects.toMatchObject({
        code: status,
        message: status,
      });
    }
    // Anything unexpected from the network is unreachable, its message dropped.
    const p = icsProvider({
      homeTimeZone: 'Pacific/Auckland',
      fetchFeed: async () => {
        throw new Error(`boom ${SYNTHETIC_ADDRESS}`);
      },
    });
    const e = await p
      .fetchEvents({ kind: 'ics', address: SYNTHETIC_ADDRESS }, CAL, RANGE)
      .catch((x: Error) => x);
    expect(e).toMatchObject({ code: 'unreachable', message: 'unreachable' });
    expect(JSON.stringify(e) + String(e) + (e as Error).stack).not.toContain('private-');
  });

  it('a cut-off feed (no END:VCALENDAR) is not a calendar, so nothing reads as deleted', async () => {
    const whole = SEQUENCES.initial[0];
    await expect(read(whole.slice(0, whole.length / 2))).rejects.toMatchObject({
      code: 'not_a_calendar',
    });
    await expect(read(whole.replace(/END:VCALENDAR\r\n$/, ''))).rejects.toMatchObject({
      code: 'not_a_calendar',
    });
  });

  it('the homeTimeZone must be a real zone', () => {
    expect(() => icsProvider({ homeTimeZone: 'Mars/Olympus' })).toThrow();
  });
});

describe('feed syntax', () => {
  it('folded lines, LF-only line ends, a BOM and lower-case names all read', async () => {
    const long = 'A very long synthetic title that will certainly be folded across several lines ✓';
    const feed = googleFeed([
      nzEvent({
        uid: 'f@example.test',
        start: '20261015T090000',
        end: '20261015T100000',
        summary: long,
      }),
    ]);
    expect(feed).toMatch(/\r\n /); // folded
    expect(only(await read(feed)).title).toBe(long);
    expect(only(await read(`\uFEFF${feed.replace(/\r\n/g, '\n')}`)).title).toBe(long);
    const lower = feed.replace('DTSTART;TZID', 'dtstart;TZID').replace('SUMMARY:', 'summary:');
    expect(only(await read(lower)).time).toMatchObject({
      startsAt: new Date('2026-10-14T20:00:00Z'),
    });
  });

  it('TEXT escapes are undone once: commas, semicolons, backslashes and line breaks', async () => {
    const feed = googleFeed([
      timed({
        DTSTART: '20261015T090000Z',
        SUMMARY: 'Bread\\, milk\\; eggs \\\\ more',
        DESCRIPTION: 'One\\nTwo',
      }),
    ]);
    const e = only(await read(feed));
    expect(e.title).toBe('Bread, milk; eggs \\ more');
    expect(e.description).toBe('One\nTwo');
  });

  it('VTIMEZONE definitions are never used: a custom zone name is unknown, even with rules beside it', async () => {
    const feed = googleFeed(
      [
        timed({
          DTSTART: ';TZID=Customized Time Zone:20261015T090000',
          DTEND: ';TZID=Customized Time Zone:20261015T100000',
        }),
      ],
      { zone: 'Pacific/Auckland' },
    ).replace(
      'BEGIN:VEVENT',
      'BEGIN:VTIMEZONE\r\nTZID:Customized Time Zone\r\nBEGIN:STANDARD\r\nDTSTART:16010101T000000\r\nTZOFFSETFROM:+0500\r\nTZOFFSETTO:+0500\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT',
    );
    const r = await read(feed);
    expect(r.notes.unknownZone).toBe(1);
    // Floating in the calendar's zone, not +05:00.
    expect(only(r).time).toMatchObject({
      startsAt: new Date('2026-10-14T20:00:00Z'),
      timeZone: 'Pacific/Auckland',
    });
  });

  it('other components (VTODO, VJOURNAL, VFREEBUSY) are passed over', async () => {
    const feed = googleFeed([timed({ DTSTART: '20261015T090000Z' })]).replace(
      'BEGIN:VEVENT',
      'BEGIN:VTODO\r\nUID:todo@example.test\r\nSUMMARY:Not an event\r\nEND:VTODO\r\nBEGIN:VEVENT',
    );
    const r = await read(feed);
    expect(r.events.map((e) => e.uid)).toEqual(['e@example.test']);
    expect(r.skipped).toBe(0);
  });
});

describe('recurrence (M4 Package 3 cases)', () => {
  const series = (rrule: string, extra: Record<string, string | string[]> = {}) =>
    googleFeed([
      nzEvent({
        uid: 's@example.test',
        start: '20261014T153000',
        end: '20261014T163000',
        summary: 'Series',
        rrule,
      }),
    ]).replace(
      'UID:s@example.test',
      `UID:s@example.test${Object.entries(extra)
        .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `\r\n${k}${x}`))
        .join('')}`,
    );

  it('a non-recurring timed event and a non-recurring all-day event', async () => {
    const r = await read(SEQUENCES.initial[0]);
    expect(occurrences(byUid(r, 'dentist-91a@example.test'))).toEqual(['2026-10-22 10:00']);
    expect(occurrences(byUid(r, 'school-holidays-55d@example.test'))).toEqual(['2026-10-20']);
  });

  it('daily, weekly, fortnightly, monthly and yearly rules expand as the provider says', async () => {
    const cases: [string, string[]][] = [
      ['FREQ=DAILY;COUNT=3', ['2026-10-14 15:30', '2026-10-15 15:30', '2026-10-16 15:30']],
      [
        'FREQ=WEEKLY;BYDAY=WE;COUNT=3',
        ['2026-10-14 15:30', '2026-10-21 15:30', '2026-10-28 15:30'],
      ],
      [
        'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=3',
        ['2026-10-14 15:30', '2026-10-28 15:30', '2026-11-11 15:30'],
      ],
      ['FREQ=MONTHLY;COUNT=3', ['2026-10-14 15:30', '2026-11-14 15:30', '2026-12-14 15:30']],
      ['FREQ=YEARLY;COUNT=3', ['2026-10-14 15:30', '2027-10-14 15:30', '2028-10-14 15:30']],
    ];
    for (const [rule, want] of cases) {
      const e = only(await read(series(rule)));
      expect(e.rrule, rule).toBe(rule);
      expect(e.recurrence).toBe('rule');
      expect(occurrences(e), rule).toEqual(want);
    }
  });

  it('a custom but valid rule is kept exactly and expanded (second Tuesday, last Friday)', async () => {
    const e = only(await read(series('FREQ=MONTHLY;BYDAY=2TU;COUNT=3')));
    expect(e.rrule).toBe('FREQ=MONTHLY;BYDAY=2TU;COUNT=3');
    expect(occurrences(e)).toEqual(['2026-11-10 15:30', '2026-12-08 15:30', '2027-01-12 15:30']);
    const f = only(await read(series('FREQ=MONTHLY;BYDAY=-1FR;BYMONTH=1,7;COUNT=2')));
    expect(occurrences(f)).toEqual(['2027-01-29 15:30', '2027-07-30 15:30']);
  });

  it('EXDATE removes the occurrence it names, with its own TZID, in UTC, or as a date', async () => {
    const e = only(
      await read(
        series('FREQ=WEEKLY;BYDAY=WE;COUNT=5', {
          EXDATE: [
            ';TZID=Pacific/Auckland:20261021T153000',
            ':20261028T023000Z',
            ';VALUE=DATE:20261104',
          ],
        }),
      ),
    );
    // A date on a timed series names the series' own time that day.
    expect(e.exdates).toEqual([
      '2026-10-21T02:30:00Z',
      '2026-10-28T02:30:00Z',
      '2026-11-04T02:30:00Z',
    ]);
    expect(occurrences(e)).toEqual(['2026-10-14 15:30', '2026-11-11 15:30']);
  });

  it('a moved occurrence names its original and its replacement; the series no longer shows the original', async () => {
    const r = await read(SEQUENCES.seriesWithOverrides[0]);
    const s = byUid(r, 'swim-series-7c1@example.test');
    const moved = byUid(r, 'swim-series-7c1@example.test', '2026-11-04T02:30:00Z');
    expect(occurrences(s, '2026-10-14', '2026-11-25')).toEqual([
      '2026-10-14 15:30',
      '2026-10-28 15:30',
      '2026-11-25 15:30',
    ]);
    expect(occurrences(moved)).toEqual(['2026-11-04 17:00']);
  });

  it('a cancelled occurrence names the occurrence it removes and adds no event', async () => {
    const r = await read(SEQUENCES.cancelledOccurrence[1]);
    const s = byUid(r, 'swim-series-7c1@example.test');
    expect(s.cancelledOccurrences).toEqual(['2026-10-28T02:30:00Z']);
    expect(occurrences(s, '2026-10-14', '2026-11-04')).toEqual([
      '2026-10-14 15:30',
      '2026-10-21 15:30',
      '2026-11-04 15:30',
    ]);
    expect(r.events.filter((e) => e.recurrenceId)).toEqual([]);
  });

  it('multiple overrides of one series, in any order, each keep their identity', async () => {
    const r = await read(SEQUENCES.seriesWithOverrides[0]);
    expect(r.events.map((e) => e.recurrenceId)).toEqual([
      null,
      '2026-11-04T02:30:00Z',
      '2026-11-11T02:30:00Z',
    ]);
  });

  it('an all-day series: overrides and cancellations are named by date', async () => {
    const feed = googleFeed([
      allDayEvent({
        uid: 'bins@example.test',
        start: '20261019',
        end: '20261020',
        summary: 'Bins',
        rrule: 'FREQ=WEEKLY;COUNT=4',
      }),
      allDayEvent({
        uid: 'bins@example.test',
        recurrenceId: '20261026',
        start: '20261027',
        end: '20261028',
        summary: 'Bins (late)',
      }),
      allDayEvent({
        uid: 'bins@example.test',
        recurrenceId: '20261102',
        start: '20261102',
        end: '20261103',
        summary: 'Bins',
        status: 'CANCELLED',
      }),
    ]);
    const r = await read(feed);
    const s = byUid(r, 'bins@example.test');
    expect(s.exdates).toEqual(['2026-10-26', '2026-11-02']);
    expect(s.cancelledOccurrences).toEqual(['2026-11-02']);
    expect(occurrences(s)).toEqual(['2026-10-19', '2026-11-09']);
    expect(occurrences(byUid(r, 'bins@example.test', '2026-10-26'))).toEqual(['2026-10-27']);
  });

  it('a RECURRENCE-ID written as a date keeps a date identity; the series’ exdate is its own time that day', async () => {
    const feed = googleFeed([
      nzEvent({
        uid: 's@example.test',
        start: '20261014T153000',
        end: '20261014T163000',
        summary: 'S',
        rrule: 'FREQ=WEEKLY;COUNT=3',
      }),
      timed({
        UID: 's@example.test',
        'RECURRENCE-ID': ';VALUE=DATE:20261021',
        DTSTART: ';TZID=Pacific/Auckland:20261021T180000',
      }),
    ]);
    const r = await read(feed);
    expect(r.events.map((e) => e.recurrenceId)).toEqual([null, '2026-10-21']);
    expect(r.events[0]!.exdates).toEqual(['2026-10-21T02:30:00Z']);
  });

  it('a malformed or unreadable rule never invents occurrences: the first one only, counted', async () => {
    for (const rule of [
      'FREQ=SOMETIMES',
      'FREQ=WEEKLY;BYDAY=XX',
      'BYDAY=MO',
      'FREQ=WEEKLY;COUNT=3;UNTIL=20261231T000000Z',
      'FREQ=DAILY;FREQ=WEEKLY',
      'FREQ=DAILY;=3',
      'FREQ=HOURLY;COUNT=5',
      'FREQ=MINUTELY',
      'FREQ=DAILY;BYHOUR=9,17',
      'FREQ=DAILY;UNTIL=notadate',
      `FREQ=DAILY;${'BYMONTH=1;'.repeat(120)}`,
    ]) {
      const r = await read(series(rule));
      const e = only(r);
      expect(e, rule).toMatchObject({ rrule: null, recurrence: 'unreadable' });
      expect(occurrences(e), rule).toEqual(['2026-10-14 15:30']);
      expect(r.notes.unreadableRecurrence, rule).toBe(1);
    }
  });

  it('two RRULEs, an EXRULE or an unreadable EXDATE also leave the first occurrence only', async () => {
    const extras: Record<string, string>[] = [
      { RRULE: ':FREQ=DAILY' },
      { EXRULE: ':FREQ=WEEKLY;BYDAY=SA' },
      { EXDATE: ':2026-10-21' },
    ];
    for (const extra of extras) {
      const e = only(await read(series('FREQ=WEEKLY;COUNT=3', extra)));
      expect(e, JSON.stringify(extra)).toMatchObject({ rrule: null, recurrence: 'unreadable' });
    }
  });

  it('RDATE occurrences are not invented; the rule’s own occurrences stay, and the RDATE is counted', async () => {
    const r = await read(SEQUENCES.malformed[0]);
    expect(r.notes.ignoredRdate).toBe(1);
    expect(occurrences(byUid(r, 'rdate@example.test'))).toEqual([
      '2026-10-15 09:00',
      '2026-10-22 09:00',
      '2026-10-29 09:00',
    ]);
  });

  it('UNTIL is spelled as RFC 5545 asks: UTC for timed (a floating UNTIL read in the event’s zone), a date for all-day', async () => {
    expect(only(await read(series('FREQ=WEEKLY;UNTIL=20261028T153000'))).rrule).toBe(
      'FREQ=WEEKLY;UNTIL=20261028T023000Z',
    );
    expect(occurrences(only(await read(series('FREQ=WEEKLY;UNTIL=20261028T153000'))))).toEqual([
      '2026-10-14 15:30',
      '2026-10-21 15:30',
      '2026-10-28 15:30',
    ]);
    // Outlook writes an all-day series' UNTIL as UTC midnight of the creator's day.
    const allDay = googleFeed([
      allDayEvent({
        uid: 'a@example.test',
        start: '20261019',
        end: '20261020',
        summary: 'A',
        rrule: 'FREQ=DAILY;UNTIL=20261020T110000Z',
      }),
    ]);
    const e = only(await read(allDay));
    expect(e.rrule).toBe('FREQ=DAILY;UNTIL=20261021');
    expect(occurrences(e)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
  });

  it('a timed UNTIL stops at its instant, not the end of that day', () => {
    const e = {
      allDay: false as const,
      startsAt: new Date('2026-10-13T20:00:00Z'), // 09:00 NZDT 14 Oct
      endsAt: new Date('2026-10-13T21:00:00Z'),
      timeZone: 'Pacific/Auckland',
      rrule: 'FREQ=WEEKLY;BYDAY=WE,TH;UNTIL=20261014T193000Z', // 08:30 NZDT 15 Oct, before its 09:00
      exdates: [],
    };
    expect(expandEvent(e, '2026-10-01', '2026-12-31').map((o) => o.date)).toEqual(['2026-10-14']);
  });
});

describe('time zones', () => {
  it('an event’s own IANA zone wins over the calendar’s, across that zone’s daylight-saving changes', async () => {
    const feed = googleFeed([
      timed({
        DTSTART: ';TZID=America/New_York:20261025T090000',
        DTEND: ';TZID=America/New_York:20261025T100000',
        RRULE: 'FREQ=WEEKLY;COUNT=22',
      }),
    ]);
    const e = only(await read(feed));
    expect(e.time).toMatchObject({
      timeZone: 'America/New_York',
      startsAt: new Date('2026-10-25T13:00:00Z'),
    });
    const all = occurrences(e);
    expect(all.every((o) => o.endsWith('09:00'))).toBe(true); // wall clock kept
    const instants = expandEvent(
      { ...e.time, rrule: e.rrule, exdates: e.exdates } as never,
      '2026-10-25',
      '2027-03-21',
    ).map((o) => (o as { startsAt: Date }).startsAt.toISOString());
    expect(instants.slice(0, 2)).toEqual(['2026-10-25T13:00:00.000Z', '2026-11-01T14:00:00.000Z']); // EDT → EST
    expect(instants.slice(-2)).toEqual(['2027-03-14T13:00:00.000Z', '2027-03-21T13:00:00.000Z']); // EST → EDT
  });

  it('UTC times stay UTC', async () => {
    const e = only(
      await read(googleFeed([timed({ DTSTART: '20261015T200000Z', DTEND: '20261015T210000Z' })])),
    );
    expect(e.time).toEqual({
      allDay: false,
      startsAt: new Date('2026-10-15T20:00:00Z'),
      endsAt: new Date('2026-10-15T21:00:00Z'),
      timeZone: 'UTC',
    });
  });

  it('floating times: the calendar’s declared zone; without one (or with a bad one) HOME_TIMEZONE', async () => {
    const ev = timed({ DTSTART: '20261015T090000', DTEND: '20261015T100000' });
    expect(only(await read(googleFeed([ev], { zone: 'Australia/Sydney' }))).time).toMatchObject({
      startsAt: new Date('2026-10-14T22:00:00Z'), // 09:00 AEDT
      timeZone: 'Australia/Sydney',
    });
    for (const zone of [null, 'Not/AZone', '+11:00']) {
      expect(
        only(await read(googleFeed([ev], { zone }), { home: 'Europe/London' })).time,
        String(zone),
      ).toMatchObject({
        startsAt: new Date('2026-10-15T08:00:00Z'), // 09:00 BST
        timeZone: 'Europe/London',
      });
    }
  });

  it('known Windows names map through the table; an unknown zone is floating and counted, never guessed', async () => {
    const win = only(
      await read(
        googleFeed([timed({ DTSTART: ';TZID=New Zealand Standard Time:20261015T090000' })], {
          zone: 'Europe/London',
        }),
      ),
    );
    expect(win.time).toMatchObject({
      timeZone: 'Pacific/Auckland',
      startsAt: new Date('2026-10-14T20:00:00Z'),
    });
    for (const tz of [
      'Mars/Olympus',
      '(UTC+12:00) Auckland, Wellington',
      'NZDT',
      'Customized Time Zone',
    ]) {
      const r = await read(
        googleFeed([timed({ DTSTART: `;TZID="${tz}":20261015T090000` })], {
          zone: 'Europe/London',
        }),
      );
      expect(r.notes.unknownZone, tz).toBe(1);
      expect(only(r).time, tz).toMatchObject({
        timeZone: 'Europe/London',
        startsAt: new Date('2026-10-15T08:00:00Z'),
      });
    }
  });

  it('both NZ daylight-saving changes, single and repeating', async () => {
    const r = await read(SEQUENCES.nzDst[0]);
    const run = byUid(r, 'early-run-1@example.test');
    const all = occurrences(run, '2026-09-20', '2027-04-30');
    expect(all.every((o) => o.endsWith('06:00'))).toBe(true);
    expect(all).toContain('2026-09-27 06:00'); // spring-forward Sunday
    expect(all).toContain('2027-04-04 06:00'); // autumn-back Sunday
    // In the gap: moved forward an hour. In the overlap: the first 02:30.
    expect(byUid(r, 'dst-gap-1@example.test').time).toMatchObject({
      startsAt: new Date('2026-09-26T14:30:00Z'),
    });
    expect(byUid(r, 'dst-overlap-1@example.test').time).toMatchObject({
      startsAt: new Date('2027-04-03T13:30:00Z'),
    });
  });

  it('all-day: exclusive end; a missing end is one day; an end equal to the start is one day', async () => {
    const r = await read(
      googleFeed([
        vevent({
          UID: 'a@example.test',
          DTSTART: ';VALUE=DATE:20261020',
          DTEND: ';VALUE=DATE:20261023',
          SUMMARY: 'Three days',
        }),
        vevent({ UID: 'b@example.test', DTSTART: ';VALUE=DATE:20261020', SUMMARY: 'No end' }),
        vevent({
          UID: 'c@example.test',
          DTSTART: ';VALUE=DATE:20261020',
          DTEND: ';VALUE=DATE:20261020',
          SUMMARY: 'Same',
        }),
        vevent({
          UID: 'd@example.test',
          DTSTART: '20261020',
          DURATION: 'P2D',
          SUMMARY: 'Duration',
        }),
      ]),
    );
    expect(r.events.map((e) => e.time)).toEqual([
      { allDay: true, startDate: '2026-10-20', endDate: '2026-10-23' },
      { allDay: true, startDate: '2026-10-20', endDate: '2026-10-21' },
      { allDay: true, startDate: '2026-10-20', endDate: '2026-10-21' },
      { allDay: true, startDate: '2026-10-20', endDate: '2026-10-22' },
    ]);
  });

  it('timed without DTEND: DURATION (days on the wall clock), else the start', async () => {
    const r = await read(
      googleFeed([
        vevent({
          UID: 'a@example.test',
          DTSTART: ';TZID=Pacific/Auckland:20261015T090000',
          DURATION: 'PT1H30M',
          SUMMARY: 'A',
        }),
        // Across the April change: P1D keeps 09:00, so it is 25 hours long.
        vevent({
          UID: 'b@example.test',
          DTSTART: ';TZID=Pacific/Auckland:20270403T090000',
          DURATION: 'P1D',
          SUMMARY: 'B',
        }),
        vevent({
          UID: 'c@example.test',
          DTSTART: ';TZID=Pacific/Auckland:20261015T090000',
          SUMMARY: 'C',
        }),
        vevent({
          UID: 'd@example.test',
          DTSTART: ';TZID=Pacific/Auckland:20261015T090000',
          DURATION: 'P',
          SUMMARY: 'D',
        }),
      ]),
    );
    const len = (uid: string) => {
      const t = byUid(r, uid).time as { startsAt: Date; endsAt: Date };
      return (t.endsAt.getTime() - t.startsAt.getTime()) / 3_600_000;
    };
    expect(len('a@example.test')).toBe(1.5);
    expect(len('b@example.test')).toBe(25);
    expect(len('c@example.test')).toBe(0);
    expect(byUid(r, 'd@example.test')).toBeUndefined();
    expect(r.skipped).toBe(1);
  });
});

describe('identity, duplicates and orphans', () => {
  const dup = (seq: number, title: string) =>
    nzEvent({
      uid: 'dup@example.test',
      start: '20261015T090000',
      end: '20261015T100000',
      summary: title,
      sequence: seq,
    });

  it('the same identity twice keeps the latest revision, whatever the order, and counts it', async () => {
    for (const order of [
      [dup(1, 'Old'), dup(2, 'New')],
      [dup(2, 'New'), dup(1, 'Old')],
    ]) {
      const r = await read(googleFeed(order));
      expect(only(r).title).toBe('New');
      expect(r.notes.duplicate).toBe(1);
    }
  });

  it('an override whose series is missing is kept (moved) or dropped (cancelled), and counted', async () => {
    const r = await read(
      googleFeed([
        nzEvent({
          uid: 'o@example.test',
          recurrenceId: '20261021T153000',
          start: '20261021T170000',
          end: '20261021T180000',
          summary: 'Moved',
        }),
        nzEvent({
          uid: 'p@example.test',
          recurrenceId: '20261021T153000',
          start: '20261021T153000',
          end: '20261021T163000',
          summary: 'X',
          status: 'CANCELLED',
        }),
      ]),
    );
    expect(r.events.map((e) => [e.uid, e.recurrenceId])).toEqual([
      ['o@example.test', '2026-10-21T02:30:00Z'],
    ]);
    expect(r.notes.orphanOverride).toBe(2);
  });

  it('a cancelled series takes its overrides with it', async () => {
    const feed = SEQUENCES.seriesWithOverrides[0].replace(
      /(UID:swim-series-7c1@example\.test\r\n(?:(?!RECURRENCE-ID)[^\r]*\r\n)*?STATUS:)CONFIRMED/,
      '$1CANCELLED',
    );
    expect((await read(feed)).events).toEqual([]);
  });

  it('a recreated event with a new UID is a different event (HOME never guesses they are the same)', async () => {
    const [a, b] = [
      await read(SEQUENCES.recreatedNewUid[0]),
      await read(SEQUENCES.recreatedNewUid[1]),
    ];
    expect(a.events.map((e) => e.uid)).toContain('dentist-91a@example.test');
    expect(b.events.map((e) => e.uid)).not.toContain('dentist-91a@example.test');
    expect(b.events.map((e) => e.uid)).toContain('dentist-recreated-2d4@example.test');
  });

  it('every one of the fifteen sequences reads, step by step', async () => {
    for (const [name, feeds] of Object.entries(SEQUENCES))
      for (const feed of feeds) {
        const r = await read(feed);
        expect(r.events.length, name).toBeGreaterThan(0);
      }
  });
});

describe('the import window and limits', () => {
  const single = (uid: string, start: string) =>
    nzEvent({ uid, start: `${start}T090000`, end: `${start}T100000`, summary: uid });

  it('30 days back to 400 days ahead, with a day’s margin for zones; long events reaching in are kept', async () => {
    expect(RANGE).toEqual({ from: '2026-09-14', to: '2027-11-18' });
    const r = await read(
      googleFeed([
        single('too-old', '20260801'),
        single('just-in-past', '20260914'),
        single('just-in-future', '20271118'),
        single('too-far', '20271201'),
        allDayEvent({ uid: 'long-trip', start: '20260801', end: '20260920', summary: 'Long trip' }),
      ]),
    );
    expect(r.events.map((e) => e.uid)).toEqual(['just-in-future', 'just-in-past', 'long-trip']);
  });

  it('a series is kept whole, overrides included, when any part reaches the window', async () => {
    const feed = googleFeed([
      nzEvent({
        uid: 'old-series',
        start: '20200101T090000',
        end: '20200101T100000',
        summary: 'Old',
        rrule: 'FREQ=WEEKLY',
      }),
      nzEvent({
        uid: 'old-series',
        recurrenceId: '20200108T090000',
        start: '20200108T110000',
        end: '20200108T120000',
        summary: 'Old moved',
      }),
      nzEvent({
        uid: 'ended-series',
        start: '20200101T090000',
        end: '20200101T100000',
        summary: 'Ended',
        rrule: 'FREQ=WEEKLY;COUNT=5',
      }),
    ]);
    const r = await read(feed);
    expect(r.events.map((e) => [e.uid, e.recurrenceId])).toEqual([
      ['old-series', null],
      ['old-series', '2020-01-07T20:00:00Z'],
    ]);
  });

  it(`more than ${IMPORT_LIMITS.maxEvents} events in the window is too large; exactly that many is fine`, async () => {
    const many = (n: number) =>
      googleFeed(
        Array.from({ length: n }, (_, i) =>
          vevent({
            UID: `n${i}`,
            DTSTART: `2026${String(10 + Math.floor(i / 3000)).padStart(2, '0')}15T${String(i % 24).padStart(2, '0')}0000Z`,
            SUMMARY: 'x',
          }),
        ),
      );
    expect((await read(many(IMPORT_LIMITS.maxEvents))).events).toHaveLength(
      IMPORT_LIMITS.maxEvents,
    );
    await expect(read(many(IMPORT_LIMITS.maxEvents + 1))).rejects.toMatchObject({
      code: 'too_large',
    });
    // Out-of-window events do not count towards the limit.
    const old = Array.from({ length: IMPORT_LIMITS.maxEvents + 10 }, (_, i) =>
      vevent({ UID: `o${i}`, DTSTART: '20200101T000000Z', SUMMARY: 'x' }),
    );
    expect((await read(googleFeed([...old, single('now', '20261015')]))).events).toHaveLength(1);
  });

  it(`a rule needing more than ${MAX_RULE_STEPS} steps to reach the window is no longer read (first occurrence only)`, async () => {
    const r = await read(
      googleFeed([
        nzEvent({
          uid: 'ancient-daily',
          start: '19500101T090000',
          end: '19500101T100000',
          summary: 'A',
          rrule: 'FREQ=DAILY',
        }),
        nzEvent({
          uid: 'old-daily',
          start: '19900101T090000',
          end: '19900101T100000',
          summary: 'B',
          rrule: 'FREQ=DAILY',
        }),
      ]),
    );
    expect(r.events.map((e) => e.uid)).toEqual(['old-daily']); // ancient: its one occurrence is long past
    expect(r.notes.unreadableRecurrence).toBe(1);
  });

  it(`a feed needing more than ${MAX_FEED_STEPS} steps in all is too large`, async () => {
    const feed = googleFeed(
      Array.from({ length: 60 }, (_, i) =>
        nzEvent({
          uid: `d${i}`,
          start: '19800101T090000',
          end: '19800101T100000',
          summary: 'x',
          rrule: 'FREQ=DAILY',
        }),
      ),
    );
    await expect(read(feed)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('more than 500 exdates leaves the rule unread rather than over the event limit', async () => {
    const ex = Array.from({ length: 501 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 9, 15 + i));
      return d.toISOString().slice(0, 10).replaceAll('-', '');
    });
    const feed = googleFeed([
      vevent({
        UID: 'x',
        DTSTART: ';VALUE=DATE:20261014',
        RRULE: 'FREQ=DAILY',
        EXDATE: ex.map((d) => `;VALUE=DATE:${d}`),
        SUMMARY: 'x',
      }),
    ]);
    const r = await read(feed);
    expect(only(r)).toMatchObject({ rrule: null, recurrence: 'unreadable' });
  });
});

describe('a TZID the line syntax cannot carry', () => {
  it('a schemed TZID (tzone://…) cannot be read as a time, so the event is skipped, never guessed', async () => {
    const r = await read(
      googleFeed([timed({ DTSTART: ';TZID="tzone://Microsoft/Custom":20261015T090000' })]),
    );
    expect(r.events).toEqual([]);
    expect(r.skipped).toBe(1);
  });
});

describe('years HOME keeps', () => {
  it('a date outside 1900–2199 cannot be an event in HOME, so it is skipped and counted', async () => {
    const r = await read(
      googleFeed([
        nzEvent({
          uid: 'y1850',
          start: '18500101T090000',
          end: '18500101T100000',
          summary: 'x',
          rrule: 'FREQ=YEARLY',
        }),
        allDayEvent({ uid: 'y2300', start: '23000101', end: '23000102', summary: 'x' }),
      ]),
    );
    expect(r.events).toEqual([]);
    expect(r.skipped).toBe(2);
  });
});

describe('other feed shapes (adapter robustness only; M4 accepts Google’s address alone)', () => {
  const fixture = (name: string) => readFileSync(join('tests/fixtures/calendars', name), 'utf8');

  it('an Outlook-shaped feed: quoted Windows TZIDs, UTC UNTIL, EXDATE, LANGUAGE on SUMMARY, no attendees', async () => {
    const r = await read(fixture('outlook-shaped.ics'));
    expect(r.calendar).toEqual({ id: 'default', name: 'Synthetic work calendar' });
    expect(r.skipped).toBe(0);
    expect(r.notes.unknownZone).toBe(0);
    const sync = r.events.find((e) => e.title === 'Team sync')!;
    expect(sync.time).toMatchObject({
      timeZone: 'Pacific/Auckland',
      startsAt: new Date('2026-10-14T20:30:00Z'),
    });
    expect(occurrences(sync)).toEqual([
      '2026-10-15 09:30',
      '2026-10-22 09:30',
      // 29 Oct: EXDATE
      '2026-11-05 09:30',
      '2026-11-12 09:30',
      '2026-11-19 09:30',
      '2026-11-26 09:30',
      '2026-12-03 09:30',
      '2026-12-10 09:30',
    ]);
    const paris = r.events.find((e) => e.title?.startsWith('Call with'))!;
    expect(paris.time).toMatchObject({
      timeZone: 'Europe/Paris',
      startsAt: new Date('2026-10-16T12:00:00Z'),
    });
    expect(JSON.stringify(r)).not.toMatch(/mailto|colleague@|organiser@|REMINDER/);
  });

  it('an iCloud-shaped feed: its own IANA zone, a monthly all-day rule, no structured location', async () => {
    const r = await read(fixture('icloud-shaped.ics'), { home: 'Pacific/Auckland' });
    expect(r.calendar.name).toBe('Synthetic shared calendar');
    const call = r.events.find((e) => e.uid === '5E1B2C3D-SYNTHETIC-0001')!;
    expect(call.time).toMatchObject({
      timeZone: 'Australia/Sydney',
      startsAt: new Date('2026-10-16T23:00:00Z'),
    });
    expect(call.location).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/geo:|Example Lane/);
    const bills = r.events.find((e) => e.uid === '5E1B2C3D-SYNTHETIC-0002')!;
    expect(occurrences(bills, '2026-11-01', '2027-01-31')).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ]);
  });
});
