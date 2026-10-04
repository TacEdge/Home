import { todayInHomeZone } from '@/app/_agenda/load';
import { listPeople } from '@/domain/people/service';
import { requireActor } from '@/trust/session';
import { Page } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';
import { createEventAction } from '../actions';
import { EventForm } from '../event-form';
import { newEventDefaults } from '../form-defaults';

export const dynamic = 'force-dynamic';

export default async function NewEventPage() {
  const actor = await requireActor();
  const people = await listPeople(actor);
  return (
    <Page title="Add an event" intro="Something that happens at a time.">
      <EventForm
        action={createEventAction}
        people={people.map((p) => ({
          id: p.id,
          name: p.name,
          colour: p.colour as PersonColour | null,
        }))}
        defaults={newEventDefaults(todayInHomeZone())}
        submitLabel="Add it"
      />
    </Page>
  );
}
