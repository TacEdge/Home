// The calendar addresses HOME accepts (M4 contract §4.2, ADR 0007 §3): only
// Google Calendar's secret iCal address, `https://calendar.google.com/
// calendar/ical/<calendar>/private-<token>/basic.ics`, with a `webcal://`
// form rewritten to `https://`. Every other host, scheme or shape is refused
// before any request is made. There is no setting that widens this list.
// Errors carry a structural code only: never the address, which is a bearer
// credential. Pure.

export const GOOGLE_CALENDAR_HOST = 'calendar.google.com';

const MAX_LENGTH = 2048;
const GOOGLE_SECRET_PATH =
  /^\/calendar\/ical\/[A-Za-z0-9._%+-]{1,320}\/private-[A-Za-z0-9]{16,128}\/basic\.ics$/;

export type CalendarAddressRefusal =
  | 'not_an_address'
  | 'unsupported_scheme'
  | 'credentials_in_address'
  | 'unsupported_host'
  | 'unsupported_port'
  | 'unsupported_path'
  | 'unsupported_query'
  | 'unsupported_fragment';

export class CalendarAddressError extends Error {
  constructor(readonly code: CalendarAddressRefusal) {
    super(code);
    this.name = 'CalendarAddressError';
  }
}

/**
 * The one normal form of an accepted address: `https://calendar.google.com`
 * plus the secret path, nothing else. Throws CalendarAddressError otherwise.
 */
export function normaliseCalendarAddress(input: string): string {
  const raw = input.trim();
  // No whitespace or control characters anywhere inside, no oversize input.
  if (!raw || raw.length > MAX_LENGTH || /[\s\u0000-\u001f\u007f\\]/.test(raw))
    throw new CalendarAddressError('not_an_address');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme !== 'https' && scheme !== 'webcal')
    throw new CalendarAddressError('unsupported_scheme');
  if (!/^[a-z]+:\/\/[^/]/i.test(raw)) throw new CalendarAddressError('not_an_address');
  let url: URL;
  try {
    url = new URL(scheme === 'webcal' ? `https${raw.slice('webcal'.length)}` : raw);
  } catch {
    throw new CalendarAddressError('not_an_address');
  }
  if (url.username || url.password || /@/.test(raw.slice(0, raw.indexOf('/', 8) >>> 0)))
    throw new CalendarAddressError('credentials_in_address');
  if (url.hostname !== GOOGLE_CALENDAR_HOST) throw new CalendarAddressError('unsupported_host');
  if (url.port !== '') throw new CalendarAddressError('unsupported_port');
  if (raw.includes('?')) throw new CalendarAddressError('unsupported_query');
  if (raw.includes('#')) throw new CalendarAddressError('unsupported_fragment');
  if (!GOOGLE_SECRET_PATH.test(url.pathname)) throw new CalendarAddressError('unsupported_path');
  return `https://${GOOGLE_CALENDAR_HOST}${url.pathname}`;
}

/**
 * Whether a request may go to this URL at all (each redirect hop is checked
 * with it): https, the approved host, the default port, no credentials.
 */
export function isApprovedCalendarUrl(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.hostname === GOOGLE_CALENDAR_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  );
}
