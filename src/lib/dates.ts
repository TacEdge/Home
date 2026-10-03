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
