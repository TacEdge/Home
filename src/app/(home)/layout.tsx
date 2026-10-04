import { redirect } from 'next/navigation';
import { captureAction } from '@/app/_capture/actions';
import { CaptureBar } from '@/app/_capture/capture-bar';
import { getActor } from '@/trust/session';
import { Shell } from '@/ui/shell';

// Session-dependent on every request; never prerendered.
export const dynamic = 'force-dynamic';

// The protected shell. The session check happens here, on the server, for
// every place — never in middleware or a client component (contract §5.5).
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  return <Shell capture={<CaptureBar action={captureAction} />}>{children}</Shell>;
}
