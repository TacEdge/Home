import Link from 'next/link';
import { requestNow } from '@/app/_agenda/now';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import { kevSwitchedOn } from '@/app/_kev/status';
import { listCalendars } from '@/domain/calendar/service';
import { listKeptMessageIds } from '@/domain/captures/service';
import { listCitedRecords } from '@/domain/citations/service';
import { listConversations, listMessages } from '@/domain/conversations/service';
import { getSpendStatus, getTurnInFlight } from '@/domain/kev-bookkeeping/service';
import {
  addDays,
  instantFromWallClock,
  isoDateInZone,
  parseIsoDate,
  wallClockOf,
} from '@/lib/dates';
import { env } from '@/lib/env';
import { ERROR_TEXT, KEV_TURN_ERROR_CODES, type KevTurnErrorCode } from '@/kev/answer/language';
import { requireActor } from '@/trust/session';
import { Headline } from '@/ui/page';
import { clearConversationAction } from './actions';
import { Composer } from './composer';
import { Conversation } from './conversation';
import {
  CLEAR_CONFIRM,
  CLEAR_LABEL,
  CLEAR_QUESTION,
  CLEARED,
  DISCLOSURE,
  DISCLOSURE_LINK,
  EARLIER,
  INTRO,
  KEV_TITLE,
  PRIVACY_LINE,
  SIMPLER_TODAY,
  suggestions,
} from './copy';
import { byDay, toTurns } from './turns';

export const dynamic = 'force-dynamic';

// Kev's screen (M8 contract §11; D16, D17; ADR 0012 §32, §33): a full page
// with its own URL, phone first, rendered on the server from the database
// as the signed-in adult, with and without JavaScript. Only the adult's own
// conversation is ever read (owner-only in every query); the records its
// answers cite are read again as the adult, now, before any is linked.
// Never a model call: opening this page asks Kev nothing (D14).
//
// The page holds: the privacy line, always; the first-open introduction and
// disclosure; the conversation, a week at a time, by day; the quiet
// once-a-day line when the month's recorded usage is past 80%; static
// suggestions on a day with no turns; the composer (./composer.tsx); and
// Clear at the foot, with a confirmation.

const WEEK_LIMIT = 13; // 90 days of messages, a week at a time

export default async function KevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActor();
  if (!kevSwitchedOn())
    return (
      <>
        <Headline>{KEV_TITLE}</Headline>
        <p className="text-ink-2 mt-3" data-testid="kev-off">
          {ERROR_TEXT.off}
        </p>
      </>
    );

  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : undefined);
  const weeks = Math.min(WEEK_LIMIT, Math.max(1, Number.parseInt(one('weeks') ?? '1', 10) || 1));
  const zone = env.HOME_TIMEZONE;
  const now = await requestNow();
  const today = isoDateInZone(now, zone);
  const since = instantFromWallClock(
    { ...parseIsoDate(addDays(today, -(7 * weeks - 1))), hour: 0, minute: 0, second: 0 },
    zone,
  );

  const conversations = await listConversations(actor, { includeArchived: true });
  const active = conversations
    .filter((c) => c.archivedAt === null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))[0];
  const [rows, inFlight, spend] = await Promise.all([
    active ? listMessages(actor, active.id, { since }) : Promise.resolve([]),
    getTurnInFlight(actor),
    getSpendStatus(actor),
  ]);
  // The first open: nothing in the adult's conversation at all (never asked,
  // cleared, or all expired), not just a quiet week.
  const firstOpen =
    rows.length === 0 &&
    (active === undefined || (await listMessages(actor, active.id)).length === 0);
  const turns = toTurns(rows, inFlight, zone);
  const days = byDay(turns);
  const refs = turns.flatMap((t) => (t.kev?.kind === 'v2' ? t.kev.content.cites : []));
  const answered = turns.some((t) => t.kev?.kind === 'v2');
  const [cited, kept, calendars] = await Promise.all([
    listCitedRecords(actor, refs),
    listKeptMessageIds(
      actor,
      turns.flatMap((t) => (t.user ? [t.user.id] : [])),
    ),
    answered ? listCalendars(actor, { now }) : Promise.resolve([]),
  ]);

  const turnsToday = turns.some((t) => t.day === today);
  const hour = wallClockOf(now, zone).hour;
  const code = one('e');
  const at = Number(one('at'));
  const errorCode =
    code &&
    (KEV_TURN_ERROR_CODES as readonly string[]).includes(code) &&
    Math.abs(now.getTime() - at) < 120_000
      ? (code as KevTurnErrorCode)
      : null;
  const olderMayExist =
    weeks < WEEK_LIMIT && active !== undefined && active.createdAt.getTime() < since.getTime();

  return (
    <>
      <header>
        <Headline>{KEV_TITLE}</Headline>
        <p className="text-ink-2 mt-1" data-testid="kev-privacy">
          {PRIVACY_LINE}
        </p>
      </header>

      {firstOpen ? (
        <div className="mt-6" data-testid="kev-intro">
          <p className="font-display text-ink text-[22px] leading-[1.25] font-medium">{INTRO}</p>
          <p className="text-ink-2 mt-2 text-[15px]">
            {DISCLOSURE}{' '}
            <Link
              href="/settings/usage"
              className="inline-flex min-h-11 items-center underline underline-offset-4"
            >
              {DISCLOSURE_LINK} ›
            </Link>
          </p>
        </div>
      ) : null}

      {olderMayExist ? (
        <p className="mt-4">
          <Link
            href={`/kev?weeks=${weeks + 1}`}
            className="text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4"
          >
            {EARLIER}
          </Link>
        </p>
      ) : null}

      {one('cleared') === '1' && turns.length === 0 ? (
        <p role="status" className="text-ink-2 mt-4" data-testid="kev-cleared">
          {CLEARED}
        </p>
      ) : null}

      <Conversation
        days={days}
        today={today}
        ctx={{
          timeZone: zone,
          now,
          cited,
          kept,
          calendars: calendars
            .filter((c) => c.archivedAt === null)
            .map((c) => ({ id: c.id, name: c.name, lastSyncedAt: c.lastSyncedAt })),
        }}
      />

      {spend.state === 'deep_withdrawn' ? (
        <p className="text-muted mt-6 text-[15px]" data-testid="kev-simpler">
          {SIMPLER_TODAY}
        </p>
      ) : null}

      <Composer
        focusToday={one('focus') === 'today'}
        suggestions={turnsToday || inFlight ? [] : suggestions(today, hour)}
        notSaved={ERROR_TEXT.not_saved}
        initialError={errorCode ? ERROR_TEXT[errorCode] : null}
      />

      {turns.length > 0 ? (
        <div className="mt-8">
          <ConfirmAction
            action={clearConversationAction}
            label={CLEAR_LABEL}
            question={CLEAR_QUESTION}
            confirmLabel={CLEAR_CONFIRM}
          />
        </div>
      ) : null}
    </>
  );
}
