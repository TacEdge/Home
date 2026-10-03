import { describe, expect, it } from 'vitest';
import {
  addDay,
  addMonths,
  assessStaleness,
  STALE_AFTER_MONTHS,
  type StalenessCategory,
} from '@/domain/engines/staleness';

// Staleness (contract §6, D16, P-5): derived, never stored; the engine only
// answers. Scenario dates use the fixture family's October 2026.

const fresh = { possiblyStale: false, reason: null, since: null };

describe('addMonths and addDay', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2026-10-14', 3, '2027-01-14'],
    ['2026-11-30', 3, '2027-02-28'],
    ['2026-12-15', 12, '2027-12-15'],
    ['2028-02-29', 12, '2029-02-28'],
    ['2026-08-31', 6, '2027-02-28'],
  ])('%s + %i months = %s', (from, n, to) => {
    expect(addMonths(from, n)).toBe(to);
  });

  it.each([
    ['2026-10-14', '2026-10-15'],
    ['2026-10-31', '2026-11-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-02-28', '2028-02-29'],
    ['2026-02-28', '2026-03-01'],
  ])('the day after %s is %s', (from, to) => {
    expect(addDay(from)).toBe(to);
  });
});

describe('assessStaleness', () => {
  it('uses the approved periods: interest, preference, practical and other 12 months; routine 6; intention 3', () => {
    expect(STALE_AFTER_MONTHS).toEqual({
      interest: 12,
      preference: 12,
      routine: 6,
      intention: 3,
      practical: 12,
      other: 12,
    });
  });

  it.each(Object.entries(STALE_AFTER_MONTHS) as [StalenessCategory, number][])(
    '%s: fresh the day before its period ends, possibly stale on the boundary day (%i months)',
    (category, months) => {
      const lastConfirmedOn = '2026-10-14';
      const due = addMonths(lastConfirmedOn, months);
      const dayBefore = addMonths('2026-10-13', months);
      expect(assessStaleness({ category, lastConfirmedOn, validUntil: null }, dayBefore)).toEqual(
        fresh,
      );
      expect(assessStaleness({ category, lastConfirmedOn, validUntil: null }, due)).toEqual({
        possiblyStale: true,
        reason: 'unconfirmed_for',
        since: due,
      });
    },
  );

  it('clamps month ends: confirmed 31 August, a routine is due on 28 February', () => {
    const c = { category: 'routine' as const, lastConfirmedOn: '2026-08-31', validUntil: null };
    expect(assessStaleness(c, '2027-02-27')).toEqual(fresh);
    expect(assessStaleness(c, '2027-02-28')).toMatchObject({ since: '2027-02-28' });
  });

  it('valid_until today still holds; valid_until yesterday is past', () => {
    const c = { category: 'interest' as const, lastConfirmedOn: '2026-10-01' };
    expect(assessStaleness({ ...c, validUntil: '2026-10-14' }, '2026-10-14')).toEqual(fresh);
    expect(assessStaleness({ ...c, validUntil: '2026-10-13' }, '2026-10-14')).toEqual({
      possiblyStale: true,
      reason: 'past_valid_until',
      since: '2026-10-14',
    });
  });

  it('a past valid_until wins over an unconfirmed period', () => {
    expect(
      assessStaleness(
        { category: 'intention', lastConfirmedOn: '2025-01-01', validUntil: '2025-02-28' },
        '2026-10-14',
      ),
    ).toEqual({ possiblyStale: true, reason: 'past_valid_until', since: '2025-03-01' });
  });

  it('a future valid_until does not keep unconfirmed context fresh', () => {
    expect(
      assessStaleness(
        { category: 'intention', lastConfirmedOn: '2026-06-01', validUntil: '2027-01-01' },
        '2026-10-14',
      ),
    ).toEqual({ possiblyStale: true, reason: 'unconfirmed_for', since: '2026-09-01' });
  });

  it('confirmed today is fresh; the input is never changed', () => {
    const c = Object.freeze({
      category: 'practical' as const,
      lastConfirmedOn: '2026-10-14',
      validUntil: null,
    });
    expect(assessStaleness(c, '2026-10-14')).toEqual(fresh);
  });
});
