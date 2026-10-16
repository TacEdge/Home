import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// Baseline accessibility checks shared by every screen spec (M3 contract
// §4.5, §8.3): no serious or critical axe violations against WCAG 2.x A/AA,
// and no horizontal page scroll.

export async function expectAccessible(page: Page, where: string): Promise<void> {
  // Next streams a page's <title> after its content; after a client-side
  // navigation (a form's redirect) axe can otherwise run in the moment before
  // it lands and report `document-title`. Wait for the title, then check.
  await expect(page, where).toHaveTitle(/\S/);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} (${n.failureSummary ?? ''})`).join(', ')}`,
    );
  expect(blocking, where).toEqual([]);
}

/**
 * The same check with nothing sticky sitting over a control (M8 Package 4).
 * axe's target-size rule reads a control that the sticky header or the
 * sticky capture bar happens to cover at the current scroll as too small
 * ("partially obscured"); which control that is depends on where the last
 * click left the page, so the result varied between runs. The check runs
 * with the page at the top (the header then sits over nothing) and the
 * bar in the page's flow, then both are put back. Every axe rule still
 * runs. That the bars never hide a focused control is a separate matter:
 * the shell's scroll-padding (globals.css) keeps them clear (WCAG 2.4.11).
 */
export async function expectAccessibleBarInFlow(page: Page, where: string): Promise<void> {
  const scroll = await page.evaluate(() => window.scrollY);
  const bar = (position: string) =>
    page.evaluate((p) => {
      const el = document.querySelector('#capture-text')?.closest<HTMLElement>('.sticky');
      if (el) el.style.position = p;
    }, position);
  await bar('static');
  await page.evaluate(() => window.scrollTo(0, 0));
  try {
    await expectAccessible(page, where);
  } finally {
    await bar('');
    await page.evaluate((y) => window.scrollTo(0, y), scroll);
  }
}

export async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, where).toBe(false);
}
