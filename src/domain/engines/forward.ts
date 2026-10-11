import {
  compareAgendaItems,
  type AgendaDay,
  type AgendaEventInput,
  type AgendaItem,
} from './agenda';
import {
  capitalise,
  eventFact,
  homeDate,
  numberWord,
  occurrenceKey,
  stillCounts,
  WEEKDAYS,
  type DayPerson,
  type Fact,
} from './day-facts';
import { regularWeek, type RegularWeekEntry } from './profile';
import { placement, unhealthyCalendars, type TodayCalendar } from './today';
import {
  addDays,
  compareIsoDates,
  daysBetween,
  daysInMonth,
  longDate,
  parseIsoDate,
  weekdayOf,
  type IsoDate,
} from '@/lib/dates';

// The Forward engine (M6 contract §5.1–§5.5, ADR 0009 §15, §16, §22): the
// next 7, 30 or 90 days composed into one model, the same composition for
// every horizon. Week groups by day, Month by week, Season by month. Pure:
// it reads the agenda engine's output and the reader's own records (already
// filtered by the domain services for this actor), the home zone and an
// injected `now`. No database, no clock, no recurrence of its own: every
// occurrence comes from the agenda, and the usual comes from the regular
// week (`profile.regularWeek`), the same test the profile page shows.
//
// Every statement is traced: a rule id, the records it stands on (ids and
// dates only), and an explicit counting rule. Nothing is ranked by
// importance, nothing is called busy, easy or free, and an empty stretch is
// only "nothing recorded".

export const HORIZONS = ['week', 'month', 'season'] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Days each horizon covers, from today (contract §5.1). */
export const HORIZON_DAYS: Record<Horizon, number> = { week: 7, month: 30, season: 90 };

/** Notable items shown per unit before "+ N" (contract §5.3). */
export const ROW_CAP: Record<Horizon, number> = { week: 2, month: 3, season: 3 };

/**
 * Load bands (contract §5.4, ADR 0009 §22; provisional, evaluated in the
 * M10 trial): the counts at which a unit reaches band 1, 2 and 3. A day
 * counts in ones and twos; a week or a month in larger steps.
 */
export const LOAD_BANDS = { day: [1, 3, 5], period: [1, 5, 10] } as const;

export const FORWARD_RULES = [
  'forward.horizon',
  'forward.usual',
  'forward.notable',
  'forward.row',
  'forward.load',
  'forward.headline.first_run',
  'forward.headline.nothing',
  'forward.headline.usual',
  'forward.headline.listed',
  'forward.headline.counted',
  'forward.headline.conflicts',
  'forward.headline.qualified',
] as const;
export type ForwardRule = (typeof FORWARD_RULES)[number];
export type HeadlineRule = Extract<
  ForwardRule,
  | 'forward.headline.first_run'
  | 'forward.headline.nothing'
  | 'forward.headline.usual'
  | 'forward.headline.listed'
  | 'forward.headline.counted'
>;

/**
 * A conflict as Package 2 will hand it over: its key and the occurrences it
 * stands on (`occurrenceKey`: `{eventId}:{occurrenceDate}`). The caller
 * passes only the reader's current conflicts that the reader has not
 * responded to. Package 1 passes none.
 */
export type ForwardConflict = { key: string; occurrences: readonly string[] };

export type ForwardInput = {
  now: Date;
  timeZone: string;
  horizon: Horizon;
  /** The agenda engine's output. Days with nothing on are absent from it. */
  days: readonly AgendaDay[];
  /**
   * The range of home dates the agenda was computed over (its `from` and
   * `to`, inclusive). The agenda leaves empty days out, so only this says
   * which absent days were loaded and empty and which were never loaded. It
   * must cover the whole horizon, or the engine refuses to compose (ADR 0009
   * §32): an unloaded stretch is never presented as "nothing recorded".
   */
  coverage: { from: IsoDate; to: IsoDate };
  /** The events the agenda read, with their people: what the regular week is derived from. */
  events: readonly AgendaEventInput[];
  /** The reader's visible people, in the order People lists them. */
  people: readonly DayPerson[];
  calendars: readonly TodayCalendar[];
  conflicts?: readonly ForwardConflict[];
};

