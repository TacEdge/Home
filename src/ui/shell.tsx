import Link from 'next/link';
import { NavSwitch } from './nav-switch';
import { PlacesMenu } from './places-menu';
import { menuPlaces, primaryPlaces } from './places';
import { Wordmark } from './wordmark';

// The HOME shell (docs/concepts/README.md, docs/BRAND.md §07, M3 contract
// §3.1): the wordmark, the Today/Forward switch, the ⌂ menu, the page, and a
// slot for the capture bar at the foot of every place. The capture bar
// arrives in M3 Package 7; until then the slot renders nothing, so no input
// ever appears that cannot keep what is typed.

export function Shell({
  children,
  capture,
}: {
  children: React.ReactNode;
  /** The capture bar (Package 7). */
  capture?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#content"
        className="bg-ink text-paper sr-only rounded-home-sm px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-30"
      >
        Skip to content
      </a>
      <header className="bg-paper sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center px-5 pt-3 pb-2">
        <Link href="/today" className="flex min-h-11 items-center justify-self-start">
          <Wordmark size="sm" />
        </Link>
        <NavSwitch places={primaryPlaces()} />
        <PlacesMenu places={menuPlaces()} />
      </header>
      <main id="content" className="mx-auto w-full max-w-[720px] flex-1 px-5 pt-2 pb-10">
        {children}
      </main>
      {capture ? (
        <div className="bg-paper border-line sticky bottom-0 z-10 border-t px-5 py-3">
          <div className="mx-auto w-full max-w-[720px]">{capture}</div>
        </div>
      ) : null}
    </div>
  );
}
