import { loadAgenda } from '@/app/_agenda/load';
import { requestNow } from '@/app/_agenda/now';
import { todayInput } from '@/app/_agenda/today-input';
import { RefreshOnUse } from '@/app/_calendar/refresh-on-use';
import { listCaptures } from '@/domain/captures/service';
import { today } from '@/domain/engines/today';
import { env, realDataGateOpen } from '@/lib/env';
import { isoDateInZone } from '@/lib/dates';
import { requireActor } from '@/trust/session';
import type { FactLookup } from './facts';
import { TodayView } from './today-view';

export const dynamic = 'force-dynamic';

// Today (M5 contract §4, ADR 0008 §32). The page reads once and hands the
// records to the Today engine, which decides what Today says; the view
// renders that and nothing else. The agenda loader supplies the events, the
// people, the open tasks, the projects and the calendars, all read as the
// signed-in adult, so nothing here is read twice (the page adds only the
// waiting captures). A calendar older than fifteen minutes is refreshed after
// the page has rendered (M4); Today never waits for it, and never for Kev.
export default async function TodayPage() {
  const actor = await requireActor();
  const now = await requestNow();
  const timeZone = env.HOME_TIMEZONE;
  const date = isoDateInZone(now, timeZone);
  const [agenda, captures] = await Promise.all([loadAgenda(actor, date, 2), listCaptures(actor)]);
  const waiting = captures.filter((c) => c.status === 'new' || c.status === 'proposed').length;
  const model = today(todayInput(agenda, now, timeZone, waiting));

  const lookup: FactLookup = {
    days: agenda.days,
    people: agenda.people,
    calendars: new Map(agenda.records.calendars.map((c) => [c.id, c])),
    tasks: new Map(agenda.records.tasks.map((t) => [t.id, t])),
    timeZone,
  };
  const projects = new Map(agenda.records.projects.map((p) => [p.id, p.title]));
  const people = [...agenda.people.values()];
  const linked = !realDataGateOpen() || people.some((p) => p.userId === actor.userId);
  const stale = agenda.records.calendars.some((c) => c.stale && c.archivedAt === null);

  return (
    <>
      {stale ? <RefreshOnUse /> : null}
      <TodayView model={model} lookup={lookup} linked={linked} projects={projects} />
    </>
  );
}
