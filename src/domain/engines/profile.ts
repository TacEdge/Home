import {
  compareIsoDates,
  formatIsoDate,
  isLeapYear,
  parseIsoDate,
  type IsoDate,
} from '@/lib/dates';

// The profile engine (SYSTEM-ARCHITECTURE §2.2): age and next birthday from a
// date of birth. Pure: no database, no clock, no time zone. "today" is a
// calendar date the caller computed in the home time zone. Regular-week
// derivation arrives with recurrence support (ADR 0005, D-M2-4). No
// school-year inference (D17).

/**
 * The date a birthday falls on in a given year. A 29 February birthday falls
 * on 28 February in common years (P-4, ADR 0005).
 */
export function birthdayInYear(dateOfBirth: IsoDate, year: number): IsoDate {
  const dob = parseIsoDate(dateOfBirth);
  const day = dob.month === 2 && dob.day === 29 && !isLeapYear(year) ? 28 : dob.day;
  return formatIsoDate({ year, month: dob.month, day });
}

/** Age in whole years on `today`; null without a date of birth or before it. */
export function ageOn(dateOfBirth: IsoDate | null, today: IsoDate): number | null {
  if (dateOfBirth === null) return null;
  if (compareIsoDates(today, dateOfBirth) < 0) return null;
  const dob = parseIsoDate(dateOfBirth);
  const now = parseIsoDate(today);
  const reached = compareIsoDates(today, birthdayInYear(dateOfBirth, now.year)) >= 0;
  return now.year - dob.year - (reached ? 0 : 1);
}

export type NextBirthday = { date: IsoDate; age: number };

/**
 * The next birthday on or after `today`, and the age reached on it. A
 * birthday today is today's. Null without a date of birth or before it.
 */
export function nextBirthday(dateOfBirth: IsoDate | null, today: IsoDate): NextBirthday | null {
  if (dateOfBirth === null) return null;
  if (compareIsoDates(today, dateOfBirth) < 0) return null;
  const dob = parseIsoDate(dateOfBirth);
  const now = parseIsoDate(today);
  const thisYear = birthdayInYear(dateOfBirth, now.year);
  const date =
    compareIsoDates(thisYear, today) >= 0 ? thisYear : birthdayInYear(dateOfBirth, now.year + 1);
  return { date, age: parseIsoDate(date).year - dob.year };
}
