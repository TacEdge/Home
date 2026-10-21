import 'server-only';
import { capitalise, nameList, numberWord } from '@/domain/engines/day-facts';
import { asOfTime, bandWords, forecastAge, type Band } from '@/domain/engines/weather';
import {
  addDays,
  clockOf,
  isoDateInZone,
  longDate,
  softWhen,
  weekdayOf,
  type IsoDate,
} from '@/lib/dates';
import type { Ref } from '../tools/types';
import { LIST_MAX } from './catalogue';
import type { LedgerEntry, Ledger, Shape } from './ledger';
import { DEFAULT_SHOW, type RecordBlock, type ShowField } from './schema';

// HOME's renderer (M8 contract §8.2; owner amendment, ADR 0012 §46): every
// fact the adult reads is written here, by code, from one cited record's
// own fields, in natural NZ English. Pure: no database, no clock but the
// `now` it is given, no model text. What it guarantees by construction:
// - a block reads one object, the one that carried that ref in this
//   attempt's reads: no field of another record can reach it, so one
//   event's time, person or role is never rendered for another;
// - times and dates come from the record's own instants, in the home zone
//   (the tools wrote them with the home offset; DST-correct), as the
//   screens write them (`clockOf`, `longDate`); an all-day event never has
//   a time;
// - people and roles are the record's own (a person record is never
//   attached to an event; a conflict's commitments render from the
//   conflict's own data);
// - status is as recorded, in the Tasks screen's words: an open task reads
//   "to do", never "done";
// - titles, labels, notes and context are quoted recorded text, cleaned of
//   control and format characters and never interpreted ("Football
//   CANCELLED" is a title); a person's name reads plainly when it looks like
//   a name, and is quoted otherwise;
// - the copy is HOME's own, reused from M5–M7 where it exists (M7's band
//   words, temperatures and "Nothing is recorded …" clause; M5's number
//   words), and tested against the four forbidden lists.

export type RenderContext = { ledger: Ledger; now: Date; timeZone: string };
/** At most this many people (or regular-week entries) in one block. */
export { LIST_MAX };
/** A rendered block's longest text (content v2's bound). */
export const FACT_MAX_CHARS = 1500;
export type RenderFailure = 'fact.kind' | 'fact.field';
export type RenderedFact = {
  text: string;
  cites: Ref[];
  /** The home dates the block is about (for `{when}`). */
  dates: IsoDate[];
  /**
   * When the block shows forecast words, the fetch time of the forecast read
   * they are attributed to (the credit's "as of"; ADR 0012 §47).
   */
  forecastAt?: string;
};
export type RenderOutcome =
  ({ ok: true } & RenderedFact) | { ok: false; code: RenderFailure | 'cite.unknown' };

// ---------------------------------------------------------------------------
// Words.

/** Recorded text, cleaned: no control, format or private-use characters, one space, plain quotes inside. */
export function clean(s: string): string {
  return s
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029]/gu, ' ')
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

type Untrusted = { untrusted_text: string; truncated?: true };
const textOf = (v: unknown): Untrusted | null =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { untrusted_text?: unknown }).untrusted_text === 'string'
    ? (v as Untrusted)
    : null;

/** A recorded title, label, note or context text: quoted, as the record's own words. */
export function quoted(v: unknown): string {
  const t = textOf(v);
  if (!t) return '“”';
  return `“${clean(t.untrusted_text)}${t.truncated ? '…' : ''}”`;
}

/** A name that reads as a name: letters, spaces, hyphens and apostrophes, at most four words. */
const NAME_LIKE = /^[\p{L}][\p{L}'’-]*(?: [\p{L}][\p{L}'’-]*){0,3}$/u;

/** A person's recorded name: plain when it looks like a name, quoted otherwise. */
export function nameText(name: string): string {
  const c = clean(name);
  return c.length <= 40 && NAME_LIKE.test(c) ? c : `“${c}”`;
}

/** A sentence ends with its own stop (one inside a closing quote counts). */
const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]”?$/.test(t) ? t : `${t}.`;
};

/** The day, said from today: "today", "tomorrow", "yesterday", or "Saturday 17 October". */
export function dayWord(d: IsoDate, today: IsoDate): string {
  if (d === today) return 'today';
  if (d === addDays(today, 1)) return 'tomorrow';
  if (d === addDays(today, -1)) return 'yesterday';
  return longDate(d);
}

