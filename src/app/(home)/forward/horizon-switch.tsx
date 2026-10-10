import Link from 'next/link';
import type { Horizon } from '@/domain/engines/forward';
import { HORIZONS } from '@/domain/engines/forward';
import { HORIZON_HREF, HORIZON_LABEL } from './copy';

// Week, Month or Season (M6 contract §4.1): three links, so the choice is a
// URL and works without JavaScript. The page says which is current; this
// reads no path of its own.

export function HorizonSwitch({ current }: { current: Horizon }) {
  return (
    <nav aria-label="Horizon" className="flex gap-5">
      {HORIZONS.map((h) => (
        <Link
          key={h}
          href={HORIZON_HREF[h]}
          aria-current={h === current ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center border-b-2 ${
            h === current ? 'border-ink text-ink' : 'text-muted border-transparent'
          }`}
        >
          {HORIZON_LABEL[h]}
        </Link>
      ))}
    </nav>
  );
}
