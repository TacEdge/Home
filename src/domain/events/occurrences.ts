import {
  expandEvent,
  type EventStart,
  type Occurrence,
  type RecurringEvent,
} from '../engines/recurrence';
import { addDays, compareIsoDates, isoDateInZone, isValidIsoDate, type IsoDate } from '@/lib/dates';
import type { Event } from './service';

// Override suppression (ADR 0007 §13, §42; M4 Package 6). A moved or changed
// occurrence is its own row naming the occurrence it replaces in
// recurrence_original; the sync also adds that original to the series'
// exdates, but a partial feed can leave the series without it. So the series
// is expanded with every live override's original treated as skipped, by
// identity: the same calendar source and external UID (a synced series), or
// the series row an override points at (a manual one). An archived override
// suppresses nothing; an override whose series is gone is simply its own
// event at its own time, except a manual one (an occurrence change, below),
// which is part of its series and is not shown without it.

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

// ---------------------------------------------------------------------------
// Occurrence changes (M4 contract §3.7, ADR 0007 §46; Package 8a)
//
// One occurrence of a repeating manual event, changed on its own, is an
// override row: source 'manual', recurrence_parent_id its series and
// recurrence_original the occurrence it replaces. That identity is the
// ORIGINAL occurrence in the series' own terms, the same value the engine
// skips as an EXDATE: its start date for an all-day series, its start
// instant in UTC to the second (`2026-10-21T02:30:00Z`) for a timed one.
// It never depends on the change's own (moved) time or on the zone it is
// displayed in, and it is never re-keyed.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Whether an event is a manual occurrence change (it replaces one occurrence of a series). */
export function isOccurrenceChange(e: Pick<Event, 'source' | 'recurrenceOriginal'>): boolean {
  return e.source === 'manual' && e.recurrenceOriginal !== null;
}

/**
 * The identity of one of a series' occurrences: its date (all-day) or its
 * start instant in UTC to the second (timed; the engine places occurrences
 * on whole seconds of their wall clock).
 */
