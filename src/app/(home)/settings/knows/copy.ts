import type { ContextCategory } from '@/domain/context/schema';
import type { Staleness } from '@/domain/engines/staleness';
import { longDate, type IsoDate } from '@/lib/dates';

// Words for What Kev knows (M3 contract §3.9): kinds in plain words, the
// gentle "still true?" line, and the sensitivity choice explained.

export const CATEGORY_LABEL: Record<ContextCategory, string> = {
  interest: 'Something they enjoy',
  preference: 'A preference',
  routine: 'A routine',
  intention: 'Something planned',
  practical: 'Practical',
  other: 'Something else',
};

/** The kinds, as a form offers them. */
export const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABEL) as ContextCategory[]).map((value) => ({
  value,
  label: CATEGORY_LABEL[value],
}));

export const categoryLabel = (c: string) => CATEGORY_LABEL[c as ContextCategory] ?? c;

/**
 * "Still true? Not confirmed since 4 Sep", or null when it looks current.
 * The engine's `since` is the day it became possibly stale; the line names
 * the day it was last confirmed (`lastConfirmedOn`, in the home zone), or
 * the day it was meant to hold until.
 */
export function stalenessLine(s: Staleness, lastConfirmedOn: IsoDate): string | null {
  if (!s.possiblyStale) return null;
  return s.reason === 'past_valid_until'
    ? `Still true? It was meant to hold until ${longDate(s.since, 'short')}.`
    : `Still true? Not confirmed since ${longDate(lastConfirmedOn, 'short')}.`;
}

export const SENSITIVITY_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'sensitive', label: 'Sensitive' },
];
export const SENSITIVITY_HINT =
  'Sensitive keeps it out of everything automatic: Kev never sees it, and it only appears here after you press Show sensitive items.';
