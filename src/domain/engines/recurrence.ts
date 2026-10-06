import { RRule, Weekday, type Options } from 'rrule';
import {
  addDays,
  daysBetween,
  formatIsoDate,
  instantFromWallClock,
  isValidIsoDate,
  parseIsoDate,
  wallClockOf,
  weekdayOf,
  type IsoDate,
  type WallClock,
} from '@/lib/dates';

// The recurrence engine (M3 contract §5, ADR 0006 §3). Pure: no database,
// clock or environment; the caller passes every date and zone.
//
// HOME's own recurrence model is deliberately small: none, daily, weekly on
// chosen days, fortnightly, monthly on the start's date, yearly; ending
// never, on a date, or after N times. It is stored as an RFC 5545 RRULE
// (the `event.rrule` column), so M4's calendar sync and any export reader
// see a standard rule. A stored rule outside the model is still expanded,
// but reads as `custom` and is never rewritten.
//
// Expansion never uses rrule's own time-zone support. Rules are expanded in
// "floating" time: each occurrence is a local wall clock in the event's
// zone, which is then turned into an instant by instantFromWallClock (the
// DST rules of M3 contract §5: kept wall-clock time; a skipped hour moves
// forward; a repeated hour takes its first instance). All-day events are
// dates and never touch a zone.

export type Weekdays = readonly number[]; // 0 = Monday … 6 = Sunday

export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'until'; date: IsoDate } // the last day it may occur, inclusive, in the event's zone
  | { type: 'count'; count: number }; // occurrences in all, the first included

export type Recurrence =
  | { preset: 'none' }
  | { preset: 'daily'; end: RecurrenceEnd }
  | { preset: 'weekly'; weekdays: Weekdays; end: RecurrenceEnd }
  | { preset: 'fortnightly'; weekdays: Weekdays; end: RecurrenceEnd }
  | { preset: 'monthly'; end: RecurrenceEnd }
  | { preset: 'yearly'; end: RecurrenceEnd };

export type RecurrencePreset = Recurrence['preset'];

/** What a stored rule means to HOME: one of its presets, or a rule it shows read-only. */
export type ReadRecurrence = Recurrence | { preset: 'custom'; rrule: string };

/** When an event starts: the facts recurrence needs, timed or all-day. */
export type EventStart =
  { allDay: true; startDate: IsoDate } | { allDay: false; startsAt: Date; timeZone: string };

export const MAX_COUNT = 1000;
const RFC_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurrenceError';
  }
}

/** The event's first local date, in its own zone (or its date, all-day). */
export function startDateOf(start: EventStart): IsoDate {
  if (start.allDay) return start.startDate;
  const w = wallClockOf(start.startsAt, start.timeZone);
  return formatIsoDate(w);
}

