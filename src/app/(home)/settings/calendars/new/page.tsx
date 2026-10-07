import { requireActor } from '@/trust/session';
import { Page } from '@/ui/page';
import { connectCalendarAction } from '../actions';
import { CalendarForm } from '../calendar-form';
import { peopleFor } from '../people';

// Add a calendar (M4 contract §5.1): Google's secret address, a name, who
// can see it, its usual kind and whose events these usually are.
export default async function NewCalendarPage() {
  const actor = await requireActor();
  const people = await peopleFor(actor);
  return (
    <Page title="Add a calendar" intro="A Google calendar, read by HOME.">
      <CalendarForm
        action={connectCalendarAction}
        mode="connect"
        people={people.all}
        submitLabel="Connect"
      />
    </Page>
  );
}
