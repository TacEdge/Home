import type { AgendaDay, AgendaEventInput } from '../agenda';
import {
  capitalise,
  eventFact,
  eventsOn,
  homeDate,
  numberWord,
  occurrenceKey,
  routineEvents,
  WEEKDAYS,
  type DayPerson,
  type EventItem,
  type Fact,
} from '../day-facts';
import { nextBirthday } from '../profile';
import { lateOn, lateSentence, unhealthyCalendars, type TodayCalendar } from '../today';
import {
  addDays,
  compareIsoDates,
  daysBetween,
  longDate,
  weekdayOf,
  type IsoDate,
} from '@/lib/dates';

// The insights engine (CLAUDE.md rule 15, SYSTEM-ARCHITECTURE §2.6, M5
// contract §5.4, ADR 0008 §16): small deterministic detectors over the
// reader's own records, each insight carrying its key, rule, the records it
// came from and its template sentence, ranked without randomness or an LLM.
// Derived on read; nothing is stored but a person's own dismissals.
//
// M5's families only (ADR 0008 §16, §21): `busy_day` (counts and recorded
// evening events, provisional thresholds), `preparation` (a recorded
// birthday, or a recorded project target with recorded open tasks) and
// `data_health` (a visible calendar's recorded freshness). No transport,
// no `coordination_gap`, no need inferred from a missing record.

export const INSIGHT_RULES = [
  'busy_day.count',
  'busy_day.late',
  'preparation.birthday',
  'preparation.project_target',
  'data_health.stale',
  'data_health.failed',
] as const;
export type InsightRule = (typeof INSIGHT_RULES)[number];
export type InsightKind = 'data_health' | 'preparation' | 'busy_day';

export type Insight = {
  /** Deterministic: kind, rule, subject ids and date; never text. */
  key: string;
  kind: InsightKind;
  rule: InsightRule;
  /** The date it is about. */
  when: IsoDate;
  text: string;
  /** The records it stands on. */
  facts: Fact[];
  /** The numbers the rule compared, for the explanation. */
  basis: Record<string, number | string>;
  /** Already said on its own item or by the headline (ADR 0002 §3): never listed or counted. */
  onObject: boolean;
};

export type InsightPerson = DayPerson & { dateOfBirth: IsoDate | null };
export type InsightTask = { id: string; projectId: string | null };
export type InsightProject = {
  id: string;
  title: string;
  status: string;
  targetDate: IsoDate | null;
};

export type InsightsInput = {
  now: Date;
  timeZone: string;
  /** The agenda engine's output from today through the lookahead. */
  days: readonly AgendaDay[];
  events: readonly AgendaEventInput[];
  people: readonly InsightPerson[];
  /** The reader's open tasks. */
  tasks: readonly InsightTask[];
  projects: readonly InsightProject[];
  calendars: readonly TodayCalendar[];
  /** The reader's own dismissed keys. */
  dismissed?: ReadonlySet<string>;
};

export type Insights = {
  /** Every candidate, ranked; on-object and dismissed ones included, marked. */
  all: Insight[];
  /** The top eligible ones (not on an object, not dismissed). */
  shown: Insight[];
  /** How many more eligible ones there are: genuine insights only. */
  more: number;
};

/** Provisional thresholds (ADR 0008 §22): code constants, evaluated in the M10 trial. */
export const BUSY_DAY_COUNT = 6;
/** How far ahead the detectors look (ADR 0008 §26). */
export const LOOKAHEAD_DAYS = 7;
/** Worth knowing shows at most this many (M5 contract §4.1). */
export const SHOWN = 3;

const KIND_ORDER: Record<InsightKind, number> = { data_health: 0, preparation: 1, busy_day: 2 };

/** The order of insights: kind, then date, then key. Total: no ties remain. */
export function compareInsights(a: Insight, b: Insight): number {
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    compareIsoDates(a.when, b.when) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

/** "today", "tomorrow", "Tuesday", "next Wednesday", for a date up to a week ahead. */
function dayWord(date: IsoDate, today: IsoDate): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  const weekday = WEEKDAYS[weekdayOf(date)]!;
  return n >= 7 ? `next ${weekday}` : weekday;
}

/** When a calendar last updated, in words: "yesterday", "Tuesday", "3 Oct". */
function sinceWord(instant: Date, today: IsoDate, timeZone: string): string {
  const day = homeDate(instant, timeZone);
  if (day === addDays(today, -1)) return 'yesterday';
  if (day > addDays(today, -7)) return WEEKDAYS[weekdayOf(day)]!;
  return longDate(day, 'short');
}

