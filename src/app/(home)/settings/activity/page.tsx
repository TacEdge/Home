import Link from 'next/link';
import { redirect } from 'next/navigation';
import { env } from '@/lib/env';
import { listAudit } from '@/trust/audit';
import { getActor } from '@/trust/session';
import { Label, Page, Quiet } from '@/ui/page';
import { describeEvent, describeVia } from './labels';

export const dynamic = 'force-dynamic';

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Activity (M3 contract §3.1): everything HOME has done, newest first, in
// plain words, a page at a time. "Earlier" follows the audit cursor, so a
// page is never skipped or repeated; it is a link, so it works without
// JavaScript. Rows show what happened, never what was written; rows about
// sensitive items are never listed (ADR 0005 §43), and a row about a
// private record is listed only to the adult who can see it (P-1).
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  // A cursor is the id of the last row shown; anything else reads as Latest
  // (never a query error, never a stack).
  const before = UUID.test((await searchParams).before ?? '')
    ? (await searchParams).before
    : undefined;
  const { rows: entries, next } = await listAudit(actor, {
    limit: PAGE,
    before: before ? { id: before } : undefined,
  });
  const fmt = new Intl.DateTimeFormat('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: env.HOME_TIMEZONE,
  });

  return (
    <>
      <Page
        title="Activity"
        intro="Everything HOME has done, newest first. This record can’t be edited."
      />

      <Label>{before ? 'Earlier' : 'Recent'}</Label>
      {entries.length === 0 ? (
        <Quiet>{before ? 'Nothing earlier.' : 'Nothing yet.'}</Quiet>
      ) : (
        <ul className="border-line border-b">
          {entries.map((e) => (
            <li
              key={e.id}
              data-id={e.id}
              className="border-line flex items-baseline gap-3 border-t py-2"
            >
              <span className="text-muted w-[120px] shrink-0 font-mono text-[13px] tabular-nums">
                {fmt.format(e.at)}
              </span>
              <span className="min-w-0 flex-1">
                {describeEvent(e.event)}
                {e.summary ? (
                  <span className="text-muted block text-[14px]">{e.summary}</span>
                ) : null}
              </span>
              <span className="text-muted shrink-0 text-[13px]">{describeVia(e.actorVia)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 flex flex-wrap gap-x-6">
        {next ? (
          <Link
            href={`/settings/activity?before=${next.id}`}
            className="text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Earlier ›
          </Link>
        ) : null}
        {before ? (
          <Link
            href="/settings/activity"
            className="text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4"
          >
            ‹ Latest
          </Link>
        ) : null}
      </p>
    </>
  );
}
