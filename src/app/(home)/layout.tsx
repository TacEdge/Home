import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/trust/session';
import { NavSwitch } from '@/ui/nav-switch';
import { primaryPlaces } from '@/ui/places';
import { Wordmark } from '@/ui/wordmark';

// Session-dependent on every request; never prerendered.
export const dynamic = 'force-dynamic';

// The protected shell. The session check happens here, on the server, for
// every place — never in middleware or a client component (contract §5.5).
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  return (
    <div className="flex min-h-full flex-col">
      <header className="bg-paper sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center px-5 pt-4 pb-2">
        <Link href="/today" className="justify-self-start">
          <Wordmark size="sm" />
        </Link>
        <NavSwitch places={primaryPlaces()} />
        <Link
          href="/settings/activity"
          aria-label="Settings"
          className="text-muted hover:text-ink justify-self-end"
        >
          <svg
            viewBox="0 0 36 36"
            aria-hidden="true"
            className="h-6 w-6 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]"
          >
            <rect x="7" y="10" width="22" height="16" rx="4" />
            <path d="M12 17h12M12 21h7" />
          </svg>
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[720px] flex-1 px-5 pt-2 pb-10">{children}</main>
    </div>
  );
}
