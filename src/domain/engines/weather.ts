import type { ForecastHour } from '@/domain/weather/provider';
import {
  addDays,
  clockOf,
  daysBetween,
  instantFromWallClock,
  isoDateInZone,
  longDate,
  parseIsoDate,
  type IsoDate,
} from '@/lib/dates';

// Forecast words (M7 contract §5.1 freshness, §5.2; ADR 0011 §15, §17):
// bands over spans of forecast hours, Today's sentence, Forward Week's day
// phrases and the stale line. Pure: no I/O, no clock (`now` is given), no
// provider; hours are UTC instants and every day and part is placed in the
// home zone here, DST included. Weather is described, never judged: no
// output says a time is good, bad or suitable for anything. Every output
// carries its rule and the forecast fact it rests on (§3.7).

// ---- Constants (contract §5.2, §5.1; changed only by an ADR amendment) ----

/** Looks dry: every hour at or below this chance of rain (%). */
export const DRY_MAX_PROBABILITY = 20;
/** Looks dry: every hour under this much rain (mm). */
export const DRY_MAX_MM = 0.2;
/** Rain likely: any hour at or above this chance of rain (%). */
export const RAIN_LIKELY_PROBABILITY = 60;
/** Rain likely: any hour with at least this much rain (mm). */
export const RAIN_LIKELY_MM = 1.0;
/** Windy: any hour's gusts at or above this (km/h). */
export const WINDY_GUST_KMH = 50;
/** A forecast under this many hours old is fresh. */
export const FRESH_HOURS = 3;
/** A forecast up to this many hours old is usable (older); beyond it, unusable. */
export const USABLE_HOURS = 12;
/** Words for today to today + 6 only (D6). */
export const HORIZON_DAYS = 7;
/** Planning hours (D9), home time: the span of a day phrase. */
export const PLANNING_FROM = '08:00';
export const PLANNING_TO = '20:00';
/** Parts of a day, home time (contract §5.2). */
export const DAY_PARTS = Object.freeze([
  { part: 'morning', from: '06:00', to: '12:00' },
  { part: 'afternoon', from: '12:00', to: '18:00' },
  { part: 'evening', from: '18:00', to: '21:00' },
] as const);

export type Band = 'dry' | 'showers' | 'rain';
export type ForecastAge = 'fresh' | 'older' | 'unusable';
export type DayPart = (typeof DAY_PARTS)[number]['part'];
export type WeatherRule = 'weather.today' | 'weather.tomorrow' | 'weather.day' | 'weather.stale';

/** The forecast a sentence rests on: the span it describes and when it was fetched (ISO instants). */
export type ForecastFact = { kind: 'forecast'; from: string; to: string; fetchedAt: string };

export type Forecast = { fetchedAt: Date; hours: readonly ForecastHour[] };

/** One part of a day as Today's Why describes it (contract §4.5). */
export type PartSummary = {
  part: DayPart;
  band: Band;
  from: Date;
  to: Date;
  /** The highest chance of rain in the part (%). */
  maxProbability: number;
  /** Rain over the part (mm, rounded to 0.1). */
  totalMm: number;
  /** The strongest gust, if every hour gave one (km/h). */
  maxGustKmh: number | null;
};

export type WeatherWords = {
  rule: WeatherRule;
  text: string;
  facts: ForecastFact[];
};

export type WeatherSentence = WeatherWords & {
  rule: 'weather.today' | 'weather.tomorrow';
  parts: PartSummary[];
  windy: boolean;
  /** The low and high temperature over the parts described, when every hour gave one. */
  lowC: number | null;
  highC: number | null;
};

const HOUR_MS = 3_600_000;

// ---- Freshness ---------------------------------------------------------

