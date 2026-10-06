import { isValidTimeZone } from './dates';

// Time-zone names as calendars write them (M4 contract §3.5). An IANA name is
// used as itself, in its canonical spelling. A Windows name (Outlook-style
// TZID) is used only when it is in the fixed table below, taken from CLDR's
// windowsZones mapping for the territory "001" (the zone Windows means by
// that name). Anything else is unknown, and the caller decides what an
// unknown zone means; nothing here guesses from offsets, abbreviations,
// VTIMEZONE rules or the server's own zone.

export const WINDOWS_ZONES: Readonly<Record<string, string>> = Object.freeze({
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Chatham Islands Standard Time': 'Pacific/Chatham',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'W. Australia Standard Time': 'Australia/Perth',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'Samoa Standard Time': 'Pacific/Apia',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Atlantic Standard Time': 'America/Halifax',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'India Standard Time': 'Asia/Calcutta',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  UTC: 'UTC',
});

const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/;

/**
 * The canonical IANA name for a zone name, or null when it is not one. Offsets
 * ("+12:00"), empty and over-long names are not zones here even where Intl
 * would take them.
 */
export function ianaZone(name: string): string | null {
  const n = name.trim();
  if (!IANA_SHAPE.test(n) || !isValidTimeZone(n)) return null;
  return new Intl.DateTimeFormat('en-NZ', { timeZone: n }).resolvedOptions().timeZone;
}

export type ResolvedZone = { zone: string; via: 'iana' | 'windows' };

/** A calendar's TZID as a zone: an IANA name, or a Windows name in the table; else null. */
export function resolveZoneName(tzid: string): ResolvedZone | null {
  const name = tzid.trim().replace(/^"(.*)"$/, '$1');
  const windows = Object.hasOwn(WINDOWS_ZONES, name) ? WINDOWS_ZONES[name] : undefined;
  if (windows) return { zone: ianaZone(windows) ?? windows, via: 'windows' };
  const iana = ianaZone(name);
  return iana ? { zone: iana, via: 'iana' } : null;
}
