import 'server-only';
import type { Deps } from '../common/write';
import type { AgendaDay } from '../engines/agenda';
import type { Conflict } from '../engines/conflicts';
import type { InsightKind } from '../engines/insights';
import { OPENING_DAYS, OPENINGS_SHOWN } from '../engines/insights/openings';
import type { AgendaInputs } from '../events/agenda-inputs';
import { addDays, isoDateInZone } from '@/lib/dates';
import type { UserActor } from '@/trust/actor';
import type { ForecastRead } from '../weather/service';
import { insightsFor, insightsInput } from './today';

// Forward's Worth knowing (M6 Package 4; contract §4.1, §5.8; ADR 0009 §18).
// The same detectors and the same responses query as Today, with Forward's
// own window (the horizon) and its own listing: Week lists only a calendar's
// health, because its conflicts are said on their rows; Month and Season list
// their conflicts, because they show no marks. Two are shown before "+ N more".
// M7 (ADR 0011 §34, D15, D16): Week also lists openings over today … today + 6,
// after every other family, at most two; Month and Season have none.

/** Forward's horizons, written out here so this service does not import the Forward engine (ADR 0010 §8). */
export type ForwardSurface = 'week' | 'month' | 'season';

/** The families each horizon lists; any other insight is said on its item or indicator. */
export const FORWARD_LISTED: Record<ForwardSurface, ReadonlySet<InsightKind>> = {
  week: new Set(['data_health', 'open_window']),
  month: new Set(['data_health', 'conflict']),
  season: new Set(['data_health', 'conflict']),
};

/** How many of Forward's insights are shown before "+ N more". */
export const FORWARD_SHOWN = 2;

/**
 * Forward's insights for one horizon: one responses query, and on Week one
 * read of the forecast cache for its openings. `days` is the 90-day agenda
 * the page read; `found` the conflicts over it.
 */
export async function forwardInsights(
  actor: UserActor,
  inputs: Pick<AgendaInputs, 'events' | 'people' | 'records'>,
  days: readonly AgendaDay[],
  now: Date,
  timeZone: string,
  horizon: ForwardSurface,
  horizonDays: number,
  found: readonly Conflict[],
  deps: Deps = {},
  forecast?: ForecastRead,
) {
  const today = isoDateInZone(now, timeZone);
  return insightsFor(
    actor,
    {
      ...insightsInput(inputs, days, now, timeZone, new Set(), {
        conflicts: found,
        ...(forecast ? { forecast } : {}),
      }),
      through: addDays(today, horizonDays - 1),
      listed: FORWARD_LISTED[horizon],
      shown: FORWARD_SHOWN,
      openingDays: OPENING_DAYS.forward,
      openingsShown: OPENINGS_SHOWN.forward,
    },
    deps,
  );
}
