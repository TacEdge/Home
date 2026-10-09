import Link from 'next/link';
import { AgendaDays } from '@/app/_agenda/agenda-list';
import { loadAgenda } from '@/app/_agenda/load';
import { requestNow } from '@/app/_agenda/now';
import { RefreshOnUse } from '@/app/_calendar/refresh-on-use';
import { hasStaleCalendar } from '@/app/_calendar/stale';
import { isoDateInZone } from '@/lib/dates';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { EmptyState, Page } from '@/ui/page';

export const dynamic = 'force-dynamic';

// Forward, plain (M3 contract §3.3, ADR 0006 §4): the next 30 days from
// today in the home zone, grouped by day, empty days left out, in the
// agenda engine's order. No conflicts, no coordination marks, no horizons
// switch, no Week Ahead: those are M6. Synced calendar events (M4 Package
// 6) come through the same loader, in the same rows; a stale calendar is
// refreshed after the page has rendered.
export default async function ForwardPage() {
  const actor = await requireActor();
  // Today as the test time source sees it, like Today (M6 Package 1).
  const today = isoDateInZone(await requestNow(), env.HOME_TIMEZONE);
  const [loaded, stale] = await Promise.all([
    loadAgenda(actor, today, 30, today),
    hasStaleCalendar(actor),
  ]);
  return (
    <Page title="Forward" intro="The next 30 days.">
      {stale ? <RefreshOnUse /> : null}
      {loaded.days.length === 0 ? (
        <EmptyState title="Nothing in the next 30 days.">
          <Link
            href="/events/new"
            className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
          >
            Add an event
          </Link>
        </EmptyState>
      ) : (
        <>
          <AgendaDays
            days={loaded.days}
            today={loaded.today}
            timeZone={env.HOME_TIMEZONE}
            people={loaded.people}
          />
          <p className="mt-8">
            <Link
              href="/events/new"
              className="text-ink-2 inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
            >
              Add an event
            </Link>
          </p>
        </>
      )}
    </Page>
  );
}
