import ical from 'node-ical';
import { CalendarProviderError } from '@/domain/calendar/provider';

// Reading an ICS feed into raw events (M4 contract §3.1). node-ical is the
// parser of record for the format: line unfolding, property and parameter
// syntax, quoting and TEXT unescaping. HOME does not let it interpret time:
// node-ical resolves zones by guessing (a VTIMEZONE's offsets, the server's
// own zone for floating times), folds overrides into their series by date,
// and throws for a whole feed when one event is malformed. So:
//   - the feed is split into its top-level VEVENTs by line, and each is
//     parsed on its own, so one unreadable event is skipped and counted and
//     events with the same UID are never merged;
//   - every date-bearing property (and RRULE, EXRULE, DURATION) is handed
//     to node-ical renamed `X-HOME-…`, which it keeps verbatim with its
//     parameters, and HOME reads the values itself (normalise.ts);
//   - VTIMEZONE and every other component are not read: zones are known by
//     IANA name or the fixed Windows table only (src/lib/time-zones.ts).
// Nothing here logs, and no error carries feed text.

export type RawProperty = { value: string; params: Readonly<Record<string, string>> };

export type RawEvent = {
  uid: unknown;
  dtstart: RawProperty[];
  dtend: RawProperty[];
  duration: RawProperty[];
  rrule: RawProperty[];
  exrule: RawProperty[];
  exdate: RawProperty[];
  rdate: RawProperty[];
  recurrenceId: RawProperty[];
  lastModified: RawProperty[];
  status: unknown;
  sequence: unknown;
  summary: unknown;
  description: unknown;
  location: unknown;
};

export type RawFeed = {
  calendarName: unknown;
  calendarZone: unknown;
  events: RawEvent[];
  /** Top-level VEVENTs that could not be read as one event. */
  unreadable: number;
};

/** Properties HOME reads itself; node-ical sees them under an `X-HOME-` name. */
const OWN = [
  'DTSTART',
  'DTEND',
  'DURATION',
  'RRULE',
  'EXRULE',
  'EXDATE',
  'RDATE',
  'RECURRENCE-ID',
  'LAST-MODIFIED',
  'DTSTAMP',
  'CREATED',
] as const;
const OWN_LINE = new RegExp(`^(${OWN.join('|')})(?=[;:])`, 'i');

const isContinuation = (line: string) => line.startsWith(' ') || line.startsWith('\t');
const nameOf = (line: string) => line.split(/[;:]/, 1)[0]!.trim().toUpperCase();
const valueOf = (line: string) =>
  line
    .slice(line.indexOf(':') + 1)
    .trim()
    .toUpperCase();

/** The value(s) node-ical stored under a key, as raw properties. */
function properties(stored: unknown): RawProperty[] {
  const list = Array.isArray(stored) ? stored : stored === undefined ? [] : [stored];
  const out: RawProperty[] = [];
  for (const item of list) {
    if (typeof item === 'string' || typeof item === 'number') {
      out.push({ value: String(item), params: {} });
    } else if (item && typeof item === 'object' && 'val' in item) {
      const { val, params } = item as { val: unknown; params?: Record<string, unknown> };
      const p: Record<string, string> = {};
      for (const [k, v] of Object.entries(params ?? {})) p[k.toUpperCase()] = String(v);
      out.push({ value: String(val ?? ''), params: p });
    }
  }
  return out;
}

/** A property's first value as given (text values may carry parameters such as LANGUAGE). */
function firstValue(stored: unknown): unknown {
  const item = Array.isArray(stored) ? stored[0] : stored;
  if (item && typeof item === 'object' && 'val' in item) return (item as { val: unknown }).val;
  return item;
}

