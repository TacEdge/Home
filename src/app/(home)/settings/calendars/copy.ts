import type { CalendarView } from '@/domain/calendar/service';
import { softWhen } from '@/lib/dates';

// Settings › Calendars in plain words (M4 contract §3.8, §5.1). A calendar's
// state is one calm line, never a code: freshness when it is fine, what to
// do when it is not. Nothing here names a provider, a feed, a UID, a hash,
// a key or an address.

export const VISIBILITY_LABEL: Record<CalendarView['visibility'], string> = {
  household: 'Everyone at home',
  private: 'Just me',
};

export const VISIBILITY_OPTIONS = [
  { value: 'household', label: 'Everyone at home' },
  { value: 'private', label: 'Just me' },
];

export const KIND_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'appointment', label: 'Appointment' },
  { value: 'activity', label: 'Activity' },
  { value: 'work', label: 'Work' },
  { value: 'school', label: 'School' },
  { value: 'social', label: 'Social' },
  { value: 'travel', label: 'Travel' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'other', label: 'Other' },
];

export function kindLabel(kind: string | null): string {
  return KIND_OPTIONS.find((k) => k.value === (kind ?? ''))?.label ?? 'Not set';
}

/** "Updated 12 min ago", "Updated yesterday, 18:05", "Last updated 4 Oct". */
function updated(at: Date, now: Date, timeZone: string): string {
  const when = softWhen(at, now, timeZone);
  const recent =
    when === 'just now' ||
    when.endsWith(' ago') ||
    when.startsWith('today') ||
    when.startsWith('yesterday');
  return recent ? `Updated ${when}` : `Last updated ${when}`;
}

/** What is wrong, then how old what is shown is: "… · Last updated 4 Oct"; alone if nothing was ever read. */
function failed(words: string, lastSyncedAt: Date | null, now: Date, timeZone: string): string {
  return lastSyncedAt ? `${words} · Last updated ${softWhen(lastSyncedAt, now, timeZone)}` : words;
}

/**
 * The one line that says how a calendar is: its freshness, or what is wrong
 * in words with the last good time beside it, so a person knows how old what
 * HOME is showing them is. Never a code, never red, never a countdown.
 */
export function statusLine(
  c: Pick<CalendarView, 'lastSyncStatus' | 'lastSyncedAt' | 'lastAttemptAt' | 'archivedAt'>,
  now: Date,
  timeZone: string,
): string {
  if (c.archivedAt) return 'Disconnected';
  const last = c.lastSyncedAt ? updated(c.lastSyncedAt, now, timeZone) : null;
  switch (c.lastSyncStatus) {
    case 'ok':
      return last ?? 'Updated';
    case 'partial':
      return `${last ?? 'Updated'}, with a few things skipped`;
    case 'unreachable':
      return failed('Couldn’t update just now', c.lastSyncedAt, now, timeZone);
    case 'address_rejected':
      return failed('The Google Calendar address needs attention', c.lastSyncedAt, now, timeZone);
    case 'not_a_calendar':
      return failed('HOME couldn’t read this calendar', c.lastSyncedAt, now, timeZone);
    case 'too_large':
      return failed(
        'This calendar has more history than HOME can read at once',
        c.lastSyncedAt,
        now,
        timeZone,
      );
    default:
      return c.lastAttemptAt ? 'Not updated yet' : 'Connected, not updated yet';
  }
}

/** Whether the calendar needs something from its owner (the one Sun mark). */
export function needsAttention(c: Pick<CalendarView, 'lastSyncStatus' | 'archivedAt'>): boolean {
  return (
    !c.archivedAt &&
    (c.lastSyncStatus === 'address_rejected' ||
      c.lastSyncStatus === 'not_a_calendar' ||
      c.lastSyncStatus === 'too_large')
  );
}

/** A longer word on a failed state, for the calendar's own page. */
export function statusHelp(c: Pick<CalendarView, 'lastSyncStatus' | 'archivedAt'>): string | null {
  if (c.archivedAt) return null;
  switch (c.lastSyncStatus) {
    case 'unreachable':
      return 'HOME will try again the next time someone looks.';
    case 'address_rejected':
      return 'If you reset the secret address in Google Calendar, connect it again with the new one.';
    case 'not_a_calendar':
      return 'Check that the address is the one under “Secret address in iCal format” in Google Calendar’s settings.';
    case 'too_large':
      return 'HOME reads a month back and just over a year ahead. A calendar with a very long history can be too much to bring in at once.';
    case 'partial':
      return 'A few entries in this calendar couldn’t be read. Everything else is here.';
    default:
      return null;
  }
}

export const REFRESH_BUSY_COPY = 'Already updating. Give it a moment.';
export const PASTE_AGAIN_COPY = 'For safety the address isn’t kept. Please paste it again.';
export const CAN_RECONNECT_COPY =
  'You’ve connected this calendar before. Connect it again from its page, and its people and notes come back.';
