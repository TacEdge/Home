import {
  CalendarProviderError,
  emptyNotes,
  type CalendarProvider,
  type ExternalCalendar,
  type ExternalEvent,
  type FetchNotes,
  type ProviderErrorCode,
} from '@/domain/calendar/provider';
import { CalendarAddressError, normaliseCalendarAddress } from '@/lib/calendar-address';
import { readFeed } from './ics/feed';
import { finish, normaliseFeed } from './ics/normalise';
import { TEXT_LIMITS, plainText } from './text';

// A deterministic fake CalendarProvider (M4 contract §3.1, §8.4) for tests
// and Package 4b's sync scenarios: it replays a script of states, one per
// step, with no network. A step is a synthetic ICS feed (read by exactly the
// `ics` adapter's parser and normaliser), a list of events already in HOME's
// shape, or a failure code. The current step answers every call until the
// test moves on with `advance()` or `goTo()`, so a scenario reads as a
// sequence of feeds. The address is approved as the real adapter approves
// it. Never used outside tests.

export type FakeStep =
  | { ics: string }
  | {
      events: ExternalEvent[];
      calendarName?: string | null;
      skipped?: number;
      notes?: Partial<FetchNotes>;
    }
  | { fail: ProviderErrorCode };

export type FakeProvider = CalendarProvider & {
  /** Moves to the next step (staying on the last). */
  advance(): void;
  goTo(step: number): void;
  readonly step: number;
  /** How many times the provider was asked, for refresh-once tests. */
  readonly calls: number;
};

export function fakeProvider(
  steps: readonly FakeStep[],
  opts: { homeTimeZone: string },
): FakeProvider {
  if (steps.length === 0) throw new Error('fakeProvider: at least one step');
  let step = 0;
  let calls = 0;

  function current(address: string): FakeStep {
    calls++;
    try {
      normaliseCalendarAddress(address);
    } catch (e) {
      if (e instanceof CalendarAddressError) throw new CalendarProviderError('address_rejected');
      throw e;
    }
    const s = steps[step]!;
    if ('fail' in s) throw new CalendarProviderError(s.fail);
    return s;
  }

  const calendarOf = (s: FakeStep): ExternalCalendar => {
    if ('ics' in s) {
      try {
        return {
          id: 'default',
          name: plainText(readFeed(s.ics).calendarName, TEXT_LIMITS.title, 'line'),
        };
      } catch {
        throw new CalendarProviderError('not_a_calendar');
      }
    }
    return { id: 'default', name: 'calendarName' in s ? (s.calendarName ?? null) : null };
  };

  return {
    kind: 'ics',
    async listCalendars(conn) {
      return [calendarOf(current(conn.address))];
    },
    async fetchEvents(conn, calendar, range) {
      const s = current(conn.address);
      if (calendar.id !== 'default') throw new CalendarProviderError('not_a_calendar');
      if ('ics' in s) {
        try {
          return normaliseFeed(readFeed(s.ics), range, opts.homeTimeZone);
        } catch (e) {
          throw e instanceof CalendarProviderError
            ? e
            : new CalendarProviderError('not_a_calendar');
        }
      }
      if (!('events' in s)) throw new CalendarProviderError('not_a_calendar');
      return finish(
        calendarOf(s),
        s.events,
        s.skipped ?? 0,
        { ...emptyNotes(), ...s.notes },
        range,
      );
    },
    advance() {
      step = Math.min(step + 1, steps.length - 1);
    },
    goTo(n) {
      if (!Number.isInteger(n) || n < 0 || n >= steps.length)
        throw new Error('fakeProvider: no such step');
      step = n;
    },
    get step() {
      return step;
    },
    get calls() {
      return calls;
    },
  };
}
