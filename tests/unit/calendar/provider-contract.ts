import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarProviderError,
  importWindow,
  type CalendarProvider,
  type ExternalEvent,
  type FetchResult,
  type ProviderErrorCode,
} from '@/domain/calendar/provider';
import { TEXT_LIMITS } from '@/integrations/calendar/text';
import { SYNTHETIC_ADDRESS, googleFeed } from '../../fixtures/calendars/google';
import { SEQUENCES, TODAY } from '../../fixtures/calendars/sequences';

// The provider contract suite (M4 contract §3.1, §8.2). Every CalendarProvider
// HOME uses, now the `ics` adapter and the fake, and any future provider,
// must pass it. A provider is driven through a harness that replays a script
// of steps (a synthetic feed, or a failure), so the same scenarios run
// against each. Synthetic data only; no network.

export type ContractStep = { ics: string } | { fail: ProviderErrorCode };
export type Harness = { provider: CalendarProvider; advance(): void };
export type MakeHarness = (steps: readonly ContractStep[]) => Harness;

const CONN = { kind: 'ics' as const, address: SYNTHETIC_ADDRESS };
const RANGE = importWindow(TODAY);
const ERROR_CODES: ProviderErrorCode[] = [
  'unreachable',
  'address_rejected',
  'not_a_calendar',
  'too_large',
];

/** Every step of a sequence, read in turn. */
async function readAll(make: MakeHarness, feeds: readonly string[]): Promise<FetchResult[]> {
  const h = make(feeds.map((ics) => ({ ics })));
  const [calendar] = await h.provider.listCalendars(CONN);
  const out: FetchResult[] = [];
  for (let i = 0; i < feeds.length; i++) {
    out.push(await h.provider.fetchEvents(CONN, calendar!, RANGE));
    h.advance();
  }
  return out;
}
const one = async (make: MakeHarness, feed: string) => (await readAll(make, [feed]))[0]!;
const identity = (e: ExternalEvent) => `${e.uid}|${e.recurrenceId ?? ''}`;
const find = (r: FetchResult, uid: string, recurrenceId: string | null = null) => {
  const e = r.events.find((x) => x.uid === uid && x.recurrenceId === recurrenceId);
  if (!e) throw new Error(`no ${uid} ${recurrenceId}`);
  return e;
};

/** A feed's VEVENTs in another order (reversed, then rotated). */
function reordered(feed: string): string {
  const blocks = feed.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r\n/g) ?? [];
  const head = feed.slice(0, feed.indexOf('BEGIN:VEVENT'));
  const lastEnd = feed.lastIndexOf('END:VEVENT\r\n') + 'END:VEVENT\r\n'.length;
  const tail = feed.slice(lastEnd); // anything after the last whole event, END:VCALENDAR included
  const rest = [...blocks].reverse();
  rest.push(rest.shift()!);
  return `${head}${rest.join('')}${tail}`;
}