function normaliseWeekdays(days: Weekdays): number[] {
  const out = [...new Set(days)].sort((a, b) => a - b);
  if (out.length === 0 || out.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    throw new RecurrenceError('weekly and fortnightly repeats need one or more weekdays');
  return out;
}

function untilValue(date: IsoDate, start: EventStart): string {
  const d = date.replaceAll('-', '');
  if (start.allDay) return d;
  // RFC 5545: with a zoned DTSTART, UNTIL is UTC. The last moment of the
  // chosen local day in the event's zone, so that day is included.
  const last = instantFromWallClock(
    { ...parseIsoDate(date), hour: 23, minute: 59, second: 59 },
    start.timeZone,
  );
  return last
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * The RRULE (without DTSTART) for a recurrence, or null for `none`. Checks
 * the model: weekdays for weekly and fortnightly, a count from 1 to 1000, an
 * end date on or after the start. Weekly and fortnightly rules always name
 * their days, so a stored rule says exactly what it means.
 */
export function toRRule(r: Recurrence, start: EventStart): string | null {
  if (r.preset === 'none') return null;
  const parts: string[] = [];
  switch (r.preset) {
    case 'daily':
      parts.push('FREQ=DAILY');
      break;
    case 'weekly':
    case 'fortnightly':
      parts.push('FREQ=WEEKLY');
      if (r.preset === 'fortnightly') parts.push('INTERVAL=2');
      parts.push(
        `BYDAY=${normaliseWeekdays(r.weekdays)
          .map((d) => RFC_DAYS[d])
          .join(',')}`,
      );
      break;
    case 'monthly':
      parts.push('FREQ=MONTHLY');
      break;
    case 'yearly':
      parts.push('FREQ=YEARLY');
      break;
  }
  const end = r.end;
  if (end.type === 'count') {
    if (!Number.isInteger(end.count) || end.count < 1 || end.count > MAX_COUNT)
      throw new RecurrenceError(`a repeat count is from 1 to ${MAX_COUNT}`);
    parts.push(`COUNT=${end.count}`);
  } else if (end.type === 'until') {
    if (!isValidIsoDate(end.date)) throw new RecurrenceError('the end date is not a real date');
    if (end.date < startDateOf(start))
      throw new RecurrenceError('the end date is before the first one');
    parts.push(`UNTIL=${untilValue(end.date, start)}`);
  }
  return parts.join(';');
}

/**
 * Whether a stored or imported rule can be read at all. A rule that cannot
 * is never expanded: the event is its first occurrence only (M4 contract
 * §3.5), so HOME never invents occurrences from a rule it does not understand.
 */
export function isReadableRRule(rrule: string): boolean {
  return parseRule(rrule) !== null;
}

function parseRule(rrule: string): Partial<Options> | null {
  try {
    const body = rrule.trim().replace(/^RRULE:/i, '');
    if (!/^[A-Z0-9=;,:+\-]+$/i.test(body)) return null;
    const o = RRule.parseString(body);
    if (o.freq === undefined) return null;
    // Some rules parse but cannot be built (an unknown weekday code, for
    // one): building it once here means expansion never throws on them.
    new RRule({ ...o, dtstart: new Date(0) });
    return o;
  } catch {
    return null;
  }
}

function weekdayNumbers(byweekday: Options['byweekday'] | undefined): number[] | null {
  if (byweekday === undefined || byweekday === null) return null;
  const list = Array.isArray(byweekday) ? byweekday : [byweekday];
  const out: number[] = [];
  for (const w of list) {
    if (typeof w === 'number') out.push(w);
    else if (w instanceof Weekday && w.n === undefined) out.push(w.weekday);
    else return null; // "the second Tuesday" and the like: not in the model
  }
  return out;
}

/** The local date a stored UNTIL names, in the event's terms. */
function untilDate(until: Date, start: EventStart): IsoDate {
  return start.allDay
    ? formatIsoDate({
        year: until.getUTCFullYear(),
        month: until.getUTCMonth() + 1,
        day: until.getUTCDate(),
      })
    : formatIsoDate(wallClockOf(until, start.timeZone));
}

/**
 * What a stored rule means: one of HOME's presets, or `custom` for anything
 * else (a rule from elsewhere, or one HOME's editor cannot show). Only the
 * keys HOME writes are understood; any other part makes it custom.
 */
export function readRRule(rrule: string | null | undefined, start: EventStart): ReadRecurrence {
  if (rrule === null || rrule === undefined || rrule.trim() === '') return { preset: 'none' };
  const custom = { preset: 'custom' as const, rrule };
  const o = parseRule(rrule);
  if (!o) return custom;
  const keys = rrule
    .trim()
    .replace(/^RRULE:/i, '')
    .split(';')
    .map((p) => p.split('=')[0]!.toUpperCase());
  if (keys.some((k) => !['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL'].includes(k))) return custom;
  if (o.count != null && o.until != null) return custom;
  const end: RecurrenceEnd =
    o.count != null
      ? o.count >= 1 && o.count <= MAX_COUNT
        ? { type: 'count', count: o.count }
        : { type: 'never' }
      : o.until != null
        ? { type: 'until', date: untilDate(o.until, start) }
        : { type: 'never' };
  if (o.count != null && end.type !== 'count') return custom;
  const interval = o.interval ?? 1;
  // BYDAY belongs only to weekly rules; on any other it is outside the model.
  const byday = keys.includes('BYDAY');
  const days = weekdayNumbers(o.byweekday);
  switch (o.freq) {
    case RRule.DAILY:
      return interval === 1 && !byday ? { preset: 'daily', end } : custom;
    case RRule.WEEKLY: {
      if (days === null || days.length === 0) return custom;
      const weekdays = normaliseWeekdays(days);
      if (interval === 1) return { preset: 'weekly', weekdays, end };
      if (interval === 2) return { preset: 'fortnightly', weekdays, end };
      return custom;
    }
    case RRule.MONTHLY:
      return interval === 1 && !byday ? { preset: 'monthly', end } : custom;
    case RRule.YEARLY:
      return interval === 1 && !byday ? { preset: 'yearly', end } : custom;
    default:
      return custom;
  }
}

// ---------------------------------------------------------------------------
// Expansion

/** An event, as much of it as expansion needs. */
export type RecurringEvent =
  | {
      allDay: true;
      startDate: IsoDate;
      endDate: IsoDate; // exclusive (RFC 5545)
      rrule: string | null;
      exdates: readonly string[] | null;
    }
  | {
      allDay: false;
      startsAt: Date;
      endsAt: Date;
      timeZone: string;
      rrule: string | null;
      exdates: readonly string[] | null;
    };

export type Occurrence =
  | {
      allDay: true;
      /** The occurrence's own start date: its identity, and what "skip this one" names. */
      date: IsoDate;
      startDate: IsoDate;
      endDate: IsoDate; // exclusive
    }
  | {
      allDay: false;
      /** The occurrence's start date in the event's zone: what "skip this one" names. */
      date: IsoDate;
      startsAt: Date;
      endsAt: Date;
      timeZone: string;
    };

const fakeUtc = (w: WallClock) =>
  new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second));
