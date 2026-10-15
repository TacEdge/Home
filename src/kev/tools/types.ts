import 'server-only';
import { z } from 'zod';
import type { Deps } from '@/domain/common/write';
import { addDays, isoDateInZone, offsetAt, wallClockOf, type IsoDate } from '@/lib/dates';
import { env } from '@/lib/env';
import type { UserActor } from '@/trust/actor';

// What every Kev tool shares (M8 contract §4.4, §6.1, §6.3, §9.1–§9.4; ADR
// 0012 §17). A tool reads as the requesting adult, through the domain
// services, and returns a minimised, bounded result whose every user- or
// calendar-authored string sits inside an `untrusted_text` field. Tools
// never throw to the model: a closed error code comes back instead.
//
// The closed sets here (tool names, ref types, error codes, the ref shape)
// are the same values message content v2 defines in the bookkeeping path's
// schema. Tools may not import the bookkeeping path (matrix row S11), so they
// are written out here and tests/unit/kev-tools-registry.test.ts holds the
// two equal.

/** Kev's tools (contract §6.2): the twelve read tools and `escalate`. */
export const TOOL_NAMES = [
  'get_today',
  'get_agenda',
  'get_conflicts',
  'get_insights',
  'get_tasks',
  'get_projects',
  'get_people',
  'get_context',
  'get_calendar_health',
  'get_weather',
  'get_gaps',
  'search',
  'escalate',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** What a citation can point at (contract §4.4). */
export const REF_TYPES = [
  'event',
  'task',
  'project',
  'note',
  'person',
  'conflict',
  'insight',
  'gap',
  'forecast',
  'calendar',
  'context',
] as const;
export type RefType = (typeof REF_TYPES)[number];

/** A tool's closed error codes (contract §6.1): never a message, stack or query. */
export const TOOL_ERROR_CODES = ['bad_input', 'out_of_range', 'not_found', 'unavailable'] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/** `at`: an occurrence's start, as an instant with the home offset (contract §4.4). */
export type Ref = { type: RefType; id: string; at?: string };

export type ToolResult<T> = { ok: true; data: T; refs: Ref[] } | { ok: false; code: ToolErrorCode };

/**
 * What the server hands a tool: the requesting adult (`via: 'kev'`), the
 * turn's `now` and the home zone. Never anything from the model's input.
 */
export type ToolContext = Readonly<{
  actor: UserActor;
  now: Date;
  timeZone: string;
  deps?: Deps;
}>;

// ---------------------------------------------------------------------------
// Who Kev's tools and bundle run for, and in which zone (contract §4.4, §7.3;
// ADR 0012 §44). Shared by the runner and the context assembly, so the two
// can never disagree.

/** Why the server refused to run Kev's tools or build the bundle: a closed code, never a message. */
export const CONTEXT_REFUSAL_CODES = ['not_kev_actor', 'zone_mismatch', 'bundle_too_large'] as const;
export type ContextRefusalCode = (typeof CONTEXT_REFUSAL_CODES)[number];

/** A closed refusal: its message is its code and nothing else (no record, query or value). */
export class ContextRefusal extends Error {
  constructor(readonly code: ContextRefusalCode) {
    super(code);
    this.name = 'ContextRefusal';
  }
}

/**
 * The server's context, checked before anything is read: the actor must be
 * a user acting through Kev (never the system, the UI or sync; never an
 * identity from model input), and the zone must be the home zone the shared
 * agenda loader reads with (`HOME_TIMEZONE`), so a tool never presents in
 * one zone what was read in another. Throws a `ContextRefusal` otherwise.
 */
export function assertKevContext(ctx: { actor: unknown; timeZone: unknown }): void {
  const actor = ctx.actor as { kind?: unknown; via?: unknown } | null | undefined;
  if (actor?.kind !== 'user' || actor.via !== 'kev') throw new ContextRefusal('not_kev_actor');
  if (ctx.timeZone !== env.HOME_TIMEZONE) throw new ContextRefusal('zone_mismatch');
}

/** A structural summary of a call's arguments: dates, scopes, ids, counts; never free text (§7.6). */
export type TraceArgs = Record<string, string | number | boolean>;

// ---------------------------------------------------------------------------
// Bounds (contract §6.1).

/** At most this many items in any list a tool returns. */
export const MAX_ITEMS = 50;
/** About 3,000 tokens: a result's JSON is never larger. */
export const MAX_RESULT_BYTES = 12 * 1024;
/** Dates a tool may be asked about: today − 7 to today + 90 (Forward's horizon). */
export const RANGE_PAST_DAYS = 7;
export const RANGE_FUTURE_DAYS = 90;

/** Length caps for labelled text (contract §6.2): titles and names, bodies, notes. */
export const TEXT_CAP = {
  title: 200,
  name: 100,
  label: 100,
  sentence: 400,
  body: 500,
  stageNote: 200,
  relationship: 200,
} as const;

// ---------------------------------------------------------------------------
// Untrusted text (contract §6.1, §6.3, §9.3).

/**
 * A string a person or a calendar wrote, carried as data and never as an
 * instruction. Cut to its cap; a cut string says so.
 */
export type UntrustedText = { untrusted_text: string; truncated?: true };

export function untrusted(text: string, cap: number): UntrustedText {
  // Cut on code points, so a surrogate pair is never split.
  const chars = Array.from(text);
  return chars.length <= cap
    ? { untrusted_text: text }
    : { untrusted_text: chars.slice(0, cap).join(''), truncated: true };
}

/** The output schema of a labelled string with its cap. */
export const untrustedSchema = (cap: number) =>
  z
    .object({
      untrusted_text: z.string().max(cap * 2),
      truncated: z.literal(true).optional(),
    })
    .strict()
    .refine((u) => Array.from(u.untrusted_text).length <= cap, 'over its cap');

// ---------------------------------------------------------------------------
// Shared output pieces.

export const instantSchema = z.iso.datetime({ offset: true });
export const dateSchema = z.iso.date();
export const refSchema = z
  .object({
    type: z.enum(REF_TYPES),
    id: z.string().min(1).max(200),
    at: instantSchema.optional(),
  })
  .strict();

/** An instant written in the home zone with its offset: "2026-10-17T09:00:00+13:00". */
export function homeInstant(instant: Date, timeZone: string): string {
  const w = wallClockOf(instant, timeZone);
  // offsetAt is in milliseconds; New Zealand's offsets are whole minutes.
  const offset = Math.round(offsetAt(instant.getTime(), timeZone) / 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(w.year, 4)}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}:${p(w.second)}${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

/** The home date `now` falls on. */
export const todayOf = (ctx: ToolContext): IsoDate => isoDateInZone(ctx.now, ctx.timeZone);

/** Whether a date is inside what a tool may be asked about (today − 7 … today + 90). */
export function inAskableRange(date: IsoDate, today: IsoDate): boolean {
  return date >= addDays(today, -RANGE_PAST_DAYS) && date <= addDays(today, RANGE_FUTURE_DAYS);
}

/** A list cut to `limit`, with whether it was and how many there were. */
export function bounded<T>(list: readonly T[], limit: number) {
  return { items: list.slice(0, limit), count: list.length, truncated: list.length > limit };
}

/** Refs in order, each once. */
export function uniqueRefs(refs: readonly Ref[]): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const r of refs) {
    const k = `${r.type}|${r.id}|${r.at ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(
      r.at === undefined ? { type: r.type, id: r.id } : { type: r.type, id: r.id, at: r.at },
    );
  }
  return out;
}

/** A tool's own refusal, carried out of its read to the runner. */
export class ToolRefusal extends Error {
  constructor(readonly code: ToolErrorCode) {
    super(code);
    this.name = 'ToolRefusal';
  }
}

/**
 * One read tool. `read` reads once, as the actor; `present` minimises what
 * was read into the model's view, with at most `limit` items in any list,
 * and the refs of every record in it. The runner calls `present` again with
 * a smaller limit if the result would pass `MAX_RESULT_BYTES`, so a result
 * is cut, and says so, before it is ever sent (contract §7.4).
 */
export type ReadTool<I, R, O> = Readonly<{
  name: Exclude<ToolName, 'escalate'>;
  authority: 'read';
  kind: 'read';
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  summarise: (input: I) => TraceArgs;
  read: (ctx: ToolContext, input: I) => Promise<R>;
  present: (read: R, limit: number, ctx: ToolContext) => { data: O; refs: Ref[] };
}>;
