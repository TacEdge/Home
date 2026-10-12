import type { ForecastHour } from '@/domain/weather/provider';
import { addDays, clockOf, daysBetween, isoDateInZone, weekdayOf, type IsoDate } from '@/lib/dates';
import { capitalise, numberWord, WEEKDAYS, type Fact } from '../day-facts';
import type { Daylight } from '../daylight';
import { HOUSEHOLD, type CommitmentFact, type Coverage, type Gap, type Gaps } from '../gaps';
import { PLANNING_FROM, PLANNING_TO } from '../planning';
import {
  asOfTime,
  atHome,
  bandOf,
  forecastAge,
  HORIZON_DAYS,
  hoursCovering,
  windyOf,
  type Band,
  type Forecast,
} from '../weather';

// Openings: the `open_window` insight family (M7 Package 3; contract
// §5.6–§5.8; ADR 0011 §29–§35). An opening is a household gap on a weekend
// day, within daylight when HOME knows it, of two hours or more, stated as
// exactly that: "Nothing is recorded for the household on Sunday,
// 08:00–19:30." Sometimes with the forecast for it; sometimes matched to a
// waiting task the family recorded with an estimate and a need for dry
// weather or daylight. Never "free", never advice, never a judgement of the
// time or the weather (§5.8's lists).
//
// Pure: every input is injected (the gap engine's household gaps and
// coverage, the cached forecast and its fetch time, daylight per date, the
// reader's own authorised tasks and projects, `now`, the zone and the
// surface's window). No I/O, no clock, stable sorts with explicit
// tie-breaks. Requirements come only from the recorded `needs` and
// `estimate_minutes`; a task's title, notes, domain or project title are
// never read for meaning (the title is said as recorded, nothing more).
//
//   open_window.plain  the longest candidate of a weekend day, when no task
//                      matches; the forecast adds a clause when it is usable
//                      and banded, and never decides whether it exists;
//   open_window.task   the longest candidate a waiting task matches, naming
//                      the first matching task; the others are listed.
//
// Identity (§5.7): `open_window:household:{date}:{HHMM}-{HHMM}`, with
// `:task:{taskId}` for a task opening, from the candidate's bounds before
// they are clipped to `now`. Nothing else: no forecast value, fetch time,
// viewing date or text, so a refreshed forecast keeps a plain opening's key
// (and any response on it), and midnight changes nothing.

// ---- Constants (contract §5.6–§5.8; changed only by an ADR amendment) ----

/** The shortest opening (D10), measured on the shown span (clipped to `now` on today). */
export const OPENING_MIN_MINUTES = 120;

export const OPENING_RULES = ['open_window.plain', 'open_window.task'] as const;
export type OpeningRule = (typeof OPENING_RULES)[number];

/** How many home days from today each surface looks for openings in (§5.8): today and tomorrow; today … today + 6. */
export const OPENING_DAYS = Object.freeze({ today: 2, forward: 7 } as const);
/** How many openings each surface lists (D15): Today one, Forward Week two. */
export const OPENINGS_SHOWN = Object.freeze({ today: 1, forward: 2 } as const);

/** The only recorded needs HOME has a rule for (ADR 0011 §30). */
export const MATCHED_NEEDS = Object.freeze(['dry_weather', 'daylight'] as const);

/** Every opening's Why ends with this fixed sentence (ADR 0011 §6). */
export const OPENING_LIMIT =
  "This is only what HOME has recorded that you can see. It isn't a check of anyone's plans.";

/** Saturday and Sunday (`weekdayOf`: 0 = Monday … 6 = Sunday), D14. */
const WEEKEND = new Set([5, 6]);
const MINUTE = 60_000;
const HOUR = 3_600_000;

// ---- Inputs and outputs -------------------------------------------------

/** One of the reader's own open tasks, as the authorised read gave it. */
export type OpeningTask = {
  id: string;
  title: string;
  status: string;
  dueDate: IsoDate | null;
  estimateMinutes: number | null;
  needs: readonly string[];
  projectId: string | null;
  scheduledStartsAt: Date | null;
  scheduledEndsAt: Date | null;
};

