import { listCalendars } from '@/domain/calendar/service';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { ItemRow, List } from '@/ui/list';
import { EmptyState, Page, Quiet } from '@/ui/page';
import { needsAttention, statusLine, VISIBILITY_LABEL } from './copy';
import { peopleFor } from './people';
import { RefreshOnUse } from '@/app/_calendar/refresh-on-use';

export const dynamic = 'force-dynamic';

// Settings › Calendars (M4 contract §5.1): each calendar this adult can see,
// with its name, whose it is, who can see it and how fresh it is, in words.
// The service decides what is listed; nothing is filtered here.
export default async function CalendarsPage() {
  const actor = await requireActor();
  const now = new Date();
  const [calendars, people] = await Promise.all([
    listCalendars(actor, { includeArchived: true, now }),
    peopleFor(actor),
  ]);
  const stale = calendars.some((c) => c.stale && !c.archivedAt);
  return (
    <Page title="Calendars" intro="Google calendars HOME reads, beside what’s entered by hand.">
      {stale ? <RefreshOnUse /> : null}
      {calendars.length === 0 ? (
        <EmptyState title="No calendars yet.">
          Connect a Google calendar and its events appear on Today and Forward with everything else.
        </EmptyState>
      ) : (
        <List label="Calendars">
          {calendars.map((c) => {
            const owner = people.ownerName(c);
            return (
              <ItemRow
                key={c.id}
                href={`/settings/calendars/${c.id}`}
                title={c.name}
                needsYou={c.isOwner && needsAttention(c)}
                detail={[
                  statusLine(c, now, env.HOME_TIMEZONE),
                  owner ? `${owner}’s` : VISIBILITY_LABEL[c.visibility],
                ].join(' · ')}
              />
            );
          })}
        </List>
      )}
      <List>
        <ItemRow href="/settings/calendars/new" title="Add a calendar" />
      </List>
      <div className="mt-6">
        <Quiet>HOME only reads calendars. It never changes anything in Google Calendar.</Quiet>
      </div>
    </Page>
  );
}
