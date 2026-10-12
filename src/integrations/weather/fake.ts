import {
  WeatherProviderError,
  type ForecastHour,
  type WeatherFailureCode,
  type WeatherProvider,
} from '@/domain/weather/provider';
import type { WeatherPoint } from '@/lib/env';
import { FORECAST_DAYS, HOURLY_VARIABLES, normaliseOpenMeteo } from './open-meteo';

// Deterministic fake WeatherProviders (M7 contract §1.2, §7): no network,
// ever. `fakeWeatherProvider` replays a script of steps for tests, one per
// call until the test moves on, like the calendar's fake: a step is hours
// already in HOME's shape, a synthetic Open-Meteo body (read by exactly the
// real adapter's normaliser), a failure code, or an unexpected throw. The
// `syntheticWeatherProvider` is what HOME_TEST_WEATHER=fake gives a local or
// CI server: a dry synthetic week from the current UTC day. Never used in a
// deployed environment (entry.ts refuses it).

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type SyntheticValues = {
  temperatureC: number | null;
  precipitationMm: number | null;
  precipitationProbability: number | null;
  windKmh: number | null;
  gustKmh: number | null;
};

const DRY: SyntheticValues = {
  temperatureC: 14,
  precipitationMm: 0,
  precipitationProbability: 5,
  windKmh: 15,
  gustKmh: 30,
};

/** UTC midnight of an instant's UTC day. */
export const utcDayStart = (at: Date) => new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS);

/**
 * `count` consecutive synthetic hours from `from` (on the hour), dry unless
 * `values` says otherwise for an hour.
 */
export function syntheticHours(
  from: Date,
  count: number,
  values: (start: Date, i: number) => Partial<SyntheticValues> = () => ({}),
): ForecastHour[] {
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(from.getTime() + i * HOUR_MS);
    return { start, ...DRY, ...values(start, i) };
  });
}

/**
 * A synthetic Open-Meteo body (`timeformat=unixtime`) for 8 UTC days from
 * `from`: 192 rows, as the provider answers. Row `t` carries the values the
 * provider reports at `t`; `values` describes the HOUR each row closes or
 * opens exactly as the adapter reads it back (so `values(start)` comes back
 * as the hour starting at `start`). It echoes a synthetic point, as the real
 * provider does, so tests can prove HOME never keeps it.
 */
export function syntheticOpenMeteoBody(
  from: Date,
  values: (start: Date, i: number) => Partial<SyntheticValues> = () => ({}),
  opts: { days?: number; echo?: { latitude: number; longitude: number; elevation: number } } = {},
): string {
  const rows = (opts.days ?? FORECAST_DAYS) * 24;
  const hours = syntheticHours(from, rows, values);
  const time = hours.map((h) => h.start.getTime() / 1000);
  // Instantaneous values at the row's own time; preceding-hour values at the
  // row that closes the hour (row i + 1 for hour i). Row 0 closes the hour
  // before `from`, which HOME never stores.
  const at = (i: number) => hours[i]!;
  const before = (i: number, k: keyof SyntheticValues) => (i === 0 ? 0 : at(i - 1)[k]);
  const hourly: Record<string, unknown> = { time };
  hourly.temperature_2m = hours.map((h) => h.temperatureC);
  hourly.wind_speed_10m = hours.map((h) => h.windKmh);
  hourly.precipitation = hours.map((_, i) => before(i, 'precipitationMm'));
  hourly.precipitation_probability = hours.map((_, i) => before(i, 'precipitationProbability'));
  hourly.wind_gusts_10m = hours.map((_, i) => before(i, 'gustKmh'));
  const echo = opts.echo ?? { latitude: -41.29, longitude: 174.78, elevation: 0 };
  return JSON.stringify({
    ...echo,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'GMT',
    timezone_abbreviation: 'GMT',
    hourly_units: Object.fromEntries(['time', ...HOURLY_VARIABLES].map((k) => [k, ''])),
    hourly,
  });
}

export type FakeWeatherStep =
  | { hours: ForecastHour[] }
  | { body: string }
  | { fail: WeatherFailureCode }
  /** An unexpected throw: the adapter would never let one out, so it tests the service's own boundary. */
  | { throws: unknown };

export type FakeWeatherProvider = WeatherProvider & {
  advance(): void;
  goTo(step: number): void;
  readonly step: number;
  /** How many times the provider was asked, for single-flight tests. */
  readonly calls: number;
  /** The points it was asked for, in order. */
  readonly points: readonly WeatherPoint[];
  /** Holds every fetch until `release()`; `reached` resolves once one waits there. */
  hold(): { reached: Promise<void>; release: () => void };
};

export function fakeWeatherProvider(steps: readonly FakeWeatherStep[]): FakeWeatherProvider {
  if (steps.length === 0) throw new Error('fakeWeatherProvider: at least one step');
  let step = 0;
  let calls = 0;
  const points: WeatherPoint[] = [];
  let held: { gate: Promise<void>; arrive: () => void } | null = null;
  return {
    kind: 'open_meteo',
    async fetchForecast(point) {
      calls++;
      points.push(point);
      if (held) {
        held.arrive();
        await held.gate;
      }
      const s = steps[step]!;
      if ('fail' in s) throw new WeatherProviderError(s.fail);
      if ('throws' in s) throw s.throws;
      if ('body' in s) return normaliseOpenMeteo(s.body);
      return s.hours.map((h) => ({ ...h }));
    },
    advance() {
      step = Math.min(step + 1, steps.length - 1);
    },
    goTo(n) {
      if (!Number.isInteger(n) || n < 0 || n >= steps.length)
        throw new Error('fakeWeatherProvider: no such step');
      step = n;
    },
    get step() {
      return step;
    },
    get calls() {
      return calls;
    },
    get points() {
      return points;
    },
    hold() {
      let release!: () => void;
      let arrive!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const reached = new Promise<void>((r) => (arrive = r));
      held = { gate, arrive };
      return {
        reached,
        release: () => {
          held = null;
          release();
        },
      };
    },
  };
}

/**
 * HOME_TEST_WEATHER=fake: a dry synthetic week from the current UTC day,
 * through the real normaliser, whatever point is asked for.
 */
export function syntheticWeatherProvider(clock: () => Date = () => new Date()): WeatherProvider {
  return {
    kind: 'open_meteo',
    async fetchForecast() {
      return normaliseOpenMeteo(syntheticOpenMeteoBody(utcDayStart(clock())));
    },
  };
}
