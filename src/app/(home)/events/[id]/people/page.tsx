import { notFound, redirect } from 'next/navigation';
import { NotFoundError } from '@/domain/common/errors';
import { getEvent, listEventPeople } from '@/domain/events/service';
import { listPeople } from '@/domain/people/service';
import { requireActor } from '@/trust/session';
import { Page } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';
import { setEventPeopleAction } from '../../actions';
import { PeopleForm } from '../../people-form';

export const dynamic = 'force-dynamic';

// Who's going to, and responsible for, a synced event (M4 contract §5.2):
// HOME's own say about an event whose details belong to its calendar. A
// manual event says this on its edit page, so it is sent there.
export default async function EventPeoplePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const event = await getEvent(actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (event.source === 'manual') redirect(`/events/${event.id}/edit`);
  const [people, annotations] = await Promise.all([
    listPeople(actor),
    listEventPeople(actor, event.id),
  ]);
  if (people.length === 0) redirect(`/events/${event.id}`);
  const ids = (role: string) =>
    new Set(annotations.filter((a) => a.role === role).map((a) => a.personId));
  return (
    <Page
      title={`Who’s going to ${event.title}`}
      intro="The rest of it stays as the calendar has it."
    >
      <PeopleForm
        action={setEventPeopleAction.bind(null, event.id)}
        people={people.map((p) => ({
          id: p.id,
          name: p.name,
          colour: p.colour as PersonColour | null,
        }))}
        attending={ids('attending')}
        responsible={ids('responsible')}
      />
    </Page>
  );
}
