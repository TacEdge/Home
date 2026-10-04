// HOME's places (docs/concepts/README.md, ADR 0002, M3 contract §3.1). Two are
// primary and sit in the top switch; the rest are quiet and live in the ⌂
// menu. A place appears in the menu only once it is `ready` (its screen
// exists), so the menu never offers a page that isn't there. Each M3 package
// that builds a place flips its flag; tests/unit/places.test.ts checks every
// ready place has a page.

export type Place = {
  id: string;
  name: string;
  href: string;
  primary: boolean;
  ready: boolean;
};

export const PLACES: readonly Place[] = [
  { id: 'today', name: 'Today', href: '/today', primary: true, ready: true },
  { id: 'forward', name: 'Forward', href: '/forward', primary: true, ready: true },
  { id: 'people', name: 'People', href: '/people', primary: false, ready: true },
  { id: 'home', name: 'Home', href: '/home', primary: false, ready: false }, // Package 6
  { id: 'tasks', name: 'To do', href: '/tasks', primary: false, ready: false }, // Package 6
  { id: 'sort', name: 'To sort', href: '/sort', primary: false, ready: false }, // Package 7
  { id: 'settings', name: 'Settings', href: '/settings', primary: false, ready: true },
];

export const primaryPlaces = () => PLACES.filter((p) => p.primary);
/** The ⌂ menu: quiet places whose screens exist, in order. */
export const menuPlaces = () => PLACES.filter((p) => !p.primary && p.ready);
