import {
  compareIsoDates,
  daysInMonth,
  formatIsoDate,
  parseIsoDate,
  type IsoDate,
} from '@/lib/dates';

// The staleness engine (FAMILY-DATA-MODEL §3 Context, D16; M2 contract §6).
// Context can go out of date: it is *possibly stale* once it is past its
// `valid_until`, or once nobody has confirmed it for the period its category
// allows. Staleness is a heuristic, derived on read and never stored. The
// engine only answers the question: it never changes, retires or deletes
// anything. Pure: no database, clock or time zone; `today` and the date of
// the last confirmation are calendar dates the caller computed in the home
// time zone.

export type StalenessCategory =
  'interest' | 'preference' | 'routine' | 'intention' | 'practical' | 'other';

/** Months without confirmation before context is possibly stale (D16; `other` per P-5). */
export const STALE_AFTER_MONTHS: Readonly<Record<StalenessCategory, number>> = Object.freeze({
  interest: 12,
  preference: 12,
  routine: 6,
  intention: 3,
  practical: 12,
  other: 12,
});

export type StalenessInput = {
  category: StalenessCategory;
  /** The calendar day it was last confirmed (or created), in the home time zone. */
  lastConfirmedOn: IsoDate;
  /** The last day it is meant to hold, if time-bound. */
  validUntil: IsoDate | null;
};

export type Staleness =
  | { possiblyStale: false; reason: null; since: null }
  | { possiblyStale: true; reason: 'past_valid_until' | 'unconfirmed_for'; since: IsoDate };

/**
 * Calendar months later; a day the target month lacks clamps to its last day
 * (31 January + 1 month = 28 or 29 February).
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const d = parseIsoDate(date);
  const index = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return formatIsoDate({ year, month, day: Math.min(d.day, daysInMonth(year, month)) });
}

/** The next calendar day. */
export function addDay(date: IsoDate): IsoDate {
  const d = parseIsoDate(date);
  if (d.day < daysInMonth(d.year, d.month)) return formatIsoDate({ ...d, day: d.day + 1 });
  return d.month === 12
    ? formatIsoDate({ year: d.year + 1, month: 1, day: 1 })
    : formatIsoDate({ year: d.year, month: d.month + 1, day: 1 });
}

const FRESH: Staleness = { possiblyStale: false, reason: null, since: null };

/**
 * Is this context possibly out of date on `today`? A `valid_until` before
 * today wins: it is stale from the day after. Otherwise it is stale from the
 * day its category's period has passed since it was last confirmed, that day
 * included.
 */
export function assessStaleness(context: StalenessInput, today: IsoDate): Staleness {
  if (context.validUntil !== null && compareIsoDates(context.validUntil, today) < 0) {
    return { possiblyStale: true, reason: 'past_valid_until', since: addDay(context.validUntil) };
  }
  const due = addMonths(context.lastConfirmedOn, STALE_AFTER_MONTHS[context.category]);
  if (compareIsoDates(today, due) >= 0) {
    return { possiblyStale: true, reason: 'unconfirmed_for', since: due };
  }
  return FRESH;
}
