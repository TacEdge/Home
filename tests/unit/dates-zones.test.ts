import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  instantFromWallClock,
  offsetAt,
  wallClockOf,
  weekdayOf,
} from '@/lib/dates';

// Day arithmetic and wall clocks (M3 contract §5). NZ 2026: daylight saving
// ends Sunday 5 April (03:00 NZDT → 02:00 NZST) and starts Sunday
// 27 September (02:00 NZST → 03:00 NZDT).

const NZ = 'Pacific/Auckland';
const wall = (s: string) => {
  const [d, t] = s.split(' ');
  const [year, month, day] = d!.split('-').map(Number) as [number, number, number];
  const [hour, minute] = t!.split(':').map(Number) as [number, number];
  return { year, month, day, hour, minute, second: 0 };
};

describe('day arithmetic', () => {
  it('adds days across months, years and 29 February', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('counts days between dates, unaffected by DST', () => {
    expect(daysBetween('2026-09-26', '2026-09-28')).toBe(2);
    expect(daysBetween('2026-04-04', '2026-04-06')).toBe(2);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
    expect(daysBetween('2026-10-14', '2026-10-01')).toBe(-13);
  });
  it('names weekdays Monday = 0 … Sunday = 6', () => {
    expect(weekdayOf('2026-10-12')).toBe(0); // Monday
    expect(weekdayOf('2026-10-14')).toBe(2); // Wednesday
    expect(weekdayOf('2026-10-18')).toBe(6); // Sunday
  });
});

describe('wall clocks in Pacific/Auckland', () => {
  it('knows the offset either side of each transition', () => {
    expect(offsetAt(Date.parse('2026-06-01T00:00:00Z'), NZ)).toBe(12 * 3600_000);
    expect(offsetAt(Date.parse('2026-12-01T00:00:00Z'), NZ)).toBe(13 * 3600_000);
  });

  it('round-trips an ordinary time', () => {
    const t = instantFromWallClock(wall('2026-10-14 15:30'), NZ);
    expect(t.toISOString()).toBe('2026-10-14T02:30:00.000Z');
    expect(wallClockOf(t, NZ)).toEqual(wall('2026-10-14 15:30'));
  });

  it('spring forward: the skipped 02:30 moves forward by the gap, to 03:30 NZDT', () => {
    expect(instantFromWallClock(wall('2026-09-27 01:30'), NZ).toISOString()).toBe(
      '2026-09-26T13:30:00.000Z',
    );
    const skipped = instantFromWallClock(wall('2026-09-27 02:30'), NZ);
    expect(skipped.toISOString()).toBe('2026-09-26T14:30:00.000Z');
    expect(wallClockOf(skipped, NZ)).toEqual(wall('2026-09-27 03:30'));
    expect(instantFromWallClock(wall('2026-09-27 03:30'), NZ).toISOString()).toBe(
      '2026-09-26T14:30:00.000Z',
    );
  });

  it('fall back: the repeated 02:30 takes its first instance (NZDT)', () => {
    const first = instantFromWallClock(wall('2026-04-05 02:30'), NZ);
    expect(first.toISOString()).toBe('2026-04-04T13:30:00.000Z');
    // The second 02:30 (NZST) is an hour later and never chosen.
    expect(wallClockOf(new Date('2026-04-04T14:30:00Z'), NZ)).toEqual(wall('2026-04-05 02:30'));
    expect(instantFromWallClock(wall('2026-04-05 03:30'), NZ).toISOString()).toBe(
      '2026-04-04T15:30:00.000Z',
    );
  });

  it('works in another zone (New York, 2026: spring 8 March, fall 1 November)', () => {
    const ny = 'America/New_York';
    expect(instantFromWallClock(wall('2026-03-08 02:30'), ny).toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    ); // 03:30 EDT
    expect(instantFromWallClock(wall('2026-11-01 01:30'), ny).toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    ); // first 01:30, EDT
    expect(instantFromWallClock(wall('2026-07-01 09:00'), 'UTC').toISOString()).toBe(
      '2026-07-01T09:00:00.000Z',
    );
  });
});
