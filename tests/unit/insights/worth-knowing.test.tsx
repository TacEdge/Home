import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FactLookup } from '@/app/_insights/facts';
import { FOLDED_FULL } from '@/app/_insights/folds';
import { WorthKnowing } from '@/app/_insights/worth-knowing';
import type { Insight } from '@/domain/engines/insights';
import type { Person } from '@/domain/people/service';
import { at, fresh, ID, NZ, PEOPLE, run, timed } from '../today/household';

// Worth knowing's bounded fold (M6 Package 4, ADR 0009 §35; acceptance R-4,
// matrix D-16): Today shows three (Forward two), "+ N more" counts every one
// of the rest exactly, and only the first `FOLDED_FULL` inside the fold carry
// their Why and their Dismiss and Not useful forms. Any beyond are still said,
// as their sentence and mark. Nothing is lost. Synthetic only.

const WED_0703 = at('2026-10-14T07:03:00+13:00');
const N = 20;

// Seven things at once for Sam tomorrow: 21 conflicts, the first 20 of them taken.
const events = Array.from({ length: 7 }, (_, k) =>
  timed(`e-m${k}`, `Thing ${k}`, '2026-10-15T09:00:00+13:00', '2026-10-15T17:00:00+13:00', {
    people: [{ personId: ID.sam, role: 'attending' }],
  }),
);
const r = run({ events, calendars: [fresh(WED_0703)] }, WED_0703);
const all: Insight[] = r.insights.all.slice(0, N);
const lookup: FactLookup = {
  days: r.days,
  people: new Map(PEOPLE.map((p) => [p.id, { ...p, colour: null } as unknown as Person])),
  calendars: new Map(),
  tasks: new Map(),
  projects: new Map(),
  timeZone: NZ,
};

function render(shownCount: number, insights: readonly Insight[], surface: 'today' | 'forward') {
  const html = renderToStaticMarkup(
    <WorthKnowing
      shown={insights.slice(0, shownCount)}
      rest={insights.slice(shownCount)}
      lookup={lookup}
      surface={surface}
      returnTo={surface === 'today' ? '/today' : '/forward'}
    />,
  );
  const count = (re: RegExp) => (html.match(re) ?? []).length;
  return { html, count };
}

describe('WorthKnowing past twelve', () => {
  it('the fixture is twenty distinct insights', () => {
    expect(all).toHaveLength(N);
    expect(new Set(all.map((i) => i.key)).size).toBe(N);
    expect(new Set(all.map((i) => i.text)).size).toBe(N);
  });

  it('Today: three shown, "+ 17 more", fifteen Why blocks, thirty forms, every sentence present', () => {
    const { html, count } = render(3, all, 'today');
    expect(html).toContain('+ 17 more');
    expect(count(/>Why</g)).toBe(3 + FOLDED_FULL);
    expect(count(/<form/g)).toBe((3 + FOLDED_FULL) * 2); // Dismiss and Not useful each
    expect(count(/aria-label="Dismiss: /g)).toBe(3 + FOLDED_FULL);
    expect(count(/aria-label="Not useful: /g)).toBe(3 + FOLDED_FULL);
    expect(count(/<li[^>]*data-insight=/g)).toBe(N);
    for (const i of all) expect(html).toContain(i.text);
    // The first FOLDED_FULL in the fold are the ones in full, in the engine's order.
    for (const i of all.slice(0, 3 + FOLDED_FULL))
      expect(html).toContain(`name="key" value="${i.key}"`);
    for (const i of all.slice(3 + FOLDED_FULL))
      expect(html).not.toContain(`name="key" value="${i.key}"`);
  });

  it('Today with three plus twelve: every one in full, no shortfall', () => {
    const fits = all.slice(0, 3 + FOLDED_FULL);
    const { html, count } = render(3, fits, 'today');
    expect(html).toContain(`+ ${FOLDED_FULL} more`);
    expect(count(/>Why</g)).toBe(fits.length);
    expect(count(/<form/g)).toBe(fits.length * 2);
    for (const i of fits) expect(html).toContain(`name="key" value="${i.key}"`);
  });

  it('Forward: two shown, "+ 18 more", fourteen Why blocks, twenty-eight forms, every sentence present', () => {
    const { html, count } = render(2, all, 'forward');
    expect(html).toContain('+ 18 more');
    expect(count(/>Why</g)).toBe(2 + FOLDED_FULL);
    expect(count(/<form/g)).toBe((2 + FOLDED_FULL) * 2);
    expect(count(/name="surface" value="forward"/g)).toBe((2 + FOLDED_FULL) * 2);
    expect(count(/<li[^>]*data-insight=/g)).toBe(N);
    for (const i of all) expect(html).toContain(i.text);
  });
});
