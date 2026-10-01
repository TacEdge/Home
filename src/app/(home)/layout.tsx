import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/trust/session';
import { NavSwitch } from '@/ui/nav-switch';
import { primaryPlaces } from '@/ui/places';

// Session-dependent on every request; never prerendered.
export const dynamic = 'force-dynamic';

// The protected shell. The session check happens here, on the server, for
// every place — never in middleware or a client component (contract §5.5).
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  return (
    <div className="flex min-h-full flex-col">
      <header className="bg-paper sticky top-0 z-10 flex items-center px-4 pt-3 pb-1">
        <Link
          href="/settings/activity"
          aria-label="Settings"
          className="text-muted w-8 text-[20px]"
        >
          ⌂
        </Link>
        <div className="flex-1">
          <NavSwitch places={primaryPlaces()} />
        </div>
        <span className="w-8" />
      </header>
      <main className="mx-auto w-full max-w-[720px] flex-1 px-5 pt-2 pb-10">{children}</main>
    </div>
  );
}
