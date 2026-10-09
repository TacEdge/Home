import type { AgendaDay, AgendaEventInput, AgendaItem, AgendaPersonRef } from './agenda';
import {
  capitalise,
  eventFact,
  eventsOn,
  homeClock,
  homeDate,
  itemsOn,
  nameList,
  numberWord,
  occurrenceKey,
  routineEvents,
  stillCounts,
  type DayPerson,
  type EventItem,
  type Fact,
  type TimedItem,
} from './day-facts';
import { addDays, compareIsoDates, type IsoDate } from '@/lib/dates';

// The Today engine (M5 contract §5, ADR 0008 §5–§19): what Today says, as
// structured, traceable statements over the agenda the reader already has.
// Pure: given the authorised records (read through the domain services as
// the reader, so nothing here can see what the reader cannot), the agenda
// engine's own output, the home zone and an injected `now`. No database, no
// clock, no recurrence expansion of its own, no LLM.
//
// It says what is recorded and the rules it applies to it, nothing more
// (ADR 0008 §5, §6): counts, names, times and titles; never "easy", "busy",
// "free", a need, an arrangement or a reassurance. A missing record is said
// only as absence, and qualified "as far as HOME knows" when a calendar the
// reader can see is out of date or failing.

/** Every headline rule (M5 contract §5.3, ADR 0008 §30). */
export const HEADLINE_RULES = [
  'headline.first_run',
  'headline.evening',
  'headline.evening_all_day',
  'headline.listed',
  'headline.counted',
  'headline.usual',
  'headline.nothing',
] as const;
export type HeadlineRule = (typeof HEADLINE_RULES)[number];

export type TodayTask = {
  id: string;
  title: string;
  dueDate: IsoDate | null;
  scheduledStartsAt: Date | null;
};

/** A calendar as the reader may see it: its name and freshness, nothing of its address. */
export type TodayCalendar = {
  id: string;
  name: string;
  archivedAt: Date | null;
  lastAttemptAt: Date | null;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
};

export type TodayInput = {
  /** The request time, injected; the engine never reads the clock. */
  now: Date;
  /** The home time zone. */
  timeZone: string;
  /** The agenda engine's output from today (at least today and tomorrow). */
  days: readonly AgendaDay[];
  /** The events the agenda was given (for the routine rule's recorded rule and kind). */
  events: readonly AgendaEventInput[];
  /** The reader's visible people, in the order People lists them. */
  people: readonly DayPerson[];
  /** The reader's open tasks. */
  tasks: readonly TodayTask[];
  /** The reader's visible calendars. */
  calendars: readonly TodayCalendar[];
  /** How many captures wait in the reader's To sort. */
  capturesWaiting: number;
};

/** A statement and what it stands on (ADR 0008 §6). */
export type Traced<R extends string> = { rule: R; text: string; facts: Fact[] };

export type Headline = Traced<HeadlineRule> & {
  /** "As far as HOME knows": a visible calendar is out of date or failing. */
  qualified: boolean;
  /** The second sentence, when `headline.late` holds today. */
  late: Traced<'headline.late'> | null;
};

export type LineEntry = {
  rule: 'person_line.routine' | 'person_line.item' | 'person_line.birthday';
  text: string;
  routine: boolean;
  facts: Fact[];
  /** The agenda item itself, for links and people. */
  item: AgendaItem;
  /** Who is recorded on it (empty for a birthday). */
  people: readonly AgendaPersonRef[];
};

export type PersonLine = {
  personId: string;
  name: string;
  /** Every entry, in agenda order. */
  entries: LineEntry[];
  /** Up to two, shown (`lineSelection`), in agenda order. */
  shown: LineEntry[];
  /** Every other entry, in agenda order: what "+ N more" holds. */
  rest: LineEntry[];
  more: number;
};

export type TodoReason = 'due_today' | 'scheduled_today' | 'carried_over' | 'due_tomorrow';
export type TodoEntry = { rule: `todo.${TodoReason}`; task: TodayTask; facts: Fact[] };

export type Evening = {
  /** Today's items, folded. */
  earlier: AgendaItem[];
  /** Tomorrow's events before midday (all-day ones included). */
  tomorrowMorning: EventItem[];
  /** Tasks due tomorrow ("Before then"). */
  beforeThen: TodoEntry[];
};

export type TodayModel = {
  date: IsoDate;
  state: 'first_run' | 'evening' | 'day';
  headline: Headline;
  personLines: PersonLine[];
  /** Today's items with no visible household person. */
  alsoToday: AgendaItem[];
  todo: { all: TodoEntry[]; shown: TodoEntry[]; more: number };
  toSort: number;
  /** In the day view, timed items already over, once more than one has passed. */
  earlier: AgendaItem[];
  evening: Evening | null;
  /** The calendars that make Today's absences and counts "as far as HOME knows". */
  incomplete: Fact[];
};

