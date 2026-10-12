import { z } from 'zod';
import {
  FORECAST_BOUNDS,
  MAX_FORECAST_HOURS,
  WeatherProviderError,
  type ForecastHour,
  type WeatherFailureCode,
  type WeatherProvider,
} from '@/domain/weather/provider';
import type { WeatherPoint } from '@/lib/env';
import {
  SafeFetchError,
  openMeteoPolicy,
  safeGet,
  type SafeFetchErrorCode,
} from '@/integrations/net/safe-fetch';

// The Open-Meteo adapter (M7 contract §5.1; ADR 0011 §11, §12, §19): the
// only real weather provider. One GET, built here and nowhere else, fetched
// only through safe-fetch's frozen openMeteoPolicy. The adapter knows
// nothing about the database and logs nothing. Every outcome that is not a
// forecast is a WeatherProviderError with one of the closed codes: no raw
// error, message, cause, URL or body ever leaves this module (contract §5.1,
// amendment 3). The response is untrusted data (CLAUDE.md rule 7): only
// numbers are read, through a bounded schema; the location, elevation and
// every other field the provider echoes back are never read or kept.

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/** The five hourly variables, in the order requested. */
export const HOURLY_VARIABLES = [
  'temperature_2m',
  'precipitation_probability',
  'precipitation',
  'wind_speed_10m',
  'wind_gusts_10m',
] as const;

/** Days requested: today to today + 7 in UTC days (contract §5.1, D6). */
export const FORECAST_DAYS = 8;

const HOUR_S = 3600;

/** Fetches the (policy-approved) request and returns the body. Tests inject one; production never does. */
export type WeatherFetcher = (url: string) => Promise<string>;

const guardedFetch: WeatherFetcher = async (url) =>
  (await safeGet(url, { policy: openMeteoPolicy })).text;

const FETCH_CODES: Record<SafeFetchErrorCode, WeatherFailureCode> = {
  timeout: 'timeout',
  too_large: 'too_large',
  rate_limited: 'rate_limited',
  bad_response: 'bad_response',
  // Any other refusal is recorded as `unreachable` (contract §3.9).
  unsupported_destination: 'unreachable',
  forbidden_destination: 'unreachable',
  redirect_refused: 'unreachable',
  address_rejected: 'unreachable',
  unreachable: 'unreachable',
};

const validPoint = (p: WeatherPoint) =>
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lon) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lon) <= 180 &&
  (p.elevation === null || Number.isInteger(p.elevation));

/**
 * The request, exactly (contract §5.1): latitude and longitude with two
 * decimals, elevation in whole metres when configured, the five hourly
 * variables, eight days, Unix times. No `timezone` (HOME converts UTC
 * itself, DST included), no other parameter, no key.
 */
export function openMeteoRequestUrl(point: WeatherPoint): string {
  const params = [
    `latitude=${point.lat.toFixed(2)}`,
    `longitude=${point.lon.toFixed(2)}`,
    ...(point.elevation === null ? [] : [`elevation=${point.elevation.toFixed(0)}`]),
    `hourly=${HOURLY_VARIABLES.join(',')}`,
    `forecast_days=${FORECAST_DAYS}`,
    'timeformat=unixtime',
  ];
  return `${ENDPOINT}?${params.join('&')}`;
}

const values = z.array(z.number().nullable());
const responseSchema = z.object({
  hourly: z.object({
    time: z.array(z.number().int()),
    temperature_2m: values,
    precipitation_probability: values,
    precipitation: values,
    wind_speed_10m: values,
    wind_gusts_10m: values,
  }),
});

const bad = () => new WeatherProviderError('bad_response');

const inRange = (v: number | null, min: number, max: number) =>
  v === null || (v >= min && v <= max);

/**
 * Open-Meteo's answer as HOME's hours (contract §5.1, ADR 0011 §12): each
 * hour `[t, t + 1h)` takes temperature and wind from the row stamped `t`,
 * and precipitation, its probability and gusts from the row stamped
 * `t + 1h` (the provider reports those for the preceding hour). So n rows
 * make n − 1 complete hours. Anything malformed, non-monotonic, inconsistent
 * in length or out of range is `bad_response`. Pure; never returns a
 * provider string.
 */
export function normaliseOpenMeteo(text: string): ForecastHour[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw bad();
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw bad();
  const h = parsed.data.hourly;
  const n = h.time.length;
  if (n < 2 || n > MAX_FORECAST_HOURS + 1) throw bad();
  for (const name of HOURLY_VARIABLES) if (h[name].length !== n) throw bad();
  for (let i = 0; i < n; i++) {
    const t = h.time[i]!;
    if (t % HOUR_S !== 0) throw bad();
    if (i > 0 && t - h.time[i - 1]! !== HOUR_S) throw bad();
    if (
      !inRange(
        h.temperature_2m[i]!,
        FORECAST_BOUNDS.minTemperatureC,
        FORECAST_BOUNDS.maxTemperatureC,
      ) ||
      !inRange(h.precipitation_probability[i]!, 0, FORECAST_BOUNDS.maxProbability) ||
      !inRange(h.precipitation[i]!, 0, Number.MAX_VALUE) ||
      !inRange(h.wind_speed_10m[i]!, 0, Number.MAX_VALUE) ||
      !inRange(h.wind_gusts_10m[i]!, 0, Number.MAX_VALUE)
    )
      throw bad();
  }
  const hours: ForecastHour[] = [];
  for (let i = 0; i < n - 1; i++)
    hours.push({
      start: new Date(h.time[i]! * 1000),
      temperatureC: h.temperature_2m[i]!,
      windKmh: h.wind_speed_10m[i]!,
      precipitationMm: h.precipitation[i + 1]!,
      precipitationProbability: h.precipitation_probability[i + 1]!,
      gustKmh: h.wind_gusts_10m[i + 1]!,
    });
  return hours;
}

export type OpenMeteoOptions = {
  /** Tests only: a fetcher standing in for the network. Production always uses safe-fetch. */
  fetchText?: WeatherFetcher;
};

export function openMeteoProvider(opts: OpenMeteoOptions = {}): WeatherProvider {
  const fetchText = opts.fetchText ?? guardedFetch;
  return {
    kind: 'open_meteo',
    async fetchForecast(point) {
      if (!validPoint(point)) throw new WeatherProviderError('unreachable');
      let text: string;
      try {
        text = await fetchText(openMeteoRequestUrl(point));
      } catch (e) {
        // A fresh error, never the one caught: its message, cause or stack
        // could carry the request URL.
        if (e instanceof SafeFetchError)
          throw new WeatherProviderError(FETCH_CODES[e.code] ?? 'unreachable');
        if (e instanceof WeatherProviderError) throw new WeatherProviderError(e.code);
        throw new WeatherProviderError('unreachable');
      }
      try {
        return normaliseOpenMeteo(text);
      } catch {
        throw bad();
      }
    },
  };
}
