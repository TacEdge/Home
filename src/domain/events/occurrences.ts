import { expandEvent, type EventStart, type RecurringEvent } from '../engines/recurrence';
import type { IsoDate } from '@/lib/dates';
import type { Event } from './service';

// Override suppression (ADR 0007 §13, §42; M4 Package 6). A moved or changed
// occurrence is its own row naming the occurrence it replaces in
// recurrence_original; the sync also adds that original to the series'
// exdates, but a partial feed can leave the series without it. So the series
// is expanded with every live override's original treated as skipped, by
// identity: the same calendar source and external UID (a synced series), or
// the series row an override points at (a manual one). An archived override
// suppresses nothing; an override whose series is gone is simply its own
// event at its own time.

/** The identity a synced override shares with its series: source and UID. */
const seriesKey = (e: Pick<Event, 'calendarSourceId' | 'externalUid'>) =>
  e.calendarSourceId && e.externalUid ? `${e.calendarSourceId}:${e.externalUid}` : null;

/**
 * For each series, the original occurrences its live overrides replace, as
 * EXDATE values (a date for an all-day series, an instant for a timed one),
 * from the rows the caller could read. Pure.
 */
export function overriddenOriginals(events: readonly Event[]): Map<string, string[]> {
  const seriesIdByKey = new Map<string, string>();
  const liveSeries = new Set<string>();
  for (const e of events)
    if (e.recurrenceOriginal === null && e.archivedAt === null) {
      liveSeries.add(e.id);
      const key = seriesKey(e);
      if (key) seriesIdByKey.set(key, e.id);
    }
  const out = new Map<string, string[]>();
  for (const o of events) {
    if (o.recurrenceOriginal === null || o.archivedAt !== null) continue;
    const key = seriesKey(o);
    const seriesId = (key ? seriesIdByKey.get(key) : undefined) ?? o.recurrenceParentId;
    // Only a series that is here and live can be expanded, so only one can need it.
    if (!seriesId || seriesId === o.id || !liveSeries.has(seriesId)) continue;
    const list = out.get(seriesId);
    if (list) list.push(o.recurrenceOriginal);
    else out.set(seriesId, [o.recurrenceOriginal]);
  }
  return out;
}

/** The engine's view of an event with its overridden originals skipped too. */
export function recurringWithOverrides(
  e: Event,
  overridden: ReadonlyMap<string, readonly string[]>,
): RecurringEvent {
  const base = recurringOf(e);
  const extra = overridden.get(e.id);
  if (!extra || extra.length === 0) return base;
  return { ...base, exdates: [...new Set([...(base.exdates ?? []), ...extra])] };
}

// A stored event in the recurrence engine's terms (ADR 0006 §42): the one
// place that mapping is written, so screens, the loader and the services
// ask the engine the same way and do no date work of their own.

/** The engine's view of an event's start. */
export function startOf(e: Event): EventStart {
  return e.allDay
    ? { allDay: true, startDate: e.startDate! }
    : { allDay: false, startsAt: e.startsAt!, timeZone: e.timeZone! };
}

/** The engine's view of an event, for expanding it. */
export function recurringOf(e: Event): RecurringEvent {
  return e.allDay
    ? {
        allDay: true,
        startDate: e.startDate!,
        endDate: e.endDate!,
        rrule: e.rrule,
        exdates: e.exdates,
      }
    : {
        allDay: false,
        startsAt: e.startsAt!,
        endsAt: e.endsAt!,
        timeZone: e.timeZone!,
        rrule: e.rrule,
        exdates: e.exdates,
      };
}

/** Whether the rule puts an occurrence on this date, skipped or not. */
export function isOccurrence(e: Event, date: IsoDate): boolean {
  return expandEvent({ ...recurringOf(e), exdates: null }, date, date).length > 0;
}

/** The skipped dates from `from` on that the current rule would still put an occurrence on. */
export function upcomingSkips(e: Event, from: IsoDate): IsoDate[] {
  if (!e.rrule) return [];
  return (e.exdates ?? [])
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= from && isOccurrence(e, x))
    .sort();
}
