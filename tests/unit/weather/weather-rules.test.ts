import { describe, expect, it } from 'vitest';
import {
  RATE_LIMITED_WAIT_HOURS,
  REFRESH_INTERVAL_MINUTES,
  RETENTION_HOURS,
  locationMismatch,
  refreshDue,
  type AttemptState,
} from '@/domain/weather/rules';

// When a refresh is due (M7 contract §5.1, §8.1, §8.6 W8, W20, W21).

const NOW = new Date('2026-10-13T18:03:00Z');
const HERE = 'a'.repeat(64);
const THERE = 'b'.repeat(64);
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const row = (o: Partial<AttemptState> & { minutesAgo?: number }): AttemptState => ({
  locationFingerprint: o.locationFingerprint === undefined ? HERE : o.locationFingerprint,
  lastAttemptAt: o.minutesAgo === undefined ? null : ago(o.minutesAgo),
  lastAttemptStatus: o.lastAttemptStatus ?? 'ok',
});

describe('constants', () => {
  it('60 minutes, 3 hours after rate_limited, 24-hour retention', () => {
    expect([REFRESH_INTERVAL_MINUTES, RATE_LIMITED_WAIT_HOURS, RETENTION_HOURS]).toEqual([
      60, 3, 24,
    ]);
  });
});

describe('W8', () => {
  it.each([
    ['last attempt 59 minutes ago', row({ minutesAgo: 59 }), false],
    ['60 minutes ago', row({ minutesAgo: 60 }), true],
    ['a failure 59 minutes ago', row({ minutesAgo: 59, lastAttemptStatus: 'timeout' }), false],
    ['a failure 60 minutes ago', row({ minutesAgo: 60, lastAttemptStatus: 'unreachable' }), true],
    ['rate_limited 2:59 ago', row({ minutesAgo: 179, lastAttemptStatus: 'rate_limited' }), false],
    ['rate_limited 3:00 ago', row({ minutesAgo: 180, lastAttemptStatus: 'rate_limited' }), true],
    ['no row', null, true],
    ['a row with no attempt', row({}), true],
  ])('%s: due %s', (_n, r, due) => {
    expect(refreshDue(r, HERE, NOW)).toBe(due);
  });
});

describe('W20, W21: a location, elevation or key change', () => {
  it('a row carrying another fingerprint is a mismatch; a null one is not', () => {
    expect(locationMismatch(row({ locationFingerprint: THERE }), HERE)).toBe(true);
    expect(locationMismatch(row({ locationFingerprint: null }), HERE)).toBe(false);
    expect(locationMismatch(row({}), HERE)).toBe(false);
    expect(locationMismatch(null, HERE)).toBe(false);
  });
  it('due at once on a mismatch, overriding the 60 minutes', () => {
    expect(refreshDue(row({ locationFingerprint: THERE, minutesAgo: 1 }), HERE, NOW)).toBe(true);
  });
  it('except within 3 hours of rate_limited', () => {
    const limited = { locationFingerprint: THERE, lastAttemptStatus: 'rate_limited' };
    expect(refreshDue(row({ ...limited, minutesAgo: 179 }), HERE, NOW)).toBe(false);
    expect(refreshDue(row({ ...limited, minutesAgo: 180 }), HERE, NOW)).toBe(true);
  });
  it('after the first attempt cleared the fingerprint, the normal 60 minutes govern', () => {
    const cleared = { locationFingerprint: null, lastAttemptStatus: 'unreachable' };
    expect(refreshDue(row({ ...cleared, minutesAgo: 1 }), HERE, NOW)).toBe(false);
    expect(refreshDue(row({ ...cleared, minutesAgo: 60 }), HERE, NOW)).toBe(true);
  });
});
