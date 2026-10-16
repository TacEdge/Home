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
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(blocking, where).toEqual([]);
}

/**
 * The same check with the shell's sticky capture bar in the page's flow
 * (M8 Package 4). axe's target-size rule reads a control the sticky bar
 * happens to sit over at the current scroll as too small; with Kev on,
 * Today's "Ask Kev about today ›" line moves the page down a row, so which
 * control that is depends on the run. The bar is put back afterwards.
 */
export async function expectAccessibleBarInFlow(page: Page, where: string): Promise<void> {
  const bar = (position: string) =>
    page.evaluate((p) => {
      const el = document.querySelector('#capture-text')?.closest<HTMLElement>('.sticky');
      if (el) el.style.position = p;
    }, position);
  await bar('static');
  try {
    await expectAccessible(page, where);
  } finally {
    await bar('');
  }
}

export async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, where).toBe(false);
}
