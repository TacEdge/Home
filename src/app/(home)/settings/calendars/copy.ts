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

/**
 * The one line that says how a calendar is: its freshness, or what is wrong
 * in words. Failure keeps the last good time in view, so a person knows what
 * HOME is showing them.
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
    case 'unreachable': {
      // What is shown is the last good read; when that was moments ago, the
      // one sentence says enough.
      const stillFresh =
        c.lastSyncedAt !== null && now.getTime() - c.lastSyncedAt.getTime() < 5 * 60_000;
      return last && !stillFresh ? `Couldn’t update just now. ${last}` : 'Couldn’t update just now';
    }
    case 'address_rejected':
      return 'The Google Calendar address needs attention';
    case 'not_a_calendar':
      return 'HOME couldn’t read this calendar';
    case 'too_large':
      return 'This calendar has more history than HOME can read at once';
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
