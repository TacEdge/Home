import ical from 'node-ical';
import { CalendarProviderError } from '@/domain/calendar/provider';

// Reading an ICS feed into raw events (M4 contract §3.1). node-ical is the
// parser of record for property and parameter syntax, quoting and TEXT
// unescaping. HOME does not let it interpret time: node-ical resolves zones
// by guessing (a VTIMEZONE's offsets, the server's own zone for floating
// times), folds overrides into their series by date, and throws for a whole
// feed when one event is malformed. So (ADR 0007 §23, §32):
//   - the whole feed is RFC 5545-unfolded first, so a property name split
//     across lines is whole before anything looks at it;
//   - the feed is split into its top-level VEVENTs, and each is parsed on
//     its own, so one unreadable event is skipped and counted and events
//     with the same UID are never merged;
//   - node-ical is given an allowlist only: the few text properties HOME
//     reads (UID, SUMMARY, DESCRIPTION, LOCATION, STATUS, SEQUENCE), and
//     every date-bearing or recurrence property renamed `X-HOME-…`, which
//     it keeps verbatim with its parameters for HOME to read
//     (normalise.ts). Nothing else (attendees, organiser, alarms, nested
//     components, unknown properties) ever reaches a node-ical handler;
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
const OWN_NAMES = new Set<string>(OWN);
/** Text properties node-ical parses for HOME as they are. */
const PASSED = new Set(['UID', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'STATUS', 'SEQUENCE']);
/** Calendar properties read from outside the events. */
const CALENDAR_PASSED = new Set(['X-WR-CALNAME', 'X-WR-TIMEZONE']);

/** RFC 5545 §3.1: a line break followed by one space or tab continues the line before. */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n|\r/)) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length)
      out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/** A content line's property name, upper-cased (the name never contains `;` or `:`). */
const nameOf = (line: string) => (line.match(/^[A-Za-z0-9-]+/)?.[0] ?? '').toUpperCase();
const valueOf = (line: string) =>
  line
    .slice(line.indexOf(':') + 1)
    .trim()
    .toUpperCase();
/** The line with its name upper-cased (and renamed), the rest as written. */
const withName = (line: string, name: string) => name + line.slice(nameOf(line).length);

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

/**
 * One VEVENT's unfolded lines as node-ical sees them: the allowlisted text
 * properties, and HOME's own properties renamed; nested components (alarms)
 * and every other property dropped before parsing.
 */
function isolate(lines: readonly string[]): string[] {
  const out = ['BEGIN:VEVENT'];
  let depth = 0;
  for (const line of lines.slice(1, -1)) {
    const name = nameOf(line);
    if (name === 'BEGIN') depth++;
    else if (name === 'END') depth = Math.max(0, depth - 1);
    else if (depth === 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
      if (OWN_NAMES.has(name)) out.push(withName(line, `X-HOME-${name}`));
      else if (PASSED.has(name)) out.push(withName(line, name));
    }
  }
  out.push('END:VEVENT');
  return out;
}

function parseBlock(lines: string[]): Record<string, unknown> | null {
  try {
    const parsed = ical.sync.parseICS(
      ['BEGIN:VCALENDAR', ...isolate(lines), 'END:VCALENDAR'].join('\r\n'),
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
  const lines = unfold(text.replace(/^\uFEFF/, ''));
  while (lines.length && lines.at(-1)!.trim() === '') lines.pop();
  const firstLine = lines.findIndex((l) => l.trim() !== '');
  if (firstLine === -1) throw new CalendarProviderError('not_a_calendar');
  const isLine = (l: string | undefined, name: string, value: string) =>
    l !== undefined && nameOf(l) === name && valueOf(l) === value;
  if (!isLine(lines[firstLine], 'BEGIN', 'VCALENDAR') || !isLine(lines.at(-1), 'END', 'VCALENDAR'))
    throw new CalendarProviderError('not_a_calendar');

  const header: string[] = [];
  const events: RawEvent[] = [];
  let unreadable = 0;
  // A VEVENT directly inside the VCALENDAR is collected with anything
  // nested in it; any other component is passed over whole.
  let block: string[] | null = null;
  let depth = 0;
  for (let i = firstLine + 1; i < lines.length - 1; i++) {
    const line = lines[i]!;
    const name = nameOf(line);
    if (block) {
      block.push(line);
      if (name === 'BEGIN') depth++;
      else if (name === 'END' && --depth === 0) {
        const parsed = valueOf(line) === 'VEVENT' ? parseBlock(block) : null;
        if (parsed) events.push(toRawEvent(parsed));
        else unreadable++;
        block = null;
      }
      continue;
    }
    if (name === 'BEGIN') {
      if (valueOf(line) === 'VEVENT') {
        block = [line];
        depth = 1;
        continue;
      }
      // Pass over this component and everything nested in it.
      let d = 1;
      while (d > 0 && ++i < lines.length - 1) {
        const n = nameOf(lines[i]!);
        if (n === 'BEGIN') d++;
        else if (n === 'END') d--;
      }
      continue;
    }
    if (CALENDAR_PASSED.has(name)) header.push(withName(line, name));
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