/** Provisional thresholds (ADR 0008 §22): code constants, evaluated in the M10 trial. */
export const LATE_AFTER = '18:00';
const MIDDAY = '12:00';
const TODO_SHOWN = 3;
const LINE_SHOWN = 2;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const SYNC_OK = new Set(['ok', 'partial']);

/**
 * A visible calendar Today cannot vouch for (`data_health.*`, M5 contract
 * §5.4): its last refresh failed, or its last successful one is more than a
 * day old. A calendar never refreshed yet has said nothing either way.
 */
export function unhealthyCalendars(
  calendars: readonly TodayCalendar[],
  now: Date,
): { calendar: TodayCalendar; rule: 'data_health.failed' | 'data_health.stale' }[] {
  const out: { calendar: TodayCalendar; rule: 'data_health.failed' | 'data_health.stale' }[] = [];
  for (const c of [...calendars].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (c.archivedAt !== null) continue;
    if (c.lastSyncStatus !== null && !SYNC_OK.has(c.lastSyncStatus))
      out.push({ calendar: c, rule: 'data_health.failed' });
    else if (c.lastSyncedAt !== null && now.getTime() - c.lastSyncedAt.getTime() > STALE_AFTER_MS)
      out.push({ calendar: c, rule: 'data_health.stale' });
  }
  return out;
}

/**
 * The household adults with a visible timed event still on after 18:00 on
 * `date` (`busy_day.late`): an event ending after 18:00 that day, or running
 * into the next. Two or more make the rule hold. Only who is recorded on an
 * event counts; nobody's evening is inferred.
 */
export function lateOn(
  days: readonly AgendaDay[],
  date: IsoDate,
  people: readonly DayPerson[],
  timeZone: string,
): { names: string[]; facts: Fact[] } | null {
  const adults = people.filter((p) => p.inHousehold && p.role === 'parent');
  const names: string[] = [];
  const facts: Fact[] = [];
  for (const a of adults) {
    const late = eventsOn(days, date).filter(
      (i): i is TimedItem =>
        !i.allDay &&
        i.people.some((p) => p.personId === a.id) &&
        (compareIsoDates(homeDate(i.endsAt, timeZone), date) > 0 ||
          homeClock(i.endsAt, timeZone) > LATE_AFTER),
    );
    if (late.length === 0) continue;
    names.push(a.name);
    facts.push({ kind: 'person', id: a.id }, ...late.map(eventFact));
  }
  return names.length >= 2 ? { names, facts } : null;
}

export function lateSentence(names: readonly string[], when: 'today' | 'tomorrow'): string {
  const all = names.length === 2 ? 'both' : 'all';
  return `${nameList(names)} ${all} have something on after 6${when === 'tomorrow' ? ' tomorrow' : ''}.`;
}

/** The agenda's people that are household people the reader can see. */
const householdOn = (i: EventItem, household: ReadonlySet<string>) =>
  i.people.filter((p) => household.has(p.personId));

