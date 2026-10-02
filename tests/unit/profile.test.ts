import { describe, expect, it } from 'vitest';
import { ageOn, birthdayInYear, nextBirthday } from '@/domain/engines/profile';
import { FAMILY_PEOPLE, SCENARIO_TODAY } from '../fixtures/family';

// The profile engine is pure: a date of birth and a calendar "today", nothing
// else. 29 February falls on 28 February in common years (P-4, ADR 0005).

describe('ageOn', () => {
  it('matches the fixture family on the scenario date', () => {
    expect(ageOn(FAMILY_PEOPLE.milo.dateOfBirth, SCENARIO_TODAY)).toBe(9);
    expect(ageOn(FAMILY_PEOPLE.isla.dateOfBirth, SCENARIO_TODAY)).toBe(6);
    expect(ageOn(FAMILY_PEOPLE.nanaJo.dateOfBirth, SCENARIO_TODAY)).toBe(67);
  });

  it('turns over on the birthday itself, not the day before', () => {
    expect(ageOn('2017-05-03', '2026-05-02')).toBe(8);
    expect(ageOn('2017-05-03', '2026-05-03')).toBe(9);
    expect(ageOn('2017-05-03', '2026-05-04')).toBe(9);
  });

  it('is 0 on the day of birth and null before it or without a date', () => {
    expect(ageOn('2026-10-14', '2026-10-14')).toBe(0);
    expect(ageOn('2026-10-15', '2026-10-14')).toBeNull();
    expect(ageOn(null, SCENARIO_TODAY)).toBeNull();
  });

  it('handles year ends', () => {
    expect(ageOn('2010-12-31', '2026-12-30')).toBe(15);
    expect(ageOn('2010-12-31', '2026-12-31')).toBe(16);
    expect(ageOn('2010-12-31', '2027-01-01')).toBe(16);
    expect(ageOn('2011-01-01', '2026-12-31')).toBe(15);
  });

  it('treats a 29 February birthday as reached on 28 February in common years (P-4)', () => {
    expect(ageOn('2020-02-29', '2027-02-27')).toBe(6);
    expect(ageOn('2020-02-29', '2027-02-28')).toBe(7);
    expect(ageOn('2020-02-29', '2027-03-01')).toBe(7);
    // In a leap year the real day counts, and the 28th does not.
    expect(ageOn('2020-02-29', '2028-02-28')).toBe(7);
    expect(ageOn('2020-02-29', '2028-02-29')).toBe(8);
  });
});

describe('birthdayInYear', () => {
  it('keeps the day except for 29 February in common years', () => {
    expect(birthdayInYear('1988-06-12', 2026)).toBe('2026-06-12');
    expect(birthdayInYear('2020-02-29', 2028)).toBe('2028-02-29');
    expect(birthdayInYear('2020-02-29', 2027)).toBe('2027-02-28');
    expect(birthdayInYear('2020-02-29', 2100)).toBe('2100-02-28');
  });
});

describe('nextBirthday', () => {
  it("is today's when the birthday is today, with the age reached", () => {
    expect(nextBirthday('2017-05-03', '2026-05-03')).toEqual({ date: '2026-05-03', age: 9 });
  });

  it('is tomorrow the day before', () => {
    expect(nextBirthday('2017-05-03', '2026-05-02')).toEqual({ date: '2026-05-03', age: 9 });
  });

  it('rolls into next year once the birthday has passed', () => {
    expect(nextBirthday('2017-05-03', '2026-05-04')).toEqual({ date: '2027-05-03', age: 10 });
    expect(nextBirthday(FAMILY_PEOPLE.nanaJo.dateOfBirth, SCENARIO_TODAY)).toEqual({
      date: '2026-10-20',
      age: 68,
    });
  });

  it('handles year ends', () => {
    expect(nextBirthday('2010-12-31', '2026-12-31')).toEqual({ date: '2026-12-31', age: 16 });
    expect(nextBirthday('2010-12-31', '2027-01-01')).toEqual({ date: '2027-12-31', age: 17 });
    expect(nextBirthday('2011-01-01', '2026-12-31')).toEqual({ date: '2027-01-01', age: 16 });
  });

  it('observes 29 February on the 28th in common years and the 29th in leap years (P-4)', () => {
    expect(nextBirthday('2020-02-29', '2027-02-27')).toEqual({ date: '2027-02-28', age: 7 });
    expect(nextBirthday('2020-02-29', '2027-02-28')).toEqual({ date: '2027-02-28', age: 7 });
    expect(nextBirthday('2020-02-29', '2027-03-01')).toEqual({ date: '2028-02-29', age: 8 });
    expect(nextBirthday('2020-02-29', '2028-02-28')).toEqual({ date: '2028-02-29', age: 8 });
  });

  it('is null without a date of birth or before it', () => {
    expect(nextBirthday(null, SCENARIO_TODAY)).toBeNull();
    expect(nextBirthday('2026-10-15', '2026-10-14')).toBeNull();
  });
});