/** One record in a unit: the first placement of an occurrence (or item) within the unit. */
export type ForwardEntry = {
  /** Stable within the model: an occurrence once, a birthday, target or task once. */
  key: string;
  rule: 'forward.notable' | 'forward.usual';
  item: AgendaItem;
  /** The first day of the unit it is on. */
  date: IsoDate;
  /** In a current conflict for the reader (always notable; first in its row on Week). */
  conflicted: boolean;
  /**
   * Whether it counts towards the headline and the load (as Today's counts,
   * ADR 0008 §31): everything that begins in the range does; a carry-over
   * from before today counts only while it is still running at `now`.
   */
  counts: boolean;
  facts: Fact[];
};

export type ForwardUnit = {
  rule: 'forward.row';
  unit: 'day' | 'week' | 'month';
  label: string;
  from: IsoDate;
  to: IsoDate;
  /** Every notable entry, in row order (§5.3). */
  notable: ForwardEntry[];
  /** The first `ROW_CAP` of them, and the rest, so nothing is lost. */
  shown: ForwardEntry[];
  rest: ForwardEntry[];
  /** Exactly `rest.length`. */
  more: number;
  /** Every usual entry, in agenda order: folded away, never dropped. */
  usual: ForwardEntry[];
  load: { rule: 'forward.load'; count: number; band: 0 | 1 | 2 | 3; text: string; facts: Fact[] };
};

export type ForwardHeadline = {
  rule: HeadlineRule;
  /** The sentence without the qualifier. */
  sentence: string;
  /** The whole statement: the sentence, then "As far as HOME knows." when qualified. */
  text: string;
  qualified: boolean;
  facts: Fact[];
  conflicts: { rule: 'forward.headline.conflicts'; text: string; facts: Fact[] } | null;
};

export type ForwardModel = {
  horizon: Horizon;
  today: IsoDate;
  from: IsoDate;
  to: IsoDate;
  firstRun: boolean;
  headline: ForwardHeadline;
  units: ForwardUnit[];
  /** Each household person's regular week (The usual ›), in People order. */
  usual: { personId: string; name: string; entries: RegularWeekEntry[] }[];
  /** Counted entries over the whole range, each occurrence once. */
  counts: {
    notable: number;
    usual: number;
    events: number;
    birthdays: number;
    projectTargets: number;
    tasksDue: number;
    tasksScheduled: number;
    conflicts: number;
  };
  /** Calendars the reader can see that are stale or failing (`data_health`). */
  incomplete: Fact[];
};

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));
const RANGE_WORDS: Record<Horizon, string> = {
  week: 'the next seven days',
  month: 'the next 30 days',
  season: 'the next 90 days',
};

/** An item's identity within a model: an occurrence once however many days it covers. */
export function entryKey(i: AgendaItem): string {
  switch (i.kind) {
    case 'event':
      return occurrenceKey(i);
    case 'birthday':
      return `birthday:${i.personId}:${i.date}`;
    case 'project_target':
      return `project_target:${i.projectId}:${i.date}`;
    case 'task_due':
      return `task_due:${i.taskId}`;
    case 'task_scheduled':
      return `task_scheduled:${i.taskId}`;
  }
}

function factOf(i: AgendaItem): Fact {
  switch (i.kind) {
    case 'event':
      return eventFact(i);
    case 'birthday':
      return { kind: 'person', id: i.personId };
    case 'project_target':
      return { kind: 'project', id: i.projectId };
    case 'task_due':
    case 'task_scheduled':
      return { kind: 'task', id: i.taskId };
  }
}

/**
 * Row order (contract §5.3): by kind and time, never by importance. On Week,
 * items in a conflict first (their marks are on these rows); then birthdays;
 * all-day and multi-day events; project targets; tasks due; scheduled tasks;
 * timed events. Then by day, then the agenda's own order, then the key: a
 * total order. On Month and Season (ADR 0009 §35) a row is chronological: by
 * day, then the agenda's order, then the key. Conflicts are listed in Worth
 * knowing there, and do not move an entry ahead of earlier commitments.
 */
function rowRank(e: ForwardEntry): number {
  if (e.conflicted) return 0;
  const i = e.item;
  switch (i.kind) {
    case 'birthday':
      return 1;
    case 'event':
      return i.allDay || i.days > 1 ? 2 : 6;
    case 'project_target':
      return 3;
    case 'task_due':
      return 4;
    case 'task_scheduled':
      return 5;
  }
}

