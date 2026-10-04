// Pure calendar-date helpers. All-day values and "today" travel as plain
// `YYYY-MM-DD` strings; the caller computes today in the home time zone
// (M2 contract §4.1) and engines never read the clock. No local-time Date
// arithmetic anywhere: these work on integer year, month and day.

/** A calendar date as `YYYY-MM-DD`. */
export type IsoDate = string;

export type CalendarDate = { year: number; month: number; day: number };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** True for a real calendar date between 1900 and 2199. */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2199 || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function parseIsoDate(value: IsoDate): CalendarDate {
  if (!isValidIsoDate(value)) throw new RangeError('not a valid calendar date');
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

export function formatIsoDate(d: CalendarDate): IsoDate {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** -1, 0 or 1. String order is calendar order for valid ISO dates. */
export function compareIsoDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * True for a time zone name the runtime's IANA database knows (a region
 * name, or `UTC`). The database cannot check this, so input schemas do.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() !== timeZone || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-NZ', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date of an instant in an IANA time zone, for callers computing "today". */
export function isoDateInZone(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * A calendar date in words, NZ style: "Tuesday 20 October" or, short,
 * "20 Oct". The date is a date, not an instant, so it is formatted in UTC.
 */
export function longDate(date: IsoDate, style: 'long' | 'short' = 'long'): string {
  const d = parseIsoDate(date);
  const instant = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'UTC',
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    ...(style === 'long' ? { weekday: 'long' } : {}),
  })
    .format(instant)
    .replace(',', '');
}

// ---------------------------------------------------------------------------
// Days and wall clocks. Still integer arithmetic on calendar fields; the only
// conversions between instants and local time go through Intl's IANA data.

/** The date `n` days after (or before, for negative `n`) a date. */
export function addDays(date: IsoDate, n: number): IsoDate {
  const d = parseIsoDate(date);
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return formatIsoDate({
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
  });
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const x = parseIsoDate(a);
  const y = parseIsoDate(b);
  return Math.round(
    (Date.UTC(y.year, y.month - 1, y.day) - Date.UTC(x.year, x.month - 1, x.day)) / 86_400_000,
  );
}

/** Day of the week, 0 = Monday … 6 = Sunday (RFC 5545 order, MO first). */
export function weekdayOf(date: IsoDate): number {
  const d = parseIsoDate(date);
  return (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;
}

/** A local date and time of day, with no zone attached. */
export type WallClock = CalendarDate & { hour: number; minute: number; second: number };

const wallFormat = new Map<string, Intl.DateTimeFormat>();
function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = wallFormat.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-NZ', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    wallFormat.set(timeZone, f);
  }
  return f;
}

/** The wall clock an instant shows in an IANA time zone. */
export function wallClockOf(instant: Date, timeZone: string): WallClock {
  const parts = wallFormatter(timeZone).formatToParts(instant);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: n('year'),
    month: n('month'),
    day: n('day'),
    hour: n('hour'),
    minute: n('minute'),
    second: n('second'),
  };
}

const wallMs = (w: WallClock) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);

/** The zone's offset from UTC at an instant, in milliseconds (NZDT: +13h). */
export function offsetAt(instant: number, timeZone: string): number {
  return wallMs(wallClockOf(new Date(instant), timeZone)) - (instant - (instant % 1000));
}

/**
 * The instant a wall clock names in an IANA time zone. Where the clock
 * shows that time twice (the hour repeated when daylight saving ends), the
 * first instance. Where it never shows it (the hour skipped when daylight
 * saving starts), the time moved forward by the gap: 02:30 on the NZ
 * spring-forward night becomes 03:30 NZDT (M3 contract §5).
 */
export function instantFromWallClock(wall: WallClock, timeZone: string): Date {
  const target = wallMs(wall);
  const before = offsetAt(target - 86_400_000, timeZone);
  const after = offsetAt(target + 86_400_000, timeZone);
  const matches = [...new Set([target - before, target - after])]
    .filter((t) => wallMs(wallClockOf(new Date(t), timeZone)) === target)
    .sort((a, b) => a - b);
  // In a gap neither offset reproduces the wall time; the pre-transition
  // offset lands just after the gap, shifted forward by its length.
  return new Date(matches[0] ?? target - before);
}
