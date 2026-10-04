import Link from 'next/link';
import { ActionForm } from '@/app/_forms/action-form';
import { getCapture, listCaptures } from '@/domain/captures/service';
import { softWhen } from '@/lib/dates';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { Button } from '@/ui/button';
import { EmptyState, Page } from '@/ui/page';
import { bringBackAction, setAsideAction } from './actions';
import { shortWords } from './copy';
import { SetAsideLine } from './set-aside-line';

export const dynamic = 'force-dynamic';

// To sort (M3 contract §3.8): what the signed-in adult has told HOME and
// not yet decided about, newest first, in their exact words with a soft
// time. Private to them. Make it a… opens the capture; Not needed sets it
// aside, with Undo. No counts, no ageing colours, no reminders.
export default async function SortPage({
  searchParams,
}: {
  searchParams: Promise<{ aside?: string }>;
}) {
  const actor = await requireActor();
  const { aside } = await searchParams;
  const all = await listCaptures(actor);
  const waiting = all.filter((c) => c.status === 'new' || c.status === 'proposed');
  const setAside = aside ? await getCapture(actor, aside).catch(() => undefined) : undefined;
  const now = new Date();

  return (
    <Page
      title="To sort"
      intro="What you’ve told HOME, waiting to become something. Only you see these."
    >
      {setAside && setAside.status === 'dismissed' ? (
        <SetAsideLine
          action={bringBackAction.bind(null, '/sort')}
          captureId={setAside.id}
          words={shortWords(setAside.text)}
        />
      ) : null}
      {waiting.length === 0 ? (
        <EmptyState title="Nothing to sort.">
          Anything you tell HOME waits here until you decide what it is.
        </EmptyState>
      ) : (
        <ul className="border-line border-b">
          {waiting.map((c) => (
            <li key={c.id} className="border-line border-t py-3">
              <p className="break-words whitespace-pre-wrap">{c.text}</p>
              <p className="text-muted mt-1 text-[14px]">
                {softWhen(c.createdAt, now, env.HOME_TIMEZONE)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-5">
                <Link
                  href={`/sort/${c.id}`}
                  aria-label={`Make it a…: ${shortWords(c.text)}`}
                  className="text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  Make it a…
                </Link>
                <ActionForm action={setAsideAction.bind(null, '/sort')}>
                  <input type="hidden" name="id" value={c.id} />
                  <Button variant="quiet" ariaLabel={`Not needed: ${shortWords(c.text)}`}>
                    Not needed
                  </Button>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
