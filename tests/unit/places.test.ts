import { describe, expect, it } from 'vitest';
import { PLACES, primaryPlaces, quietPlaces } from '@/ui/places';

describe('places', () => {
  it('has Today and Forward as the primary places, in that order', () => {
    expect(primaryPlaces().map((p) => p.id)).toEqual(['today', 'forward']);
  });

  it('keeps the other places quiet but present', () => {
    expect(quietPlaces().map((p) => p.id)).toEqual(['people', 'home', 'family', 'us', 'admin']);
  });

  it('has unique ids and hrefs', () => {
    expect(new Set(PLACES.map((p) => p.id)).size).toBe(PLACES.length);
    expect(new Set(PLACES.map((p) => p.href)).size).toBe(PLACES.length);
  });
});
