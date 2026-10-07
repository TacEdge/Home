import type { ReadRecurrence } from '@/domain/engines/recurrence';
import type { Event } from '@/domain/events/service';
import {
  addDays,
  clockOf as clock,
  isoDateInZone as dateIn,
  longDate,
  softWhen,
  type IsoDate,
} from '@/lib/dates';

// Words for events: kinds, when, how they repeat, and where a synced one
// comes from (M4 Package 6): the calendar's HOME name and how fresh it is,
// never a provider's words, an address, an id or a status code.

/** "Sam's work calendar", "Family calendar": the name as HOME knows it, said as a calendar. */
export function calendarPhrase(name: string): string {
  return /calendar/i.test(name) ? name : `${name} calendar`;
}

/** "From Sam's work calendar · updated 12 min ago". */
export function sourceLine(
  calendar: { name: string; lastSyncedAt: Date | null; archivedAt: Date | null },
  now: Date,
  timeZone: string,
): string {
  const from = `From ${calendarPhrase(calendar.name)}`;
  if (calendar.archivedAt) return `${from} · not connected at the moment`;
  if (!calendar.lastSyncedAt) return `${from} · not updated yet`;
  return `${from} · updated ${softWhen(calendar.lastSyncedAt, now, timeZone)}`;
}

/** "This comes from Sam's work calendar, so change those details there." */
export function ownedElsewhereLine(name: string): string {
  return `This comes from ${calendarPhrase(name)}, so change those details there.`;
}

/** How a synced event repeats: HOME's own words where the rule is one of its presets, else as in the calendar. */
export const REPEATS_AS_IN_CALENDAR = 'Repeats as in the calendar';

export const KIND_LABEL: Record<string, string> = {
  appointment: 'Appointment',
  activity: 'Activity',
  work: 'Work',
  school: 'School',
  social: 'Social',
  travel: 'Travel',
  birthday: 'Birthday',
  deadline: 'Deadline',
  other: 'Other',
};

export const WEEKDAY_LABEL = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** "Wednesday 14 October · 15:30–16:15", or the date range for all-day events. */
export function whenLabel(e: Event): string {
  if (e.allDay) {
    const last = addDays(e.endDate!, -1);
    return last === e.startDate
      ? longDate(e.startDate!)
      : `${longDate(e.startDate!)} to ${longDate(last)}`;
  }
  const tz = e.timeZone!;
  const startDay = longDate(dateIn(e.startsAt!, tz));
  const endDay = dateIn(e.endsAt!, tz);
  const sameDay = endDay === dateIn(e.startsAt!, tz);
  return sameDay
    ? `${startDay} · ${clock(e.startsAt!, tz)}–${clock(e.endsAt!, tz)}`
    : `${startDay} ${clock(e.startsAt!, tz)} to ${longDate(endDay)} ${clock(e.endsAt!, tz)}`;
}

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'] as const;
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** "Every Wednesday, until 31 December" and the like; null when it does not repeat. */
export function repeatLabel(r: ReadRecurrence, startDate: IsoDate): string | null {
  if (r.preset === 'none') return null;
  if (r.preset === 'custom') return 'Repeats (custom)';
  const d = Number(startDate.slice(8, 10));
  let base: string;
  switch (r.preset) {
    case 'daily':
      base = 'Every day';
      break;
    case 'weekly':
      base = `Every ${list(r.weekdays.map((w) => WEEKDAY_LABEL[w]!))}`;
      break;
    case 'fortnightly':
      base = `Every fortnight on ${list(r.weekdays.map((w) => WEEKDAY_LABEL[w]!))}`;
      break;
    case 'monthly':
      base = `Every month on the ${ordinal(d)}${d > 28 ? ' (skipping shorter months)' : ''}`;
      break;
    case 'yearly':
      base = `Every year on ${longDate(startDate, 'short').replace(/^\d+ /, `${d} `)}`;
      break;
  }
  const end = r.end;
  if (end.type === 'until') return `${base}, until ${longDate(end.date, 'short')}`;
  if (end.type === 'count') return `${base}, ${end.count === 1 ? 'once' : `${end.count} times`}`;
  return base;
}
