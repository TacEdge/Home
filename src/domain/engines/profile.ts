import {
  compareIsoDates,
  formatIsoDate,
  isLeapYear,
  parseIsoDate,
  type IsoDate,
} from '@/lib/dates';

// The profile engine (SYSTEM-ARCHITECTURE §2.2, M2 contract §6): age and next
// birthday from a date of birth. Pure: no database, clock or time zone;
// `today` is a calendar date the caller computed in the home time zone.
// Regular week waits for recurrence support (ADR 0005, D-M2-4). No school
// year is inferred (D17). Nothing here measures or scores a person (rule 11).

/**
 * The date of a birthday in a given year. A 29 February birthday falls on
 * 28 February in common years (P-4, ADR 0005 §12).
 */
export function birthdayInYear(dateOfBirth: IsoDate, year: number): IsoDate {
  const dob = parseIsoDate(dateOfBirth);
  const day = dob.month === 2 && dob.day === 29 && !isLeapYear(year) ? 28 : dob.day;
  return formatIsoDate({ year, month: dob.month, day });
}

/** Age in whole years on `today`; null without a date of birth, or before it. */
export function ageOn(dateOfBirth: IsoDate | null, today: IsoDate): number | null {
  if (dateOfBirth === null || compareIsoDates(today, dateOfBirth) < 0) return null;
  const born = parseIsoDate(dateOfBirth).year;
  const year = parseIsoDate(today).year;
  const reached = compareIsoDates(today, birthdayInYear(dateOfBirth, year)) >= 0;
  return year - born - (reached ? 0 : 1);
}

export type NextBirthday = { date: IsoDate; age: number };

/**
 * The next birthday on or after `today` (a birthday today is today's) and the
 * age reached on it. Null without a date of birth, or before it.
 */
export function nextBirthday(dateOfBirth: IsoDate | null, today: IsoDate): NextBirthday | null {
  if (dateOfBirth === null || compareIsoDates(today, dateOfBirth) < 0) return null;
  const born = parseIsoDate(dateOfBirth).year;
  const year = parseIsoDate(today).year;
  const thisYear = birthdayInYear(dateOfBirth, year);
  const date =
    compareIsoDates(thisYear, today) >= 0 ? thisYear : birthdayInYear(dateOfBirth, year + 1);
  return { date, age: parseIsoDate(date).year - born };
}