export function today(input: TodayInput): TodayModel {
  const { now, timeZone, days, people } = input;
  const date = homeDate(now, timeZone);
  const tomorrow = addDays(date, 1);
  const household = new Set(people.filter((p) => p.inHousehold).map((p) => p.id));
  const routine = routineEvents(input.events, household);
  const isRoutine = (i: EventItem) => routine.has(i.eventId);

  const todays = itemsOn(days, date).filter((i) => i.kind !== 'task_due');
  const events = eventsOn(days, date);
  const timed = events.filter((i): i is TimedItem => !i.allDay);
  const unhealthy = unhealthyCalendars(input.calendars, now);
  const incomplete: Fact[] = unhealthy.map((u) => ({ kind: 'calendar', id: u.calendar.id }));
  const qualified = incomplete.length > 0;
  const liveCalendars = input.calendars.filter((c) => c.archivedAt === null);

  // Evening (§5.6): something timed began today, and everything timed on
  // today (carry-overs included) is over. A carry-over from last night can
  // never bring evening on by itself, and one still running holds it off.
  const over = (i: TimedItem) => i.endsAt.getTime() <= now.getTime();
  const evening = timed.some((i) => i.day === 1) && timed.every(over);
  const allDayToday = events.filter((i) => i.allDay);
  const firstRun = liveCalendars.length === 0 && input.events.length === 0;
  const state: TodayModel['state'] = firstRun ? 'first_run' : evening ? 'evening' : 'day';

  // The headline (§5.3): first match wins.
  const qualify = (sentence: string) =>
    qualified ? `${sentence.slice(0, -1)}, as far as HOME knows.` : sentence;
  const once = new Map<string, EventItem>();
  for (const i of events)
    if (stillCounts(i, now) && !once.has(occurrenceKey(i))) once.set(occurrenceKey(i), i);
  const occurrences = [...once.values()];
  const counted = occurrences.filter((i) => !isRoutine(i));
  const usual = occurrences.some(isRoutine);
  const range: Fact = { kind: 'range', from: date, to: date };
  const consulted: Fact[] = liveCalendars.map((c) => ({ kind: 'calendar', id: c.id }));
  let headline: Traced<HeadlineRule>;
  if (state === 'first_run')
    headline = {
      rule: 'headline.first_run',
      text: 'HOME is quiet because it doesn’t know your calendars yet.',
      facts: [range],
    };
  else if (state === 'evening' && allDayToday.length > 0)
    // An all-day event is still today's: say only what is true of the timed ones.
    headline = {
      rule: 'headline.evening_all_day',
      text: qualify('Today’s timed events have finished.'),
      facts: [...timed.map(eventFact), ...allDayToday.map(eventFact), ...incomplete],
    };
  else if (state === 'evening')
    headline = {
      rule: 'headline.evening',
      text: qualify('Nothing else on today.'),
      facts: [...timed.map(eventFact), ...incomplete],
    };
  else if (
    counted.length > 0 &&
    counted.length <= 2 &&
    counted.every((i): i is TimedItem => !i.allDay && i.day === 1)
  ) {
    const [a, b] = counted as TimedItem[];
    const at = (i: TimedItem) => `${i.title} at ${homeClock(i.startsAt, timeZone)}`;
    headline = {
      rule: 'headline.listed',
      text: qualify(b ? `${at(a!)}, then ${at(b)}.` : `${at(a!)}.`),
      facts: [...counted.map(eventFact), ...incomplete],
    };
  } else if (counted.length > 0)
    headline = {
      rule: 'headline.counted',
      text: qualify(
        `${capitalise(numberWord(counted.length))} ${counted.length === 1 ? 'thing' : 'things'} on today${usual ? ', besides the usual' : ''}.`,
      ),
      facts: [...counted.map(eventFact), ...incomplete],
    };
  else if (usual)
    headline = {
      rule: 'headline.usual',
      text: qualify('Just the usual today.'),
      facts: [...occurrences.map(eventFact), ...incomplete],
    };
  else
    headline = {
      rule: 'headline.nothing',
      text: qualify('Nothing on today.'),
      facts: [range, ...consulted],
    };
  const late = state === 'day' ? lateOn(days, date, people, timeZone) : null;

  // Everyone's day (§5.1).
  const personLines: PersonLine[] = [];
  for (const p of people) {
    if (!p.inHousehold) continue;
    const entries: LineEntry[] = [];
    for (const i of todays) {
      if (i.kind === 'birthday' && i.personId === p.id)
        entries.push({
          rule: 'person_line.birthday',
          text: 'Birthday',
          routine: false,
          facts: [{ kind: 'person', id: p.id }],
          item: i,
          people: [],
        });
      if (i.kind !== 'event' || !i.people.some((r) => r.personId === p.id)) continue;
      const r = isRoutine(i);
      entries.push({
        rule: r ? 'person_line.routine' : 'person_line.item',
        text: r ? routineText(i, timeZone) : itemText(i, timeZone),
        routine: r,
        facts: [eventFact(i)],
        item: i,
        people: i.people,
      });
    }
    if (entries.length === 0) continue;
    const { shown, rest } = lineSelection(entries, now);
    personLines.push({ personId: p.id, name: p.name, entries, shown, rest, more: rest.length });
  }

  // Also today (§5.2): what belongs to no visible household person.
  const alsoToday = todays.filter((i) =>
    i.kind === 'event'
      ? householdOn(i, household).length === 0
      : i.kind === 'birthday'
        ? !household.has(i.personId)
        : i.kind === 'project_target',
  );

  // To do (§5.5).
  const all = todo(input.tasks, date, timeZone);

  return {
    date,
    state,
    headline: {
      ...headline,
      qualified: qualified && headline.rule !== 'headline.first_run',
      late: late
        ? { rule: 'headline.late', text: lateSentence(late.names, 'today'), facts: late.facts }
        : null,
    },
    personLines,
    alsoToday,
    todo: { all, shown: all.slice(0, TODO_SHOWN), more: Math.max(0, all.length - TODO_SHOWN) },
    toSort: Math.max(0, input.capturesWaiting),
    earlier:
      state === 'day'
        ? (() => {
            const over = timed.filter((i) => i.endsAt.getTime() <= now.getTime());
            return over.length > 1 ? over : [];
          })()
        : [],
    evening:
      state === 'evening'
        ? {
            earlier: todays,
            tomorrowMorning: eventsOn(days, tomorrow).filter(
              (i) => i.allDay || (i.day === 1 && homeClock(i.startsAt, timeZone) < MIDDAY),
            ),
            beforeThen: input.tasks
              .filter((t) => t.dueDate === tomorrow)
              .sort(byTitle)
              .map((t) => ({
                rule: 'todo.due_tomorrow' as const,
                task: t,
                facts: [{ kind: 'task' as const, id: t.id }],
              })),
          }
        : null,
    incomplete,
  };
}

