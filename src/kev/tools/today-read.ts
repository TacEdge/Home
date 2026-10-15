import 'server-only';
import { loadAgenda, type LoadedAgenda } from '@/domain/agenda/load';
import { todayInput } from '@/domain/agenda/today-input';
import { listCaptures } from '@/domain/captures/service';
import { LOOKAHEAD_DAYS, type Insights } from '@/domain/engines/insights';
import { conflictPlacements, today, type TodayModel } from '@/domain/engines/today';
import { conflictsOver } from '@/domain/insights/conflicts';
import { insightsFor, insightsInput } from '@/domain/insights/today';
import { readForecast, type ForecastRead } from '@/domain/weather/service';
import { addDays } from '@/lib/dates';
import { todayOf, type ToolContext } from './types';

// Today, read exactly as the Today screen reads it (contract §6.2: "get_today
// returns the same model Today renders, so Kev and Today never disagree about
// today"; M5 contract §4, M6 §4.5, M7 §3.8). The same calls in the same order
// as the page's composition (src/app/(home)/today/compose.ts), as the adult
// via Kev: the shared agenda loader for today and the lookahead, the
// reader's waiting captures for the To sort count, the Today engine, the
// conflict engine over the same days, one read of the forecast cache, and
// Worth knowing with the reader's own responses applied. Nothing presentational
// is read (no fact lookup, no credit placement). tests/integration/kev-tools.
// test.ts (T2) holds this equal to the page's composition.

export type TodayRead = {
  date: string;
  agenda: LoadedAgenda;
  model: TodayModel;
  worth: Insights & { responded: ReadonlySet<string> };
  forecast: ForecastRead;
  capturesWaiting: number;
};

export async function readToday(ctx: ToolContext): Promise<TodayRead> {
  const { actor, now, timeZone, deps = {} } = ctx;
  const date = todayOf(ctx);
  const [agenda, captures] = await Promise.all([
    loadAgenda(actor, date, LOOKAHEAD_DAYS + 1, date, deps),
    listCaptures(actor, {}, deps),
  ]);
  const waiting = captures.filter((c) => c.status === 'new' || c.status === 'proposed').length;
  const model = today(todayInput(agenda, now, timeZone, waiting));
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
  const forecast = await readForecast(actor, { now }, deps);
  const worth = await insightsFor(
    actor,
    insightsInput(records, agenda.days, now, timeZone, new Set(), {
      conflicts: found,
      placed,
      forecast,
    }),
    deps,
  );
  return { date, agenda, model, worth, forecast, capturesWaiting: waiting };
}
