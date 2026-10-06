import { addDays, type IsoDate } from '@/lib/dates';

// The provider-neutral calendar boundary (M4 contract §3.1, CLAUDE.md rule 13).
// These are HOME's own shapes: a provider adapter (src/integrations/calendar)
// turns whatever its source speaks into them, and nothing past this boundary
// knows ICS, Google or any library's types. Read-only: there is no write
// capability on a provider in M4. Lives in the domain so the sync service
// (Package 4b) can depend on it without importing an adapter.

/** How a provider reaches one connection. ICS: the secret address (a bearer credential). */
export type ProviderConnection = { kind: 'ics'; address: string };

/** One calendar within a connection. ICS: exactly one per feed. */
export type ExternalCalendar = {
  /** Stable within the connection. ICS: always `default`. */
  id: string;
  /** The calendar's own name, as untrusted plain text, if it gives one. */
  name: string | null;
};

/** A timed event keeps its own IANA zone; an all-day one is dates, the end exclusive. */
export type ExternalTime =
  | { allDay: false; startsAt: Date; endsAt: Date; timeZone: string }
  | { allDay: true; startDate: IsoDate; endDate: IsoDate };

/**
 * One event as HOME reads it from a provider: a series, a single event, or
 * an override of one occurrence of a series. No attendees, organiser,
 * alarms, attachments, URLs, conferencing or raw provider properties.
 */
export type ExternalEvent = {
  /** The provider's identity for the event (and its series), as given. */
  uid: string;
  /**
   * Empty for a series or a single event. For an override, the occurrence it
   * replaces: an ISO date (`2026-10-21`) for an all-day series, a UTC
   * instant (`2026-10-21T02:30:00Z`) for a timed one.
   */
  recurrenceId: string | null;
  status: 'confirmed' | 'tentative';
  time: ExternalTime;
  /**
   * The provider's RRULE as given (without DTSTART), only its UNTIL spelled
   * as RFC 5545 asks for this event (a date for all-day, UTC for timed). Null
   * when the event does not repeat, or when its rule could not be read.
   */
  rrule: string | null;
  /** `unreadable`: the event had a rule HOME could not read, so it is its first occurrence only. */
  recurrence: 'none' | 'rule' | 'unreadable';
  /**
   * Occurrences that do not happen as the event says: the feed's own
   * exdates, every cancelled occurrence and every override's original
   * occurrence, as ISO dates (all-day) or UTC instants (timed); sorted,
   * without repeats. Always empty on an override.
   */
  exdates: string[];
  /** The subset of `exdates` that the provider cancelled one by one. */
  cancelledOccurrences: string[];
  /** Untrusted plain text, already sanitised and bounded (§4.5). */
  title: string | null;
  description: string | null;
  location: string | null;
  /** The provider's revision counter and last change, where given; never used for identity. */
  sequence: number | null;
  updatedAt: Date | null;
};

/** The days to read, as calendar dates in the home time zone, inclusive. */
export type FetchRange = { from: IsoDate; to: IsoDate };

/** What a feed held that HOME read with care; counts only, never content. */
export type FetchNotes = {
  /** Events kept as their first occurrence because their rule could not be read. */
  unreadableRecurrence: number;
  /** Times whose zone HOME did not know, read as the calendar's floating time. */
  unknownZone: number;
  /** Events present more than once with the same identity; the latest revision kept. */
  duplicate: number;
  /** Occurrences added by RDATE, which HOME does not read (no occurrence is invented). */
  ignoredRdate: number;
  /** Overrides or cancellations whose series is not in the feed. */
  orphanOverride: number;
};

export type FetchResult = {
  calendar: ExternalCalendar;
  /** Normalised events with any occurrence in the range, in a stable order. */
  events: ExternalEvent[];
  /** Events that could not be read at all, so were left out. */
  skipped: number;
  /**
   * Which skipped events are known by identity (ADR 0007 §42): the UIDs of
   * skipped events whose UID could itself be read and is a valid identity,
   * sorted, without repeats, at most MAX_SKIPPED_UIDS. A skipped event is
   * not a removed one, so the sync never archives these UIDs' events on
   * this refresh.
   */
  skippedUids: string[];
  /**
   * Skipped events whose UID could not be read safely, plus any beyond
   * MAX_SKIPPED_UIDS. While this is above zero the feed cannot prove that
   * anything was removed, so the sync archives nothing on this refresh.
   */
  skippedUnidentified: number;
  /** A hash of the whole feed as received, so an unchanged feed can be recognised. */
  feedHash: string;
  notes: FetchNotes;
};

