import { describe, expect, it } from 'vitest';
import {
  CalendarAddressError,
  isApprovedCalendarUrl,
  normaliseCalendarAddress,
} from '@/lib/calendar-address';

// The calendar addresses HOME accepts (M4 contract §4.2, ADR 0007 §3): Google
// Calendar's secret iCal address only. Synthetic addresses only.

const PATH =
  '/calendar/ical/synthetic.family%40example.test/private-0123456789abcdef0123456789abcdef/basic.ics';
const GOOD = `https://calendar.google.com${PATH}`;
const codeOf = (input: string) => {
  try {
    normaliseCalendarAddress(input);
    return 'accepted';
  } catch (e) {
    return e instanceof CalendarAddressError ? e.code : `other: ${String(e)}`;
  }
};

describe('accepted', () => {
  it.each([
    ['the address as Google gives it', GOOD],
    ['webcal://', `webcal://calendar.google.com${PATH}`],
    ['WEBCAL:// in capitals', `WEBCAL://calendar.google.com${PATH}`],
    ['a capitalised host', `https://Calendar.Google.COM${PATH}`],
    ['the default port written out', `https://calendar.google.com:443${PATH}`],
    ['surrounding spaces', `  ${GOOD}\n`],
    [
      'a group calendar id',
      GOOD.replace('synthetic.family%40example.test', 'abc123%40group.calendar.google.com'),
    ],
  ])('%s, normalised to one form', (_name, input) => {
    expect(normaliseCalendarAddress(input)).toBe(
      input.includes('group.calendar') ? input.trim().replace(/^webcal/i, 'https') : GOOD,
    );
  });
});

describe('refused, with a structural code', () => {
  it.each([
    ['http', `http://calendar.google.com${PATH}`, 'unsupported_scheme'],
    ['ftp', `ftp://calendar.google.com${PATH}`, 'unsupported_scheme'],
    ['javascript', 'javascript:alert(1)', 'unsupported_scheme'],
    ['file', 'file:///etc/passwd', 'unsupported_scheme'],
    ['data', 'data:text/calendar,BEGIN', 'unsupported_scheme'],
    ['no scheme', `calendar.google.com${PATH}`, 'unsupported_scheme'],
    ['protocol-relative', `//calendar.google.com${PATH}`, 'unsupported_scheme'],
    ['https: without slashes', `https:calendar.google.com${PATH}`, 'not_an_address'],
    ['user and password', `https://user:pass@calendar.google.com${PATH}`, 'credentials_in_address'],
    ['an empty user', `https://@calendar.google.com${PATH}`, 'credentials_in_address'],
    ['an empty user on webcal', `webcal://@calendar.google.com${PATH}`, 'credentials_in_address'],
    ['a user on webcal', `webcal://u:p@calendar.google.com${PATH}`, 'credentials_in_address'],
    [
      'the host as a webcal user',
      `webcal://calendar.google.com@evil.example${PATH}`,
      'credentials_in_address',
    ],
    [
      'the host as a user',
      `https://calendar.google.com@evil.example${PATH}`,
      'credentials_in_address',
    ],
    [
      'the host as a subdomain',
      `https://calendar.google.com.evil.example${PATH}`,
      'unsupported_host',
    ],
    ['a trailing dot', `https://calendar.google.com.${PATH}`, 'unsupported_host'],
    ['another Google host', `https://www.google.com${PATH}`, 'unsupported_host'],
    ['iCloud', `https://p01-caldav.icloud.com/published/2/abc`, 'unsupported_host'],
    [
      'Outlook',
      `https://outlook.office365.com/owa/calendar/abc/reachcalendar.ics`,
      'unsupported_host',
    ],
    ['localhost', `https://localhost${PATH}`, 'unsupported_host'],
    ['127.0.0.1', `https://127.0.0.1${PATH}`, 'unsupported_host'],
    ['127.1', `https://127.1${PATH}`, 'unsupported_host'],
    ['decimal 2130706433', `https://2130706433${PATH}`, 'unsupported_host'],
    ['hex 0x7f.0.0.1', `https://0x7f.0.0.1${PATH}`, 'unsupported_host'],
    ['octal 0177.0.0.1', `https://0177.0.0.1${PATH}`, 'unsupported_host'],
    ['IPv6 loopback', `https://[::1]${PATH}`, 'unsupported_host'],
    ['IPv4-mapped IPv6', `https://[::ffff:127.0.0.1]${PATH}`, 'unsupported_host'],
    ['metadata address', `https://169.254.169.254${PATH}`, 'unsupported_host'],
    ['private 10/8', `https://10.0.0.1${PATH}`, 'unsupported_host'],
    ['a homoglyph host', `https://calendar.gооgle.com${PATH}`, 'unsupported_host'],
    [
      'the host only in the query',
      `https://evil.example/?host=calendar.google.com`,
      'unsupported_host',
    ],
    ['another port', `https://calendar.google.com:8443${PATH}`, 'unsupported_port'],
    ['a query', `${GOOD}?ctz=Pacific/Auckland`, 'unsupported_query'],
    ['an empty query', `${GOOD}?`, 'unsupported_query'],
    ['a fragment', `${GOOD}#x`, 'unsupported_fragment'],
    ['an empty fragment', `${GOOD}#`, 'unsupported_fragment'],
    [
      'the public address',
      `https://calendar.google.com/calendar/ical/a%40example.test/public/basic.ics`,
      'unsupported_path',
    ],
    ['a short token', GOOD.replace('0123456789abcdef0123456789abcdef', 'abc'), 'unsupported_path'],
    [
      'a path traversal',
      `https://calendar.google.com/calendar/ical/a/private-0123456789abcdef/../../x/basic.ics`,
      'unsupported_path',
    ],
    [
      'an encoded traversal',
      `https://calendar.google.com/calendar/ical/%2e%2e/private-0123456789abcdef/basic.ics`,
      'unsupported_path',
    ],
    ['a backslash', `https:\\\\calendar.google.com${PATH}`, 'not_an_address'],
    [
      'an inner space',
      `https://calendar.google.com/calendar/ical/a b/private-0123456789abcdef/basic.ics`,
      'not_an_address',
    ],
    ['a control character', `https://calendar.google.com${PATH}\u0000`, 'not_an_address'],
    ['empty', '', 'not_an_address'],
    ['oversized', `${GOOD}${'a'.repeat(3000)}`, 'not_an_address'],
  ])('%s', (_name, input, code) => {
    expect(codeOf(input)).toBe(code);
  });

  it('never puts the address in the error', () => {
    try {
      normaliseCalendarAddress(`https://calendar.google.com:8443${PATH}`);
    } catch (e) {
      expect(`${String(e)} ${JSON.stringify(e)} ${(e as Error).stack}`).not.toContain('private-');
    }
  });
});

describe('redirect hops', () => {
  it('may stay on the approved host over https only', () => {
    expect(isApprovedCalendarUrl(new URL(GOOD))).toBe(true);
    expect(isApprovedCalendarUrl(new URL('https://calendar.google.com/elsewhere'))).toBe(true);
    for (const u of [
      `http://calendar.google.com${PATH}`,
      `https://evil.example${PATH}`,
      `https://calendar.google.com:8443${PATH}`,
      `https://u:p@calendar.google.com${PATH}`,
      `https://127.0.0.1${PATH}`,
    ])
      expect(isApprovedCalendarUrl(new URL(u)), u).toBe(false);
  });
});
