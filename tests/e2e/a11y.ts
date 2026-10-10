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

export async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, where).toBe(false);
}