/** Fresh under 3 hours; older from 3 to 12 hours; unusable beyond (contract §5.1). */
export function forecastAge(fetchedAt: Date, now: Date): ForecastAge {
  const age = now.getTime() - fetchedAt.getTime();
  if (age < FRESH_HOURS * HOUR_MS) return 'fresh';
  if (age <= USABLE_HOURS * HOUR_MS) return 'older';
  return 'unusable';
}

// ---- Bands -------------------------------------------------------------

/**
 * The band over a span of hours (D5): rain likely if any hour reaches 60% or
 * 1.0 mm; looks dry if every hour is at or below 20% and under 0.2 mm;
 * showers possible otherwise. No band (null) if the span is empty or any hour
 * is missing its chance or amount: no words are said for it.
 */
export function bandOf(hours: readonly ForecastHour[]): Band | null {
  if (hours.length === 0) return null;
  if (hours.some((h) => h.precipitationProbability === null || h.precipitationMm === null))
    return null;
  if (
    hours.some(
      (h) =>
        h.precipitationProbability! >= RAIN_LIKELY_PROBABILITY ||
        h.precipitationMm! >= RAIN_LIKELY_MM,
    )
  )
    return 'rain';
  if (
    hours.every(
      (h) => h.precipitationProbability! <= DRY_MAX_PROBABILITY && h.precipitationMm! < DRY_MAX_MM,
    )
  )
    return 'dry';
  return 'showers';
}

/** Windy: any hour's gusts at or above 50 km/h. */
export function windyOf(hours: readonly ForecastHour[]): boolean {
  return hours.some((h) => h.gustKmh !== null && h.gustKmh >= WINDY_GUST_KMH);
}

const BAND_WORDS: Record<Band, string> = {
  dry: 'Looks dry',
  showers: 'Showers possible',
  rain: 'Rain likely',
};

/** The band's words: "Looks dry", "Showers possible", "Rain likely". */
export const bandWords = (band: Band) => BAND_WORDS[band];
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---- Spans -------------------------------------------------------------

/** The instant a home wall-clock time ("08:00") names on a home date. */
export function atHome(date: IsoDate, clock: string, timeZone: string): Date {
  const d = parseIsoDate(date);
  const [hour, minute] = clock.split(':').map(Number) as [number, number];
  return instantFromWallClock({ ...d, hour, minute, second: 0 }, timeZone);
}

/**
 * The hours of `[from, to)`, only if the forecast covers every one of them
 * (stored hours are consecutive, so a count is enough); otherwise null.
 */
export function hoursCovering(
  hours: readonly ForecastHour[],
  from: Date,
  to: Date,
): ForecastHour[] | null {
  const span = to.getTime() - from.getTime();
  if (span <= 0 || span % HOUR_MS !== 0) return null;
  const inside = hours.filter(
    (h) => h.start.getTime() >= from.getTime() && h.start.getTime() + HOUR_MS <= to.getTime(),
  );
  return inside.length === span / HOUR_MS ? inside : null;
}

/** The start of the hour an instant falls in (UTC; New Zealand's offsets are whole hours). */
const hourOf = (at: Date) => new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);

const fact = (from: Date, to: Date, fetchedAt: Date): ForecastFact => ({
  kind: 'forecast',
  from: from.toISOString(),
  to: to.toISOString(),
  fetchedAt: fetchedAt.toISOString(),
});

/** "06:55" when fetched on the reader's today, else "yesterday 21:00" (never older, §5.1). */
export function asOfTime(fetchedAt: Date, now: Date, timeZone: string): string {
  const clock = clockOf(fetchedAt, timeZone);
  return isoDateInZone(fetchedAt, timeZone) === isoDateInZone(now, timeZone)
    ? clock
    : `yesterday ${clock}`;
}

const usable = (forecast: Forecast | null, now: Date): forecast is Forecast =>
  forecast !== null && forecastAge(forecast.fetchedAt, now) !== 'unusable';

// ---- Parts and sentences ----------------------------------------------

type Part = { part: DayPart; from: Date; to: Date; hours: ForecastHour[]; band: Band };

