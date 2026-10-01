import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Wordmark } from '@/ui/wordmark';

// The brand's one rule for the wordmark that code can check (docs/BRAND.md §01):
// it is always named HOME, the mark is decorative, and the orb follows the
// theme token rather than a fixed colour.
describe('Wordmark', () => {
  it('is always accessibly named HOME, as a span or an h1', () => {
    expect(renderToStaticMarkup(createElement(Wordmark))).toContain('aria-label="HOME"');
    const h1 = renderToStaticMarkup(createElement(Wordmark, { as: 'h1', size: 'lg' }));
    expect(h1).toMatch(/^<h1 aria-label="HOME"/);
  });

  it('draws the O as a decorative orb on the theme token, cut by the page colour', () => {
    const html = renderToStaticMarkup(createElement(Wordmark));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('fill="var(--orb)"');
    expect(html).toContain('fill="var(--paper)"');
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