export function providerContract(name: string, make: MakeHarness): void {
  describe(`CalendarProvider contract: ${name}`, () => {
    let written: string[];
    beforeEach(() => {
      written = [];
      const capture = (chunk: unknown) => {
        written.push(String(chunk));
        return true;
      };
      vi.spyOn(process.stdout, 'write').mockImplementation(capture as never);
      vi.spyOn(process.stderr, 'write').mockImplementation(capture as never);
      for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const)
        vi.spyOn(console, m).mockImplementation(
          (...a: unknown[]) => void written.push(a.join(' ')),
        );
    });
    afterEach(() => {
      vi.restoreAllMocks();
      // Nothing is logged at all: no address, no provider text, no stack.
      expect(written).toEqual([]);
    });

    it('lists exactly one calendar, with its name as plain text', async () => {
      const h = make([{ ics: SEQUENCES.initial[0] }]);
      expect(await h.provider.listCalendars(CONN)).toEqual([
        { id: 'default', name: 'Synthetic family calendar' },
      ]);
    });

    it('stable identity: each event once per identity, the same identities on every read', async () => {
      const [a, b] = await readAll(make, SEQUENCES.unchanged);
      const ids = a!.events.map(identity);
      expect(new Set(ids).size).toBe(ids.length);
      expect(b!.events.map(identity)).toEqual(ids);
    });

    it('deterministic: a feed served again (fresh DTSTAMPs) reads the same, hash included', async () => {
      const [a, b] = await readAll(make, SEQUENCES.unchanged);
      expect(b).toEqual(a);
      expect(a!.feedHash).toMatch(/^h1:[0-9a-f]{64}$/);
    });

    it('order-independent: the same events in another order read the same, hash included', async () => {
      for (const feed of [
        SEQUENCES.initial[0],
        SEQUENCES.seriesWithOverrides[0],
        SEQUENCES.malformed[0],
      ]) {
        expect(await one(make, reordered(feed))).toEqual(await one(make, feed));
      }
    });

    it('the hash changes when anything HOME keeps changes', async () => {
      const hashes = new Set<string>();
      for (const seq of [
        'added',
        'changed',
        'moved',
        'cancelledOccurrence',
        'deleted',
        'sameUidChanged',
        'recreatedNewUid',
      ] as const)
        for (const r of await readAll(make, SEQUENCES[seq])) hashes.add(r.feedHash);
      // initial (shared first step) plus seven distinct changes
      expect(hashes.size).toBe(8);
    });

    it('timed events: instants with their IANA zone; all-day events: dates with an exclusive end', async () => {
      const r = await one(make, SEQUENCES.initial[0]);
      expect(find(r, 'dentist-91a@example.test').time).toEqual({
        allDay: false,
        startsAt: new Date('2026-10-21T21:00:00Z'), // 10:00 NZDT on 22 October
        endsAt: new Date('2026-10-21T22:00:00Z'),
        timeZone: 'Pacific/Auckland',
      });
      expect(find(r, 'school-holidays-55d@example.test').time).toEqual({
        allDay: true,
        startDate: '2026-10-20',
        endDate: '2026-10-24',
      });
    });

    it('recurrence: the provider’s rule is kept as given, not turned into a preset', async () => {
      const r = await one(make, SEQUENCES.initial[0]);
      expect(find(r, 'swim-series-7c1@example.test')).toMatchObject({
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        recurrence: 'rule',
      });
      expect(find(r, 'football-series-3f2@example.test').rrule).toBe(
        'FREQ=WEEKLY;BYDAY=SA;UNTIL=20261212T200000Z',
      );
      expect(find(r, 'nana-jo-birthday-0b8@example.test').rrule).toBe('FREQ=YEARLY');
      expect(find(r, 'dentist-91a@example.test')).toMatchObject({
        rrule: null,
        recurrence: 'none',
      });
    });

    it('overrides and cancellations: each names the occurrence it replaces or removes', async () => {
      const r = await one(make, SEQUENCES.seriesWithOverrides[0]);
      const series = find(r, 'swim-series-7c1@example.test');
      expect(series.exdates).toEqual([
        '2026-10-21T02:30:00Z', // the feed's EXDATE
        '2026-11-04T02:30:00Z', // moved
        '2026-11-11T02:30:00Z', // retitled
        '2026-11-18T02:30:00Z', // cancelled
      ]);
      expect(series.cancelledOccurrences).toEqual(['2026-11-18T02:30:00Z']);
      const moved = find(r, 'swim-series-7c1@example.test', '2026-11-04T02:30:00Z');
      expect(moved.time).toMatchObject({ startsAt: new Date('2026-11-04T04:00:00Z') }); // 17:00 NZDT
      expect(moved).toMatchObject({ rrule: null, exdates: [] });
      expect(find(r, 'swim-series-7c1@example.test', '2026-11-11T02:30:00Z').title).toBe(
        'Swimming (squad trials)',
      );
      // The cancelled occurrence is an exdate only, never an event of its own.
      expect(r.events.map(identity)).toEqual([
        'swim-series-7c1@example.test|',
        'swim-series-7c1@example.test|2026-11-04T02:30:00Z',
        'swim-series-7c1@example.test|2026-11-11T02:30:00Z',
      ]);
    });

    it('a cancelled event is removed; status is confirmed or tentative only', async () => {
      const dentist = (SEQUENCES.initial[0].match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []).find(
        (b) => b.includes('UID:dentist'),
      )!;
      const feed = googleFeed([dentist.replace('STATUS:CONFIRMED', 'STATUS:CANCELLED')]);
      expect((await one(make, feed)).events).toEqual([]);
      for (const e of (await one(make, SEQUENCES.initial[0])).events)
        expect(['confirmed', 'tentative']).toContain(e.status);
    });

    it('time zones: floating times in the calendar’s zone; both NZ daylight-saving changes', async () => {
      const f = await one(make, SEQUENCES.floating[0]);
      expect(find(f, 'floating-1@example.test').time).toMatchObject({
        startsAt: new Date('2026-10-14T20:00:00Z'), // 09:00 NZDT
        timeZone: 'Pacific/Auckland',
      });
      const d = await one(make, SEQUENCES.nzDst[0]);
      // 02:30 does not exist on 27 September 2026: moved forward to 03:30 NZDT.
      expect(find(d, 'dst-gap-1@example.test').time).toMatchObject({
        startsAt: new Date('2026-09-26T14:30:00Z'),
      });
      // 02:30 happens twice on 4 April 2027: the first (NZDT).
      expect(find(d, 'dst-overlap-1@example.test').time).toMatchObject({
        startsAt: new Date('2027-04-03T13:30:00Z'),
      });
    });

    it('text is plain and bounded; markup never survives as markup', async () => {
      const r = await one(make, SEQUENCES.hostile[0]);
      for (const e of r.events) {
        expect((e.title ?? '').length).toBeLessThanOrEqual(TEXT_LIMITS.title);
        expect((e.location ?? '').length).toBeLessThanOrEqual(TEXT_LIMITS.location);
        expect((e.description ?? '').length).toBeLessThanOrEqual(TEXT_LIMITS.description);
      }
      const all = JSON.stringify(r.events);
      for (const bad of [
        "alert('title')",
        '<img',
        'onerror',
        '<a ',
        'href=',
        '<svg',
        'onload',
        '<iframe',
        '<style',
        '<p>',
        '<br',
        '\\u0007',
        '\\u202e',
        '\\ufeff',
      ])
        expect(all.toLowerCase(), bad).not.toContain(bad.toLowerCase());
    });

    it('never imports attendees, organiser, alarms, conferencing, attachments or URLs', async () => {
      const r = await one(make, SEQUENCES.initial[0]);
      const all = JSON.stringify(r);
      for (const bad of [
        'mailto',
        'sam@example.test',
        'guest.parent',
        'organiser',
        'meet.example.test',
        'drive.example.test',
        'notes.pdf',
        'https://example.test/event',
        'event reminder',
        'PARTSTAT',
      ])
        expect(all, bad).not.toContain(bad);
      for (const e of r.events)
        expect(Object.keys(e).sort()).toEqual([
          'cancelledOccurrences',
          'description',
          'exdates',
          'location',
          'recurrence',
          'recurrenceId',
          'rrule',
          'sequence',
          'status',
          'time',
          'title',
          'uid',
          'updatedAt',
        ]);
    });

    it('unreadable events are skipped and counted; the rest of the feed still reads', async () => {
      const r = await one(make, SEQUENCES.malformed[0]);
      expect(r.skipped).toBe(8);
      expect(find(r, 'dentist-91a@example.test').title).toBe('Dentist');
      expect(find(r, 'unreadable-rule@example.test')).toMatchObject({
        rrule: null,
        recurrence: 'unreadable',
      });
    });

    it('errors are structural codes only, carrying nothing else', async () => {
      for (const code of ERROR_CODES) {
        const h = make([{ fail: code }]);
        const e = await h.provider.fetchEvents(CONN, { id: 'default', name: null }, RANGE).then(
          () => null,
          (x: unknown) => x,
        );
        expect(e).toBeInstanceOf(CalendarProviderError);
        expect(e).toMatchObject({ code, message: code });
        expect(Object.keys(e as object).sort()).toEqual(['code', 'name']);
        expect((e as Error).cause).toBeUndefined();
      }
      for (const text of [
        '',
        'not a calendar',
        '<html><body>Sign in</body></html>',
        'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n',
      ]) {
        const h = make([{ ics: text }]);
        await expect(
          h.provider.fetchEvents(CONN, { id: 'default', name: null }, RANGE),
        ).rejects.toMatchObject({
          code: 'not_a_calendar',
          message: 'not_a_calendar',
        });
      }
    });

    it('an address outside the approved shape is refused before anything is read', async () => {
      const h = make([{ ics: SEQUENCES.initial[0] }]);
      for (const address of [
        'https://calendar.example.test/calendar/ical/x/private-0123456789abcdef/basic.ics',
        'http://calendar.google.com/calendar/ical/x/private-0123456789abcdef/basic.ics',
        'https://calendar.google.com/calendar/ical/x/public/basic.ics',
        'file:///etc/passwd',
      ])
        await expect(
          h.provider.fetchEvents({ kind: 'ics', address }, { id: 'default', name: null }, RANGE),
        ).rejects.toMatchObject({ code: 'address_rejected' });
    });
  });
}
