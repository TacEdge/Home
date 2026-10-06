import { describe, expect, it } from 'vitest';
import { WINDOWS_ZONES, ianaZone, resolveZoneName } from '@/lib/time-zones';

// Zone names as calendars write them (M4 contract §3.5): IANA names, and
// Windows names from a fixed table only. Nothing is guessed.

describe('ianaZone', () => {
  it('accepts IANA names, in their canonical spelling', () => {
    expect(ianaZone('Pacific/Auckland')).toBe('Pacific/Auckland');
    expect(ianaZone(' America/New_York ')).toBe('America/New_York');
    expect(ianaZone('UTC')).toBe('UTC');
    expect(ianaZone('Etc/UTC')).toMatch(/^(Etc\/)?UTC$/);
  });

  it('refuses offsets, unknown names, blanks and odd shapes', () => {
    for (const z of [
      '+12:00',
      '-0500',
      'Mars/Olympus',
      '',
      '  ',
      'Pacific/Auckland\nx',
      '../etc',
      'Pacific//Auckland',
      'x'.repeat(80),
    ])
      expect(ianaZone(z), z).toBeNull();
  });
});

describe('resolveZoneName', () => {
  it('IANA names resolve as themselves', () => {
    expect(resolveZoneName('Pacific/Auckland')).toEqual({ zone: 'Pacific/Auckland', via: 'iana' });
    expect(resolveZoneName('"Europe/London"')).toEqual({ zone: 'Europe/London', via: 'iana' });
  });

  it('known Windows names resolve through the fixed table', () => {
    expect(resolveZoneName('New Zealand Standard Time')).toEqual({
      zone: 'Pacific/Auckland',
      via: 'windows',
    });
    expect(resolveZoneName('Eastern Standard Time')).toEqual({
      zone: 'America/New_York',
      via: 'windows',
    });
    expect(resolveZoneName('AUS Eastern Standard Time')).toEqual({
      zone: 'Australia/Sydney',
      via: 'windows',
    });
  });

  it('every Windows entry maps to a real IANA zone', () => {
    for (const [name, zone] of Object.entries(WINDOWS_ZONES))
      expect(ianaZone(zone), name).not.toBeNull();
  });

  it('anything else is unknown, never guessed: no offsets, abbreviations, near-misses or custom names', () => {
    for (const z of [
      'Mars/Olympus',
      'New Zealand Standard',
      'new zealand standard time',
      'NZDT',
      '(UTC+12:00) Auckland, Wellington',
      'Customized Time Zone',
      'tzone://Microsoft/Custom',
      '/mozilla.org/20050126_1/Pacific/Auckland',
      'GMT+12',
      '__proto__',
      'constructor',
      'toString',
    ])
      expect(resolveZoneName(z), z).toBeNull();
  });
});
