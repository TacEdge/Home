import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/app/_forms/action-form';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import { getCalendar } from '@/domain/calendar/service';
import { NotFoundError } from '@/domain/common/errors';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { Button } from '@/ui/button';
import { Label, Page, Quiet } from '@/ui/page';
import { PersonName } from '@/ui/person-dot';
import { disconnectCalendarAction, refreshCalendarAction } from '../actions';
import { kindLabel, statusHelp, statusLine, VISIBILITY_LABEL } from '../copy';
import { peopleFor } from '../people';
import { RefreshOnUse } from '../refresh-on-use';

export const dynamic = 'force-dynamic';

const JUST: Record<string, string> = {
  connected: 'Connected. Its events arrive with the first update.',
  reconnected: 'Connected again. Its events come back with the next update.',
};

// A calendar's own page (M4 contract §5.1): its state in words, Refresh
// now, its settings, and for its owner Change settings, Disconnect or
// Reconnect. Whoever can see the calendar sees it here; only its owner
// manages it, and only the owner is told anything about its connection.
export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const query = await searchParams;
  const now = new Date();
  const calendar = await getCalendar(actor, id, { includeArchived: true, now }).catch(
    (e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    },
  );
  const people = await peopleFor(actor);
  // Whose it is reads from the service's own answer, never from whether a
  // person record happens to be linked to the owner.
  const ownerName = calendar.isOwner ? null : people.ownerName(calendar);
  const whose = calendar.isOwner ? 'Yours' : ownerName ? `${ownerName}’s` : 'Someone at home';
  const disconnected = calendar.archivedAt !== null;
  const named = calendar.defaultPersonIds
    .map((pid) => people.byId.get(pid))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const just = Object.keys(JUST).find((k) => query[k] === '1');
  // Help about the connection is the owner's to act on; the other adult sees the state only.
  const help = calendar.isOwner ? statusHelp(calendar) : null;
  const here = `/settings/calendars/${calendar.id}`;

  return (
    <Page
      title={calendar.name}
      intro={<Quiet>{[whose, VISIBILITY_LABEL[calendar.visibility]].join(' · ')}</Quiet>}
    >
      {just ? (
        <p role="status" className="text-ink-2 mt-4">
          {JUST[just]}
        </p>
      ) : null}
      {calendar.stale && !disconnected ? <RefreshOnUse /> : null}

      <Label>Status</Label>
      {disconnected ? (
        <>
          <p>Disconnected.</p>
          <Quiet>
            HOME isn’t reading this calendar at the moment. What HOME already knows is kept, and
            comes back if {calendar.isOwner ? 'you connect it again' : 'it’s connected again'}.
          </Quiet>
        </>
      ) : (
        <>
          <p>{statusLine(calendar, now, env.HOME_TIMEZONE)}</p>
          {help ? <Quiet>{help}</Quiet> : null}
          <ActionForm action={refreshCalendarAction} className="mt-3 -ml-1">
            <input type="hidden" name="id" value={calendar.id} />
            <Button variant="quiet">Refresh now</Button>
          </ActionForm>
        </>
      )}

      <Label>Settings</Label>
      <dl className="border-line border-b">
        <Row term="Who can see it">{VISIBILITY_LABEL[calendar.visibility]}</Row>
        <Row term="Usual kind">{kindLabel(calendar.defaultKind)}</Row>
        <Row term="Usually about">
          {named.length === 0 ? (
            <span className="text-ink-2">Nobody in particular</span>
          ) : (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {named.map((p) => (
                <PersonName key={p.id} name={p.name} colour={p.colour} />
              ))}
            </span>
          )}
        </Row>
      </dl>
      {calendar.isOwner ? (
        <p className="mt-3">
          <Link
            href={`${here}/edit`}
            className="text-ink-2 inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
          >
            Change settings
          </Link>
        </p>
      ) : null}

      {calendar.isOwner ? (
        <>
          <Label>This calendar</Label>
          {disconnected ? (
            <p>
              <Link
                href={`${here}/reconnect`}
                className="text-ink-2 inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
              >
                Reconnect
              </Link>
            </p>
          ) : (
            <ConfirmAction
              action={disconnectCalendarAction}
              hidden={{ id: calendar.id }}
              label="Disconnect"
              question="Disconnect this calendar? HOME will stop reading it. What HOME already knows is kept, and you can reconnect it later."
              confirmLabel="Disconnect"
              cancelLabel="Keep it connected"
            />
          )}
        </>
      ) : null}
    </Page>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="border-line flex min-h-11 flex-wrap items-baseline gap-x-4 gap-y-1 border-t py-3">
      <dt className="text-ink-2 w-36 shrink-0 text-[15px]">{term}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