export function compareRow(a: ForwardEntry, b: ForwardEntry, horizon: Horizon = 'week'): number {
  return (
    (horizon === 'week' ? rowRank(a) - rowRank(b) : 0) ||
    compareIsoDates(a.date, b.date) ||
    compareAgendaItems(a.item, b.item) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

/** The units a horizon is grouped into (contract §5.1): days, weeks from Monday, or months. */
export function unitsOf(
  horizon: Horizon,
  today: IsoDate,
): { unit: ForwardUnit['unit']; label: string; from: IsoDate; to: IsoDate }[] {
  const last = addDays(today, HORIZON_DAYS[horizon] - 1);
  const out: { unit: ForwardUnit['unit']; label: string; from: IsoDate; to: IsoDate }[] = [];
  if (horizon === 'week') {
    for (let k = 0; k < HORIZON_DAYS.week; k++) {
      const d = addDays(today, k);
      const label =
        k === 0
          ? 'Today'
          : k === 1
            ? 'Tomorrow'
            : `${WEEKDAY_SHORT[weekdayOf(d)]} ${parseIsoDate(d).day}`;
      out.push({ unit: 'day', label, from: d, to: d });
    }
    return out;
  }
  if (horizon === 'month') {
    let from = today;
    while (from <= last) {
      const sunday = addDays(from, 6 - weekdayOf(from));
      const to = sunday < last ? sunday : last;
      out.push({
        unit: 'week',
        label: from === today ? 'This week' : spanLabel(from, to),
        from,
        to,
      });
      from = addDays(to, 1);
    }
    return out;
  }
  const year = parseIsoDate(today).year;
  let from = today;
  while (from <= last) {
    const d = parseIsoDate(from);
    const nextMonth = addDays(from, daysInMonth(d.year, d.month) - d.day + 1);
    const end = addDays(nextMonth, -1);
    const to = end < last ? end : last;
    // A month the horizon ends inside is labelled by the days it covers
    // ("1–11 Jan"), never by its name: HOME has looked at those days only.
    // The first month runs from today, as every horizon does, and keeps its name.
    const name = d.year === year ? MONTHS[d.month - 1]! : `${MONTHS[d.month - 1]} ${d.year}`;
    out.push({ unit: 'month', label: to === end ? name : spanLabel(from, to), from, to });
    from = nextMonth;
  }
  return out;
}

/** "19–25 Oct", "26 Oct–1 Nov", "12 Nov". */
function spanLabel(from: IsoDate, to: IsoDate): string {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (from === to) return `${a.day} ${MONTH_SHORT[a.month - 1]}`;
  return a.month === b.month && a.year === b.year
    ? `${a.day}–${b.day} ${MONTH_SHORT[b.month - 1]}`
    : `${a.day} ${MONTH_SHORT[a.month - 1]}–${b.day} ${MONTH_SHORT[b.month - 1]}`;
}

/**
 * Which notable entries are on the surface (ADR 0009 §32, after the Package 1
 * review): those that still count first, so a carry-over from last night that
 * has already ended (`counts: false`, by its own recorded end and `now`) never
 * takes a visible slot from something still to come. Within each group, and
 * on the surface, the row order holds. Everything else is held in `rest`, in
 * row order; `more` is exactly its length. Nothing is ranked by importance.
 */
export function selection(
  notable: readonly ForwardEntry[],
  cap: number,
): { shown: ForwardEntry[]; rest: ForwardEntry[]; more: number } {
  const preferred = [...notable.filter((e) => e.counts), ...notable.filter((e) => !e.counts)];
  const picked = new Set(preferred.slice(0, cap).map((e) => e.key));
  const shown = notable.filter((e) => picked.has(e.key));
  const rest = notable.filter((e) => !picked.has(e.key));
  return { shown, rest, more: rest.length };
}

function bandOf(unit: ForwardUnit['unit'], count: number): 0 | 1 | 2 | 3 {
  const steps = unit === 'day' ? LOAD_BANDS.day : LOAD_BANDS.period;
  return steps.filter((s) => count >= s).length as 0 | 1 | 2 | 3;
}

const things = (n: number) => `${numberWord(n)} ${n === 1 ? 'thing' : 'things'}`;

/** "today", "tomorrow", "on Tuesday": within seven days a weekday is unambiguous. */
function onDay(date: IsoDate, today: IsoDate): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `on ${WEEKDAYS[weekdayOf(date)]}`;
}

/** How a listed item is named in a headline: as recorded. */
function nameOf(i: AgendaItem): string {
  return i.kind === 'birthday' ? `${i.name}’s birthday` : i.title;
}

/**
 * A listed item in the headline (§5.5, `forward.headline.listed`): its name
 * and its day ("Swimming today", "Nana Jo’s birthday on Tuesday"). An event
 * carried in from before today is named by when it ends, so it never reads
 * as starting today (ADR 0009 §36, owner's decision): "Camp, until Friday",
 * "Camp, until tomorrow", "Camp, ending today"; past a week, its date.
 */
function listedPart(e: ForwardEntry, today: IsoDate): string {
  const i = e.item;
  if (i.kind !== 'event' || i.day === 1) return `${nameOf(i)} ${onDay(e.date, today)}`;
  const end = addDays(e.date, i.days - i.day);
  const n = daysBetween(today, end);
  if (n === 0) return `${i.title}, ending today`;
  if (n === 1) return `${i.title}, until tomorrow`;
  return n < 7
    ? `${i.title}, until ${WEEKDAYS[weekdayOf(end)]}`
    : `${i.title}, until ${longDate(end)}`;
}

/** Thrown when the agenda handed over does not cover the whole horizon. */
export class IncompleteAgendaError extends RangeError {
  constructor(
    readonly needed: { from: IsoDate; to: IsoDate },
    readonly coverage: { from: IsoDate; to: IsoDate },
  ) {
    super(
      `agenda covers ${coverage.from}..${coverage.to}, but the horizon needs ${needed.from}..${needed.to}`,
    );
    this.name = 'IncompleteAgendaError';
  }
}

export function forward(input: ForwardInput): ForwardModel {
  const { now, timeZone, horizon, coverage } = input;
  const today = homeDate(now, timeZone);
  const to = addDays(today, HORIZON_DAYS[horizon] - 1);
  // The coverage invariant: both ends of the horizon must have been loaded.
  // Nothing is fetched, expanded or filled in here; a short agenda is refused.
  parseIsoDate(coverage.from);
  parseIsoDate(coverage.to);
  if (coverage.from > today || coverage.to < to)
    throw new IncompleteAgendaError({ from: today, to }, coverage);
  const inRange = input.days.filter((d) => d.date >= today && d.date <= to);

  // The usual (§5.2): unchanged occurrences of series in a household
  // person's regular week. A changed occurrence is its own row with no rule,
  // so it is never in a regular week and is always notable.
  const household = input.people.filter((p) => p.inHousehold);
  const usualWeeks = household
    .map((p) => ({
      personId: p.id,
      name: p.name,
      entries: regularWeek(input.events, p.id, { today, timeZone }),
    }))
    .filter((w) => w.entries.length > 0);
  const usualSeries = new Set(usualWeeks.flatMap((w) => w.entries.map((e) => e.eventId)));
  const conflicted = new Set((input.conflicts ?? []).flatMap((c) => c.occurrences));

  const entryOf = (i: AgendaItem, date: IsoDate): ForwardEntry => {
    const key = entryKey(i);
    const inConflict = i.kind === 'event' && conflicted.has(key);
    const usual = i.kind === 'event' && usualSeries.has(i.eventId) && !inConflict;
    return {
      key,
      rule: usual ? 'forward.usual' : 'forward.notable',
      item: i,
      date,
      conflicted: inConflict,
      counts: i.kind !== 'event' || stillCounts(i, now),
      facts: [factOf(i)],
    };
  };

  // Units (§5.1, §5.3, §5.4): each occurrence once per unit, at its first day there.
  const cap = ROW_CAP[horizon];
  const units: ForwardUnit[] = unitsOf(horizon, today).map((u) => {
    const seen = new Map<string, ForwardEntry>();
    for (const d of inRange)
      if (d.date >= u.from && d.date <= u.to)
        for (const i of d.items) {
          const k = entryKey(i);
          if (!seen.has(k)) seen.set(k, entryOf(i, d.date));
        }
    const all = [...seen.values()];
    const notable = all
      .filter((e) => e.rule === 'forward.notable')
      .sort((a, b) => compareRow(a, b, horizon));
    const usual = all
      .filter((e) => e.rule === 'forward.usual')
      .sort(
        (a, b) =>
          compareIsoDates(a.date, b.date) ||
          compareAgendaItems(a.item, b.item) ||
          (a.key < b.key ? -1 : 1),
      );
    const counted = notable.filter((e) => e.counts);
    const count = counted.length;
    return {
      rule: 'forward.row',
      ...u,
      notable,
      ...selection(notable, cap),
      usual,
      load: {
        rule: 'forward.load',
        count,
        band: bandOf(u.unit, count),
        text:
          count > 0
            ? `${capitalise(things(count))} recorded`
            : usual.length > 0
              ? 'Nothing recorded besides the usual'
              : 'Nothing recorded',
        facts: counted.flatMap((e) => e.facts),
      },
    };
  });

  // The whole range, each occurrence once, at its first day (for the headline and counts).
  const once = new Map<string, ForwardEntry>();
  for (const d of inRange)
    for (const i of d.items) {
      const k = entryKey(i);
      if (!once.has(k)) once.set(k, entryOf(i, d.date));
    }
  const whole = [...once.values()].filter((e) => e.counts);
  const notable = whole
    .filter((e) => e.rule === 'forward.notable')
    .sort(
      (a, b) =>
        compareIsoDates(a.date, b.date) ||
        compareAgendaItems(a.item, b.item) ||
        (a.key < b.key ? -1 : 1),
    );
  const usual = whole.filter((e) => e.rule === 'forward.usual');
  const inRangeKeys = new Set(once.keys());
  const conflicts = (input.conflicts ?? []).filter((c) =>
    c.occurrences.some((o) => inRangeKeys.has(o)),
  );

  // The headline (§5.5): first match wins.
  const liveCalendars = input.calendars.filter((c) => c.archivedAt === null);
  const firstRun = liveCalendars.length === 0 && input.events.length === 0;
  const incomplete: Fact[] = unhealthyCalendars(input.calendars, now).map((u) => ({
    kind: 'calendar',
    id: u.calendar.id,
  }));
  const range: Fact = { kind: 'range', from: today, to };
  const words = RANGE_WORDS[horizon];
  const listable =
    horizon === 'week' &&
    notable.length >= 1 &&
    notable.length <= 2 &&
    notable.every((e) => e.item.kind === 'event' || e.item.kind === 'birthday');
  let rule: HeadlineRule;
  let sentence: string;
  let facts: Fact[];
  if (firstRun) {
    rule = 'forward.headline.first_run';
    sentence = 'HOME doesn’t know your calendars yet.';
    facts = [range];
  } else if (notable.length === 0 && usual.length === 0) {
    rule = 'forward.headline.nothing';
    sentence = `Nothing recorded in ${words}.`;
    facts = [range, ...liveCalendars.map((c): Fact => ({ kind: 'calendar', id: c.id }))];
  } else if (notable.length === 0) {
    rule = 'forward.headline.usual';
    sentence = `Just the usual in ${words}.`;
    facts = usual.flatMap((e) => e.facts);
  } else if (listable) {
    rule = 'forward.headline.listed';
    const parts = notable.map((e) => listedPart(e, today));
    sentence = `${capitalise(parts.join(', then '))}.`;
    facts = notable.flatMap((e) => e.facts);
  } else {
    rule = 'forward.headline.counted';
    sentence = `${capitalise(things(notable.length))} in ${words}${usual.length > 0 ? ', besides the usual' : ''}.`;
    facts = notable.flatMap((e) => e.facts);
  }
  const qualified = incomplete.length > 0 && !firstRun;

  const kinds = (k: AgendaItem['kind']) => notable.filter((e) => e.item.kind === k).length;
  return {
    horizon,
    today,
    from: today,
    to,
    firstRun,
    headline: {
      rule,
      sentence,
      text: qualified ? `${sentence} As far as HOME knows.` : sentence,
      qualified,
      facts: qualified ? [...facts, ...incomplete] : facts,
      conflicts:
        conflicts.length > 0 && !firstRun
          ? {
              rule: 'forward.headline.conflicts',
              text:
                conflicts.length === 1
                  ? 'There is one overlap.'
                  : `There are ${numberWord(conflicts.length)} overlaps.`,
              facts: [...new Set(conflicts.flatMap((c) => c.occurrences))]
                .filter((o) => once.has(o))
                .map((o) => once.get(o)!.facts[0]!),
            }
          : null,
    },
    units,
    usual: usualWeeks,
    counts: {
      notable: notable.length,
      usual: usual.length,
      events: kinds('event'),
      birthdays: kinds('birthday'),
      projectTargets: kinds('project_target'),
      tasksDue: kinds('task_due'),
      tasksScheduled: kinds('task_scheduled'),
      conflicts: conflicts.length,
    },
    incomplete,
  };
}

/**
 * Where Forward's rows can hold a conflict mark (contract §4.5): every event
 * entry on the surface, shown or folded, by `placement(null, key)`, since a
 * Forward row is shared and not a person's line. A lookup for the marks, not
 * a rule.
 */
export function forwardPlacements(model: Pick<ForwardModel, 'units'>): Set<string> {
  return new Set(
    model.units
      .flatMap((u) => [...u.shown, ...u.rest])
      .filter((e) => e.item.kind === 'event')
      .map((e) => placement(null, e.key)),
  );
}
