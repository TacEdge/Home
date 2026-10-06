import { createHash } from 'node:crypto';
import {
  CalendarProviderError,
  IMPORT_LIMITS,
  emptyNotes,
  type ExternalCalendar,
  type ExternalEvent,
  type ExternalTime,
  type FetchNotes,
  type FetchRange,
  type FetchResult,
  uidFits,
} from '@/domain/calendar/provider';
import { isReadableRRule, occursWithin } from '@/domain/engines/recurrence';
import {
  addDays,
  daysBetween,
  formatIsoDate,
  instantFromWallClock,
  isValidIsoDate,
  offsetAt,
  wallClockOf,
  type IsoDate,
  type WallClock,
} from '@/lib/dates';
import { ianaZone, resolveZoneName } from '@/lib/time-zones';
import { TEXT_LIMITS, plainText } from '../text';
import type { RawEvent, RawFeed, RawProperty } from './feed';

// Raw ICS events to HOME's ExternalEvent (M4 contract §3.1, §3.3, §3.5).
// Every rule here is deterministic and never guesses:
//   - a time with a TZID is read in that zone when it is an IANA name or a
//     known Windows name; an unknown zone, and a time with no zone at all
//     (floating), is read in the calendar's declared zone (X-WR-TIMEZONE,
//     when it is an IANA name) or else HOME_TIMEZONE, and an unknown zone is
//     counted; a `Z` time is UTC;
//   - all-day events are dates with an exclusive end; a missing end is one
//     day (all-day) or DURATION, else the start (timed);
//   - a rule HOME cannot read, or that needs too much work to reach the
//     window, leaves the event as its first occurrence only, and is counted;
//   - a moved or changed occurrence is its own event, and its original
//     occurrence joins the series' exdates; a cancelled occurrence is an
//     exdate only; a cancelled event is removed;
//   - the same identity twice keeps the latest revision (SEQUENCE, then
//     LAST-MODIFIED, then content), whatever order the feed lists them in.

/** Rule frequencies HOME expands. Finer ones can describe millions of occurrences. */
const FREQS = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
/** Rule parts that multiply occurrences within a day; outside what HOME expands. */
const SUBDAY_PARTS = new Set(['BYHOUR', 'BYMINUTE', 'BYSECOND']);
/** Occurrences a series may walk to reach the window before HOME stops reading its rule. */
export const MAX_RULE_STEPS = 20_000;
/** Occurrences the whole feed may walk; beyond it the calendar is too large to bring in. */
export const MAX_FEED_STEPS = 300_000;
/** As the event schema allows (src/domain/events/schema.ts). */
const MAX_EXDATES = 500;
const MAX_RRULE = 1000;

type Moment =
  { kind: 'date'; date: IsoDate } | { kind: 'instant'; at: Date; zone: string; wall: WallClock };

type Context = { floatingZone: string; notes: FetchNotes };

/** Raised inside normalisation for an event that cannot be read; it is skipped and counted. */
class Unreadable extends Error {}

const DATE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