/** One of the reader's projects: only its status is read. */
export type OpeningProject = { id: string; status: string };

/**
 * The project statuses a matched task's project may have: every recorded
 * status but `paused` and `done`. An unknown status is not live.
 */
const LIVE_PROJECT_STATUSES: ReadonlySet<string> = new Set(['idea', 'active']);

export type OpeningsInput = {
  now: Date;
  /** The home zone. */
  timeZone: string;
  /** The home dates this surface looks across, inclusive (§5.8). */
  window: { from: IsoDate; to: IsoDate };
  /** The gap engine's output (the household scope) over at least the window. */
  gaps: Gaps;
  /** The cached forecast, if any; its freshness is checked here (§5.1). */
  forecast: Forecast | null;
  /** Daylight for the window's dates, when a location is configured (none otherwise). */
  daylight: readonly Daylight[];
  /** The reader's open tasks, read as the reader (visibility and archive already applied). */
  tasks: readonly OpeningTask[];
  /**
   * The reader's projects, read as the reader (visibility and archive already
   * applied). A task whose project is not here is not matched.
   */
  projects: readonly OpeningProject[];
};

/** What bounds an opening at each end: a recorded commitment, the planning hours, or daylight. */
export type OpeningEdge = 'commitment' | 'planning' | 'daylight';

/** The forecast an opening cites (§4.5): its hours, when it was fetched, and what they say. */
export type OpeningForecast = {
  /** The hours described, `[from, to)`. */
  from: Date;
  to: Date;
  fetchedAt: Date;
  age: 'fresh' | 'older';
  /** `span`: the opening's own hours (today and tomorrow); `day`: the day's planning hours (days 2–6). */
  over: 'span' | 'day';
  band: Band;
  windy: boolean;
  /** The highest chance of rain in those hours (%). */
  maxProbability: number;
  /** Rain over those hours (mm, to 0.1). */
  totalMm: number;
  /** The strongest gust, when every hour gave one (km/h). */
  maxGustKmh: number | null;
};

/** A task as an opening names it: its id and the recorded fields the match read. */
export type OpeningTaskRef = { id: string; estimateMinutes: number; needs: string[] };

export type Opening = {
  key: string;
  rule: OpeningRule;
  date: IsoDate;
  /** Days from today: 0 today, 1 tomorrow, then 2–6. */
  offset: number;
  /** The identity: the candidate's bounds before clipping to `now`. */
  stretch: { from: Date; to: Date };
  /** What is said: on today, from `now` once the stretch has begun. */
  shown: { from: Date; to: Date };
  /** The household gap it lies in, with the commitments either side and the events named in Why. */
  gap: {
    key: string;
    stretch: { from: Date; to: Date };
    before: CommitmentFact | null;
    after: CommitmentFact | null;
    unblocking: CommitmentFact[];
  };
  edges: { from: OpeningEdge; to: OpeningEdge };
  /** The day's daylight, when known (with sunrise and sunset for Why). */
  daylight: Daylight | null;
  /** The household people it is about: the ones the reader can see. */
  people: string[];
  coverage: Coverage;
  /** Coverage `partial`: the sentence says ", as far as HOME knows". */
  qualified: boolean;
  /** The forecast cited, when usable and banded; null otherwise. */
  forecast: OpeningForecast | null;
  /** The task named, for a task opening. */
  task: OpeningTaskRef | null;
  /** The other tasks that matched the same stretch, in the same order. */
  others: OpeningTaskRef[];
  /** The fixed limit sentence. */
  limit: string;
  text: string;
  facts: Fact[];
};

// ---- Words ---------------------------------------------------------------

