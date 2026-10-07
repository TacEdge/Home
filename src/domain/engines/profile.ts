import {
  addDays,
  clockOf,
  compareIsoDates,
  formatIsoDate,
  isLeapYear,
  isoDateInZone,
  parseIsoDate,
  weekdayOf,
  type IsoDate,
} from '@/lib/dates';
import type { AgendaPersonRef } from './agenda';
import { expandEvent, weeklyCadence, type RecurringEvent, type WeeklyCadence } from './recurrence';

// The profile engine (SYSTEM-ARCHITECTURE §2.2, M2 contract §6): age and next
// birthday from a date of birth. Pure: no database, clock or time zone;
// `today` is a calendar date the caller computed in the home time zone.
// The regular week (M4 contract §3.6) is derived here from recurring events,
// on read; nothing is stored. No school year is inferred (D17). Nothing here
// measures or scores a person (rule 11).

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

// ---------------------------------------------------------------------------
// The regular week (M4 contract §3.6, ADR 0007 §45)

/** A recurring event as the regular week reads it: the agenda's input, with who it is for. */
export type RegularWeekEventInput = RecurringEvent & {
  id: string;
  title: string;
  /** The event's effective people (its own annotations, else its calendar's usual people). */
  people?: readonly AgendaPersonRef[];
};

export type RegularWeekEntry =
  | {
      /** 0 = Monday … 6 = Sunday, in the home zone. */
      weekday: number;
      allDay: true;
      cadence: WeeklyCadence;
      eventId: string;
      title: string;
    }
  | {
      weekday: number;
      allDay: false;
      /** The home-zone wall-clock start of its next occurrence on this weekday, as "15:30". */
      time: string;
      cadence: WeeklyCadence;
      eventId: string;
      title: string;
    };

/** The order within the regular week: Monday to Sunday, all-day first, then by time, title, id. */
export function compareRegularWeekEntries(a: RegularWeekEntry, b: RegularWeekEntry): number {
  if (a.weekday !== b.weekday) return a.weekday - b.weekday;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (!a.allDay && !b.allDay && a.time !== b.time) return a.time < b.time ? -1 : 1;
  const t = a.title.localeCompare(b.title, 'en-NZ');
  if (t !== 0) return t;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

/**
 * A person's regular week: the weekly and fortnightly series they are on
 * (any role, as the caller resolved it), placed on the weekdays and at the
 * times they next happen in the home zone. Only plain weekly rhythms count
 * (weeklyCadence); a one-off, a monthly or yearly rule, "the second
 * Tuesday", anything else or anything unreadable is left out rather than
 * guessed at. The rhythm is the rule's own: skipped or cancelled dates do
 * not hide it, and a moved occurrence (its own row, with no rule) never
 * makes one. A series with no occurrence in the coming week (or fortnight)
 * has ended or not begun, and is left out. An all-day series counts only
 * when each occurrence is a single day, and carries no time. Pure: `today`
 * is a date in the home zone, and every date and time comes from the
 * recurrence engine.
 */
export function regularWeek(
  events: readonly RegularWeekEventInput[],
  personId: string,
  opts: { today: IsoDate; timeZone: string },
): RegularWeekEntry[] {
  const out: RegularWeekEntry[] = [];
  for (const e of events) {
    if (!e.people?.some((p) => p.personId === personId)) continue;
    const cadence = weeklyCadence(e.rrule);
    if (!cadence) continue;
    // One full cycle from today: every weekday the rule uses, once. The
    // rule's own dates, without its exdates, so a skipped week hides nothing.
    const span = cadence === 'weekly' ? 7 : 14;
    const rhythm = { ...e, exdates: null } as RecurringEvent;
    // A timed occurrence is dated in its own zone and may fall on another
    // day at home: expand a day either side, then keep what starts at home
    // within the cycle.
    const from = e.allDay ? opts.today : addDays(opts.today, -1);
    const to = addDays(opts.today, span - 1 + (e.allDay ? 0 : 1));
    const last = addDays(opts.today, span - 1);
    const seen = new Set<number>();
    for (const o of expandEvent(rhythm, from, to)) {
      if (o.allDay) {
        if (addDays(o.startDate, 1) !== o.endDate) continue; // one day only
        const weekday = weekdayOf(o.startDate);
        if (seen.has(weekday)) continue;
        seen.add(weekday);
        out.push({ weekday, allDay: true, cadence, eventId: e.id, title: e.title });
      } else {
        const date = isoDateInZone(o.startsAt, opts.timeZone);
        if (date < opts.today || date > last) continue;
        const weekday = weekdayOf(date);
        if (seen.has(weekday)) continue;
        seen.add(weekday);
        out.push({
          weekday,
          allDay: false,
          time: clockOf(o.startsAt, opts.timeZone),
          cadence,
          eventId: e.id,
          title: e.title,
        });
      }
    }
  }
  return out.sort(compareRegularWeekEntries);
}
