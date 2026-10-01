// HOME's places (docs/concepts/README.md, ADR 0002). Two are primary in V0.1
// and appear in the top switch; the rest are quiet and can be promoted later
// without redesigning navigation.

export type Place = {
  id: string;
  name: string;
  href: string;
  primary: boolean;
  note?: string; // shown in the quiet list until the place exists
};

export const PLACES: readonly Place[] = [
  { id: 'today', name: 'Today', href: '/today', primary: true },
  { id: 'forward', name: 'Forward', href: '/forward', primary: true },
  { id: 'people', name: 'People', href: '/people', primary: false, note: 'V0.1, via a person' },
  { id: 'home', name: 'Home', href: '/home', primary: false, note: 'V0.1 projects' },
  { id: 'family', name: 'Family', href: '/family', primary: false, note: 'later' },
  { id: 'us', name: 'Us', href: '/us', primary: false, note: 'later' },
  { id: 'admin', name: 'Life admin', href: '/admin', primary: false, note: 'later' },
];

export const primaryPlaces = () => PLACES.filter((p) => p.primary);
export const quietPlaces = () => PLACES.filter((p) => !p.primary);
