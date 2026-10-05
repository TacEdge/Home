import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayInHomeZone } from '@/app/_agenda/load';
import { ActionForm } from '@/app/_forms/action-form';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import { NotesSection } from '@/app/_notes/notes-section';
import { NotFoundError } from '@/domain/common/errors';
import { expandEvent, readRRule, startDateOf } from '@/domain/engines/recurrence';
import { recurringOf, startOf, upcomingSkips } from '@/domain/events/occurrences';
import { getEvent, listEventPeople } from '@/domain/events/service';
import { listNotes } from '@/domain/notes/service';
import { listPeople } from '@/domain/people/service';
import { addDays, clockOf as clock, longDate } from '@/lib/dates';
import { requireActor } from '@/trust/session';
import { Button } from '@/ui/button';
import { ItemRow, List } from '@/ui/list';
import { Label, Page, Quiet } from '@/ui/page';
import { PersonName, type PersonColour } from '@/ui/person-dot';
import {
  archiveEventAction,
  putBackOccurrenceAction,
  restoreEventAction,
  skipOccurrenceAction,
} from '../actions';
import { KIND_LABEL, repeatLabel, whenLabel } from '../copy';

export const dynamic = 'force-dynamic';

const UPCOMING_DAYS = 56;
const UPCOMING_MAX = 6;

// An event (M3 contract §3.6): when, how it repeats, who, where; the next
// few times it happens with "Skip this one"; upcoming skipped dates with "Put back";
// Edit, Archive and Restore. A synced event is read-only, and says so.
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const event = await getEvent(actor, id, { includeArchived: true }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [annotations, people, notes] = await Promise.all([
    listEventPeople(actor, event.id, { includeArchived: true }),
    listPeople(actor),
    listNotes(actor, { subject: { type: 'event', id: event.id }, includeArchived: true }),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const names = (role: string) =>
    annotations
      .filter((a) => a.role === role)
      .map((a) => byId.get(a.personId))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const start = startOf(event);
  const recurrence = readRRule(event.rrule, start);
  const repeats = repeatLabel(recurrence, startDateOf(start));
  const archived = event.archivedAt !== null;
  const synced = event.source !== 'manual';
  const editable = !archived && !synced;
  const today = todayInHomeZone();
  const upcoming = event.rrule
    ? expandEvent(recurringOf(event), today, addDays(today, UPCOMING_DAYS - 1)).slice(
        0,
        UPCOMING_MAX,
      )
    : [];
  // Skipped dates still ahead that the rule would put it on: a past skip,
  // or one the rule no longer reaches, is not something to put back.
  const skipped = upcomingSkips(event, today);
  const going = names('attending');
  const responsible = names('responsible');

  return (
    <Page
      title={event.title}
      intro={
        <Quiet>
          {[
            whenLabel(event),
            repeats,
            KIND_LABEL[event.kind] ?? event.kind,
            archived ? 'archived' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Quiet>
      }
    >
      {synced ? (
        <div className="mt-4">
          <Quiet>This comes from a calendar, so change it there. HOME shows it as it is.</Quiet>
        </div>
      ) : null}
      {event.location ? (
        <>
          <Label>Where</Label>
          <p>{event.location}</p>
        </>
      ) : null}
      {event.description ? (
        <>
          <Label>Details</Label>
          <p className="whitespace-pre-wrap">{event.description}</p>
        </>
      ) : null}

      {going.length > 0 || responsible.length > 0 ? (
        <>
          <Label>Who</Label>
          <List>
            {going.map((p) => (
              <ItemRow
                key={`a-${p.id}`}
                href={`/people/${p.id}`}
                title={<PersonName name={p.name} colour={p.colour as PersonColour | null} />}
                detail="Going"
              />
            ))}
            {responsible.map((p) => (
              <ItemRow
                key={`r-${p.id}`}
                href={`/people/${p.id}`}
                title={<PersonName name={p.name} colour={p.colour as PersonColour | null} />}
                detail="Responsible"
              />
            ))}
          </List>
        </>
      ) : null}

      {event.rrule ? (
        <>
          <Label>Next few times</Label>
          {upcoming.length === 0 ? (
            <Quiet>Nothing in the next eight weeks.</Quiet>
          ) : (
            <ul className="border-line border-b">
              {upcoming.map((o) => (
                <li
                  key={o.date}
                  className="border-line flex min-h-11 flex-wrap items-center justify-between gap-3 border-t py-2"
                >
                  <span>
                    {longDate(o.date)}
                    {o.allDay ? null : (
                      <span className="text-muted font-mono text-[14px]">
                        {' '}
                        · {clock(o.startsAt, o.timeZone)}
                      </span>
                    )}
                  </span>
                  {editable ? (
                    <ActionForm action={skipOccurrenceAction}>
                      <input type="hidden" name="id" value={event.id} />
                      <input type="hidden" name="date" value={o.date} />
                      <Button variant="quiet" ariaLabel={`Skip ${longDate(o.date)}`}>
                        Skip this one
                      </Button>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {skipped.length > 0 ? (
            <>
              <Label>Skipped</Label>
              <ul className="border-line border-b">
                {skipped.map((d) => (
                  <li
                    key={d}
                    className="border-line flex min-h-11 flex-wrap items-center justify-between gap-3 border-t py-2"
                  >
                    <span className="text-ink-2">{longDate(d)}</span>
                    {editable ? (
                      <ActionForm action={putBackOccurrenceAction}>
                        <input type="hidden" name="id" value={event.id} />
                        <input type="hidden" name="date" value={d} />
                        <Button variant="quiet" ariaLabel={`Put back ${longDate(d)}`}>
                          Put back
                        </Button>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}

      <NotesSection
        notes={notes}
        subject={{ type: 'event', id: event.id }}
        subjectVisibility={event.visibility}
        returnTo={`/events/${event.id}`}
        readOnly={archived}
      />

      <Label>This event</Label>
      {synced ? (
        <Quiet>Read-only in HOME.</Quiet>
      ) : archived ? (
        <ConfirmAction
          action={restoreEventAction}
          hidden={{ id: event.id }}
          label="Restore"
          question={`Bring ${event.title} back?`}
          confirmLabel="Restore"
          cancelLabel="Leave archived"
        />
      ) : (
        <>
          <p>
            <Link
              href={`/events/${event.id}/edit`}
              className="text-ink-2 inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
            >
              Edit
            </Link>
          </p>
          <ConfirmAction
            action={archiveEventAction}
            hidden={{ id: event.id }}
            label="Archive"
            question={`Put ${event.title} away? Nothing is deleted; you can bring it back from Settings.`}
            confirmLabel="Archive"
          />
        </>
      )}
    </Page>
  );
}
