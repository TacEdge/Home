import { z } from 'zod';
import type { WeatherPoint } from '@/lib/env';

// The provider-neutral weather boundary (M7 contract §3.4, §5.1; ADR 0011
// §10, §12; CLAUDE.md rule 13). These are HOME's own shapes: an adapter
// (src/integrations/weather) turns whatever its provider speaks into them,
// and nothing past this boundary knows Open-Meteo's field names, units or
// layout. Read-only. Lives in the domain so the forecast service can depend
// on it without importing an adapter.

/**
 * One hour of forecast, `[start, start + 1h)` in UTC. Values the provider
 * reports for the preceding hour (precipitation, its probability, gusts)
 * come from its row stamped at this hour's end; instantaneous values
 * (temperature, wind) from its row at this hour's start. A value the
 * provider did not give is null.
 */
export type ForecastHour = {
  start: Date;
  temperatureC: number | null;
  /** Millimetres during this hour. */
  precipitationMm: number | null;
  /** 0–100, for this hour. */
  precipitationProbability: number | null;
  windKmh: number | null;
  /** The hour's maximum. */
  gustKmh: number | null;
};

/** The provider HOME uses (D1); the `weather_forecast.provider` value. */
export type WeatherProviderKind = 'open_meteo';

/**
 * Why a fetch produced no forecast (contract §5.1): the attempt statuses a
 * refresh records, and nothing else. A code only: never a coordinate, the
 * request URL, a header, the provider's text or a stack.
 */
export type WeatherFailureCode =
  'unreachable' | 'rate_limited' | 'timeout' | 'too_large' | 'bad_response';

export const WEATHER_FAILURE_CODES: readonly WeatherFailureCode[] = Object.freeze([
  'unreachable',
  'rate_limited',
  'timeout',
  'too_large',
  'bad_response',
]);

export class WeatherProviderError extends Error {
  readonly code: WeatherFailureCode;
  constructor(code: WeatherFailureCode) {
    super(code);
    this.name = 'WeatherProviderError';
    this.code = code;
  }
}

export interface WeatherProvider {
  readonly kind: WeatherProviderKind;
  /**
   * The hourly forecast for the rounded point: complete hours in UTC order,
   * with no gap or duplicate. Throws WeatherProviderError and nothing else.
   */
  fetchForecast(point: WeatherPoint): Promise<ForecastHour[]>;
}

/** Bounds every stored or returned hour must satisfy (contract §5.1). */
export const FORECAST_BOUNDS = Object.freeze({
  minTemperatureC: -60,
  maxTemperatureC: 60,
  maxProbability: 100,
});

const HOUR_MS = 3_600_000;

const nullableBetween = (min: number, max: number) => z.number().min(min).max(max).nullable();
const nullableNonNegative = z.number().nonnegative().nullable();

/**
 * One hour as it is stored in `weather_forecast.hours` (jsonb): the start as
 * an ISO instant on the hour, the five values. The service writes and reads
 * through this schema only, so a stored row can never carry anything else.
 */
export const storedHourSchema = z
  .object({
    start: z.iso.datetime().refine((s) => Date.parse(s) % HOUR_MS === 0, 'on the hour'),
    temperatureC: nullableBetween(FORECAST_BOUNDS.minTemperatureC, FORECAST_BOUNDS.maxTemperatureC),
    precipitationMm: nullableNonNegative,
    precipitationProbability: nullableBetween(0, FORECAST_BOUNDS.maxProbability),
    windKmh: nullableNonNegative,
    gustKmh: nullableNonNegative,
  })
  .strict();

export type StoredHour = z.infer<typeof storedHourSchema>;

/** The most hours a stored forecast holds (8 days, with room to spare). */
export const MAX_FORECAST_HOURS = 400;

export const storedHoursSchema = z.array(storedHourSchema).min(1).max(MAX_FORECAST_HOURS);

export const toStoredHour = (h: ForecastHour): StoredHour => ({
  start: h.start.toISOString(),
  temperatureC: h.temperatureC,
  precipitationMm: h.precipitationMm,
  precipitationProbability: h.precipitationProbability,
  windKmh: h.windKmh,
  gustKmh: h.gustKmh,
});

export const fromStoredHour = (h: StoredHour): ForecastHour => ({ ...h, start: new Date(h.start) });

/**
 * Whether hours are a usable forecast: within bounds, on the hour, strictly
 * consecutive (UTC order, no gap, no duplicate). The adapter guarantees it;
 * the service checks again before writing, so no provider, fake or real,
 * can store anything else.
 */
export function wellFormedHours(hours: readonly ForecastHour[]): boolean {
  if (hours.length === 0 || hours.length > MAX_FORECAST_HOURS) return false;
  for (let i = 0; i < hours.length; i++) {
    const h = hours[i]!;
    if (!(h.start instanceof Date) || Number.isNaN(h.start.getTime())) return false;
    if (!storedHourSchema.safeParse(toStoredHour(h)).success) return false;
    if (i > 0 && h.start.getTime() - hours[i - 1]!.start.getTime() !== HOUR_MS) return false;
  }
  return true;
}