const wallOfFake = (d: Date): WallClock => ({
  year: d.getUTCFullYear(),
  month: d.getUTCMonth() + 1,
  day: d.getUTCDate(),
  hour: d.getUTCHours(),
  minute: d.getUTCMinutes(),
  second: d.getUTCSeconds(),
});

/**
 * An EXDATE as HOME reads it. A date (`2026-10-21`, or RFC 5545's
 * `20261021`) skips the occurrence starting that local day; an instant skips
 * the timed occurrence starting at exactly that moment. Anything else is
 * ignored rather than guessed at.
 */
function readExdates(exdates: readonly string[] | null) {
  const dates = new Set<string>();
  const instants = new Set<number>();
  for (const raw of exdates ?? []) {
    const v = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && isValidIsoDate(v)) dates.add(v);
    else if (/^\d{8}$/.test(v)) {
      const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
      if (isValidIsoDate(iso)) dates.add(iso);
    } else {
      const t = Date.parse(v);
      if (/T/.test(v) && /(Z|[+-]\d{2}:?\d{2})$/.test(v) && Number.isFinite(t)) instants.add(t);
    }
  }
  return { dates, instants };
}

/** The local wall clock a rule's UNTIL stops at, written as if it were UTC. */
function untilWall(rrule: string, until: Date, start: EventStart): Date {
  // An UNTIL with a time of day is an instant (RFC 5545: UTC with a zoned
  // DTSTART), so it stops at that moment's wall clock in the event's zone,
  // which for HOME's own rules (the last second of the chosen day) is the
  // same thing. A date-only UNTIL, or any UNTIL on an all-day event, keeps
  // the whole of its last day.
  if (!start.allDay && /UNTIL=\d{8}T\d{6}Z/i.test(rrule))
    return fakeUtc(wallClockOf(until, start.timeZone));
  const lastDay = untilDate(until, start);
  return fakeUtc({ ...parseIsoDate(lastDay), hour: 23, minute: 59, second: 59 });
}

