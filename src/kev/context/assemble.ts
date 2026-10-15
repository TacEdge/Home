import 'server-only';
import { z } from 'zod';
import { PERSON_ROLES } from '@/domain/people/schema';
import { ageOn } from '@/domain/engines/profile';
import { WEEKDAYS } from '@/domain/engines/day-facts';
import { clockOf, weekdayOf } from '@/lib/dates';
import type { ProviderToolDefinition } from '../providers/types';
import { calendarHealth } from '../tools/get-calendar-health';
import { presentToday, todaySchema } from '../tools/get-today';
import { personRef } from '../tools/present';
import { toolDefinitions } from '../tools/registry';
import { readToday } from '../tools/today-read';
import {
  dateSchema,
  homeInstant,
  instantSchema,
  MAX_ITEMS,
  MAX_RESULT_BYTES,
  refSchema,
  TEXT_CAP,
  uniqueRefs,
  untrusted,
  untrustedSchema,
  type Ref,
  type ToolContext,
} from '../tools/types';

// Context assembly (M8 contract §7.3, §9.1, §9.2, §5.5; D11; ADR 0012 §21).
//
// The stable prefix (cached): the system prompt and the tool definitions.
// No personal data, no date, nothing that varies by household or adult.
// Package 2 builds its structure and the tool definitions; the provisional
// system prompt is Package 3's (§2.1), so `system` is not built here.
//
// The volatile bundle, built by code as the requesting adult, last before the
// question: the weekday, date, time and zone; the reader (their linked
// person's id and name); the people the reader can see (name, role,
// relationship, age, in household; never a date of birth); the reader's
// Today (the headline and today's items, as get_today returns them, without
// insights); freshness (how many visible calendars are healthy, stale,
// failed or never refreshed, and the forecast's fetch time); the To sort
// count; the focus. Nothing else (D11): no home location or coordinate, no
// conversation summary or memory, no other day's agenda, no conflicts,
// projects, tasks beyond Today's To do, or context. One Today read: the
// same reads the Today screen makes.

/** The stable prefix: identical for every adult and every day (N14). */
export type StablePrefix = Readonly<{ tools: readonly ProviderToolDefinition[] }>;

export function stablePrefix(opts: { escalate: boolean }): StablePrefix {
  return Object.freeze({ tools: Object.freeze(toolDefinitions(opts)) });
}

export const bundleSchema = z
  .object({
    now: z
      .object({
        weekday: z.enum(WEEKDAYS),
        date: dateSchema,
        time: z.string().regex(/^\d\d:\d\d$/),
        zone: z.string().min(1).max(64),
      })
      .strict(),
    reader: z
      .object({ ref: refSchema, name: untrustedSchema(TEXT_CAP.name) })
      .strict()
      .nullable(),
    people: z
      .array(
        z
          .object({
            ref: refSchema,
            name: untrustedSchema(TEXT_CAP.name),
            role: z.enum(PERSON_ROLES),
            relationship: untrustedSchema(TEXT_CAP.relationship).nullable(),
            age: z.number().int().min(0).max(150).nullable(),
            in_household: z.boolean(),
          })
          .strict(),
      )
      .max(MAX_ITEMS),
    today: todaySchema,
    freshness: z
      .object({
        calendars: z
          .object({
            healthy: z.number().int().nonnegative(),
            stale: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
            never: z.number().int().nonnegative(),
          })
          .strict(),
        forecast_fetched_at: instantSchema.nullable(),
      })
      .strict(),
    to_sort: z.number().int().nonnegative(),
    focus: z.literal('today').nullable(),
  })
  .strict();
export type Bundle = z.output<typeof bundleSchema>;

const LIMITS = [MAX_ITEMS, 30, 20, 10, 5, 2, 0];

/**
 * The reader's volatile bundle: the object, its JSON (what the model is
 * sent), and the refs of every record in it (the turn's ledger starts with
 * these, §8.3). Deterministic: the same adult, records and `now` give the
 * same bytes.
 */
export async function assembleBundle(
  ctx: ToolContext & { focus?: 'today' },
): Promise<{ bundle: Bundle; text: string; refs: Ref[] }> {
  const read = await readToday(ctx);
  const tz = ctx.timeZone;
  const people = [...read.agenda.people.values()];
  const me = people.find((p) => p.userId === ctx.actor.userId) ?? null;
  const health = calendarHealth(read.agenda.records.calendars, ctx.now);
  const count = (s: string) => health.filter((h) => h.status === s).length;
  for (const limit of LIMITS) {
    const today = presentToday(read, limit, ctx);
    const shown = people.slice(0, limit);
    const refs: Ref[] = [
      ...(me ? [personRef(me.id)] : []),
      ...shown.map((p) => personRef(p.id)),
      ...today.refs,
    ];
    const bundle = bundleSchema.parse({
      now: {
        weekday: WEEKDAYS[weekdayOf(read.date)]!,
        date: read.date,
        time: clockOf(ctx.now, tz),
        zone: tz,
      },
      reader: me ? { ref: personRef(me.id), name: untrusted(me.name, TEXT_CAP.name) } : null,
      people: shown.map((p) => ({
        ref: personRef(p.id),
        name: untrusted(p.name, TEXT_CAP.name),
        role: p.role,
        relationship:
          p.relationship === null ? null : untrusted(p.relationship, TEXT_CAP.relationship),
        age: ageOn(p.dateOfBirth, read.date),
        in_household: p.inHousehold,
      })),
      today: today.data,
      freshness: {
        calendars: {
          healthy: count('healthy'),
          stale: count('stale'),
          failed: count('failed'),
          never: count('never'),
        },
        forecast_fetched_at:
          read.forecast.configured && read.forecast.fetchedAt
            ? homeInstant(read.forecast.fetchedAt, tz)
            : null,
      },
      to_sort: read.capturesWaiting,
      focus: ctx.focus ?? null,
    });
    const text = JSON.stringify(bundle);
    if (Buffer.byteLength(text, 'utf8') <= MAX_RESULT_BYTES)
      return { bundle, text, refs: uniqueRefs(refs) };
  }
  throw new Error('the bundle does not fit');
}
