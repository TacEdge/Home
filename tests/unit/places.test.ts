import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { menuPlaces, PLACES, primaryPlaces } from '@/ui/places';

describe('places', () => {
  it('has Today and Forward as the primary places, in that order', () => {
    expect(primaryPlaces().map((p) => p.id)).toEqual(['today', 'forward']);
  });

  it('lists the quiet places in the agreed order (M3 contract §3.1)', () => {
    expect(PLACES.filter((p) => !p.primary).map((p) => p.name)).toEqual([
      'People',
      'Home',
      'To do',
      'To sort',
      'Settings',
    ]);
  });

  it('offers in the menu only places whose page exists, and every built place is offered', () => {
    for (const p of PLACES) {
      const page = `src/app/(home)${p.href}/page.tsx`;
      expect(
        existsSync(page),
        `${p.id}: ready=${p.ready} but page ${existsSync(page) ? 'exists' : 'is missing'}`,
      ).toBe(p.ready);
    }
    expect(menuPlaces().every((p) => p.ready && !p.primary)).toBe(true);
  });

  it('has unique ids and hrefs', () => {
    expect(new Set(PLACES.map((p) => p.id)).size).toBe(PLACES.length);
    expect(new Set(PLACES.map((p) => p.href)).size).toBe(PLACES.length);
  });
});