/**
 * The parts of a date whose hours end after `notBefore`, each with its band;
 * null if any remaining part is not fully covered or has no band.
 */
function partsOf(
  forecast: Forecast,
  date: IsoDate,
  notBefore: Date,
  timeZone: string,
): Part[] | null {
  const out: Part[] = [];
  for (const p of DAY_PARTS) {
    const partFrom = atHome(date, p.from, timeZone);
    const to = atHome(date, p.to, timeZone);
    const from = new Date(Math.max(partFrom.getTime(), hourOf(notBefore).getTime()));
    if (from.getTime() >= to.getTime()) continue;
    const hours = hoursCovering(forecast.hours, from, to);
    if (!hours) return null;
    const band = bandOf(hours);
    if (!band) return null;
    out.push({ part: p.part, from, to, hours, band });
  }
  return out.length ? out : null;
}

/** Consecutive equal bands, merged. */
function runsOf(parts: Part[]): { band: Band; parts: Part[] }[] {
  const runs: { band: Band; parts: Part[] }[] = [];
  for (const p of parts) {
    const last = runs.at(-1);
    if (last && last.band === p.band) last.parts.push(p);
    else runs.push({ band: p.band, parts: [p] });
  }
  return runs;
}

const until = (part: DayPart) => (part === 'afternoon' ? 'midday' : 'the evening');

function summarise(p: Part): PartSummary {
  const gusts = p.hours.map((h) => h.gustKmh);
  return {
    part: p.part,
    band: p.band,
    from: p.from,
    to: p.to,
    maxProbability: Math.max(...p.hours.map((h) => h.precipitationProbability!)),
    totalMm: Math.round(p.hours.reduce((s, h) => s + h.precipitationMm!, 0) * 10) / 10,
    maxGustKmh: gusts.some((g) => g === null) ? null : Math.max(...(gusts as number[])),
  };
}

function sentence(
  rule: 'weather.today' | 'weather.tomorrow',
  parts: Part[],
  forecast: Forecast,
  now: Date,
  timeZone: string,
): WeatherSentence {
  const runs = runsOf(parts);
  const w = (i: number, lowerCase = true) =>
    lowerCase ? lower(bandWords(runs[i]!.band)) : bandWords(runs[i]!.band);
  let text: string;
  if (rule === 'weather.today') {
    if (runs.length === 1) text = `${w(0, false)} today.`;
    else if (runs.length === 2)
      text = `${w(0, false)} until ${until(runs[1]!.parts[0]!.part)}, then ${w(1)}.`;
    else text = `${w(0, false)} this morning, ${w(1)} this afternoon, ${w(2)} this evening.`;
  } else {
    if (runs.length === 1) text = `${w(0, false)} tomorrow.`;
    else if (runs.length === 2)
      text = `Tomorrow: ${w(0)} until ${until(runs[1]!.parts[0]!.part)}, then ${w(1)}.`;
    else
      text = `Tomorrow: ${w(0)} in the morning, ${w(1)} in the afternoon, ${w(2)} in the evening.`;
  }
  const all = parts.flatMap((p) => p.hours);
  const windy = windyOf(all);
  if (windy) text += ' Windy at times.';
  if (forecastAge(forecast.fetchedAt, now) === 'older')
    text = `As of ${asOfTime(forecast.fetchedAt, now, timeZone)}, ${lower(text)}`;
  const temps = all.map((h) => h.temperatureC);
  const known = temps.every((t) => t !== null);
  return {
    rule,
    text,
    facts: [fact(parts[0]!.from, parts.at(-1)!.to, forecast.fetchedAt)],
    parts: parts.map(summarise),
    windy,
    lowC: known ? Math.min(...(temps as number[])) : null,
    highC: known ? Math.max(...(temps as number[])) : null,
  };
}

