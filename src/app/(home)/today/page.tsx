import { loadAgenda } from '@/app/_agenda/load';
import { requestNow } from '@/app/_agenda/now';
import { todayInput } from '@/app/_agenda/today-input';
import { RefreshOnUse } from '@/app/_calendar/refresh-on-use';
import { listCaptures } from '@/domain/captures/service';
import { conflictMarks, LOOKAHEAD_DAYS } from '@/domain/engines/insights';
import { conflictsOver } from '@/domain/insights/conflicts';
import { insightsFor, insightsInput } from '@/domain/insights/today';
import { conflictPlacements, today } from '@/domain/engines/today';
import { env, realDataGateOpen } from '@/lib/env';
import { addDays, isoDateInZone } from '@/lib/dates';
import { openingWeatherFrom } from '@/domain/insights/openings';
import { readForecast } from '@/domain/weather/service';
import { staleSentence, todaySentence, tomorrowSentence } from '@/domain/engines/weather';
import { RefreshWeather } from '@/app/_weather/refresh-weather';
import { creditOpeningKey } from '@/app/_weather/credit-key';
import { requireActor } from '@/trust/session';
import type { FactLookup } from '@/app/_insights/facts';
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
  const [agenda, captures] = await Promise.all([
    loadAgenda(actor, date, LOOKAHEAD_DAYS + 1),
    listCaptures(actor),
  ]);
  const waiting = captures.filter((c) => c.status === 'new' || c.status === 'proposed').length;
  const model = today(todayInput(agenda, now, timeZone, waiting));
  // Conflicts (M6 Package 3, contract §4.5): the conflict engine over the same
  // agenda, today and the next seven days. Today's are said on their items
  // where Today shows them; the rest are listed in Worth knowing.
  const records = {
    events: agenda.events,
    people: [...agenda.people.values()],
    records: agenda.records,
  };
  const found = conflictsOver(records, agenda.days, now, timeZone, {
    from: date,
    to: addDays(date, LOOKAHEAD_DAYS),
  });
  const placed = conflictPlacements(model);
  // The cached forecast, read once (no network): the sentence below and the
  // openings in Worth knowing both come from this one read (M7 contract §3.8).
  const forecastRead = await readForecast(actor, { now });
  const forecast = openingWeatherFrom(forecastRead).forecast;
  const sentence =
    model.state === 'evening'
      ? tomorrowSentence(forecast, now, timeZone)
      : todaySentence(forecast, now, timeZone);
  const stale =
    !sentence && forecastRead.configured && forecastRead.freshness === 'unusable'
      ? staleSentence(forecastRead.fetchedAt, now, timeZone)
      : null;
  // Worth knowing: the same records, the reader's own responses applied (one more query).
  const worth = await insightsFor(
    actor,
    insightsInput(records, agenda.days, now, timeZone, new Set(), {
      conflicts: found,
      placed,
      forecast: forecastRead,
    }),
  );
  const marks = conflictMarks(worth, worth.responded, placed, timeZone);

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
  const people = [...agenda.people.values()];
  const linked = !realDataGateOpen() || people.some((p) => p.userId === actor.userId);
  const calendarStale = agenda.records.calendars.some((c) => c.stale && c.archivedAt === null);
  // After render, and only when the server found a refresh due (M7 contract §5.1).
  const askWeather = forecastRead.configured && forecastRead.refreshDue && realDataGateOpen();

  return (
    <>
      {calendarStale ? <RefreshOnUse /> : null}
      {askWeather ? <RefreshWeather /> : null}
      <TodayView
        model={model}
        lookup={lookup}
        linked={linked}
        worth={worth}
        marks={marks}
        weather={{
          sentence,
          stale,
          fetchedAt: forecastRead.configured ? forecastRead.fetchedAt : null,
          now,
        }}
        creditFor={sentence ? undefined : creditOpeningKey(worth)}
      />
    </>
  );
}
