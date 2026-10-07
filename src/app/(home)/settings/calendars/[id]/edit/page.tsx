import { notFound } from 'next/navigation';
import { getCalendar } from '@/domain/calendar/service';
import { NotFoundError } from '@/domain/common/errors';
import { requireActor } from '@/trust/session';
import { Page, Quiet } from '@/ui/page';
import { updateCalendarAction } from '../../actions';
import { CalendarForm } from '../../calendar-form';
import { peopleFor } from '../../people';

// Change a calendar's settings (M4 contract §5.1). Its owner only: anyone
// else is shown nothing here (the service refuses the save; the page says
// so before they try). A disconnected calendar's settings can be changed
// too, which is how its owner lets a person go (ADR 0007 §42).
export default async function EditCalendarPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const calendar = await getCalendar(actor, id, { includeArchived: true }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (!calendar.isOwner) notFound();
  const people = await peopleFor(actor);
  return (
    <Page
      title={`Change ${calendar.name}`}
      intro={
        calendar.archivedAt ? (
          <Quiet>Disconnected. Its settings can still be changed.</Quiet>
        ) : undefined
      }
    >
      <CalendarForm
        action={updateCalendarAction.bind(null, calendar.id)}
        mode="edit"
        people={people.all}
        // The form's own values only: nothing about the connection, the
        // owner or the last refresh reaches the browser's form state.
        current={{
          name: calendar.name,
          visibility: calendar.visibility,
          defaultKind: calendar.defaultKind,
          defaultPersonIds: calendar.defaultPersonIds,
        }}
        submitLabel="Save"
      />
    </Page>
  );
}
