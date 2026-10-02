import { describe, expect, it } from 'vitest';
import {
  compareIsoDates,
  daysInMonth,
  formatIsoDate,
  isLeapYear,
  isValidIsoDate,
  isValidTimeZone,
  isoDateInZone,
  parseIsoDate,
} from '@/lib/dates';

describe('calendar dates', () => {
  it('knows leap years, including the century rules', () => {
    expect([2000, 2020, 2024].map(isLeapYear)).toEqual([true, true, true]);
    expect([1900, 2023, 2100].map(isLeapYear)).toEqual([false, false, false]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it.each(['2026-10-14', '2024-02-29', '1900-01-01', '2199-12-31'])('accepts %s', (d) => {
    expect(isValidIsoDate(d)).toBe(true);
  });

  it.each([
    '2023-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '1899-12-31',
    '2200-01-01',
    '2026-1-5',
    '14/10/2026',
    '2026-10-14T00:00:00Z',
    '',
  ])('rejects %s', (d) => {
    expect(isValidIsoDate(d)).toBe(false);
  });

  it('parses and formats round-trip, and refuses to parse an invalid date', () => {
    expect(parseIsoDate('2026-03-07')).toEqual({ year: 2026, month: 3, day: 7 });
    expect(formatIsoDate({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07');
    expect(() => parseIsoDate('2026-02-30')).toThrow(RangeError);
  });

  it('compares as calendar order', () => {
    expect(compareIsoDates('2026-01-31', '2026-02-01')).toBe(-1);
    expect(compareIsoDates('2026-02-01', '2026-02-01')).toBe(0);
    expect(compareIsoDates('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('validates IANA zones', () => {
    expect(isValidTimeZone('Pacific/Auckland')).toBe(true);
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('gives the calendar date of an instant in a zone, across the date line', () => {
    const instant = new Date('2026-10-13T12:30:00Z'); // 01:30 on the 14th in Auckland (NZDT)
    expect(isoDateInZone(instant, 'Pacific/Auckland')).toBe('2026-10-14');
    expect(isoDateInZone(instant, 'America/Los_Angeles')).toBe('2026-10-13');
    expect(isoDateInZone(instant, 'UTC')).toBe('2026-10-13');
  });
});