function isoOf(y: string, m: string, d: string): IsoDate | null {
  const iso = `${y}-${m}-${d}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** A DATE or DATE-TIME value with the parameters it came with. */
function readMoment(
  value: string,
  params: RawProperty['params'],
  ctx: Context,
  zoneSeen: { unknown: boolean },
): Moment | null {
  const v = value.trim().toUpperCase();
  const declaredDate = (params.VALUE ?? '').toUpperCase() === 'DATE';
  const d = DATE.exec(v);
  if (d) {
    const date = isoOf(d[1]!, d[2]!, d[3]!);
    return date ? { kind: 'date', date } : null;
  }
  if (declaredDate) return null;
  const t = DATE_TIME.exec(v);
  if (!t) return null;
  const date = isoOf(t[1]!, t[2]!, t[3]!);
  const [hour, minute, second] = [Number(t[4]), Number(t[5]), Number(t[6])];
  if (!date || hour > 23 || minute > 59 || second > 59) return null;
  const wall: WallClock = {
    year: Number(t[1]),
    month: Number(t[2]),
    day: Number(t[3]),
    hour,
    minute,
    second,
  };
  if (t[7] === 'Z') {
    const at = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, hour, minute, second));
    return { kind: 'instant', at, zone: 'UTC', wall };
  }
  let zone = ctx.floatingZone;
  if (params.TZID !== undefined) {
    const resolved = resolveZoneName(params.TZID);
    if (resolved) zone = resolved.zone;
    else zoneSeen.unknown = true;
  }
  return { kind: 'instant', at: instantFromWallClock(wall, zone), zone, wall };
}

/** RFC 5545 DURATION: weeks and days on the wall clock, hours, minutes and seconds elapsed. */
function readDuration(value: string): { days: number; ms: number } | null {
  const m =
    /^\+?P(?:(\d{1,6})W)?(?:(\d{1,6})D)?(?:T(?=\d)(?:(\d{1,6})H)?(?:(\d{1,6})M)?(?:(\d{1,6})S)?)?$/.exec(
      value.trim().toUpperCase(),
    );
  if (!m || m.slice(1).every((x) => x === undefined)) return null;
  const [w, d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0));
  return { days: w! * 7 + d!, ms: ((h! * 60 + min!) * 60 + s!) * 1000 };
}

function instantFromWall(wall: WallClock, plusDays: number, zone: string): Date {
  const [y, m, d] = addDays(formatIsoDate(wall), plusDays).split('-').map(Number);
  return instantFromWallClock({ ...wall, year: y!, month: m!, day: d! }, zone);
}

const wallMs = (w: WallClock) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);

/**
 * How far a local start was moved forward because its wall clock does not
 * exist (the hour skipped when daylight saving starts); 0 for any other time.
 * The resolved instant is read with the offset before the change (RFC 5545
 * §3.3.5, HOME's engine rule), so it lies later than the same wall clock
 * read with the offset after it by exactly the gap.
 */
function gapShift(m: Moment): number {
  if (m.kind !== 'instant') return 0;
  const shown = wallClockOf(m.at, m.zone);
  if (wallMs(shown) === wallMs(m.wall)) return 0;
  return m.at.getTime() - (wallMs(m.wall) - offsetAt(m.at.getTime(), m.zone));
}

const utcInstant = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The rule as HOME keeps it, with UNTIL spelled for this event; null when it cannot be read. */
function readRule(raw: RawProperty, time: ExternalTime, ctx: Context): string | null {
  let rule = raw.value.trim().replace(/^RRULE:/i, '');
  if (rule.length === 0 || rule.length > MAX_RRULE || !/^[A-Z0-9=;,:+\-]+$/i.test(rule))
    return null;
  const parts = rule.split(';').map((p) => p.split('='));
  if (parts.some((p) => p.length !== 2 || !p[0] || !p[1])) return null;
  const keys = parts.map(([k]) => (k ?? '').toUpperCase());
  if (new Set(keys).size !== keys.length) return null;
  const get = (k: string) => parts.find(([key]) => (key ?? '').toUpperCase() === k)?.[1];
  if (!FREQS.has((get('FREQ') ?? '').toUpperCase())) return null;
  if (keys.some((k) => SUBDAY_PARTS.has(k))) return null;
  if (get('COUNT') !== undefined && get('UNTIL') !== undefined) return null;
  const until = get('UNTIL');
  if (until !== undefined) {
    const m = readMoment(until, {}, ctx, { unknown: false });
    if (!m) return null;
    let spelled: string;
    if (time.allDay) {
      // An all-day rule ends on a date. A time-of-day UNTIL (as some
      // calendars write it) names the date it falls on in the calendar's zone.
      spelled =
        m.kind === 'date'
          ? m.date.replaceAll('-', '')
          : formatIsoDate(
              wallClockOf(m.at, m.zone === 'UTC' ? ctx.floatingZone : m.zone),
            ).replaceAll('-', '');
    } else if (m.kind === 'date') {
      spelled = m.date.replaceAll('-', ''); // a whole last day (the engine reads it so)
    } else {
      // A floating UNTIL is the event's own wall clock; RFC 5545 wants UTC.
      const at = /Z$/i.test(until) ? m.at : instantFromWallClock(m.wall, time.timeZone);
      spelled = utcInstant(at).replace(/[-:]/g, '');
    }
    rule = parts
      .map(([k, v]) => ((k ?? '').toUpperCase() === 'UNTIL' ? `UNTIL=${spelled}` : `${k}=${v}`))
      .join(';');
  }
  return isReadableRRule(rule) ? rule : null;
}

/**
 * An override's identity: its RECURRENCE-ID as written, a DATE as an ISO date
 * and a DATE-TIME as the UTC instant its own zone names. Never derived from
 * the series, so an override reads the same whether or not its series is in
 * the feed (ADR 0007 §26).
 */
const identityOf = (m: Moment): string => (m.kind === 'date' ? m.date : utcInstant(m.at));

/** An exdate or original occurrence in the series' terms: a date (all-day) or a UTC instant. */
function inSeriesTerms(m: Moment, series: ExternalTime): string {
  if (series.allDay) return m.kind === 'date' ? m.date : formatIsoDate(m.wall);
  if (m.kind === 'instant') return utcInstant(m.at);
  // A date naming an occurrence of a timed series: the series' own time on that day, in its zone.
  const wall = { ...wallClockOf(series.startsAt, series.timeZone) };
  const [y, mo, d] = m.date.split('-').map(Number);
  return utcInstant(
    instantFromWallClock({ ...wall, year: y!, month: mo!, day: d! }, series.timeZone),
  );
}

type Read = {
  event: ExternalEvent;
  cancelled: boolean;
  recurrence: Moment | null;
  revision: [number, number, string];
  ignoredRdate: boolean;
  unknownZone: boolean;
};

function readEvent(raw: RawEvent, ctx: Context): Read {
  const uid =
    typeof raw.uid === 'string' || typeof raw.uid === 'number' ? String(raw.uid).trim() : '';
  // Bounded in UTF-8 bytes, never truncated (ADR 0007 §35).
  if (!uidFits(uid) || /[\u0000-\u001f\u007f]/.test(uid)) throw new Unreadable();
  if (raw.dtstart.length !== 1 || raw.dtend.length > 1 || raw.duration.length > 1)
    throw new Unreadable();
  if (raw.dtend.length && raw.duration.length) throw new Unreadable();
  if (raw.recurrenceId.length > 1) throw new Unreadable();
  const zones = { unknown: false };

  const start = readMoment(raw.dtstart[0]!.value, raw.dtstart[0]!.params, ctx, zones);
  if (!start) throw new Unreadable();
  let time: ExternalTime;
  const endProp = raw.dtend[0];
  const duration = raw.duration[0] ? readDuration(raw.duration[0].value) : null;
  if (raw.duration[0] && !duration) throw new Unreadable();
  if (start.kind === 'date') {
    let endDate = addDays(start.date, 1);
    if (endProp) {
      const end = readMoment(endProp.value, endProp.params, ctx, zones);
      if (!end || end.kind !== 'date' || end.date < start.date) throw new Unreadable();
      // An end equal to the start (some calendars write it) is the one day.
      if (end.date > start.date) endDate = end.date;
    } else if (duration) {
      if (duration.ms !== 0) throw new Unreadable();
      endDate = addDays(start.date, Math.max(1, duration.days));
    }
    time = { allDay: true, startDate: start.date, endDate };
  } else {
    let endsAt = start.at;
    if (endProp) {
      const end = readMoment(endProp.value, endProp.params, ctx, zones);
      if (!end || end.kind !== 'instant') throw new Unreadable();
      // A start in the spring-forward gap moves forward by the gap (as the
      // engine moves an occurrence); the event keeps the length its source
      // gave it, so it never collapses to nothing (ADR 0007 §24). With both
      // ends local in one zone, that length is their wall-clock difference
      // read before the gap is resolved. A start that exists keeps the real
      // elapsed time to its end, so an event across the change is shorter.
      const shift = gapShift(start);
      if (end.zone === start.zone) {
        const length = wallMs(end.wall) - wallMs(start.wall);
        if (length < 0) throw new Unreadable();
        endsAt = shift ? new Date(start.at.getTime() + length) : end.at;
      } else {
        endsAt = new Date(end.at.getTime() + shift);
      }
      if (endsAt < start.at) throw new Unreadable();
    } else if (duration) {
      endsAt = new Date(
        instantFromWall(start.wall, duration.days, start.zone).getTime() + duration.ms,
      );
    }
    time = { allDay: false, startsAt: start.at, endsAt, timeZone: start.zone };
  }

  const recurrence = raw.recurrenceId[0]
    ? readMoment(raw.recurrenceId[0].value, raw.recurrenceId[0].params, ctx, zones)
    : null;
  if (raw.recurrenceId[0] && (!recurrence || raw.recurrenceId[0].params.RANGE !== undefined))
    throw new Unreadable(); // RANGE=THISANDFUTURE rewrites the series; HOME does not apply it

  // Recurrence: a series only. One readable RRULE, no EXRULE (it would
  // remove occurrences HOME cannot see), every EXDATE readable.
  let rrule: string | null = null;
  let readable: ExternalEvent['recurrence'] = 'none';
  const exdates: string[] = [];
  if (!recurrence && (raw.rrule.length || raw.exrule.length)) {
    rrule =
      raw.rrule.length === 1 && !raw.exrule.length ? readRule(raw.rrule[0]!, time, ctx) : null;
    // Counted before any is read: a series with more exdates than an event
    // may hold is unreadable, and reading each would be unbounded work.
    const exdateCount = raw.exdate.reduce((n, ex) => n + ex.value.split(',').length, 0);
    if (exdateCount > MAX_EXDATES) rrule = null;
    else
      for (const ex of raw.exdate) {
        for (const v of ex.value.split(',')) {
          const m = readMoment(v, ex.params, ctx, zones);
          if (!m) rrule = null;
          else exdates.push(inSeriesTerms(m, time));
        }
      }
    readable = rrule ? 'rule' : 'unreadable';
  }

  const status = typeof raw.status === 'string' ? raw.status.trim().toUpperCase() : '';
  const seq = Number(raw.sequence);
  const sequence = Number.isInteger(seq) && seq >= 0 ? seq : null;
  const lm = raw.lastModified[0]
    ? readMoment(raw.lastModified[0].value, raw.lastModified[0].params, ctx, zones)
    : null;
  const updatedAt =
    lm && lm.kind === 'instant' && /Z$/i.test(raw.lastModified[0]!.value.trim()) ? lm.at : null;

  const event: ExternalEvent = {
    uid,
    recurrenceId: null,
    status: status === 'TENTATIVE' ? 'tentative' : 'confirmed',
    time,
    rrule: readable === 'rule' ? rrule : null,
    recurrence: readable,
    // Kept whatever the rule: the engine honours exdates on a single event too.
    exdates,
    cancelledOccurrences: [],
    title: plainText(raw.summary, TEXT_LIMITS.title, 'line'),
    description: plainText(raw.description, TEXT_LIMITS.description, 'block'),
    location: plainText(raw.location, TEXT_LIMITS.location, 'line'),
    sequence,
    updatedAt,
  };
  return {
    event,
    cancelled: status === 'CANCELLED',
    recurrence,
    revision: [sequence ?? -1, updatedAt?.getTime() ?? -1, canonical(event)],
    ignoredRdate: raw.rdate.length > 0 && !recurrence,
    unknownZone: zones.unknown,
  };
}

/** A deterministic serialisation: object keys sorted, Dates as ISO. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : x,
  );
}

const newer = (a: Read, b: Read) => {
  for (let i = 0; i < 3; i++) {
    if (a.revision[i]! > b.revision[i]!) return true;
    if (a.revision[i]! < b.revision[i]!) return false;
  }
  return false;
};

/** The latest revision of each identity, counting the rest. */
function latest(reads: Read[], key: (r: Read) => string, notes: FetchNotes): Map<string, Read> {
  const out = new Map<string, Read>();
  for (const r of reads) {
    const k = key(r);
    const seen = out.get(k);
    if (!seen) out.set(k, r);
    else {
      notes.duplicate++;
      if (newer(r, seen)) out.set(k, r);
    }
  }
  return out;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (xs: string[]) => [...new Set(xs)].sort(cmp);

function asRecurring(e: ExternalEvent) {
  return e.time.allDay
    ? {
        allDay: true as const,
        startDate: e.time.startDate,
        endDate: e.time.endDate,
        rrule: e.rrule,
        exdates: e.exdates,
      }
    : {
        allDay: false as const,
        startsAt: e.time.startsAt,
        endsAt: e.time.endsAt,
        timeZone: e.time.timeZone,
        rrule: e.rrule,
        exdates: e.exdates,
      };
}

/** Days an occurrence may start before the window and still reach into it. */
function spanDays(e: ExternalEvent): number {
  if (e.time.allDay) return daysBetween(e.time.startDate, e.time.endDate);
  return Math.ceil((e.time.endsAt.getTime() - e.time.startsAt.getTime()) / 86_400_000);
}

/** Budgeted window check: a rule too costly to reach the window is no longer read. */
function inWindow(
  e: ExternalEvent,
  range: FetchRange,
  budget: { steps: number },
  notes: FetchNotes,
): boolean {
  // A day's margin either side: the engine counts dates in the event's own
  // zone, the window is in the home zone.
  const from = addDays(range.from, -(spanDays(e) + 1));
  const to = addDays(range.to, 1);
  let r: ReturnType<typeof occursWithin>;
  try {
    r = occursWithin(asRecurring(e), from, to, Math.min(MAX_RULE_STEPS, budget.steps + 1));
  } catch {
    // A rule the engine cannot expand after all: read as unreadable, never a failed feed.
    r = { occurs: false, steps: 1, exhausted: true };
  }
  budget.steps -= r.steps;
  if (budget.steps < 0) throw new CalendarProviderError('too_large');
  if (r.exhausted) {
    e.rrule = null;
    e.recurrence = 'unreadable';
    notes.unreadableRecurrence++;
    r = occursWithin(asRecurring(e), from, to, 1);
  }
  return r.occurs;
}

/**
 * Events, windowed, bounded and in order, with the feed's hash. Shared by
 * the ICS adapter and the fake provider, so both answer the same way.
 */
export function finish(
  calendar: ExternalCalendar,
  events: ExternalEvent[],
  skippedBefore: number,
  notes: FetchNotes,
  range: FetchRange,
): FetchResult {
  let skipped = skippedBefore;
  const budget = { steps: MAX_FEED_STEPS };
  const groups = new Map<string, ExternalEvent[]>();
  // Any provider's events, not only a parsed feed's: a UID that cannot be an
  // identity is skipped and counted here too (ADR 0007 §35).
  const fitting = events.filter((e) => uidFits(e.uid));
  skipped += events.length - fitting.length;
  const copies = fitting.map((e) => ({
    ...e,
    exdates: [...e.exdates],
    cancelledOccurrences: [...e.cancelledOccurrences],
  }));
  for (const e of copies) groups.set(e.uid, [...(groups.get(e.uid) ?? []), e]);
  const kept: ExternalEvent[] = [];
  for (const group of groups.values()) {
    // A series is kept whole (with its overrides) when any part reaches the window.
    let any = false;
    for (const e of group) if (inWindow(e, range, budget, notes)) any = true;
    if (any) kept.push(...group);
  }
  if (kept.length > IMPORT_LIMITS.maxEvents) throw new CalendarProviderError('too_large');
  kept.sort((a, b) => cmp(a.uid, b.uid) || cmp(a.recurrenceId ?? '', b.recurrenceId ?? ''));
  const result = { calendar, events: kept, skipped, notes };
  // The hash of the feed as HOME reads it. Google writes a fresh DTSTAMP on
  // every event each time it serves the feed, so the raw bytes never repeat;
  // this hash changes exactly when something HOME keeps changes.
  const feedHash = `h1:${createHash('sha256').update(canonical(result)).digest('hex')}`;
  return { ...result, feedHash };
}

/** A raw feed to the provider's result for a range. */
export function normaliseFeed(feed: RawFeed, range: FetchRange, homeTimeZone: string): FetchResult {
  const declared = typeof feed.calendarZone === 'string' ? ianaZone(feed.calendarZone) : null;
  const ctx: Context = { floatingZone: declared ?? homeTimeZone, notes: emptyNotes() };
  const notes = ctx.notes;
  let skipped = feed.unreadable;

  const reads: Read[] = [];
  for (const raw of feed.events) {
    try {
      const r = readEvent(raw, ctx);
      if (r.unknownZone) notes.unknownZone++;
      if (r.ignoredRdate) notes.ignoredRdate++;
      if (r.event.recurrence === 'unreadable') notes.unreadableRecurrence++;
      reads.push(r);
    } catch (e) {
      if (!(e instanceof Unreadable)) throw e;
      skipped++;
    }
  }

  const masters = latest(
    reads.filter((r) => !r.recurrence),
    (r) => r.event.uid,
    notes,
  );
  const overrides = reads.filter((r) => r.recurrence);
  const out: ExternalEvent[] = [];
  const byOriginal = latest(
    overrides,
    (r) => `${r.event.uid}\u0000${identityOf(r.recurrence!)}`,
    notes,
  );
  const removed = new Set<string>();
  for (const [uid, m] of masters) if (m.cancelled) removed.add(uid);
  for (const o of byOriginal.values()) {
    const uid = o.event.uid;
    if (removed.has(uid)) continue;
    const series = masters.get(uid);
    const recurrenceId = identityOf(o.recurrence!);
    if (!series) {
      // Kept as itself; no parent is made up for it (ADR 0007 §26).
      notes.orphanOverride++;
      if (!o.cancelled) out.push({ ...o.event, recurrenceId });
      continue;
    }
    // Only the series' exdate is in the series' own terms.
    const original = inSeriesTerms(o.recurrence!, series.event.time);
    series.event.exdates.push(original);
    if (o.cancelled) series.event.cancelledOccurrences.push(original);
    if (!o.cancelled) out.push({ ...o.event, recurrenceId });
  }
  for (const [uid, m] of masters) {
    if (removed.has(uid)) continue;
    const e = m.event;
    e.exdates = sortedUnique(e.exdates);
    e.cancelledOccurrences = sortedUnique(e.cancelledOccurrences);
    if (e.exdates.length > MAX_EXDATES) {
      e.rrule = null;
      e.recurrence = 'unreadable';
      e.exdates = [];
      e.cancelledOccurrences = [];
      notes.unreadableRecurrence++;
    }
    out.push(e);
  }

  const calendar: ExternalCalendar = {
    id: 'default',
    name: plainText(feed.calendarName, TEXT_LIMITS.title, 'line'),
  };
  return finish(calendar, out, skipped, notes, range);
}
