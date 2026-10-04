import { notFound, redirect } from 'next/navigation';
import { NotFoundError } from '@/domain/common/errors';
import { getEvent, listEventPeople } from '@/domain/events/service';
import { listPeople } from '@/domain/people/service';
import { requireActor } from '@/trust/session';
import { Page } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';
import { updateEventAction } from '../../actions';
import { EventForm } from '../../event-form';
import { existingEventDefaults } from '../../form-defaults';

export const dynamic = 'force-dynamic';

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const event = await getEvent(actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  // A synced event is read-only here (ADR 0005 §25): its page says so.
  if (event.source !== 'manual') redirect(`/events/${event.id}`);
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
