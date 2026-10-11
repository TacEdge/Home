import { loadAgenda } from '@/app/_agenda/load';
import { requestNow } from '@/app/_agenda/now';
import { todayInput } from '@/app/_agenda/today-input';
import { RefreshOnUse } from '@/app/_calendar/refresh-on-use';
import type { FactLookup } from '@/app/_insights/facts';
import {
  forward,
  forwardPlacements,
  HORIZON_DAYS,
  HORIZONS,
  type Horizon,
} from '@/domain/engines/forward';
import { conflictMarks } from '@/domain/engines/insights';
import { forwardInsights } from '@/domain/insights/forward';
import { conflictsOver, forwardConflicts } from '@/domain/insights/conflicts';
import { addDays, isoDateInZone } from '@/lib/dates';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { ForwardView } from './forward-view';

export const dynamic = 'force-dynamic';

// Forward (M6 contract §4, ADR 0009 §15–§19, §32–§34). The page reads once
// (the agenda for 90 days, whatever the horizon, so a response on one
// horizon is a response on all), runs the conflict engine over it, takes the
// reader's responses in one more query, and hands the rest to the Forward
// engine, which decides what Forward says; the view renders that and nothing
// else. A calendar older than fifteen minutes is refreshed after the page has
// rendered; Forward never waits for it, and never for Kev.
export default async function ForwardPage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string }>;
}) {
  const actor = await requireActor();
  const { h } = await searchParams;
  const horizon: Horizon = HORIZONS.find((x) => x === h) ?? 'week';
  const now = await requestNow();
  const timeZone = env.HOME_TIMEZONE;
  const today = isoDateInZone(now, timeZone);
  const agenda = await loadAgenda(actor, today, 90, today);
  const records = {
    events: agenda.events,
    people: [...agenda.people.values()],
    records: agenda.records,
  };
  const coverage = { from: today, to: addDays(today, 89) };
  const found = conflictsOver(records, agenda.days, now, timeZone, coverage);
  // Worth knowing and the reader's responses: the one more query.
  const worth = await forwardInsights(
    actor,
    records,
    agenda.days,
    now,
    timeZone,
    horizon,
    HORIZON_DAYS[horizon],
    found,
  );
  const current = found.filter((c) => !worth.responded.has(c.key));
  const input = todayInput(agenda, now, timeZone, 0);
  const model = forward({
    now,
    timeZone,
    horizon,
    days: agenda.days,
    coverage,
    events: agenda.events,
    people: input.people,
    calendars: input.calendars,
    conflicts: forwardConflicts(current),
  });
  // Week says its conflicts on its rows; Month and Season list theirs.
  const marks = conflictMarks(worth, worth.responded, forwardPlacements(model), timeZone);

  const lookup: FactLookup = {
    days: agenda.days,
    people: agenda.people,
    calendars: new Map(agenda.records.calendars.map((c) => [c.id, c])),
    tasks: new Map(agenda.records.tasks.map((t) => [t.id, t])),
    projects: new Map(
      agenda.records.projects.map((p) => [p.id, { title: p.title, targetDate: p.targetDate }]),
    ),
    timeZone,
  };
  const stale = agenda.records.calendars.some((c) => c.stale && c.archivedAt === null);
  const returnTo = horizon === 'week' ? '/forward' : `/forward?h=${horizon}`;

  return (
    <>
      {stale ? <RefreshOnUse /> : null}
      <ForwardView model={model} lookup={lookup} worth={worth} marks={marks} returnTo={returnTo} />
    </>
  );
}
