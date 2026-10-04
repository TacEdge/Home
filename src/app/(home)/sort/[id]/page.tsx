import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/app/_forms/action-form';
import { NotFoundError } from '@/domain/common/errors';
import { getCapture } from '@/domain/captures/service';
import { softWhen } from '@/lib/dates';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { Button } from '@/ui/button';
import { ItemRow, List } from '@/ui/list';
import { Label, Page, Quiet } from '@/ui/page';
import { bringBackAction, setAsideAction } from '../actions';
import { becameOf } from '../became';
import { kindOf, ORGANISE_KINDS, shortWords } from '../copy';
import { SetAsideLine } from '../set-aside-line';

export const dynamic = 'force-dynamic';

// One capture (M3 contract §3.8): the words exactly, when, what they have
// become (links), and the choices: Make it a… (Make another once it is
// something), Not needed with Undo, or, once set aside, Bring it back.
// Only its own author ever reaches it; anyone else reads "Nothing here."
export default async function CapturePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ made?: string; aside?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const { made, aside } = await searchParams;
  const c = await getCapture(actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const became = await becameOf(actor, c);
  const dismissed = c.status === 'dismissed';
  const here = `/sort/${c.id}`;
  const justMade = made ? kindOf(made) : undefined;

  return (
    <Page
      title={became.length > 0 ? 'Made into' : 'Make it a…'}
      intro={<Quiet>{softWhen(c.createdAt, new Date(), env.HOME_TIMEZONE)}</Quiet>}
    >
      <p className="border-line mt-4 border-l-2 pl-4 break-words whitespace-pre-wrap">{c.text}</p>

      {justMade && !dismissed ? (
        <p role="status" className="text-ink-2 mt-6">
          ✓ {justMade.made}
        </p>
      ) : null}

      {became.length > 0 ? (
        <>
          <Label>It became</Label>
          <List>
            {became.map((b) => (
              <ItemRow key={b.key} href={b.href} title={b.title} detail={b.noun} />
            ))}
          </List>
        </>
      ) : null}

      {dismissed ? (
        <>
          {aside === c.id ? (
            <div className="mt-6">
              <SetAsideLine
                action={bringBackAction.bind(null, here)}
                captureId={c.id}
                words={shortWords(c.text)}
              />
            </div>
          ) : (
            <>
              <Label>Set aside</Label>
              <Quiet>Not needed for now. Nothing is deleted.</Quiet>
              <ActionForm action={bringBackAction.bind(null, here)}>
                <input type="hidden" name="id" value={c.id} />
                <Button variant="quiet">Bring it back</Button>
              </ActionForm>
            </>
          )}
        </>
      ) : (
        <>
          <Label>{became.length > 0 ? 'Make another' : 'Make it a…'}</Label>
          <List>
            {ORGANISE_KINDS.map((k) => (
              <ItemRow key={k.as} href={`/sort/${c.id}/${k.as}`} title={k.label} />
            ))}
          </List>
          {became.length === 0 ? (
            <ActionForm action={setAsideAction.bind(null, here)}>
              <input type="hidden" name="id" value={c.id} />
              <div className="mt-4">
                <Button variant="quiet">Not needed</Button>
              </div>
            </ActionForm>
          ) : null}
        </>
      )}

      <p className="mt-8">
        <Link href="/sort" className="text-ink-2 underline underline-offset-4">
          To sort
        </Link>
      </p>
    </Page>
  );
}