export function occurrenceIdentity(o: Occurrence): string {
  if (o.allDay) return o.date;
  return o.startsAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The occurrence of a series an identity names, if the series' current rule
 * produces it (skipped or not: what was skipped is still the rule's), else
 * null. Judged by the recurrence engine, never by the shape of the value: a
 * date for a timed series, an instant for an all-day one, a plausible time
 * the rule does not reach, or a one-off event, all name nothing.
 */
export function occurrenceOf(series: Event, identity: string): Occurrence | null {
  if (!series.rrule) return null;
  let date: IsoDate;
  if (series.allDay) {
    if (!DATE.test(identity) || !isValidIsoDate(identity)) return null;
    date = identity;
  } else {
    if (!INSTANT.test(identity)) return null;
    const t = Date.parse(identity);
    if (!Number.isFinite(t)) return null;
    // The occurrence is dated in the series' own zone.
    date = isoDateInZone(new Date(t), series.timeZone!);
  }
  const found = expandEvent({ ...recurringOf(series), exdates: null }, date, date).find(
    (o) => occurrenceIdentity(o) === identity,
  );
  return found ?? null;
}

/** Whether the series' own exdates ("skip this one") skip this occurrence. */
export function isSkippedOccurrence(series: Event, o: Occurrence): boolean {
  return expandEvent(recurringOf(series), o.date, o.date).every(
    (x) => occurrenceIdentity(x) !== occurrenceIdentity(o),
  );
}

/**
 * The live changes a series would skip with these exdates, judged in the
 * series' own terms (ADR 0007 §46): each change's original occurrence is
 * found by the current rule and checked against the exdates as the engine
 * reads them, a date skipping the occurrence that starts that day in the
 * series' zone, an instant the one starting then. An original the rule no
 * longer reaches is not an occurrence, so it cannot be skipped. An
 * occurrence is normal, skipped or changed, never skipped and changed.
 */
export function skippedChanges(
  series: Event,
  exdates: readonly string[] | null,
  changes: readonly Pick<Event, 'id' | 'recurrenceOriginal' | 'archivedAt'>[],
): string[] {
  const withSkips = { ...series, exdates: exdates === null ? null : [...exdates] } as Event;
  return changes
    .filter((c) => c.archivedAt === null && c.recurrenceOriginal !== null)
    .filter((c) => {
      const o = occurrenceOf(series, c.recurrenceOriginal!);
      return o !== null && isSkippedOccurrence(withSkips, o);
    })
    .map((c) => c.id);
}

/**
 * The live occurrence changes that are not shown, from the rows the caller
 * could read: a manual change whose series is not here and live (archived,
 * or gone) is part of that series, not an event of its own. Restoring the
 * series brings them back with it; nothing is written. (A synced override
 * is different: the calendar says it is an event, so it stays, §44.)
 */
export function hiddenOccurrenceChanges(events: readonly Event[]): Set<string> {
  const liveSeries = new Set(
    events.filter((e) => e.recurrenceOriginal === null && e.archivedAt === null).map((e) => e.id),
  );
  const hidden = new Set<string>();
  for (const e of events)
    if (
      isOccurrenceChange(e) &&
      (e.recurrenceParentId === null || !liveSeries.has(e.recurrenceParentId))
    )
      hidden.add(e.id);
  return hidden;
}

/**
 * A series' next few times as its page shows them (contract §5.3): the
 * regular occurrences the rule still puts on, with each live change's
 * original left out, and every live change at its own date and time, once.
 * Composed exactly as the agenda composes it (overriddenOriginals), then
 * ordered by home date, all-day first, then start, title and id. Pure.
 */
export type NextTime =
  | { kind: 'regular'; occurrence: Occurrence; identity: string }
  | { kind: 'changed'; change: Event; occurrence: Occurrence };

export function nextTimes(
  series: Event,
  changes: readonly Event[],
  from: IsoDate,
  to: IsoDate,
  timeZone: string,
): NextTime[] {
  const live = changes.filter((c) => isOccurrenceChange(c) && c.archivedAt === null);
  const regular = expandEvent(
    recurringWithOverrides(series, overriddenOriginals([series, ...live])),
    from,
    to,
  ).map((o): NextTime => ({ kind: 'regular', occurrence: o, identity: occurrenceIdentity(o) }));
  // A change is dated at home, so one moved to another day is read a day either side.
  const changed = live.flatMap((c) =>
    expandEvent(recurringOf(c), addDays(from, -1), addDays(to, 1))
      .filter((o) => {
        const home = homeDateOf(o, timeZone);
        return home >= from && home <= to;
      })
      .map((o): NextTime => ({ kind: 'changed', change: c, occurrence: o })),
  );
  return [...regular, ...changed].sort(compareNextTimes(series, timeZone));
}

const homeDateOf = (o: Occurrence, timeZone: string): IsoDate =>
  o.allDay ? o.date : isoDateInZone(o.startsAt, timeZone);

function compareNextTimes(series: Event, timeZone: string) {
  const title = (t: NextTime) => (t.kind === 'changed' ? t.change.title : series.title);
  const id = (t: NextTime) => (t.kind === 'changed' ? t.change.id : series.id);
  return (a: NextTime, b: NextTime): number => {
    const d = compareIsoDates(
      homeDateOf(a.occurrence, timeZone),
      homeDateOf(b.occurrence, timeZone),
    );
    if (d !== 0) return d;
    if (a.occurrence.allDay !== b.occurrence.allDay) return a.occurrence.allDay ? -1 : 1;
    if (!a.occurrence.allDay && !b.occurrence.allDay) {
      const s = a.occurrence.startsAt.getTime() - b.occurrence.startsAt.getTime();
      if (s !== 0) return s;
    }
    const t = title(a).localeCompare(title(b), 'en-NZ');
    if (t !== 0) return t;
    return id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0;
  };
}

/** The date, in the series' own terms, that a change's original occurrence falls on. */
export function originalDateOf(series: Event, change: Pick<Event, 'recurrenceOriginal'>): IsoDate {
  const original = change.recurrenceOriginal ?? '';
  if (DATE.test(original)) return original;
  return isoDateInZone(new Date(original), series.timeZone ?? 'UTC');
}

/**
 * A series' changes that were put away (archived) and whose original
 * occurrence is still ahead: shown under the series as no longer part of
 * it (contract §3.7), newest original last. A change the rule reaches
 * can be brought back; one it no longer reaches is history.
 */
export function putAwayChanges(series: Event, changes: readonly Event[], from: IsoDate): Event[] {
  return changes
    .filter((c) => isOccurrenceChange(c) && c.archivedAt !== null)
    .filter((c) => originalDateOf(series, c) >= from)
    .sort((a, b) => (a.recurrenceOriginal! < b.recurrenceOriginal! ? -1 : 1));
}
