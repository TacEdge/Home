import 'server-only';
import type { Deps } from '../common/write';
import type { AgendaDay } from '../engines/agenda';
import type { Conflict } from '../engines/conflicts';
import type { InsightKind } from '../engines/insights';
import type { AgendaInputs } from '../events/agenda-inputs';
import { addDays, isoDateInZone } from '@/lib/dates';
import type { UserActor } from '@/trust/actor';
import { insightsFor, insightsInput } from './today';

// Forward's Worth knowing (M6 Package 4; contract §4.1, §5.8; ADR 0009 §18).
// The same detectors and the same responses query as Today, with Forward's
// own window (the horizon) and its own listing: Week lists only a calendar's
// health, because its conflicts are said on their rows; Month and Season list
// their conflicts, because they show no marks. Two are shown before "+ N more".

/** Forward's horizons, written out here so this service does not import the Forward engine (ADR 0010 §8). */
export type ForwardSurface = 'week' | 'month' | 'season';

/** The families each horizon lists; any other insight is said on its item or indicator. */
export const FORWARD_LISTED: Record<ForwardSurface, ReadonlySet<InsightKind>> = {
  week: new Set(['data_health']),
  month: new Set(['data_health', 'conflict']),
  season: new Set(['data_health', 'conflict']),
};

/** How many of Forward's insights are shown before "+ N more". */
export const FORWARD_SHOWN = 2;

/**
 * Forward's insights for one horizon: one responses query. `days` is the
 * 90-day agenda the page read; `found` the conflicts over it.
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
) {
  const today = isoDateInZone(now, timeZone);
  return insightsFor(
    actor,
    {
      ...insightsInput(inputs, days, now, timeZone, new Set(), { conflicts: found }),
      through: addDays(today, horizonDays - 1),
      listed: FORWARD_LISTED[horizon],
      shown: FORWARD_SHOWN,
    },
    deps,
  );
}
