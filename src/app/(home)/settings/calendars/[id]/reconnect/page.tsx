import { notFound, redirect } from 'next/navigation';
import { getCalendar } from '@/domain/calendar/service';
import { NotFoundError } from '@/domain/common/errors';
import { requireActor } from '@/trust/session';
import { Page } from '@/ui/page';
import { reconnectCalendarAction } from '../../actions';
import { ReconnectForm } from '../../reconnect-form';

// Reconnect a disconnected calendar (ADR 0007 §40, §42): the owner pastes
// the same secret address; everything else about the calendar is as it was.
export default async function ReconnectCalendarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const calendar = await getCalendar(actor, id, { includeArchived: true }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (!calendar.isOwner) notFound();
  if (!calendar.archivedAt) redirect(`/settings/calendars/${calendar.id}`);
  return (
    <Page
      title={`Reconnect ${calendar.name}`}
      intro="Its settings, and the people and notes you added, are kept."
    >
      <ReconnectForm action={reconnectCalendarAction.bind(null, calendar.id)} />
    </Page>
  );
}
