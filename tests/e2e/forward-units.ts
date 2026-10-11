import type { Locator, Page } from '@playwright/test';

// Forward groups what is coming by unit (a day on Week, a week on Month, a
// month on Season), each `li[data-unit="YYYY-MM-DD"]` carrying the date it
// starts. Specs that look for one record on a given date use these.

/** Opens every fold on the page (no-op for ones already open). */
export const openFolds = (page: Page) =>
  page.evaluate(() =>
    document.querySelectorAll('main details').forEach((d) => d.setAttribute('open', '')),
  );

/**
 * The unit a date falls in on the current Forward horizon: the last unit that
 * starts on or before it, with its folds opened so every row can be asserted.
 */
export async function unitFor(page: Page, iso: string): Promise<Locator> {
  const from = await page.locator('li[data-unit]').evaluateAll(
    (els, d) =>
      els
        .map((e) => e.getAttribute('data-unit')!)
        .filter((u) => u <= d)
        .pop(),
    iso,
  );
  const unit = page.locator(`li[data-unit="${from}"]`);
  await unit.evaluate((el) =>
    el.querySelectorAll('details').forEach((d) => d.setAttribute('open', '')),
  );
  return unit;
}

/** The short weekday Month shows in a row's time column ("Sun"). */
export const weekdayShort = (iso: string) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
