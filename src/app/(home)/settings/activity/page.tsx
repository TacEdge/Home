import { redirect } from 'next/navigation';
import { listAudit } from '@/trust/audit';
import { getActor } from '@/trust/session';
import { Headline, Label, Quiet } from '@/ui/calm';
import { signOutAction } from '../actions';

const describe: Record<string, string> = {
  'auth.link_requested': 'Sign-in link requested',
  'auth.sign_in': 'Signed in',
  'auth.sign_in_denied': 'Sign-in refused (address not in the household)',
  'auth.sign_out': 'Signed out',
};

export default async function ActivityPage() {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  const { rows: entries } = await listAudit(actor, { limit: 50 });
  const fmt = new Intl.DateTimeFormat('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Pacific/Auckland',
  });

  return (
    <>
      <Headline>Activity</Headline>
      <Quiet>Everything HOME has done, newest first. This record can&rsquo;t be edited.</Quiet>

      <Label>Recent</Label>
      {entries.length === 0 ? (
        <Quiet>Nothing yet.</Quiet>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id} className="border-line flex items-baseline gap-3 border-t py-2">
              <span className="text-muted w-[120px] shrink-0 text-[14px] tabular-nums">
                {fmt.format(e.at)}
              </span>
              <span className="flex-1">
                {describe[e.event] ?? e.event}
                {e.summary ? (
                  <span className="text-muted block text-[14px]">{e.summary}</span>
                ) : null}
              </span>
              <span className="text-muted text-[13px]">{e.actorVia}</span>
            </li>
          ))}
        </ul>
      )}

      <Label>Account</Label>
      <form action={signOutAction}>
        <button type="submit" className="text-accent">
          Sign out
        </button>
      </form>
    </>
  );
}