export function insights(input: InsightsInput): Insights {
  const { now, timeZone, days, people } = input;
  const today = homeDate(now, timeZone);
  const last = addDays(today, LOOKAHEAD_DAYS);
  const household = new Set(people.filter((p) => p.inHousehold).map((p) => p.id));
  const routine = routineEvents(input.events, household);
  const found = new Map<string, Insight>();
  const add = (i: Insight) => {
    if (!found.has(i.key)) found.set(i.key, i);
  };

  // data_health: a visible calendar's recorded freshness.
  for (const { calendar: c, rule } of unhealthyCalendars(input.calendars, now)) {
    const stale = rule === 'data_health.stale';
    const at = stale ? c.lastSyncedAt! : (c.lastAttemptAt ?? now);
    add({
      key: `${rule}:${c.id}:${homeDate(at, timeZone)}`,
      kind: 'data_health',
      rule,
      when: today,
      text: stale
        ? `${c.name} hasn’t updated since ${sinceWord(at, today, timeZone)}.`
        : `${c.name} didn’t update the last time it was checked.`,
      facts: [{ kind: 'calendar', id: c.id }],
      basis: stale ? { lastSyncedAt: at.toISOString() } : { lastSyncStatus: c.lastSyncStatus! },
      onObject: false,
    });
  }

  // preparation.birthday: a visible person's recorded date of birth.
  for (const p of people) {
    const next = nextBirthday(p.dateOfBirth, today);
    if (!next || next.date > last) continue;
    add({
      key: `preparation.birthday:${p.id}:${next.date}`,
      kind: 'preparation',
      rule: 'preparation.birthday',
      when: next.date,
      text: `${p.name}’s birthday is ${dayWord(next.date, today)}.`,
      facts: [{ kind: 'person', id: p.id }],
      basis: { date: next.date },
      // Today's birthday is on Today already, on its person's line or under Also today.
      onObject: next.date === today,
    });
  }

  // preparation.project_target: an active project's recorded target date, with recorded open tasks.
  for (const pr of input.projects) {
    if (pr.status !== 'active' || !pr.targetDate) continue;
    if (pr.targetDate < today || pr.targetDate > last) continue;
    const open = input.tasks.filter((t) => t.projectId === pr.id);
    if (open.length === 0) continue;
    add({
      key: `preparation.project_target:${pr.id}:${pr.targetDate}`,
      kind: 'preparation',
      rule: 'preparation.project_target',
      when: pr.targetDate,
      text: `${pr.title}’s target date is ${dayWord(pr.targetDate, today)}; ${numberWord(open.length)} ${open.length === 1 ? 'task is' : 'tasks are'} open.`,
      facts: [
        { kind: 'project', id: pr.id },
        ...open.map((t) => ({ kind: 'task' as const, id: t.id })),
      ],
      basis: { targetDate: pr.targetDate, openTasks: open.length },
      onObject: pr.targetDate === today, // on Today under Also today
    });
  }

  // busy_day: today's is said by the headline (on object); tomorrow's is an insight.
  for (const date of [today, addDays(today, 1)]) {
    const isToday = date === today;
    const once = new Map<string, EventItem>();
    for (const i of eventsOn(days, date))
      if (!routine.has(i.eventId) && !once.has(occurrenceKey(i))) once.set(occurrenceKey(i), i);
    const counted = [...once.values()];
    if (counted.length >= BUSY_DAY_COUNT)
      add({
        key: `busy_day.count:${counted.length}:${date}`,
        kind: 'busy_day',
        rule: 'busy_day.count',
        when: date,
        text: isToday
          ? `${capitalise(numberWord(counted.length))} things on today.`
          : `Tomorrow has ${numberWord(counted.length)} things on.`,
        facts: counted.map(eventFact),
        basis: { count: counted.length, threshold: BUSY_DAY_COUNT },
        onObject: isToday,
      });
    const late = lateOn(days, date, people, timeZone);
    if (late) {
      const ids = late.facts
        .filter((f): f is Extract<Fact, { kind: 'person' }> => f.kind === 'person')
        .map((f) => f.id)
        .sort();
      add({
        key: `busy_day.late:${ids.join('.')}:${date}`,
        kind: 'busy_day',
        rule: 'busy_day.late',
        when: date,
        text: lateSentence(late.names, isToday ? 'today' : 'tomorrow'),
        facts: late.facts,
        basis: { after: '18:00', adults: late.names.length },
        onObject: isToday, // the headline's second sentence
      });
    }
  }

  const all = [...found.values()].sort(compareInsights);
  const dismissed = input.dismissed ?? new Set<string>();
  const eligible = all.filter((i) => !i.onObject && !dismissed.has(i.key));
  return {
    all,
    shown: eligible.slice(0, SHOWN),
    more: Math.max(0, eligible.length - SHOWN),
  };
}
