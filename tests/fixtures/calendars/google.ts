// Google-shaped synthetic ICS (M4 contract §8.1): a builder that writes
// feeds the way Google Calendar's secret iCal address serves them (PRODID,
// X-WR-CALNAME and X-WR-TIMEZONE, a VTIMEZONE block, a fresh DTSTAMP on every
// event each time it is served, CRLF line ends, lines folded at 75 octets,
// attendees, an organiser and alarms on events). Every name, place, address
// and identifier is synthetic. Nothing here is a real calendar.

export const SYNTHETIC_ADDRESS =
  'https://calendar.google.com/calendar/ical/synthetic.family%40example.test/private-0123456789abcdef0123456789abcdef/basic.ics';
export const SYNTHETIC_WEBCAL = SYNTHETIC_ADDRESS.replace('https://', 'webcal://');

export type Props = Record<string, string | readonly string[] | undefined>;

/** RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF and a space. */
export function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never cut inside a UTF-8 sequence.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // the leading space counts
  }
  return out.join('\r\n ');
}

/** ICS TEXT escaping (RFC 5545 §3.3.11). */
export const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A VEVENT. Property values are written as given (escape text with escapeText). */
export function vevent(props: Props, extra: readonly string[] = []): string {
  const lines = ['BEGIN:VEVENT'];
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    for (const v of typeof value === 'string' ? [value] : value)
      lines.push(`${key}${v.startsWith(';') ? '' : ':'}${v}`);
  }
  lines.push(...extra, 'END:VEVENT');
  return lines.join('\r\n');
}

/** The extras Google writes on an invited event: attendees, organiser and a reminder. */
export const GOOGLE_EXTRAS = [
  'ORGANIZER;CN=organiser@example.test:mailto:organiser@example.test',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=sam@example.test;X-NUM-GUESTS=0:mailto:sam@example.test',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=guest.parent@example.test;X-NUM-GUESTS=0:mailto:guest.parent@example.test',
  'X-GOOGLE-CONFERENCE:https://meet.example.test/abc-defg-hij',
  'ATTACH;FILENAME=notes.pdf:https://drive.example.test/file/d/synthetic',
  'URL:https://example.test/event',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:This is an event reminder',
  'TRIGGER:-P0DT0H30M0S',
  'END:VALARM',
];

const NZ_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Pacific/Auckland',
  'X-LIC-LOCATION:Pacific/Auckland',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+1200',
  'TZOFFSETTO:+1300',
  'TZNAME:NZDT',
  'DTSTART:19700927T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+1300',
  'TZOFFSETTO:+1200',
  'TZNAME:NZST',
  'DTSTART:19700405T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

export type FeedOptions = {
  name?: string;
  zone?: string | null;
  /** The moment Google served the feed: written as every event's DTSTAMP. */
  servedAt?: string;
};

/** A whole Google-shaped feed around the given VEVENTs. */
export function googleFeed(events: readonly string[], opts: FeedOptions = {}): string {
  const stamp = opts.servedAt ?? '20261014T010000Z';
  const zone = opts.zone === undefined ? 'Pacific/Auckland' : opts.zone;
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${opts.name ?? 'Synthetic family calendar'}`,
    ...(zone === null ? [] : [`X-WR-TIMEZONE:${zone}`]),
    ...(zone === 'Pacific/Auckland' ? NZ_VTIMEZONE : []),
    ...events.map((e) => e.replace('BEGIN:VEVENT', `BEGIN:VEVENT\r\nDTSTAMP:${stamp}`)),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n').split('\r\n').map(fold).join('\r\n') + '\r\n';
}

/** A timed event in Pacific/Auckland, Google's way. */
export function nzEvent(p: {
  uid: string;
  start: string; // local, e.g. 20261014T153000
  end: string;
  summary: string;
  rrule?: string;
  exdate?: string[];
  recurrenceId?: string;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  sequence?: number;
  lastModified?: string;
  description?: string;
  location?: string;
  invited?: boolean;
}): string {
  return vevent(
    {
      DTSTART: `;TZID=Pacific/Auckland:${p.start}`,
      DTEND: `;TZID=Pacific/Auckland:${p.end}`,
      RRULE: p.rrule,
      EXDATE: p.exdate?.map((d) => `;TZID=Pacific/Auckland:${d}`),
      'RECURRENCE-ID': p.recurrenceId ? `;TZID=Pacific/Auckland:${p.recurrenceId}` : undefined,
      UID: p.uid,
      CREATED: '20260901T000000Z',
      'LAST-MODIFIED': p.lastModified ?? '20261001T000000Z',
      SEQUENCE: String(p.sequence ?? 0),
      STATUS: p.status ?? 'CONFIRMED',
      SUMMARY: escapeText(p.summary),
      DESCRIPTION: p.description === undefined ? undefined : escapeText(p.description),
      LOCATION: p.location === undefined ? undefined : escapeText(p.location),
      TRANSP: 'OPAQUE',
    },
    p.invited ? GOOGLE_EXTRAS : [],
  );
}

/** An all-day event, Google's way (DATE values, exclusive end). */
export function allDayEvent(p: {
  uid: string;
  start: string; // 20261020
  end: string; // exclusive
  summary: string;
  rrule?: string;
  exdate?: string[];
  recurrenceId?: string;
  status?: 'CONFIRMED' | 'CANCELLED';
}): string {
  return vevent({
    DTSTART: `;VALUE=DATE:${p.start}`,
    DTEND: `;VALUE=DATE:${p.end}`,
    RRULE: p.rrule,
    EXDATE: p.exdate?.map((d) => `;VALUE=DATE:${d}`),
    'RECURRENCE-ID': p.recurrenceId ? `;VALUE=DATE:${p.recurrenceId}` : undefined,
    UID: p.uid,
    SEQUENCE: '0',
    STATUS: p.status ?? 'CONFIRMED',
    SUMMARY: escapeText(p.summary),
    TRANSP: 'TRANSPARENT',
  });
}
