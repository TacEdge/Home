import { loadAgenda } from '@/app/_agenda/load';
import { todayInput } from '@/app/_agenda/today-input';
import { creditOpeningKey } from '@/app/_insights/weather/credit-key';
import type { FactLookup } from '@/app/_insights/facts';
import { listCaptures } from '@/domain/captures/service';
import type { Deps } from '@/domain/common/write';
import { conflictMarks, LOOKAHEAD_DAYS } from '@/domain/engines/insights';
import { conflictPlacements, today } from '@/domain/engines/today';
import { staleSentence, todaySentence, tomorrowSentence } from '@/domain/engines/weather';
import { conflictsOver } from '@/domain/insights/conflicts';
import { openingWeatherFrom } from '@/domain/insights/openings';
import { insightsFor, insightsInput } from '@/domain/insights/today';
import { readForecast } from '@/domain/weather/service';
import { addDays, isoDateInZone } from '@/lib/dates';
import { realDataGateOpen } from '@/lib/env';
import type { UserActor } from '@/trust/actor';
import type { TodayViewProps } from './today-view';

// Today's composition (M5 contract §4, ADR 0008 §32; M7 contract §3.8, §4.1):
// everything the page reads and decides, in one place, so the page renders
// exactly this and a test can compose and render it as `home_app` with the
// same code. The page reads once and hands the records to the Today engine,
// which decides what Today says; the view renders that and nothing else. The
// agenda loader supplies the events, the people, the open tasks, the projects
// and the calendars, all read as the signed-in adult, so nothing here is
// read twice (this adds only the waiting captures, the reader's responses in
// one more query, and the cached forecast in one more: never the network).

export type TodayComposition = {
  props: TodayViewProps;
  /** A calendar older than fifteen minutes: ask for it to be refreshed after render (M4). */
  calendarStale: boolean;
  /** The forecast is due a refresh, the gate is open: ask once, after render (M7 §5.1). */
  askWeather: boolean;
};

export async function composeToday(
  actor: UserActor,
  now: Date,
  timeZone: string,
  deps: Deps = {},
): Promise<TodayComposition> {
  const date = isoDateInZone(now, timeZone);
  const [agenda, captures] = await Promise.all([
    loadAgenda(actor, date, LOOKAHEAD_DAYS + 1, undefined, deps),
    listCaptures(actor, {}, deps),
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
  // The cached forecast, read once (no network): the sentence and the
  // openings in Worth knowing both come from this one read (M7 contract §3.8).
  const forecastRead = await readForecast(actor, { now }, deps);
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
    deps,
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
    now,
  };
  const people = [...agenda.people.values()];
  const linked = !realDataGateOpen() || people.some((p) => p.userId === actor.userId);
  return {
    props: {
      model,
      lookup,
      linked,
      worth,
      marks,
      weather: {
        sentence,
        stale,
        fetchedAt: forecastRead.configured ? forecastRead.fetchedAt : null,
        now,
      },
      creditFor: sentence ? undefined : creditOpeningKey(worth),
    },
    calendarStale: agenda.records.calendars.some((c) => c.stale && c.archivedAt === null),
    askWeather: forecastRead.configured && forecastRead.refreshDue && realDataGateOpen(),
  };
}