/** "{estimate}" (§5.6): whole hours in words up to ten ("three hours"), otherwise minutes ("90 minutes"). */
export function estimateWords(minutes: number): string {
  const hours = minutes / 60;
  if (Number.isInteger(hours) && hours >= 1 && hours <= 10)
    return `${numberWord(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** "dry weather and daylight", "dry weather" or "daylight": the recorded needs, in words. */
export function needsWords(needs: readonly string[]): string {
  const dry = needs.includes('dry_weather');
  const daylight = needs.includes('daylight');
  return dry && daylight ? 'dry weather and daylight' : dry ? 'dry weather' : 'daylight';
}

const VERB: Record<Band, string> = {
  dry: 'looks dry',
  showers: 'has showers possible',
  rain: 'has rain likely',
};

const hhmm = (at: Date, timeZone: string) => clockOf(at, timeZone).replace(':', '');

/** "today", "tomorrow", "on Saturday": the day an opening is on, from today. */
const dayWords = (offset: number, date: IsoDate) =>
  offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : `on ${WEEKDAYS[weekdayOf(date)]}`;

/**
 * The "Nothing is recorded" clause, with no full stop: its day and times, or,
 * on today once the stretch has begun, "for the rest of today, until …";
 * qualified with ", as far as HOME knows" when coverage is partial.
 */
function nothingClause(o: {
  offset: number;
  date: IsoDate;
  stretch: { from: Date; to: Date };
  shown: { from: Date; to: Date };
  qualified: boolean;
  timeZone: string;
}): string {
  const to = clockOf(o.shown.to, o.timeZone);
  const begun = o.offset === 0 && o.shown.from.getTime() > o.stretch.from.getTime();
  const base = begun
    ? `Nothing is recorded for the household for the rest of today, until ${to}`
    : `Nothing is recorded for the household ${dayWords(o.offset, o.date)}, ${clockOf(o.shown.from, o.timeZone)}–${to}`;
  return o.qualified ? `${base}, as far as HOME knows` : base;
}

/**
 * The weather clause, lower case, with no full stop: today and tomorrow,
 * "the forecast as of 06:55 looks dry then"; days 2–6, "the forecast for
 * Saturday as of 06:55 looks dry"; ", and windy" when it applies.
 */
function weatherClause(
  f: OpeningForecast,
  offset: number,
  date: IsoDate,
  now: Date,
  timeZone: string,
): string {
  const time = asOfTime(f.fetchedAt, now, timeZone);
  const windy = f.windy ? ', and windy' : '';
  return offset <= 1
    ? `the forecast as of ${time} ${VERB[f.band]} then${windy}`
    : `the forecast for ${WEEKDAYS[weekdayOf(date)]} as of ${time} ${VERB[f.band]}${windy}`;
}

// ---- The forecast over a span -------------------------------------------

const floorHour = (t: number) => Math.floor(t / HOUR) * HOUR;
const ceilHour = (t: number) => Math.ceil(t / HOUR) * HOUR;

/**
 * What the forecast says for an opening, or null (no words, no dry match):
 * only a usable forecast (§5.1: not over 12 hours old), only today to
 * today + 6, and only when every hour described is covered and has a band.
 * Today and tomorrow: the hours the shown span touches; days 2–6: the day's
 * planning hours (no hour-precise timing beyond tomorrow, D6).
 */
function forecastFor(
  forecast: Forecast | null,
  date: IsoDate,
  offset: number,
  shown: { from: Date; to: Date },
  now: Date,
  timeZone: string,
): OpeningForecast | null {
  if (!forecast || offset < 0 || offset >= HORIZON_DAYS) return null;
  const age = forecastAge(forecast.fetchedAt, now);
  if (age === 'unusable') return null;
  const over = offset <= 1 ? ('span' as const) : ('day' as const);
  const from =
    over === 'span'
      ? new Date(floorHour(shown.from.getTime()))
      : atHome(date, PLANNING_FROM, timeZone);
  const to =
    over === 'span' ? new Date(ceilHour(shown.to.getTime())) : atHome(date, PLANNING_TO, timeZone);
  const hours: ForecastHour[] | null = hoursCovering(forecast.hours, from, to);
  if (!hours) return null;
  const band = bandOf(hours);
  if (!band) return null;
  const gusts = hours.map((h) => h.gustKmh);
  return {
    from,
    to,
    fetchedAt: forecast.fetchedAt,
    age,
    over,
    band,
    windy: windyOf(hours),
    maxProbability: Math.max(...hours.map((h) => h.precipitationProbability!)),
    totalMm: Math.round(hours.reduce((s, h) => s + h.precipitationMm!, 0) * 10) / 10,
    maxGustKmh: gusts.some((g) => g === null) ? null : Math.max(...(gusts as number[])),
  };
}

// ---- Tasks ---------------------------------------------------------------

const collator = new Intl.Collator('en-NZ');

/** Due date (dated first, earliest first), then title (`en-NZ`), then id: a written order, never importance. */
export function compareOpeningTasks(a: OpeningTask, b: OpeningTask): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * A task that may be matched at all (ADR 0011 §30): open, not scheduled, with
 * an estimate, with needs that are non-empty and only `dry_weather` and
 * `daylight`, and either in no project or in one of the reader's visible,
 * unarchived projects whose status is neither `paused` nor `done` (`active`
 * below). A project absent from the reader's list (archived, private to
 * another adult) or with an unrecognised status is not matched: the reader's
 * view holds no status that says it is live. Only these recorded fields are read.
 */
function waiting(t: OpeningTask, active: ReadonlySet<string>): boolean {
  return (
    t.status === 'open' &&
    t.scheduledStartsAt === null &&
    t.scheduledEndsAt === null &&
    t.estimateMinutes !== null &&
    t.estimateMinutes > 0 &&
    t.needs.length > 0 &&
    t.needs.every((n) => (MATCHED_NEEDS as readonly string[]).includes(n)) &&
    (t.projectId === null || active.has(t.projectId))
  );
}

const refOf = (t: OpeningTask): OpeningTaskRef => ({
  id: t.id,
  estimateMinutes: t.estimateMinutes!,
  needs: [...MATCHED_NEEDS].filter((n) => t.needs.includes(n)),
});

// ---- The family ----------------------------------------------------------

type Candidate = {
  gap: Gap;
  stretch: { from: Date; to: Date };
  shown: { from: Date; to: Date };
  edges: { from: OpeningEdge; to: OpeningEdge };
  forecast: OpeningForecast | null;
  minutes: number;
};

/**
 * The reader's openings over the window, in order (date, then start, then
 * key), at most one per weekend day. Every one is current (its end is after
 * `now` and its shown span is still two hours or more). Complete: a surface
 * applies its own cap when it lists them (§5.8).
 */
export function openings(input: OpeningsInput): Opening[] {
  const { now, timeZone, gaps } = input;
  if (gaps.coverage.rule === 'coverage.unknown') return [];
  const today = isoDateInZone(now, timeZone);
  const qualified = gaps.coverage.rule === 'coverage.partial';
  const daylightOn = new Map(input.daylight.map((d) => [d.date, d]));
  // The reader's live projects: listed (so visible and unarchived) and with a
  // status known to be neither `paused` nor `done`. Anything else matches nothing.
  const active = new Set(
    input.projects.filter((p) => LIVE_PROJECT_STATUSES.has(p.status)).map((p) => p.id),
  );
  // Each task once, in the written order.
  const seen = new Set<string>();
  const tasks = [...input.tasks]
    .sort(compareOpeningTasks)
    .filter((t) => !seen.has(t.id) && (seen.add(t.id), true))
    .filter((t) => waiting(t, active));

  const out: Opening[] = [];
  const first = input.window.from < today ? today : input.window.from;
  for (let date = first; date <= input.window.to; date = addDays(date, 1)) {
    const offset = daysBetween(today, date);
    if (offset >= HORIZON_DAYS) break;
    if (!WEEKEND.has(weekdayOf(date))) continue;
    const daylight = daylightOn.get(date) ?? null;

    const candidates: Candidate[] = [];
    for (const gap of gaps.gaps) {
      if (gap.date !== date || gap.scope !== HOUSEHOLD) continue;
      // Gap ∩ daylight (when known); the gap is already within planning hours.
      const fromDaylight = daylight !== null && daylight.from > gap.stretch.from;
      const toDaylight = daylight !== null && daylight.to < gap.stretch.to;
      const stretch = {
        from: fromDaylight ? daylight.from : gap.stretch.from,
        to: toDaylight ? daylight.to : gap.stretch.to,
      };
      const shown = {
        from: new Date(Math.max(stretch.from.getTime(), now.getTime())),
        to: stretch.to,
      };
      const minutes = (shown.to.getTime() - shown.from.getTime()) / MINUTE;
      if (minutes < OPENING_MIN_MINUTES) continue;
      candidates.push({
        gap,
        stretch,
        shown,
        minutes,
        edges: {
          from: fromDaylight ? 'daylight' : gap.before ? 'commitment' : 'planning',
          to: toDaylight ? 'daylight' : gap.after ? 'commitment' : 'planning',
        },
        forecast: forecastFor(input.forecast, date, offset, shown, now, timeZone),
      });
    }
    if (candidates.length === 0) continue;
    // The longest first (on the shown span); the earliest on a tie; then the key.
    candidates.sort(
      (a, b) =>
        b.minutes - a.minutes ||
        a.stretch.from.getTime() - b.stretch.from.getTime() ||
        (a.gap.key < b.gap.key ? -1 : a.gap.key > b.gap.key ? 1 : 0),
    );

    // A task opening on the longest candidate any waiting task matches.
    let chosen = candidates[0]!;
    let matched: OpeningTask[] = [];
    for (const c of candidates) {
      matched = tasks.filter(
        (t) =>
          c.minutes >= t.estimateMinutes! &&
          (!t.needs.includes('daylight') || daylight !== null) &&
          (!t.needs.includes('dry_weather') || c.forecast?.band === 'dry'),
      );
      if (matched.length > 0) {
        chosen = c;
        break;
      }
    }
    out.push(opening(chosen, matched, { date, offset, daylight, qualified, input }));
  }
  return out;
}

function opening(
  c: Candidate,
  matched: OpeningTask[],
  ctx: {
    date: IsoDate;
    offset: number;
    daylight: Daylight | null;
    qualified: boolean;
    input: OpeningsInput;
  },
): Opening {
  const { date, offset, daylight, qualified, input } = ctx;
  const { now, timeZone } = input;
  const task = matched[0] ?? null;
  const base = `open_window:${HOUSEHOLD}:${date}:${hhmm(c.stretch.from, timeZone)}-${hhmm(c.stretch.to, timeZone)}`;
  const nothing = nothingClause({ ...c, offset, date, qualified, timeZone });
  const weather = c.forecast ? weatherClause(c.forecast, offset, date, now, timeZone) : null;
  const text = task
    ? `${task.title} is recorded as about ${estimateWords(task.estimateMinutes!)}, in ${needsWords(task.needs)}. ${nothing}${weather ? `, and ${weather}` : ''}.`
    : `${nothing}.${weather ? ` ${capitalise(weather)}.` : ''}`;
  const facts: Fact[] = [
    ...c.gap.facts,
    ...(c.edges.from === 'daylight' || c.edges.to === 'daylight'
      ? [{ kind: 'daylight' as const, date }]
      : []),
    ...(c.forecast
      ? [
          {
            kind: 'forecast' as const,
            from: c.forecast.from.toISOString(),
            to: c.forecast.to.toISOString(),
            fetchedAt: c.forecast.fetchedAt.toISOString(),
          },
        ]
      : []),
    ...matched.map((t) => ({ kind: 'task' as const, id: t.id })),
  ];
  return {
    key: task ? `${base}:task:${task.id}` : base,
    rule: task ? 'open_window.task' : 'open_window.plain',
    date,
    offset,
    stretch: c.stretch,
    shown: c.shown,
    gap: {
      key: c.gap.key,
      stretch: c.gap.stretch,
      before: c.gap.before,
      after: c.gap.after,
      unblocking: c.gap.unblocking,
    },
    edges: c.edges,
    daylight,
    people: c.gap.facts.flatMap((f) => (f.kind === 'person' ? [f.id] : [])),
    coverage: input.gaps.coverage,
    qualified,
    forecast: c.forecast,
    task: task ? refOf(task) : null,
    others: matched.slice(1).map(refOf),
    limit: OPENING_LIMIT,
    text,
    facts,
  };
}

/** The order (§5.8): date, then start, then key. Total. */
export function compareOpenings(a: Opening, b: Opening): number {
  return (
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    a.stretch.from.getTime() - b.stretch.from.getTime() ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}
