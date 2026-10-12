import { loadAgenda } from '@/app/_agenda/load';
import { todayInput } from '@/app/_agenda/today-input';
import type { FactLookup } from '@/app/_insights/facts';
import { creditOpeningKey } from '@/app/_insights/weather/credit-key';
import type { Deps } from '@/domain/common/write';
import { forward, forwardPlacements, HORIZON_DAYS, type Horizon } from '@/domain/engines/forward';
import { conflictMarks } from '@/domain/engines/insights';
import { dayPhrase } from '@/domain/engines/weather';
import { conflictsOver, forwardConflicts } from '@/domain/insights/conflicts';
import { forwardInsights } from '@/domain/insights/forward';
import { openingWeatherFrom } from '@/domain/insights/openings';
import { readForecast } from '@/domain/weather/service';
import { addDays, isoDateInZone } from '@/lib/dates';
import { realDataGateOpen } from '@/lib/env';
import type { UserActor } from '@/trust/actor';
import type { ForwardViewProps } from './forward-view';

// Forward's composition (M6 contract §4, ADR 0009 §15–§19, §32–§34; M7
// contract §4.2, §3.8): everything the page reads and decides, so the page
// renders exactly this and a test can compose and render it as `home_app`.
// The page reads once (the agenda for 90 days, whatever the horizon, so a
// response on one horizon is a response on all), runs the conflict engine
// over it, takes the reader's responses in one more query, and hands the rest
// to the Forward engine, which decides what Forward says; the view renders
// that and nothing else. Week alone reads the cached forecast, in one more
// query (never the network); Month and Season read none and say nothing of it.

export type ForwardComposition = {
  props: ForwardViewProps;
  calendarStale: boolean;
  askWeather: boolean;
};

export async function composeForward(
  actor: UserActor,
  now: Date,
  timeZone: string,
  horizon: Horizon,
  deps: Deps = {},
): Promise<ForwardComposition> {
  const today = isoDateInZone(now, timeZone);
  const agenda = await loadAgenda(actor, today, 90, today, deps);
  const records = {
    events: agenda.events,
    people: [...agenda.people.values()],
    records: agenda.records,
  };
  const coverage = { from: today, to: addDays(today, 89) };
  const found = conflictsOver(records, agenda.days, now, timeZone, coverage);
  const forecastRead = horizon === 'week' ? await readForecast(actor, { now }, deps) : null;
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
    deps,
    forecastRead ?? undefined,
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
    now,
  };
  const forecast = forecastRead ? openingWeatherFrom(forecastRead).forecast : null;
  const phrases = new Map<string, string>();
  if (forecast)
    for (const unit of model.units) {
      const words = unit.unit === 'day' ? dayPhrase(forecast, unit.from, now, timeZone) : null;
      if (words) phrases.set(unit.from, words.text);
    }
  return {
    props: {
      model,
      lookup,
      worth,
      marks,
      returnTo: horizon === 'week' ? '/forward' : `/forward?h=${horizon}`,
      weather:
        phrases.size > 0 && forecast ? { phrases, fetchedAt: forecast.fetchedAt, now } : undefined,
      creditFor: phrases.size > 0 ? undefined : creditOpeningKey(worth),
    },
    calendarStale: agenda.records.calendars.some((c) => c.stale && c.archivedAt === null),
    askWeather: !!forecastRead?.configured && forecastRead.refreshDue && realDataGateOpen(),
  };
}