/**
 * `weather.today` (Today, day state): the rest of today in parts, each part's
 * hours being those ending after `now`. One run of equal bands: "Looks dry
 * today."; two: "Looks dry until midday, then showers possible."; three:
 * "… this morning, … this afternoon, … this evening." Windy adds "Windy at
 * times." An older forecast begins "As of {time}, ". Null (no words) when the
 * forecast is absent or unusable, nothing of today's parts remains, or any
 * remaining part is not fully covered or has no band.
 */
export function todaySentence(
  forecast: Forecast | null,
  now: Date,
  timeZone: string,
): WeatherSentence | null {
  if (!usable(forecast, now)) return null;
  const parts = partsOf(forecast, isoDateInZone(now, timeZone), now, timeZone);
  return parts ? sentence('weather.today', parts, forecast, now, timeZone) : null;
}

/**
 * `weather.tomorrow` (Today, evening state): tomorrow's three parts. "Rain
 * likely tomorrow." / "Tomorrow: looks dry until midday, then showers
 * possible." / "Tomorrow: … in the morning, … in the afternoon, … in the
 * evening." Windy and "As of" as for today.
 */
export function tomorrowSentence(
  forecast: Forecast | null,
  now: Date,
  timeZone: string,
): WeatherSentence | null {
  if (!usable(forecast, now)) return null;
  const tomorrow = addDays(isoDateInZone(now, timeZone), 1);
  const parts = partsOf(forecast, tomorrow, atHome(tomorrow, '00:00', timeZone), timeZone);
  return parts && parts.length === DAY_PARTS.length
    ? sentence('weather.tomorrow', parts, forecast, now, timeZone)
    : null;
}

/**
 * `weather.day` (Forward Week): "{Band}" over the date's planning hours (the
 * remaining ones, today), with ", windy" when it applies: at most four words.
 * Only for today to today + 6, and only when the forecast is usable and
 * covers every one of those hours with a band.
 */
export function dayPhrase(
  forecast: Forecast | null,
  date: IsoDate,
  now: Date,
  timeZone: string,
): WeatherWords | null {
  if (!usable(forecast, now)) return null;
  const today = isoDateInZone(now, timeZone);
  const offset = daysBetween(today, date);
  if (offset < 0 || offset >= HORIZON_DAYS) return null;
  const planningFrom = atHome(date, PLANNING_FROM, timeZone);
  const to = atHome(date, PLANNING_TO, timeZone);
  const from =
    offset === 0 ? new Date(Math.max(planningFrom.getTime(), hourOf(now).getTime())) : planningFrom;
  if (from.getTime() >= to.getTime()) return null;
  const hours = hoursCovering(forecast.hours, from, to);
  const band = hours ? bandOf(hours) : null;
  if (!hours || !band) return null;
  return {
    rule: 'weather.day',
    text: `${bandWords(band)}${windyOf(hours) ? ', windy' : ''}`,
    facts: [fact(from, to, forecast.fetchedAt)],
  };
}

/**
 * `weather.stale` (Today, in place of the sentence): "The forecast hasn't
 * updated since {when}." — a time today, "yesterday", a weekday within the
 * week, or a short date. Only for an unusable forecast that still has its
 * fetch time; null otherwise.
 */
export function staleSentence(
  fetchedAt: Date | null,
  now: Date,
  timeZone: string,
): WeatherWords | null {
  if (!fetchedAt || forecastAge(fetchedAt, now) !== 'unusable') return null;
  const day = isoDateInZone(fetchedAt, timeZone);
  const today = isoDateInZone(now, timeZone);
  const when =
    day === today
      ? clockOf(fetchedAt, timeZone)
      : day === addDays(today, -1)
        ? 'yesterday'
        : day > addDays(today, -7)
          ? longDate(day).split(' ')[0]!
          : longDate(day, 'short');
  return {
    rule: 'weather.stale',
    text: `The forecast hasn't updated since ${when}.`,
    facts: [fact(fetchedAt, fetchedAt, fetchedAt)],
  };
}