/** Days in one step of each frequency, at least (RRule.YEARLY … DAILY). */
const DAYS_PER_STEP: Record<number, number> = {
  [RRule.YEARLY]: 365,
  [RRule.MONTHLY]: 28,
  [RRule.WEEKLY]: 7,
  [RRule.DAILY]: 1,
};

/**
 * Stops the rrule library searching past `end`. Its UNTIL is checked only
 * when a date passes the rule's filters, so a rule that never yields (the
 * 30th of February, every day) is searched step by step to the year 9999,
 * seconds of work. The library's one per-step way out is its check that
 * `options.interval === 0`; it reads `options.interval` once on entry and
 * then twice a step (that check, then to advance), so the property is made to
 * answer 0 at the check once the steps needed to pass `end`, with a margin,
 * are spent. Every date up to `end` is still produced as before. Tied to
 * rrule 2.8's iteration; tests/unit/calendar/review-fixes.test.ts fails
 * if an upgrade changes it (the hostile rules would take seconds again, or
 * occurrences would go missing).
 */
function searchNoFurtherThan(rr: RRule, end: Date): RRule {
  const o = rr.options;
  const interval = o.interval;
  const perStep = DAYS_PER_STEP[o.freq];
  if (!perStep || interval < 1) return rr; // HOME expands nothing finer than daily
  const days = Math.max(0, (end.getTime() - o.dtstart.getTime()) / 86_400_000);
  const maxSteps = Math.ceil(days / perStep / interval) + 2;
  let reads = 0;
  Object.defineProperty(o, 'interval', {
    configurable: true,
    enumerable: true,
    get: () => (++reads % 2 === 0 && reads / 2 > maxSteps ? 0 : interval),
  });
  return rr;
}

/** What expansion needs about one event, shared by expandEvent and occursWithin. */
function prepare(event: RecurringEvent) {
  const start: EventStart = event.allDay
    ? { allDay: true, startDate: event.startDate }
    : { allDay: false, startsAt: event.startsAt, timeZone: event.timeZone };
  const first = startDateOf(start);
  const ex = readExdates(event.exdates);

  const occurrenceOn = (wall: WallClock): Occurrence => {
    const date = formatIsoDate(wall);
    if (event.allDay) {
      return {
        allDay: true,
        date,
        startDate: date,
        endDate: addDays(date, daysBetween(event.startDate, event.endDate)),
      };
    }
    const startsAt = instantFromWallClock(wall, event.timeZone);
    const length = event.endsAt.getTime() - event.startsAt.getTime();
    return {
      allDay: false,
      date,
      startsAt,
      endsAt: new Date(startsAt.getTime() + length),
      timeZone: event.timeZone,
    };
  };
  const excluded = (o: Occurrence) =>
    ex.dates.has(o.date) || (o.allDay === false && ex.instants.has(o.startsAt.getTime()));

  const startWall: WallClock = event.allDay
    ? { ...parseIsoDate(event.startDate), hour: 0, minute: 0, second: 0 }
    : wallClockOf(event.startsAt, event.timeZone);

  const rule = event.rrule ? parseRule(event.rrule) : null;
  const ruleUntil = rule?.until && event.rrule ? untilWall(event.rrule, rule.until, start) : null;
  /**
   * The rule, never evaluated past `end`. Floating expansion: DTSTART and
   * UNTIL are local wall clocks written as if they were UTC; occurrences come
   * back the same way. The rule's own UNTIL and COUNT still apply; the cap
   * only stops the rrule library searching beyond the query, which for a
   * rule that never yields (30 February, every day) would run to year 9999.
   */
  const ruleTo = (end: Date): RRule | null => {
    if (!rule) return null;
    const options: Partial<Options> = { ...rule, dtstart: fakeUtc(startWall) };
    options.until = ruleUntil && ruleUntil < end ? ruleUntil : end;
    if (rule.count != null) options.count = Math.min(rule.count, MAX_COUNT);
    return searchNoFurtherThan(new RRule(options), end);
  };
  const windowOf = (from: IsoDate, to: IsoDate) => ({
    start: fakeUtc({ ...parseIsoDate(from < first ? first : from), hour: 0, minute: 0, second: 0 }),
    end: fakeUtc({ ...parseIsoDate(to), hour: 23, minute: 59, second: 59 }),
  });
  return { first, occurrenceOn, excluded, startWall, recurs: rule !== null, ruleTo, windowOf };
}

