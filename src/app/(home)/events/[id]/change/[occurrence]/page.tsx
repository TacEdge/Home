import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { NotFoundError } from '@/domain/common/errors';
import { isOccurrenceChange, isSkippedOccurrence, occurrenceOf } from '@/domain/events/occurrences';
import { getEvent, listOccurrenceChanges } from '@/domain/events/service';
import { requireActor } from '@/trust/session';
import { Page, Quiet } from '@/ui/page';
import { changeOccurrenceAction } from '../../../actions';
import { occurrenceWhen } from '../../../copy';
import { EventForm } from '../../../event-form';
import { occurrenceDefaults } from '../../../form-defaults';

export const dynamic = 'force-dynamic';

// "Change this one" (M4 contract §5.3, ADR 0007 §46): one time of a
// repeating manual event, on its own. The occurrence comes from the
// address and is proved against the series' rule here before anything is
// shown, then bound into the action by this page; the form never carries
// it, and the service proves it again. A time that already has a change
// goes to that change's own form; a skipped one is put back first.
export default async function ChangeOccurrencePage({
  params,
}: {
  params: Promise<{ id: string; occurrence: string }>;
}) {
  const actor = await requireActor();
  const { id, occurrence: raw } = await params;
  const series = await getEvent(actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  // Only a repeating manual event has times of its own to change.
  if (series.source !== 'manual' || !series.rrule) redirect(`/events/${series.id}`);
  if (isOccurrenceChange(series)) redirect(`/events/${series.id}/edit`);
  let identity: string;
  try {
    identity = decodeURIComponent(raw);
  } catch {
    notFound();
  }
  const occurrence = occurrenceOf(series, identity);
  if (!occurrence) notFound();
  const live = (await listOccurrenceChanges(actor, series.id)).find(
    (c) => c.archivedAt === null && c.recurrenceOriginal === identity,
  );
  if (live) redirect(`/events/${live.id}/edit`);
  const when = occurrenceWhen(occurrence);
  if (isSkippedOccurrence(series, occurrence))
    return (
      <Page title="Change this one" intro={`${series.title} · ${when}`}>
        <Quiet>That time is skipped. Put it back first, then change it.</Quiet>
        <p className="mt-4">
          <Link
            href={`/events/${series.id}`}
            className="text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Back to {series.title} ›
          </Link>
        </p>
      </Page>
    );
  return (
    <Page
      title="Change this one"
      intro={`${series.title} · ${when}. Just this once; every other time stays as it is.`}
    >
      <EventForm
        action={changeOccurrenceAction.bind(null, series.id, identity)}
        event={series}
        occurrence
        people={[]}
        defaults={occurrenceDefaults(occurrence)}
        submitLabel="Change this one"
      />
    </Page>
  );
}
