import 'server-only';
import { z } from 'zod';
import { dayOutlook, type DayOutlook } from '@/domain/engines/weather';
import { openingWeatherFrom } from '@/domain/insights/openings';
import { readForecast, type ForecastRead } from '@/domain/weather/service';
import { addDays } from '@/lib/dates';
import {
  dateSchema,
  homeInstant,
  inAskableRange,
  instantSchema,
  MAX_ITEMS,
  refSchema,
  todayOf,
  ToolRefusal,
  type ReadTool,
  type Ref,
} from './types';

// get_weather (contract §6.2): the cached forecast, in M7's words. One read
// of the forecast cache as the adult (`readForecast`: no network, no write),
// whether a location is configured, when the forecast was fetched and its
// age (`fresh`, `older`, `unusable` or `none`), and for each asked-for date
// the forecast covers (today … today + 6, usable only): M7's day phrase, the
// low and high, the strongest gust, and the band of each part of the day
// (the weather engine's `dayOutlook`). Never a coordinate, a location key or
// a request URL; the credit is the provider's name. Code-written phrases are
// not record text, so they are not labelled.

export const FORECAST_CREDIT = 'Open-Meteo';

const input = z.object({ from: z.iso.date(), to: z.iso.date() }).strict();
type Input = z.output<typeof input>;

const day = z
  .object({
    ref: refSchema,
    date: dateSchema,
    phrase: z.string().min(1).max(60),
    low_c: z.number().nullable(),
    high_c: z.number().nullable(),
    max_gust_kmh: z.number().nullable(),
    parts: z
      .array(
        z
          .object({
            part: z.enum(['morning', 'afternoon', 'evening']),
            band: z.enum(['dry', 'showers', 'rain']),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();

const output = z.union([
  z.object({ configured: z.literal(false) }).strict(),
  z
    .object({
      configured: z.literal(true),
      freshness: z.enum(['fresh', 'older', 'unusable', 'none']),
      fetched_at: instantSchema.nullable(),
      days: z.array(day).max(7),
      /** Asked-for dates the forecast does not cover. */
      uncovered: z.array(dateSchema).max(MAX_ITEMS),
      credit: z.literal(FORECAST_CREDIT),
      count: z.number().int().nonnegative(),
      truncated: z.boolean(),
    })
    .strict(),
]);

type Read = { input: Input; read: ForecastRead; days: DayOutlook[]; uncovered: string[] };

/** A forecast day's ref: the date it describes. */
export const forecastRef = (date: string): Ref => ({ type: 'forecast', id: `forecast:${date}` });

export const getWeather: ReadTool<Input, Read, z.output<typeof output>> = {
  name: 'get_weather',
  authority: 'read',
  kind: 'read',
  description:
    "The household's cached forecast for a range of home dates, in HOME's words: whether a forecast is set up, when it was fetched and how fresh it is, and for each covered day its phrase, low and high, strongest gust and the band for each part of the day. Days the forecast does not cover are listed as uncovered.",
  input,
  output,
  summarise: (i) => ({ from: i.from, to: i.to }),
  read: async (ctx, i) => {
    const today = todayOf(ctx);
    if (i.to < i.from) throw new ToolRefusal('bad_input');
    if (!inAskableRange(i.from, today) || !inAskableRange(i.to, today))
      throw new ToolRefusal('out_of_range');
    const read = await readForecast(ctx.actor, { now: ctx.now }, ctx.deps);
    const forecast = read.configured ? openingWeatherFrom(read).forecast : null;
    const days: DayOutlook[] = [];
    const uncovered: string[] = [];
    for (let date = i.from; date <= i.to; date = addDays(date, 1)) {
      const o = dayOutlook(forecast, date, ctx.now, ctx.timeZone);
      if (o) days.push(o);
      else uncovered.push(date);
    }
    return { input: i, read, days, uncovered };
  },
  present: ({ read, days, uncovered }, limit, ctx) => {
    if (!read.configured) return { data: { configured: false }, refs: [] };
    const refs: Ref[] = [];
    const out = days.slice(0, limit).map((d) => {
      const ref = forecastRef(d.date);
      refs.push(ref);
      return {
        ref,
        date: d.date,
        phrase: d.phrase,
        low_c: d.lowC,
        high_c: d.highC,
        max_gust_kmh: d.maxGustKmh,
        parts: d.parts,
      };
    });
    return {
      data: {
        configured: true,
        freshness: read.freshness,
        fetched_at: read.fetchedAt ? homeInstant(read.fetchedAt, ctx.timeZone) : null,
        days: out,
        uncovered: uncovered.slice(0, limit),
        credit: FORECAST_CREDIT,
        count: days.length + uncovered.length,
        truncated: days.length > limit || uncovered.length > limit,
      },
      refs,
    };
  },
};
