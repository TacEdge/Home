import { notFound, redirect } from 'next/navigation';
import { NotFoundError } from '@/domain/common/errors';
import { isOccurrenceChange, occurrenceOf } from '@/domain/events/occurrences';
import { getEvent, listEventPeople } from '@/domain/events/service';
import { listPeople } from '@/domain/people/service';
import { requireActor } from '@/trust/session';
import { Page } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';
import { changeOccurrenceAction, updateEventAction } from '../../actions';
import { usuallyLine } from '../../copy';
import { EventForm } from '../../event-form';
import { existingEventDefaults } from '../../form-defaults';

export const dynamic = 'force-dynamic';

// Edit an event: the whole series for a repeating one. A changed time of a
// series (M4 contract §5.3) is edited as that one time again: the same
// occurrence form, bound to its series and the time it changes, so a second
// edit updates the same change rather than making another.
export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const event = await getEvent(actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  // A synced event is read-only here (ADR 0005 §25): its page says so.
  if (event.source !== 'manual') redirect(`/events/${event.id}`);
  if (isOccurrenceChange(event)) {
    const series = event.recurrenceParentId
      ? await getEvent(actor, event.recurrenceParentId, { includeArchived: true }).catch(
          (e: unknown) => {
            if (e instanceof NotFoundError) return null;
            throw e;
          },
        )
      : null;
    // Put away with its series, or without one: its page says so.
    if (!series || series.archivedAt !== null) redirect(`/events/${event.id}`);
    const usual = occurrenceOf(series, event.recurrenceOriginal!);
    return (
      <Page
        title="Change this one again"
        intro={`One time of ${series.title}. ${usual ? usuallyLine(usual) : ''} Just this once; every other time stays as it is.`}
      >
        <EventForm
          action={changeOccurrenceAction.bind(null, series.id, event.recurrenceOriginal!)}
          event={event}
          occurrence
          people={[]}
          defaults={existingEventDefaults(event, [])}
          submitLabel="Save"
        />
      </Page>
    );
  }
  const [people, annotations] = await Promise.all([
    listPeople(actor),
    listEventPeople(actor, event.id),
  ]);
  return (
    <Page
      title={`Edit ${event.title}`}
      intro={event.rrule ? 'Changes apply to every time this happens.' : undefined}
    >
      <EventForm
        action={updateEventAction.bind(null, event.id)}
        event={event}
        people={people.map((p) => ({
          id: p.id,
          name: p.name,
          colour: p.colour as PersonColour | null,
        }))}
        defaults={existingEventDefaults(event, annotations)}
        submitLabel="Save"
      />
    </Page>
  );
}
