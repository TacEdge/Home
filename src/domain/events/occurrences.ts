import { expandEvent, type EventStart, type RecurringEvent } from '../engines/recurrence';
import type { IsoDate } from '@/lib/dates';
import type { Event } from './service';

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
