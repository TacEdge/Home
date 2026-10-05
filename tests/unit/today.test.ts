import { describe, expect, it } from 'vitest';
import { dueLabel, todayHeadline } from '@/app/(home)/today/copy';

// Today's words (M3 contract §3.2): the date as the headline, and how an
// open task's due date reads: factual, never a colour.

describe('todayHeadline', () => {
  it('is the date in words, nothing more', () => {
    expect(todayHeadline('2026-10-14')).toBe('Wednesday 14 October');
  });
});

describe('dueLabel', () => {
  const today = '2026-10-14'; // a Wednesday
  it('says due today, then from when, in words', () => {
    expect(dueLabel('2026-10-14', today)).toBe('Due today');
    expect(dueLabel('2026-10-13', today)).toBe('from yesterday');
    expect(dueLabel('2026-10-12', today)).toBe('from Monday');
    expect(dueLabel('2026-10-08', today)).toBe('from Thursday'); // 6 days: still a weekday
    expect(dueLabel('2026-10-07', today)).toBe('from 7 Oct'); // a week: the date
    expect(dueLabel('2026-09-28', today)).toBe('from 28 Sept');
  });
});
