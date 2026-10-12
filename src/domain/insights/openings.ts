import 'server-only';
import type { Deps } from '../common/write';
import type { AgendaDay } from '../engines/agenda';
import { daylightFor, type Daylight } from '../engines/daylight';
import { HOUSEHOLD } from '../engines/gaps';
import { openings, type Opening } from '../engines/insights/openings';
import type { Forecast } from '../engines/weather';
import type { AgendaInputs } from '../events/agenda-inputs';
import { readForecast } from '../weather/service';
import { addDays, type IsoDate } from '@/lib/dates';
import { weatherConfig } from '@/lib/env';
import type { UserActor } from '@/trust/actor';
import { gapsOver } from './gaps';

// The reader's openings (M7 Package 3; contract §3.3, §5.6–§5.8; ADR 0011
// §29–§35). Composed from what the page already read, as the signed-in
// adult: the shared agenda's days and the authorised records it came from
// (people, open tasks, projects, calendars), plus ONE read of the forecast
// cache (no network, no write) and daylight computed from the rounded home
// point. The gap engine runs for the household scope only; the openings
// engine does the rest. Nothing stored, nothing cached, no system actor:
// openings are derived per reader, per request, from what that reader can
// see, so nothing computed for one adult can reach the other (§3.5).

/** What openings take from configuration and the cache: the usable forecast, and the point daylight needs. */
export type OpeningWeather = {
  /** The cached forecast when it is this location's and usable (fresh or older); null otherwise. */
  forecast: Forecast | null;
  /** The rounded home point, when a location is configured (with or without a key). */
  point: { lat: number; lon: number } | null;
};

/**
 * One read of the forecast cache, as the adult (`readForecast`: one query
 * when weather is configured, none otherwise), and the rounded point for
 * daylight. A location with no valid key still gives daylight (§3.6).
 */
export async function readOpeningWeather(
  actor: UserActor,
  now: Date,
  deps: Deps = {},
): Promise<OpeningWeather> {
  const config = weatherConfig();
  const point =
    config.status === 'set' || config.status === 'key_missing'
      ? { lat: config.point.lat, lon: config.point.lon }
      : null;
  const read = await readForecast(actor, { now }, deps);
  const forecast =
    read.configured &&
    (read.freshness === 'fresh' || read.freshness === 'older') &&
    read.fetchedAt !== null
      ? { fetchedAt: read.fetchedAt, hours: read.hours }
      : null;
  return { forecast, point };
}

/** Daylight for each date of a window, at the rounded point; none without a location. */
export function daylightOver(
  window: { from: IsoDate; to: IsoDate },
  point: OpeningWeather['point'],
): Daylight[] {
  const out: Daylight[] = [];
  if (!point) return out;
  for (let date = window.from; date <= window.to; date = addDays(date, 1)) {
    const d = daylightFor(date, point);
    if (d) out.push(d);
  }
  return out;
}

/**
 * The openings engine over the agenda the caller already read. Pure. The
 * household's gaps over the window, from the same records (`gapsOver`);
 * daylight for the window; the reader's own open tasks and projects, from
 * the same authorised read (`records`), so a task the reader cannot see is
 * never matched. `agendaRange` is the range `days` was placed over.
 */
export function openingsOver(
  inputs: Pick<AgendaInputs, 'people' | 'records'>,
  days: readonly AgendaDay[],
  now: Date,
  timeZone: string,
  window: { from: IsoDate; to: IsoDate },
  agendaRange: { from: IsoDate; to: IsoDate },
  weather: OpeningWeather,
): Opening[] {
  return openings({
    now,
    timeZone,
    window,
    gaps: gapsOver(inputs, days, now, timeZone, window, agendaRange, [HOUSEHOLD]),
    forecast: weather.forecast,
    daylight: daylightOver(window, weather.point),
    tasks: inputs.records.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate,
      estimateMinutes: t.estimateMinutes,
      needs: t.needs,
      projectId: t.projectId,
      scheduledStartsAt: t.scheduledStartsAt,
      scheduledEndsAt: t.scheduledEndsAt,
    })),
    projects: inputs.records.projects.map((p) => ({ id: p.id, status: p.status })),
  });
}
