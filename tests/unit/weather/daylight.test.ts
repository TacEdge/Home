import { describe, expect, it } from 'vitest';
import {
  DAYLIGHT_ROUNDING_MINUTES,
  SUN_ALTITUDE_DEG,
  daylightFor,
  roundInward,
  sunTimes,
} from '@/domain/engines/daylight';
import { clockOf } from '@/lib/dates';

// Daylight (M7 contract §5.3, §8.6 W16; ADR 0011 §18), for the synthetic
// Wellington point (-41.29, 174.78) on the five reference dates.
//
// The reference table: sunrise and sunset under NOAA's convention (the sun's
// centre at -0.833°, no elevation), computed independently of HOME's code
// with PyEphem 4.2.1 (libastro; observer pressure 0, horizon -0:50, sun
// centre) on 2026-10-12. NOAA's own calculator could not be reached from the
// build container; PyEphem's ephemeris is more precise than NOAA's
// equations, so agreement within a minute is the contract's test. The 17
// October and 21 June rows match the contract's own figures (06:29 and
// 19:43; rounded 08:00–16:45).

const ZONE = 'Pacific/Auckland';
const POINT = { lat: -41.29, lon: 174.78 };

const REFERENCE = [
  // date, sunrise (UTC), sunset (UTC), rounded from–to in home time
  ['2026-09-27', '2026-09-26T18:02:34Z', '2026-09-27T06:22:12Z', '07:15', '19:15'], // NZ DST starts
  ['2026-10-17', '2026-10-16T17:29:36Z', '2026-10-17T06:43:49Z', '06:30', '19:30'],
  ['2026-12-21', '2026-12-20T16:43:49Z', '2026-12-21T07:53:36Z', '05:45', '20:45'],
  ['2027-04-04', '2027-04-03T18:38:52Z', '2027-04-04T06:08:37Z', '06:45', '18:00'], // NZ DST ends
  ['2027-06-21', '2027-06-20T19:46:49Z', '2027-06-21T04:58:16Z', '08:00', '16:45'],
] as const;

describe('W16: within one minute of the reference table, rounded inward', () => {
  it.each(REFERENCE)('%s', (date, sunrise, sunset, from, to) => {
    const d = daylightFor(date, POINT)!;
    expect(Math.abs(d.sunrise.getTime() - Date.parse(sunrise))).toBeLessThan(60_000);
    expect(Math.abs(d.sunset.getTime() - Date.parse(sunset))).toBeLessThan(60_000);
    expect(clockOf(d.from, ZONE)).toBe(from);
    expect(clockOf(d.to, ZONE)).toBe(to);
    expect(d.date).toBe(date);
  });

  it('17 October: about 06:29 and 19:43 in home time', () => {
    const d = daylightFor('2026-10-17', POINT)!;
    expect(clockOf(d.sunrise, ZONE)).toBe('06:29');
    expect(clockOf(d.sunset, ZONE)).toBe('19:43');
  });

  it('uses NOAA’s 0.833° and quarter hours', () => {
    expect(SUN_ALTITUDE_DEG).toBe(-0.833);
    expect(DAYLIGHT_ROUNDING_MINUTES).toBe(15);
  });
});

describe('rounding inward to the quarter hour', () => {
  const t = (hhmmss: string) => new Date(`2026-10-17T${hhmmss}Z`);
  it.each([
    ['06:29:00', '06:30:00'],
    ['06:30:00', '06:30:00'],
    ['06:30:01', '06:45:00'],
    ['07:46:00', '08:00:00'],
  ])('sunrise %s → %s (up)', (raw, rounded) => {
    expect(roundInward(t(raw), t('19:00:00')).from).toEqual(t(rounded));
  });
  it.each([
    ['19:43:00', '19:30:00'],
    ['19:45:00', '19:45:00'],
    ['19:44:59', '19:30:00'],
  ])('sunset %s → %s (down)', (raw, rounded) => {
    expect(roundInward(t('06:00:00'), t(raw)).to).toEqual(t(rounded));
  });
});

describe('the location', () => {
  it('Christchurch’s synthetic point gives its own daylight (W20)', () => {
    const chch = daylightFor('2026-10-17', { lat: -43.53, lon: 172.64 })!;
    expect(clockOf(chch.sunrise, ZONE)).toBe('06:35');
    expect(clockOf(chch.sunset, ZONE)).toBe('19:55');
    expect(chch.from).not.toEqual(daylightFor('2026-10-17', POINT)!.from);
  });
  it('no location, no daylight', () => {
    expect(daylightFor('2026-10-17', null)).toBeNull();
  });
  it('polar night or day has none', () => {
    expect(sunTimes('2026-06-21', { lat: -80, lon: 170 })).toBeNull();
    expect(sunTimes('2026-12-21', { lat: -80, lon: 170 })).toBeNull();
  });
  it('is deterministic', () => {
    expect(JSON.stringify(daylightFor('2026-10-17', POINT))).toBe(
      JSON.stringify(daylightFor('2026-10-17', POINT)),
    );
  });
});
