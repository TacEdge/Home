import {
  CalendarProviderError,
  type CalendarProvider,
  type ExternalCalendar,
  type FetchRange,
  type FetchResult,
  type ProviderConnection,
  type ProviderErrorCode,
} from '@/domain/calendar/provider';
import { CalendarAddressError, normaliseCalendarAddress } from '@/lib/calendar-address';
import { ianaZone } from '@/lib/time-zones';
import {
  SafeFetchError,
  googleCalendarPolicy,
  safeGet,
  type SafeFetchErrorCode,
} from '@/integrations/net/safe-fetch';
import { TEXT_LIMITS, plainText } from '../text';
import { readFeed } from './feed';
import { normaliseFeed } from './normalise';

// The `ics` provider (M4 contract §3.1): the only real provider in M4. The
// connection's credential is Google's secret iCal address. It is checked
// against the approved shape before anything else (calendar-address.ts), and
// fetched only through Package 2's guarded fetch with the frozen Google
// policy: no other request path exists here, and nothing widens it. The
// adapter knows nothing about the database, logs nothing, and every failure
// is one of the §3.8 codes, never the address or the feed's text.

/** Fetches the (already approved) address and returns the body. Tests inject one; production never does. */
export type FeedFetcher = (address: string) => Promise<string>;

const FETCH_CODES: Record<SafeFetchErrorCode, ProviderErrorCode> = {
  unsupported_destination: 'address_rejected',
  redirect_refused: 'address_rejected',
  address_rejected: 'address_rejected',
  forbidden_destination: 'unreachable',
  timeout: 'unreachable',
  unreachable: 'unreachable',
  too_large: 'too_large',
  bad_response: 'not_a_calendar',
};

const guardedFetch: FeedFetcher = async (address) =>
  (await safeGet(address, { policy: googleCalendarPolicy })).text;

export type IcsProviderOptions = {
  /** HOME_TIMEZONE: floating times are read here when the calendar names no zone of its own. */
  homeTimeZone: string;
  /** Tests only: a fetcher for synthetic feeds. The address is approved before it is called. */
  fetchFeed?: FeedFetcher;
};

export function icsProvider(opts: IcsProviderOptions): CalendarProvider {
  const homeTimeZone = ianaZone(opts.homeTimeZone);
  if (!homeTimeZone) throw new Error('icsProvider: homeTimeZone must be an IANA zone');
  const fetchFeed = opts.fetchFeed ?? guardedFetch;

  async function load(conn: ProviderConnection): Promise<string> {
    if (conn.kind !== 'ics') throw new CalendarProviderError('address_rejected');
    let address: string;
    try {
      address = normaliseCalendarAddress(conn.address);
    } catch (e) {
      if (e instanceof CalendarAddressError) throw new CalendarProviderError('address_rejected');
      throw new CalendarProviderError('address_rejected');
    }
    try {
      return await fetchFeed(address);
    } catch (e) {
      if (e instanceof SafeFetchError) throw new CalendarProviderError(FETCH_CODES[e.code]);
      if (e instanceof CalendarProviderError) throw new CalendarProviderError(e.code);
      throw new CalendarProviderError('unreachable');
    }
  }

  /** Parse failures that are not HOME's own codes become `not_a_calendar`, with no message. */
  function read<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof CalendarProviderError) throw new CalendarProviderError(e.code);
      throw new CalendarProviderError('not_a_calendar');
    }
  }

  return {
    kind: 'ics',
    async listCalendars(conn): Promise<ExternalCalendar[]> {
      const text = await load(conn);
      const feed = read(() => readFeed(text));
      return [{ id: 'default', name: plainText(feed.calendarName, TEXT_LIMITS.title, 'line') }];
    },
    async fetchEvents(conn, calendar, range: FetchRange): Promise<FetchResult> {
      if (calendar.id !== 'default') throw new CalendarProviderError('not_a_calendar');
      const text = await load(conn);
      return read(() => normaliseFeed(readFeed(text), range, homeTimeZone));
    },
  };
}
