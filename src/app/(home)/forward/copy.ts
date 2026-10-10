import type { ForwardEntry, Horizon } from '@/domain/engines/forward';
import { addDays, parseIsoDate, weekdayOf, type IsoDate } from '@/lib/dates';

// Words for Forward (M6 contract §4.1, §5.3): labels and the short date a row
// carries on Month and Season. Nothing here decides what is on a row or in
// what order; the Forward engine did.

export const HORIZON_LABEL: Record<Horizon, string> = {
  week: 'Week',
  month: 'Month',
  season: 'Season',
};

/** Where each horizon lives; Week is the plain /forward. */
export const HORIZON_HREF: Record<Horizon, string> = {
  week: '/forward',
  month: '/forward?h=month',
  season: '/forward?h=season',
};

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const weekdayShort = (d: IsoDate) => WEEKDAY_SHORT[weekdayOf(d)]!;
const dayMonth = (d: IsoDate) => `${parseIsoDate(d).day} ${MONTH_SHORT[parseIsoDate(d).month - 1]}`;

/** The last day an item covers, from the day it is first shown here. */
function lastDay(entry: ForwardEntry): IsoDate {
  const i = entry.item;
  return i.kind === 'event' && i.days > 1 ? addDays(entry.date, i.days - i.day) : entry.date;
}

/**
 * The time column of a row on Month ("Thu", "Fri–Sat") or Season ("15 Oct",
 * "10–12 Nov"): the day or days an item is on, as recorded.
 */
export function dateColumn(entry: ForwardEntry, horizon: Exclude<Horizon, 'week'>): string {
  const first = entry.date;
  const last = lastDay(entry);
  if (horizon === 'month')
    return first === last ? weekdayShort(first) : `${weekdayShort(first)}–${weekdayShort(last)}`;
  if (first === last) return dayMonth(first);
  const a = parseIsoDate(first);
  const b = parseIsoDate(last);
  return a.month === b.month && a.year === b.year
    ? `${a.day}–${dayMonth(last)}`
    : `${dayMonth(first)}–${dayMonth(last)}`;
}