export interface CalendarProvider {
  readonly kind: ProviderConnection['kind'];
  /** The calendars a connection offers. ICS: exactly one. */
  listCalendars(conn: ProviderConnection): Promise<ExternalCalendar[]>;
  fetchEvents(
    conn: ProviderConnection,
    calendar: ExternalCalendar,
    range: FetchRange,
  ): Promise<FetchResult>;
}

/**
 * Why a provider could not read a connection at all: the source statuses of
 * M4 contract §3.8, and nothing else. A code only: never the address, the
 * provider's text, a response or a stack.
 */
export type ProviderErrorCode = 'unreachable' | 'address_rejected' | 'not_a_calendar' | 'too_large';

export class CalendarProviderError extends Error {
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode) {
    super(code);
    this.name = 'CalendarProviderError';
    this.code = code;
  }
}

/** M4's starting limits (contract §3.3; ADR 0007 records any change). */
export const IMPORT_LIMITS = Object.freeze({
  /** Days before today that an event may last occur and still be read. */
  daysBack: 30,
  /** Days after today: the agenda engine's own limit. */
  daysAhead: 400,
  /** Events (series, single events and overrides) with an occurrence in the window. */
  maxEvents: 5000,
});

/**
 * The longest external UID HOME stores, in UTF-8 bytes (ADR 0007 §35). The
 * synced-identity index (migration 0007) holds the UID itself, and an index
 * entry over about 2,700 bytes cannot be written: a 1,000-character UID of
 * three-byte characters would fail the whole refresh. A UID over this is
 * never truncated (that would merge identities): its event is skipped and
 * counted. Real Google UIDs are short ASCII.
 */
export const MAX_EXTERNAL_UID_BYTES = 512;

/**
 * Whether a provider's UID can be an identity in HOME: non-empty, a
 * well-formed Unicode string (no lone surrogate, which the database would
 * store as a different character, so the identity would never match again),
 * no control characters, and within the byte limit. A UID that fails is
 * never repaired or truncated into another identity: its event is skipped.
 */
export function uidFits(uid: string): boolean {
  return (
    uid.length > 0 &&
    uid.isWellFormed() &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(uid) &&
    Buffer.byteLength(uid, 'utf8') <= MAX_EXTERNAL_UID_BYTES
  );
}

/** The most skipped UIDs a refresh carries; beyond it they count as unidentified. */
export const MAX_SKIPPED_UIDS = 200;

/** A running tally of skipped events, by identity where it is known (bounded). */
export class SkippedTally {
  count = 0;
  unidentified = 0;
  private readonly uids = new Set<string>();

  /** One skipped event, with its UID if it could be read. */
  add(uid: string | null): void {
    this.count++;
    if (uid === null || !uidFits(uid)) this.unidentified++;
    else if (this.uids.has(uid)) return;
    else if (this.uids.size >= MAX_SKIPPED_UIDS) this.unidentified++;
    else this.uids.add(uid);
  }

  /** Skipped events with nothing known about them (a provider's own count). */
  addUnknown(n: number): void {
    this.count += n;
    this.unidentified += n;
  }

  sortedUids(): string[] {
    return [...this.uids].sort();
  }
}

/** The import window around `today` (a date in the home time zone). */
export function importWindow(today: IsoDate): FetchRange {
  return {
    from: addDays(today, -IMPORT_LIMITS.daysBack),
    to: addDays(today, IMPORT_LIMITS.daysAhead),
  };
}

export const emptyNotes = (): FetchNotes => ({
  unreadableRecurrence: 0,
  unknownZone: 0,
  duplicate: 0,
  ignoredRdate: 0,
  orphanOverride: 0,
});