/**
 * Which two of a person's entries are on the surface (ADR 0008 §32, after
 * the Package 3 review): those not yet finished first, so a finished
 * morning never hides what is still to come. An entry is finished only when
 * it is a timed occurrence whose end is at or before `now`; one under way,
 * an all-day item and a birthday are not. Up to two unfinished entries, the
 * earliest; if fewer remain, the most recently finished fill the rest
 * (latest end, then later in agenda order). The two keep agenda order, and
 * every other entry is in `rest`, also in agenda order. Nothing is ranked
 * by importance; nothing is dropped.
 */
export function lineSelection(
  entries: readonly LineEntry[],
  now: Date,
): { shown: LineEntry[]; rest: LineEntry[] } {
  const finished = (e: LineEntry) =>
    e.item.kind === 'event' && !e.item.allDay && e.item.endsAt.getTime() <= now.getTime();
  const open = entries.map((e, k) => k).filter((k) => !finished(entries[k]!));
  const done = entries
    .map((e, k) => k)
    .filter((k) => finished(entries[k]!))
    .sort((a, b) => {
      const ea = entries[a]!.item as TimedItem;
      const eb = entries[b]!.item as TimedItem;
      return eb.endsAt.getTime() - ea.endsAt.getTime() || b - a;
    });
  const chosen = new Set([...open, ...done].slice(0, LINE_SHOWN));
  return {
    shown: entries.filter((e, k) => chosen.has(k)),
    rest: entries.filter((e, k) => !chosen.has(k)),
  };
}

const byTitle = (a: TodayTask, b: TodayTask) =>
  a.title.localeCompare(b.title, 'en-NZ') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Today's tasks (§5.5): due today, scheduled today, or due earlier. Due or
 * scheduled today come first (scheduled ones by their time, then the rest by
 * title); carried-over ones after, oldest due date first. Overdue is a
 * recorded date, not a judgement: it sets order, never urgency. Every open
 * task outside these is simply not Today's; nothing here hides it from the
 * task list itself.
 */
export function todo(tasks: readonly TodayTask[], date: IsoDate, timeZone: string): TodoEntry[] {
  const scheduledToday = (t: TodayTask) =>
    t.scheduledStartsAt !== null && homeDate(t.scheduledStartsAt, timeZone) === date;
  const entry = (t: TodayTask, reason: TodoReason): TodoEntry => ({
    rule: `todo.${reason}`,
    task: t,
    facts: [{ kind: 'task', id: t.id }],
  });
  const today = tasks
    .filter((t) => scheduledToday(t) || t.dueDate === date)
    .sort(
      (a, b) =>
        (a.scheduledStartsAt && scheduledToday(a) ? a.scheduledStartsAt.getTime() : Infinity) -
          (b.scheduledStartsAt && scheduledToday(b) ? b.scheduledStartsAt.getTime() : Infinity) ||
        byTitle(a, b),
    )
    .map((t) => entry(t, scheduledToday(t) ? 'scheduled_today' : 'due_today'));
  const carried = tasks
    .filter((t) => !scheduledToday(t) && t.dueDate !== null && t.dueDate < date)
    .sort((a, b) => compareIsoDates(a.dueDate!, b.dueDate!) || byTitle(a, b))
    .map((t) => entry(t, 'carried_over'));
  return [...today, ...carried];
}

/** A routine item in a word or two (§5.1): "School", "Work till 14:30", "Work". */
function routineText(i: EventItem, timeZone: string): string {
  if (i.allDay) return i.title;
  if (i.eventKind === 'school') return 'School';
  const end = homeClock(i.endsAt, timeZone);
  return i.days === 1 && end <= '17:00' ? `Work till ${end}` : 'Work';
}

/** Anything else with its time (§5.1): "15:30 Swimming"; a carried-over one says how it runs. */
function itemText(i: EventItem, timeZone: string): string {
  if (i.allDay) return i.title;
  if (i.day === 1) return `${homeClock(i.startsAt, timeZone)} ${i.title}`;
  if (i.day === i.days) return `${i.title} until ${homeClock(i.endsAt, timeZone)}`;
  return `${i.title}, all day`;
}
