import type { Insight } from '@/domain/engines/insights';

/**
 * The opening the credit link follows when a page has no forecast words of
 * its own (M7 contract §4.1, W19): the first listed opening whose sentence
 * cites the forecast. Undefined when there is none, so no link is shown.
 */
export function creditOpeningKey(worth: {
  shown: readonly Insight[];
  rest: readonly Insight[];
}): string | undefined {
  return [...worth.shown, ...worth.rest].find((i) => i.opening?.forecast)?.key;
}
