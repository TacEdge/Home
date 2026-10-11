import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConflictMarks, MARKS_SHOWN } from '@/app/_insights/conflict-marks';
import type { FactLookup } from '@/app/_insights/facts';
import { FOLDED_FULL } from '@/app/_insights/folds';
import { conflictMarks } from '@/domain/engines/insights';
import { placement } from '@/domain/engines/today';
import type { Person } from '@/domain/people/service';
import { at, fresh, ID, NZ, PEOPLE, run, timed } from '../today/household';

// A very dense day's marks (M6 Package 4, ADR 0009 §35): every overlap is
// said and counted exactly, two in full on the item, then the fold holds the
// rest with the first `FOLDED_FULL` in full (Why, Dismiss, Not useful) and
// any beyond as the sentence and mark alone, with a line saying so. Nothing
// is lost and no key is dropped. Synthetic only.

const WED_0703 = at('2026-10-14T07:03:00+13:00');
const N = 20; // 20 things at once for Sam: 190 conflicts, 19 marks on each entry

describe('ConflictMarks on a dense day', () => {
  const events = Array.from({ length: N }, (_, k) =>
    timed(
      `e-m${String(k).padStart(2, '0')}`,
      `Thing ${k}`,
      '2026-10-14T09:00:00+13:00',
      '2026-10-14T17:00:00+13:00',
      { people: [{ personId: ID.sam, role: 'attending' }] },
    ),
  );
  const r = run({ events, calendars: [fresh(WED_0703)] }, WED_0703);
  const marks = conflictMarks(r.insights, new Set(), r.placed, NZ);
  const mine = marks.get(placement(ID.sam, 'e-m00:2026-10-14'))!;
  const lookup: FactLookup = {
    days: r.days,
    people: new Map(PEOPLE.map((p) => [p.id, { ...p, colour: null } as unknown as Person])),
    calendars: new Map(),
    tasks: new Map(),
    projects: new Map(),
    timeZone: NZ,
  };
  const html = renderToStaticMarkup(<ConflictMarks marks={mine} lookup={lookup} />);
  const count = (re: RegExp) => (html.match(re) ?? []).length;

  it('every conflict is found, and every one on the entry is a mark with its own key', () => {
    expect(r.conflicts).toHaveLength((N * (N - 1)) / 2);
    expect(mine).toHaveLength(N - 1);
    expect(new Set(mine.map((m) => m.insight.key)).size).toBe(N - 1);
    expect(count(/<li data-conflict=/g)).toBe(N - 1);
  });

  it('two in full, an exact "+ N more overlaps", then the fold’s first few in full and the rest as sentences', () => {
    const inFold = N - 1 - MARKS_SHOWN;
    expect(html).toContain(`+ ${inFold} more overlaps`);
    const full = MARKS_SHOWN + Math.min(FOLDED_FULL, inFold);
    expect(count(/>Why</g)).toBe(full);
    expect(count(/<form/g)).toBe(full * 2); // Dismiss and Not useful each
    expect(count(/aria-label="Dismiss: /g)).toBe(full);
    expect(inFold).toBeGreaterThan(FOLDED_FULL); // the case this test is for
    expect(html).toContain('Respond to the ones above and the rest come forward.');
    // The sentence-only ones still say what they overlap.
    for (const m of mine) expect(html).toContain(m.text);
  });

  it('says nothing about the rest when the fold fits in full', () => {
    const few = renderToStaticMarkup(
      <ConflictMarks marks={mine.slice(0, MARKS_SHOWN + FOLDED_FULL)} lookup={lookup} />,
    );
    expect(few).not.toContain('the rest come forward');
    expect((few.match(/<form/g) ?? []).length).toBe((MARKS_SHOWN + FOLDED_FULL) * 2);
  });
});
