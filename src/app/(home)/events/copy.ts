import type { Occurrence, ReadRecurrence } from '@/domain/engines/recurrence';
import type { PutAwayStatus } from '@/domain/events/occurrences';
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

/**
 * The zone a timed event keeps, when it is not home's (M4 m-6b, M5 Package
 * 1): "New York time", "UTC". Its own page gives its times in that zone,
 * while Today and Forward give them at home, so the page says which.
 */
export function zoneNote(
  e: { allDay: boolean; timeZone: string | null },
  homeZone: string,
): string | null {
  if (e.allDay || !e.timeZone || e.timeZone === homeZone) return null;
  if (e.timeZone === 'UTC' || e.timeZone === 'Etc/UTC') return 'UTC';
  return `${e.timeZone.split('/').pop()!.replaceAll('_', ' ')} time`;
}

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

// One time of a repeating event, changed on its own (M4 contract §5.3,
// ADR 0007 §46): said as one time of the series, never as an override, an
// original or an exdate.

/** "Wednesday 21 October · 15:30–16:15", for an occurrence as the engine places it. */
export function occurrenceWhen(o: Occurrence): string {
  if (o.allDay) {
    const last = addDays(o.endDate, -1);
    return last === o.startDate
      ? longDate(o.startDate)
      : `${longDate(o.startDate)} to ${longDate(last)}`;
  }
  return `${longDate(dateIn(o.startsAt, o.timeZone))} · ${clock(o.startsAt, o.timeZone)}–${clock(o.endsAt, o.timeZone)}`;
}

/** "One time of Swimming, changed from the usual." */
export const changedFromUsual = (seriesTitle: string) =>
  `One time of ${seriesTitle}, changed from the usual.`;

/** "Usually Wednesday 21 October · 15:30–16:15." */
export const usuallyLine = (usual: Occurrence) => `Usually ${occurrenceWhen(usual)}.`;

/** The Back to the series question. */
export const backToSeriesQuestion = (seriesTitle: string, usual: Occurrence | null) =>
  usual
    ? `Put this one-off change away? ${seriesTitle} goes back to the usual: ${occurrenceWhen(usual)}. Nothing is deleted.`
    : `Put this one-off change away? ${seriesTitle} goes back to the usual. Nothing is deleted.`;

/** Under Put away on the series' page: why each one-off change is there. */
export function putAwayDetail(status: PutAwayStatus, seriesTitle: string): string {
  switch (status) {
    case 'no_longer':
      return `No longer part of ${seriesTitle}`;
    case 'skipped':
      return 'A one-off change, put away; that time is skipped';
    default:
      return 'A one-off change, put away';
  }
}

/** On a put-away change's own page: what is true now, never a usual time that is not happening. */
export function putAwayLine(status: PutAwayStatus, seriesTitle: string): string {
  switch (status) {
    case 'no_longer':
      return `No longer part of ${seriesTitle}: it no longer happens at that time, so this one-off change stays put away.`;
    case 'skipped':
      return `This one-off change was put away, and that time of ${seriesTitle} is skipped. Put the time back on ${seriesTitle}’s page first to bring the change back.`;
    case 'replaced':
      return `This one-off change was put away, and that time of ${seriesTitle} has been changed again since.`;
    case 'restorable':
      return `This one-off change was put away. ${seriesTitle} happens as usual that day.`;
  }
}
