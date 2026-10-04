'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Place } from './places';

// The top switch between primary places. Receives plain data only.
export function NavSwitch({ places }: { places: Place[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Places" className="flex justify-center gap-5">
      {places.map((p) => {
        const on = pathname === p.href || pathname.startsWith(p.href + '/');
        return (
          <Link
            key={p.id}
            href={p.href}
            aria-current={on ? 'page' : undefined}
            className={
              'flex min-h-11 items-center border-b-2 px-0.5 text-[16px] ' +
              (on ? 'border-ink text-ink' : 'border-transparent text-muted')
            }
          >
            {p.name}
          </Link>
        );
      })}
    </nav>
  );
}