/**
 * Every occurrence of an event whose start date (in the event's own zone,
 * or its date for all-day events) falls within `from`…`to`, inclusive, in
 * order, skipping exdates. A one-off event is its single occurrence. A
 * stored rule that cannot be read yields just the first occurrence, never a
 * guess. Duration: an all-day occurrence keeps the event's number of days;
 * a timed one keeps its elapsed length, so a 1-hour event is 1 hour long on
 * a DST night too.
 */
export function expandEvent(event: RecurringEvent, from: IsoDate, to: IsoDate): Occurrence[] {
  if (to < from) return [];
  const p = prepare(event);
  const kept = (o: Occurrence) => o.date >= from && o.date <= to && !p.excluded(o);
  if (!p.recurs) {
    const only = p.occurrenceOn(p.startWall);
    return kept(only) ? [only] : [];
  }
  if (to < p.first) return [];
  const w = p.windowOf(from, to);
  return p
    .ruleTo(w.end)!
    .between(w.start, w.end, true)
    .map((d) => p.occurrenceOn(wallOfFake(d)))
    .filter(kept);
}

/** The result of occursWithin: whether it does, and how much work finding out took. */
export type OccursWithin = { occurs: boolean; steps: number; exhausted: boolean };

/**
 * Whether an event has any occurrence starting within `from`…`to` (as
 * expandEvent counts them), stopping at the first, and walking at most
 * `maxSteps` occurrences of its rule from the beginning. A rule that needs
 * more steps than that to reach the window is reported `exhausted`, so a
 * caller can refuse it rather than spend unbounded time (M4: an imported
 * rule is outside HOME's control). Exdates count as steps walked.
 */
export function occursWithin(
  event: RecurringEvent,
  from: IsoDate,
  to: IsoDate,
  maxSteps: number,
): OccursWithin {
  if (to < from) return { occurs: false, steps: 0, exhausted: false };
  const p = prepare(event);
  const inRange = (o: Occurrence) => o.date >= from && o.date <= to && !p.excluded(o);
  if (!p.recurs)
    return { occurs: inRange(p.occurrenceOn(p.startWall)), steps: 1, exhausted: false };
  if (to < p.first) return { occurs: false, steps: 0, exhausted: false };
  const w = p.windowOf(from, to);
  let steps = 0;
  let occurs = false;
  let exhausted = false;
  p.ruleTo(w.end)!.all((d) => {
    if (++steps > maxSteps) {
      exhausted = true;
      return false;
    }
    if (d > w.end) return false;
    if (d < w.start) return true;
    occurs = inRange(p.occurrenceOn(wallOfFake(d)));
    return !occurs;
  });
  return { occurs, steps: Math.min(steps, maxSteps), exhausted };
}

/** The exdates with one more occurrence skipped, by its date: for "skip this one". */
export function skipOccurrence(exdates: readonly string[] | null, date: IsoDate): string[] {
  if (!isValidIsoDate(date)) throw new RecurrenceError('not a real date');
  return [...new Set([...(exdates ?? []), date])].sort();
}

/** The weekday of an event's first date: the default day for weekly and fortnightly. */
export function defaultWeekdays(start: EventStart): number[] {
  return [weekdayOf(startDateOf(start))];
}