const weekOf = (today: IsoDate, offsetWeeks: number): IsoDate[] => {
  const monday = addDays(today, -weekdayOf(today) + offsetWeeks * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
};
const same = (a: readonly IsoDate[], b: readonly IsoDate[]) =>
  a.length === b.length && a.every((d, i) => d === b[i]);

/**
 * A set of days in words, for a scope or `{when}`: `bare` ("this weekend"),
 * `for` ("for this weekend") or `on` ("on Saturday 17 October").
 */
export function daysPhrase(
  input: Iterable<IsoDate>,
  today: IsoDate,
  style: 'bare' | 'for' | 'on',
): string {
  const days = [...new Set(input)].sort();
  if (days.length === 0) return '';
  const pre = (word: string, named: boolean) =>
    style === 'bare' ? word : style === 'for' ? `for ${word}` : named ? `on ${word}` : word;
  if (days.length === 1) {
    const d = days[0]!;
    const w = dayWord(d, today);
    return pre(w, w !== 'today' && w !== 'tomorrow' && w !== 'yesterday');
  }
  const thisWeek = weekOf(today, 0);
  const nextWeek = weekOf(today, 1);
  if (same(days, thisWeek.slice(5)) && today <= thisWeek[5]!) return pre('this weekend', false);
  if (same(days, nextWeek.slice(5))) return pre('next weekend', false);
  if (same(days, nextWeek)) return pre('next week', false);
  if (
    same(
      days,
      thisWeek.filter((d) => d >= today),
    ) &&
    days[0] === today
  )
    return pre('the rest of this week', false);
  const contiguous = days.every((d, i) => i === 0 || d === addDays(days[i - 1]!, 1));
  if (contiguous) {
    const span = `${dayWord(days[0]!, today)} to ${dayWord(days.at(-1)!, today)}`;
    return style === 'bare' ? span : `from ${span}`;
  }
  const list = nameList(days.map((d) => dayWord(d, today)));
  return days.length > 4 ? (style === 'bare' ? 'those days' : `on those days`) : pre(list, true);
}

const clock = (iso: unknown, tz: string): string | null => {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? clockOf(new Date(t), tz) : null;
};
const dateOf = (iso: unknown, tz: string): IsoDate | null => {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? isoDateInZone(new Date(t), tz) : null;
};

/** "15:30–16:15 today", or across midnight "22:00 Friday 16 October to 01:00 tomorrow". */
function whenOf(
  start: unknown,
  end: unknown,
  tz: string,
  today: IsoDate,
): { text: string; dates: IsoDate[] } | null {
  const s = clock(start, tz);
  const sd = dateOf(start, tz);
  if (!s || !sd) return null;
  const e = clock(end, tz);
  const ed = dateOf(end, tz);
  if (!e || !ed) return { text: `${dayWord(sd, today)}, from ${s}`, dates: [sd] };
  if (ed === sd || (e === '00:00' && ed === addDays(sd, 1)))
    return { text: `${dayWord(sd, today)}, ${s}–${e}`, dates: [sd] };
  return {
    text: `${dayWord(sd, today)} ${s} to ${dayWord(ed, today)} ${e}`,
    dates: [sd, ed],
  };
}

/** M7's temperature words (src/app/_insights/weather/weather-today.tsx, held equal by a parity test). */
export function temperatureWords(lowC: number, highC: number): string {
  const low = Math.round(lowC);
  const high = Math.round(highC);
  return low === high ? `Around ${low}°C.` : `Between ${low}°C and ${high}°C.`;
}

/** A duration in words: "about 30 minutes", "about three hours", "about 1 hour 30 minutes". */
function estimateWords(minutes: number): string {
  if (minutes < 60) return `about ${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = `${numberWord(h)} hour${h === 1 ? '' : 's'}`;
  return m === 0 ? `about ${hours}` : `about ${hours} ${m} minutes`;
}

const NEED_WORDS: Readonly<Record<string, string>> = {
  dry_weather: 'dry weather',
  daylight: 'daylight',
  two_people: 'two people',
  shops_open: 'shops open',
};
/** The Tasks screen's status labels, lower case (src/app/(home)/tasks/copy.ts, held equal by a parity test). */
const TASK_STATUS: Readonly<Record<string, string>> = {
  open: 'to do',
  done: 'done',
  dropped: 'dropped',
};
const PROJECT_STATUS: Readonly<Record<string, string>> = {
  idea: 'an idea',
  active: 'active',
  paused: 'paused',
  done: 'done',
};
const CALENDAR_STATUS: Readonly<Record<string, string>> = {
  healthy: 'is up to date',
  stale: 'hasn’t updated for over a day',
  failed: 'didn’t update the last time HOME tried',
  never: 'hasn’t updated yet',
};
const ROLE: Readonly<Record<string, string>> = {
  attending: 'attending',
  responsible: 'responsible for',
};

// ---------------------------------------------------------------------------
// Records.

/** The entry to render a block from: the richest shape this record was read in. */
const PREFERENCE: Readonly<Partial<Record<Ref['type'], readonly Shape[]>>> = {
  event: ['agenda_event', 'commitment', 'regular', 'title_only'],
  task: ['task', 'task_scheduled', 'task_due', 'todo', 'title_only'],
  project: ['project_full', 'project_list', 'project_target', 'title_only'],
  note: ['note'],
  conflict: ['conflict'],
  insight: ['insight'],
  gap: ['gap'],
  forecast: ['forecast'],
  calendar: ['calendar'],
  context: ['context'],
};

function pick(entries: readonly LedgerEntry[], type: Ref['type']): LedgerEntry | null {
  for (const shape of PREFERENCE[type] ?? [])
    for (const e of entries) if (e.shape === shape && e.record) return e;
  return null;
}

/**
 * The entry a block is rendered from (for a person: their own record, the
 * richest first), for the checks over what a block shows (Kev's view).
 */
export function pickEntry(entries: readonly LedgerEntry[], type: Ref['type']): LedgerEntry | null {
  if (type !== 'person') return pick(entries, type);
  for (const shape of ['people_person', 'birthday', 'bundle_person'] as const)
    for (const e of entries) if (e.shape === shape && e.record) return e;
  return null;
}

type Ctx = RenderContext & { today: IsoDate; explicit: ReadonlySet<ShowField> };
type Out = { text: string; dates: IsoDate[]; forecastAt?: string } | RenderFailure;

const personName = (ctx: Ctx, id: string, fallback?: unknown): string => {
  const n = ctx.ledger.namesById.get(id) ?? textOf(fallback)?.untrusted_text;
  return n ? nameText(n) : 'someone you can see';
};

function event(e: LedgerEntry, show: readonly ShowField[], ctx: Ctx): Out {
  const o = e.record!;
  const tz = ctx.timeZone;
  const title = quoted(o.title);
  const atDate = e.ref.at ? dateOf(e.ref.at, tz) : null;
  let when: { text: string; dates: IsoDate[] } | null = null;
  if (e.shape === 'agenda_event') {
    if (o.all_day === true) {
      const start = atDate ?? e.day ?? null;
      if (!start) return 'fact.kind';
      const days = typeof o.days === 'number' && o.days > 1 ? o.days : 1;
      const end = addDays(start, days - 1);
      when =
        days > 1
          ? {
              text: `all day, ${dayWord(start, ctx.today)} to ${dayWord(end, ctx.today)}`,
              dates: Array.from({ length: days }, (_, i) => addDays(start, i)),
            }
          : { text: `${dayWord(start, ctx.today)}, all day`, dates: [start] };
    } else when = whenOf(o.start, o.end, tz, ctx.today);
  } else if (e.shape === 'commitment') {
    when = whenOf(o.start, o.end, tz, ctx.today);
  } else if (e.shape === 'regular') {
    const wd = typeof o.weekday === 'string' ? o.weekday : '';
    const every = o.cadence === 'fortnightly' ? 'every second' : 'every';
    const t = typeof o.time === 'string' ? `, ${o.time}` : ', all day';
    when = { text: `${every} ${wd}${t}`, dates: [] };
  } else if (atDate) {
    when = { text: dayWord(atDate, ctx.today), dates: [atDate] };
  }
  let text = when ? `${title}: ${when.text}.` : `${title} (an event).`;
  if (show.includes('people')) {
    if (e.shape !== 'agenda_event') {
      if (ctx.explicit.has('people')) return 'fact.field';
    } else {
      const people = (Array.isArray(o.people) ? o.people : []) as {
        ref?: Ref;
        name?: unknown;
        role?: string;
      }[];
      if (people.length > 0) {
        const named = people
          .slice(0, LIST_MAX)
          .map((p) => `${personName(ctx, p.ref?.id ?? '', p.name)} ${p.role ?? ''}`.trim());
        const more = people.length - LIST_MAX;
        if (more > 0) named.push(`${numberWord(more)} more you can see`);
        text += ` ${capitalise(named.join(', '))}.`;
      } else if (ctx.explicit.has('people')) text += ' No one you can see is recorded on it.';
    }
  }
  return { text, dates: when?.dates ?? [] };
}

function task(e: LedgerEntry, show: readonly ShowField[], ctx: Ctx): Out {
  const o = e.record!;
  const tz = ctx.timeZone;
  const parts: string[] = [];
  const dates: IsoDate[] = [];
  const avail: Readonly<Partial<Record<Shape, readonly ShowField[]>>> = {
    task: ['status', 'due', 'scheduled', 'estimate', 'needs', 'assignee', 'project'],
    task_due: ['due'],
    task_scheduled: ['scheduled'],
    todo: ['due', 'scheduled'],
    title_only: [],
  };
  for (const f of show) {
    if (!(avail[e.shape] ?? []).includes(f)) {
      if (ctx.explicit.has(f)) return 'fact.field';
      continue;
    }
    switch (f) {
      case 'status':
        parts.push(TASK_STATUS[String(o.status)] ?? String(o.status));
        break;
      case 'due': {
        const due = typeof o.due === 'string' ? (o.due as IsoDate) : null;
        if (due) {
          dates.push(due);
          parts.push(
            due < ctx.today
              ? `was due ${dayWord(due, ctx.today)}`
              : `due ${dayWord(due, ctx.today)}`,
          );
        } else if (e.shape === 'task' || ctx.explicit.has('due')) parts.push('no due date');
        break;
      }
      case 'scheduled': {
        const s =
          e.shape === 'task'
            ? (o.scheduled as { start?: unknown; end?: unknown } | null)
            : e.shape === 'task_scheduled'
              ? { start: o.start, end: o.end }
              : o.scheduled_start
                ? { start: o.scheduled_start, end: undefined }
                : null;
        const w = s ? whenOf(s.start, s.end, tz, ctx.today) : null;
        if (w) {
          dates.push(...w.dates);
          parts.push(`scheduled ${w.text}`);
        } else if (ctx.explicit.has('scheduled')) parts.push('not scheduled');
        break;
      }
      case 'estimate':
        parts.push(
          typeof o.estimate_minutes === 'number'
            ? estimateWords(o.estimate_minutes)
            : 'no estimate recorded',
        );
        break;
      case 'needs': {
        const needs = (Array.isArray(o.needs) ? o.needs : []).map((n) => NEED_WORDS[String(n)]);
        parts.push(
          needs.length > 0
            ? `in ${nameList(needs.filter((n): n is string => !!n))}`
            : 'no conditions recorded',
        );
        break;
      }
      case 'assignee': {
        const a = o.assignee as { ref?: Ref; name?: unknown } | null;
        parts.push(
          a?.ref
            ? `assigned to ${personName(ctx, a.ref.id, a.name)}`
            : 'not assigned to anyone you can see',
        );
        break;
      }
      case 'project': {
        const p = o.project as { title?: unknown } | null;
        if (p) parts.push(`in ${quoted(p.title)}`);
        else if (ctx.explicit.has('project')) parts.push('not in a project you can see');
        break;
      }
    }
  }
  const title = quoted(o.title);
  return { text: parts.length > 0 ? `${title}: ${parts.join(', ')}.` : `${title}.`, dates };
}

function project(e: LedgerEntry, show: readonly ShowField[], ctx: Ctx): Out {
  const o = e.record!;
  const parts: string[] = [];
  const dates: IsoDate[] = [];
  const avail: Readonly<Partial<Record<Shape, readonly ShowField[]>>> = {
    project_list: ['status', 'target', 'open_tasks'],
    project_full: ['status', 'target', 'open_tasks', 'summary'],
    project_target: ['target'],
    title_only: [],
  };
  for (const f of show) {
    if (!(avail[e.shape] ?? []).includes(f)) {
      if (ctx.explicit.has(f)) return 'fact.field';
      continue;
    }
    switch (f) {
      case 'status':
        parts.push(PROJECT_STATUS[String(o.status)] ?? String(o.status));
        break;
      case 'target': {
        const t = (e.shape === 'project_target' ? o.date : o.target_date) as IsoDate | null;
        if (typeof t === 'string') {
          dates.push(t);
          parts.push(`target ${dayWord(t, ctx.today)}`);
        } else parts.push('no target date');
        break;
      }
      case 'open_tasks': {
        // Counted by HOME in the read (list or one project): never assumed.
        if (typeof o.open_tasks !== 'number') return 'fact.field';
        const n = o.open_tasks;
        parts.push(n === 0 ? 'no open tasks' : `${numberWord(n)} open task${n === 1 ? '' : 's'}`);
        break;
      }
      case 'summary':
        parts.push(o.summary ? `summary ${quoted(o.summary)}` : 'no summary');
        break;
    }
  }
  const title = quoted(o.title);
  return { text: parts.length > 0 ? `${title}: ${parts.join(', ')}.` : `${title}.`, dates };
}

function person(
  entries: readonly LedgerEntry[],
  id: string,
  show: readonly ShowField[],
  ctx: Ctx,
): Out {
  const of = (shape: Shape) => entries.find((e) => e.shape === shape && e.record)?.record ?? null;
  const own = [of('people_person'), of('bundle_person')].filter(Boolean) as Record<
    string,
    unknown
  >[];
  const named = entries.find((e) => e.record && e.shape !== 'person_on')?.record;
  const name = personName(ctx, id, named?.name ?? named?.title);
  if (!ctx.ledger.namesById.has(id) && !named) return 'fact.kind';
  const out: string[] = [];
  const dates: IsoDate[] = [];
  for (const f of show) {
    switch (f) {
      case 'age': {
        const rec = own.find((r) => 'age' in r);
        if (!rec) {
          if (ctx.explicit.has(f)) return 'fact.field';
          break;
        }
        out.push(
          typeof rec.age === 'number'
            ? `${name} is ${rec.age}.`
            : `HOME doesn’t have ${name}’s age.`,
        );
        break;
      }
      case 'birthday': {
        const pp = of('people_person');
        const bd = entries.find((e) => e.shape === 'birthday' && e.record && e.day);
        const next = pp
          ? (pp.next_birthday as { date?: string; age?: number } | null)
          : bd
            ? { date: bd.day, age: bd.record!.age as number }
            : undefined;
        if (next === undefined) {
          if (ctx.explicit.has(f)) return 'fact.field';
          break;
        }
        if (next && typeof next.date === 'string') {
          dates.push(next.date as IsoDate);
          const on = dayWord(next.date as IsoDate, ctx.today);
          const day = /^(today|tomorrow)$/.test(on) ? on : `on ${on}`;
          out.push(`${name} turns ${next.age} ${day}.`);
        } else out.push(`HOME doesn’t have ${name}’s birthday.`);
        break;
      }
      case 'relationship': {
        const b = of('bundle_person');
        if (!b) {
          if (ctx.explicit.has(f)) return 'fact.field';
          break;
        }
        out.push(
          b.relationship
            ? `${name}, recorded as ${quoted(b.relationship)}.`
            : `No relationship is recorded for ${name}.`,
        );
        break;
      }
      case 'regular_week': {
        const pp = of('people_person');
        if (!pp) {
          if (ctx.explicit.has(f)) return 'fact.field';
          break;
        }
        const week = (Array.isArray(pp.regular_week) ? pp.regular_week : []).slice(
          0,
          LIST_MAX,
        ) as Record<string, unknown>[];
        out.push(
          week.length === 0
            ? `Nothing is recorded as ${name}’s regular week.`
            : `${name}’s regular week: ${week
                .map(
                  (w) =>
                    `${quoted(w.title)} ${w.cadence === 'fortnightly' ? 'every second' : 'every'} ${String(w.weekday)}${typeof w.time === 'string' ? ` at ${w.time}` : ''}`,
                )
                .join('; ')}.`,
        );
        break;
      }
      case 'stage_note': {
        const pp = of('people_person');
        if (!pp) {
          if (ctx.explicit.has(f)) return 'fact.field';
          break;
        }
        out.push(
          pp.stage_note
            ? `Stage note for ${name}: ${quoted(pp.stage_note)}.`
            : `No stage note is recorded for ${name}.`,
        );
        break;
      }
    }
  }
  return { text: out.length > 0 ? out.join(' ') : `${name}.`, dates };
}

function conflict(e: LedgerEntry, ctx: Ctx): Out {
  const o = e.record!;
  const tz = ctx.timeZone;
  const when = typeof o.when === 'string' ? (o.when as IsoDate) : null;
  const who = o.person as { ref?: Ref; name?: unknown } | undefined;
  const cs = (Array.isArray(o.commitments) ? o.commitments : []) as Record<string, unknown>[];
  const overlap = o.overlap as { from?: unknown; to?: unknown } | undefined;
  if (!when || !who?.ref || cs.length !== 2 || !overlap) return 'fact.kind';
  const side = (c: Record<string, unknown>) => {
    const s = clock(c.start, tz);
    const en = clock(c.end, tz);
    const sd = dateOf(c.start, tz);
    const at = sd && sd !== when ? `${dayWord(sd, ctx.today)} ` : '';
    return `${ROLE[String(c.role)] ?? 'on'} ${quoted(c.title)} (${at}${s}–${en})`;
  };
  const name = personName(ctx, who.ref.id, who.name);
  const text = `${capitalise(dayWord(when, ctx.today))}: ${name} is ${side(cs[0]!)} and ${side(cs[1]!)}. They overlap from ${clock(overlap.from, tz)} to ${clock(overlap.to, tz)}.`;
  return { text, dates: [when] };
}

function gap(e: LedgerEntry, show: readonly ShowField[], ctx: Ctx): Out {
  const o = e.record!;
  const tz = ctx.timeZone;
  const date = typeof o.date === 'string' ? (o.date as IsoDate) : null;
  const scope = e.context.gapScope;
  if (!date || !scope) return 'fact.kind';
  const who = scope === 'household' ? 'the household' : personName(ctx, scope);
  const d = dayWord(date, ctx.today);
  const day = /^(today|tomorrow|yesterday)$/.test(d) ? d : `on ${d}`;
  // M7's clause (src/domain/engines/insights/openings.ts `nothingClause`), with the scope.
  let text = `Nothing is recorded for ${who} ${day}, ${clock(o.from, tz)}–${clock(o.to, tz)}`;
  if (e.context.gapCoverage === 'partial') text += ', as far as HOME knows';
  text += '.';
  if (show.includes('neighbours')) {
    const before = o.before as { title?: unknown } | null;
    const after = o.after as { title?: unknown } | null;
    if (before && after)
      text += ` That’s between ${quoted(before.title)} and ${quoted(after.title)}.`;
    else if (before) text += ` That’s after ${quoted(before.title)}.`;
    else if (after) text += ` That’s before ${quoted(after.title)}.`;
  }
  // Forecast words only with their attribution (owner decision, ADR 0012
  // §47): a gap carries its band but no fetch time, so the band is shown
  // only beside a usable forecast read for that day in this attempt, whose
  // fetch time the credit carries; an older one (M7's 3–12 hours) begins
  // "As of {time}, ". No band, or no such read: no forecast words at all
  // (never "no forecast" for a forecast HOME has but cannot attribute).
  if (show.includes('forecast')) {
    const read = forecastReadFor(ctx.ledger, date, ctx.now);
    if (typeof o.forecast_band !== 'string' || !read) return 'fact.field';
    const band = bandWords(o.forecast_band as Band).toLowerCase();
    text +=
      forecastAge(read.at, ctx.now) === 'older'
        ? ` As of ${asOfTime(read.at, ctx.now, ctx.timeZone)}, the forecast for then: ${band}.`
        : ` The forecast for then: ${band}.`;
    return { text, dates: [date], forecastAt: read.iso };
  }
  return { text, dates: [date] };
}

/**
 * The forecast read that attributes forecast words for a home date: the
 * first forecast day for that date this attempt's `get_weather` returned,
 * with a fetch time still usable at `now` (M7 §5.1: not over 12 hours).
 */
export function forecastReadFor(
  ledger: Ledger,
  date: IsoDate,
  now: Date,
): { at: Date; iso: string } | null {
  for (const e of ledger.entries) {
    if (e.source !== 'get_weather' || e.shape !== 'forecast' || !e.dates.has(date)) continue;
    const at = forecastFetchedAt(e);
    if (at && forecastAge(at, now) !== 'unusable') return { at, iso: e.context.fetchedAt! };
  }
  return null;
}

/** An opening's own "as of" time, as M7 wrote it ("as of 06:55", "as of yesterday 22:03"). */
const OPENING_AS_OF = /\bas of ((?:yesterday )?\d{2}:\d{2})\b/g;

/**
 * An insight's sentence, with its forecast words attributed (owner decision,
 * ADR 0012 §47): an opening (`open_window.*`) that speaks of the forecast is
 * shown only beside a usable forecast read for its day in this attempt, and
 * only when the "as of" time M7 wrote in it is that read's own. Insights
 * carry no fetch time of their own, and Package 2's schema is unchanged.
 */
function insightBlock(e: LedgerEntry, ctx: Ctx): Out {
  const o = e.record!;
  const t = textOf(o.text);
  if (!t) return 'fact.kind';
  const when = typeof o.when === 'string' ? (o.when as IsoDate) : null;
  const text = `Worth knowing: ${sentence(clean(t.untrusted_text))}`;
  const dates = when ? [when] : [];
  if (!isOpening(e) || !/\bforecast\b/i.test(t.untrusted_text)) return { text, dates };
  const read = when ? forecastReadFor(ctx.ledger, when, ctx.now) : null;
  const asOf = [...t.untrusted_text.matchAll(OPENING_AS_OF)].at(-1)?.[1];
  if (!read || asOf !== asOfTime(read.at, ctx.now, ctx.timeZone)) return 'fact.field';
  return { text, dates, forecastAt: read.iso };
}

/** An opening insight (M7's `open_window.*`): a stretch where nothing is recorded. */
export const isOpening = (e: LedgerEntry | null): boolean =>
  e?.shape === 'insight' && /^open_window\./.test(String(e.record?.rule));

function forecast(e: LedgerEntry, show: readonly ShowField[], ctx: Ctx): Out {
  const o = e.record!;
  const date = typeof o.date === 'string' ? (o.date as IsoDate) : null;
  if (!date) return 'fact.kind';
  const out: string[] = [];
  for (const f of show) {
    switch (f) {
      case 'phrase':
        out.push(sentence(clean(String(o.phrase))));
        break;
      case 'temperature':
        if (typeof o.low_c === 'number' && typeof o.high_c === 'number')
          out.push(temperatureWords(o.low_c, o.high_c));
        else if (ctx.explicit.has(f)) out.push('No temperatures in the forecast.');
        break;
      case 'gust':
        if (typeof o.max_gust_kmh === 'number')
          out.push(`Gusts up to ${Math.round(o.max_gust_kmh)} km/h.`);
        else if (ctx.explicit.has(f)) out.push('No gusts in the forecast.');
        break;
      case 'parts': {
        const parts = (Array.isArray(o.parts) ? o.parts : []) as { part?: string; band?: Band }[];
        for (const p of parts)
          if (p.part && p.band)
            out.push(`${capitalise(p.part)}: ${bandWords(p.band).toLowerCase()}.`);
        break;
      }
    }
  }
  const day = `${dayWord(date, ctx.today)}: ${out.join(' ')}`.trim();
  // M7's freshness rule (contract §5.1; src/domain/engines/weather.ts): an
  // older forecast (3 to 12 hours) begins "As of {time}, ", its own fetch
  // time against this answer's `now`.
  const at = forecastFetchedAt(e);
  const older = at !== null && forecastAge(at, ctx.now) === 'older';
  return {
    text: older ? `As of ${asOfTime(at, ctx.now, ctx.timeZone)}, ${day}` : capitalise(day),
    dates: [date],
    ...(at ? { forecastAt: e.context.fetchedAt! } : {}),
  };
}

/** A forecast day's fetch time, from the read that returned it (null when it did not say). */
export function forecastFetchedAt(e: LedgerEntry): Date | null {
  const t = Date.parse(e.context.fetchedAt ?? '');
  return Number.isFinite(t) ? new Date(t) : null;
}

function calendarBlock(e: LedgerEntry, ctx: Ctx): Out {
  const o = e.record!;
  const last =
    typeof o.last_success === 'string' && Number.isFinite(Date.parse(o.last_success))
      ? ` Last updated ${softWhen(new Date(o.last_success), ctx.now, ctx.timeZone)}.`
      : '';
  return {
    text: `The calendar ${quoted(o.label)} ${CALENDAR_STATUS[String(o.status)] ?? 'is in HOME'}.${last}`,
    dates: [],
  };
}

function contextBlock(e: LedgerEntry, ctx: Ctx): Out {
  const o = e.record!;
  const subject = o.subject as { type?: string; ref?: Ref | null } | undefined;
  let about = 'the household';
  if (subject?.type === 'person' && subject.ref) about = personName(ctx, subject.ref.id);
  else if (subject?.type === 'project' && subject.ref) {
    const p = ctx.ledger.resolve(subject.ref).find((x) => x.record && 'title' in x.record);
    about = p ? quoted(p.record!.title) : 'a project';
  }
  const confirmed =
    typeof o.last_confirmed === 'string'
      ? ` Last confirmed ${dayWord(o.last_confirmed as IsoDate, ctx.today)}.`
      : '';
  const stale = o.stale === true ? ' It may no longer be true.' : '';
  return {
    text: `What Kev knows about ${about}: ${sentence(quoted(o.content))}${confirmed}${stale}`,
    dates: [],
  };
}

/**
 * One record block, rendered from the record's own fields (see the header).
 * Fails `cite.unknown` (not in this attempt's ledger), `fact.kind` (the
 * block's kind is not the record's type, or this attempt read no object of
 * that record it can render from) or `fact.field` (a field asked for that
 * the object rendered from does not carry).
 */
export function renderRecord(block: RecordBlock, ctx: RenderContext): RenderOutcome {
  const { ledger } = ctx;
  if (block.kind !== block.ref.type) return { ok: false, code: 'fact.kind' };
  const entries = ledger.resolve(block.ref);
  if (entries.length === 0) return { ok: false, code: 'cite.unknown' };
  // One occurrence: an event cited without its `at` must not be ambiguous.
  if (block.ref.type === 'event' && new Set(entries.map((e) => e.ref.at ?? '')).size > 1)
    return { ok: false, code: 'fact.kind' };
  const today = isoDateInZone(ctx.now, ctx.timeZone);
  const show = block.show.length > 0 ? block.show : DEFAULT_SHOW[block.kind];
  const c: Ctx = { ...ctx, today, explicit: new Set(block.show) };
  let out: Out;
  if (block.kind === 'person') out = person(entries, block.ref.id, show, c);
  else {
    const e = pick(entries, block.kind);
    if (!e) return { ok: false, code: 'fact.kind' };
    switch (block.kind) {
      case 'event':
        out = event(e, show, c);
        break;
      case 'task':
        out = task(e, show, c);
        break;
      case 'project':
        out = project(e, show, c);
        break;
      case 'note':
        out = { text: `Note: ${sentence(quoted(e.record!.body))}`, dates: [] };
        break;
      case 'conflict':
        out = conflict(e, c);
        break;
      case 'insight':
        out = insightBlock(e, c);
        break;
      case 'gap':
        out = gap(e, show, c);
        break;
      case 'forecast':
        out = forecast(e, show, c);
        break;
      case 'calendar':
        out = calendarBlock(e, c);
        break;
      case 'context':
        out = contextBlock(e, c);
        break;
    }
  }
  if (typeof out === 'string') return { ok: false, code: out };
  if (out.text.length > FACT_MAX_CHARS) return { ok: false, code: 'fact.field' };
  const ref = entries[0]!.ref;
  return {
    ok: true,
    text: out.text,
    cites: [ref],
    dates: out.dates,
    ...(out.forecastAt ? { forecastAt: out.forecastAt } : {}),
  };
}