function parseBlock(lines: string[]): Record<string, unknown> | null {
  const renamed = lines.map((l) =>
    isContinuation(l) ? l : l.replace(OWN_LINE, (name) => `X-HOME-${name.toUpperCase()}`),
  );
  try {
    const parsed = ical.sync.parseICS(
      ['BEGIN:VCALENDAR', ...renamed, 'END:VCALENDAR'].join('\r\n'),
    );
    const found = Object.values(parsed).filter(
      (c) => c && typeof c === 'object' && (c as { type?: unknown }).type === 'VEVENT',
    );
    return found.length === 1 ? (found[0] as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toRawEvent(c: Record<string, unknown>): RawEvent {
  const own = (name: (typeof OWN)[number]) => properties(c[`HOME-${name}`]);
  return {
    uid: firstValue(c.uid),
    dtstart: own('DTSTART'),
    dtend: own('DTEND'),
    duration: own('DURATION'),
    rrule: own('RRULE'),
    exrule: own('EXRULE'),
    exdate: own('EXDATE'),
    rdate: own('RDATE'),
    recurrenceId: own('RECURRENCE-ID'),
    lastModified: own('LAST-MODIFIED'),
    status: firstValue(c.status),
    sequence: firstValue(c.sequence),
    summary: firstValue(c.summary),
    description: firstValue(c.description),
    location: firstValue(c.location),
  };
}

/**
 * The feed's events, raw. Refuses (`not_a_calendar`) anything that is not a
 * whole VCALENDAR: it must begin with BEGIN:VCALENDAR and end with
 * END:VCALENDAR, so a cut-off body can never be read as a calendar whose
 * missing events were deleted.
 */
export function readFeed(text: string): RawFeed {
  const lines = text.replace(/^﻿/, '').split(/\r?\n|\r/);
  while (lines.length && lines.at(-1)!.trim() === '') lines.pop();
  const firstLine = lines.findIndex((l) => l.trim() !== '');
  if (firstLine === -1) throw new CalendarProviderError('not_a_calendar');
  const isLine = (l: string | undefined, name: string, value: string) =>
    l !== undefined && !isContinuation(l) && nameOf(l) === name && valueOf(l) === value;
  if (!isLine(lines[firstLine], 'BEGIN', 'VCALENDAR') || !isLine(lines.at(-1), 'END', 'VCALENDAR'))
    throw new CalendarProviderError('not_a_calendar');

  const header: string[] = [];
  const events: RawEvent[] = [];
  let unreadable = 0;
  // Depth 0: inside the VCALENDAR itself. A VEVENT at depth 0 is collected
  // (with anything nested in it); any other component is passed over.
  let depth = 0;
  let block: string[] | null = null;
  for (let i = firstLine + 1; i < lines.length - 1; i++) {
    const line = lines[i]!;
    const begin = !isContinuation(line) && nameOf(line) === 'BEGIN';
    const end = !isContinuation(line) && nameOf(line) === 'END';
    if (block) {
      block.push(line);
      if (begin) depth++;
      else if (end && --depth === 0) {
        const parsed = valueOf(line) === 'VEVENT' ? parseBlock(block) : null;
        if (parsed) events.push(toRawEvent(parsed));
        else unreadable++;
        block = null;
      }
      continue;
    }
    if (begin) {
      depth = 1;
      if (valueOf(line) === 'VEVENT') block = [line];
      else block = null;
      if (!block) {
        // Pass over this component and everything nested in it.
        let d = 1;
        while (d > 0 && ++i < lines.length - 1) {
          const l = lines[i]!;
          if (isContinuation(l)) continue;
          if (nameOf(l) === 'BEGIN') d++;
          else if (nameOf(l) === 'END') d--;
        }
        depth = 0;
      }
      continue;
    }
    if (end) continue; // an END with no BEGIN: not the calendar's own property
    header.push(line);
  }
  if (block) unreadable++; // a VEVENT that never ended

  let calendarName: unknown = null;
  let calendarZone: unknown = null;
  try {
    const parsed = ical.sync.parseICS(['BEGIN:VCALENDAR', ...header, 'END:VCALENDAR'].join('\r\n'));
    const cal = Object.values(parsed).find(
      (c) => c && typeof c === 'object' && (c as { type?: unknown }).type === 'VCALENDAR',
    ) as Record<string, unknown> | undefined;
    calendarName = firstValue(cal?.['WR-CALNAME']);
    calendarZone = firstValue(cal?.['WR-TIMEZONE']);
  } catch {
    // The calendar's own name and zone are optional; without them HOME uses its defaults.
  }
  return { calendarName, calendarZone, events, unreadable };
}
