import Link from 'next/link';
import { ActionForm } from '@/app/_forms/action-form';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import { listPeople } from '@/domain/people/service';
import { realDataGateOpen } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { Button } from '@/ui/button';
import { Label, Page, Quiet } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';
import { PersonName } from '@/ui/person-dot';
import { addMeAction, linkSelfAction, unlinkSelfAction } from './actions';
import { AddMeForm } from './add-me-form';

// Which person is you (M3 contract §3.4, ADR 0005 §19, §22). Lists the
// unlinked household parents with "This is me"; "Add me" makes one; "Not
// me" unlinks after a confirmation. Nobody can link or unlink anyone else:
// the services only ever act on the signed-in user's own link. While the
// Production real-data gate is closed every link is refused, so the page
// says so instead of offering actions that can only fail (ADR 0006 §31).
export default async function YouPage() {
  const actor = await requireActor();
  const people = await listPeople(actor);
  const me = people.find((p) => p.userId === actor.userId);
  const open = realDataGateOpen();

  if (me) {
    return (
      <Page title="You">
        <Label>In HOME, you are</Label>
        <p className="text-[20px]">
          <Link href={`/people/${me.id}`} className="underline underline-offset-4">
            <PersonName name={me.name} colour={me.colour as PersonColour | null} />
          </Link>
        </p>
        <Quiet>
          Your own record stays a parent everyone at home can see, and can&rsquo;t be archived while
          it&rsquo;s yours.
        </Quiet>
        {open ? (
          <ConfirmAction
            action={unlinkSelfAction}
            label="Not me"
            question={`Stop being ${me.name} in HOME? The record stays; it just won't be yours.`}
            confirmLabel="That's not me"
          />
        ) : null}
      </Page>
    );
  }

  if (!open) {
    return (
      <Page title="Which one is you?">
        <div className="mt-4">
          <Quiet>
            HOME isn&rsquo;t open for family data yet, so you can&rsquo;t say which person you are
            just now. Once it opens, you&rsquo;ll choose yourself here.
          </Quiet>
        </div>
      </Page>
    );
  }

  const eligible = people.filter(
    (p) => p.userId === null && p.role === 'parent' && p.visibility === 'household',
  );
  return (
    <Page title="Which one is you?" intro="HOME can show your own day once it knows who you are.">
      {eligible.length > 0 ? (
        <>
          <Label>Parents at home</Label>
          <ul className="border-line border-b">
            {eligible.map((p) => (
              <li key={p.id} className="border-line border-t">
                <ActionForm
                  action={linkSelfAction}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-2"
                >
                  <input type="hidden" name="id" value={p.id} />
                  <PersonName name={p.name} colour={p.colour as PersonColour | null} />
                  <Button variant="quiet" ariaLabel={`This is me: ${p.name}`}>
                    This is me
                  </Button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Label>{eligible.length > 0 ? 'Or' : 'Add yourself'}</Label>
      <AddMeForm action={addMeAction} />
    </Page>
  );
}
