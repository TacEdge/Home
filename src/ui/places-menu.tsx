'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { Place } from './places';

// The ⌂ menu of quiet places (docs/concepts/README.md, M3 contract §3.1).
// A <details> disclosure, so it opens without JavaScript; with JavaScript it
// closes on navigation, on Escape and on a tap outside, and returns focus.

export function PlacesMenu({ places }: { places: Place[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    ref.current?.removeAttribute('open');
  }, [pathname]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = () => {
      if (!el.open) return;
      el.removeAttribute('open');
      el.querySelector('summary')?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointer = (e: PointerEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.removeAttribute('open');
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  return (
    <details ref={ref} className="relative justify-self-end">
      <summary
        aria-label="Menu"
        className="text-ink-2 hover:text-ink flex h-11 w-11 cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden"
      >
        {/* Horizon lines (docs/BRAND.md §05): the places, stacked. */}
        <svg
          viewBox="0 0 36 36"
          aria-hidden="true"
          className="h-6 w-6 fill-none stroke-current [stroke-linecap:round] [stroke-width:1.75]"
        >
          <path d="M8 12h20M8 18h20M8 24h13" />
        </svg>
      </summary>
      <nav
        aria-label="More places"
        className="bg-paper border-line absolute right-0 z-20 mt-1 w-56 rounded-home border px-2 py-2 shadow-[0_8px_24px_rgba(31,59,54,0.12)]"
      >
        <ul>
          {places.map((p) => {
            const on = pathname === p.href || pathname.startsWith(p.href + '/');
            return (
              <li key={p.id}>
                <Link
                  href={p.href}
                  aria-current={on ? 'page' : undefined}
                  className={
                    'flex min-h-11 items-center rounded-home-sm px-3 ' +
                    (on ? 'text-ink font-medium' : 'text-ink-2 hover:bg-paper-2')
                  }
                >
                  {p.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </details>
  );
}
