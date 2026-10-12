import type { AgendaDay, AgendaPersonRef } from './agenda';
import { PLANNING_FROM, PLANNING_TO } from './planning';
import { unhealthyCalendars, type TodayCalendar } from './today';
import {
  addDays,
  formatIsoDate,
  instantFromWallClock,
  parseIsoDate,
  wallClockOf,
  type IsoDate,
} from '@/lib/dates';

// The gap engine (M7 Package 2; contract §5.4–§5.5, ADR 0011 §22–§28). It
// states one thing, and only this, from the records the reader can see:
//
//   gap.household  a stretch of a home date's planning hours in which nothing
//                  the reader can see is recorded for the household;
//   gap.person     the same for one person the reader can see.
//
// A gap is "nothing recorded", never "free": it says nothing of anyone's
// plans, availability or what they should do, and carries no words at all
// (the templates are Package 3's). Pure: the caller reads every record
// through the domain services as the reader (so visibility, archive and
// sensitivity are already applied), runs the shared agenda over at least the
// range and passes it in, with the reader's scheduled tasks and calendars.
// No I/O, no clock (`now` is injected), stable sorts with explicit tie-breaks.
//
// Events come from the agenda's days (it places an occurrence on every home
// day it covers). Scheduled tasks do not: the agenda places a task only on the
// home day its window starts, so a window that began before the range would
// never reach a range's days. The engine takes each scheduled task's full
// window from `tasks` instead (`scheduledTasks` selects them exactly as the
// agenda does) and blocks every requested date the window covers, so a
// date's stretches do not depend on where the range starts.
//
// What blocks a stretch (§5.4; D11, D12):
//   a person's scope   the timed occurrences they are on (attending or
//                      responsible, as the agenda resolved its people), every
//                      all-day event they are on (the whole planning day), and
//                      scheduled tasks assigned to them;
//   the household      everything on a household person's scope, plus every
//                      timed occurrence and scheduled task with no household
//                      person on it (nobody, or only people outside it).
// Never: an all-day event with no household person (named instead),
// birthdays, project targets, tasks due, tasks with no window, zero-length
// occurrences, skipped occurrences (absent from the agenda). Kind is never
// read. Instants are compared in UTC; a stretch is named in home wall time.
//
// Identity (§5.4, ADR 0011 §27): `gap:{household|personId}:{date}:{HHMM}-{HHMM}`
// from the stretch's home wall clock, computed as if `now` were before the day
// began, so a key never moves as the day goes on. Only the shown span is
// clipped to `now`. Ids and times only: no text, no viewing date.

/** The shortest stretch the engine returns (D10): openings ask for more (Package 3). */
export const GAP_FLOOR_MINUTES = 60;

export const GAP_RULES = ['gap.household', 'gap.person'] as const;
export type GapRule = (typeof GAP_RULES)[number];
export const COVERAGE_RULES = [
  'coverage.recorded',
  'coverage.partial',
  'coverage.unknown',
] as const;
export type CoverageRule = (typeof COVERAGE_RULES)[number];

/** The household's scope; any other scope is a person id. */
export const HOUSEHOLD = 'household';
export type GapScope = string;

/** A person the reader can see. Only these can be in a scope. */
export type GapPerson = { id: string; inHousehold: boolean };
/** A scheduled task the reader can see: its full window and who it is assigned to. */
export type GapTask = {
  id: string;
  assigneePersonId: string | null;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
};

/** A task record as the reader's agenda read gives it (the fields selection needs). */
export type GapTaskRecord = {
  id: string;
  status: string;
  assigneePersonId: string | null;
  scheduledStartsAt?: Date | null;
  scheduledEndsAt?: Date | null;
};

/**
 * The tasks the shared agenda treats as scheduled (agenda.ts: open, with both
 * ends of a window), from the same authorised task records the agenda was
 * given, so visibility and archive are the read's and nothing else is added
 * or dropped. Only where it places them differs: the gap engine uses the
 * whole window.
 */
export function scheduledTasks(tasks: readonly GapTaskRecord[]): GapTask[] {
  const out: GapTask[] = [];
  for (const t of tasks)
    if (t.status === 'open' && t.scheduledStartsAt && t.scheduledEndsAt)
      out.push({
        id: t.id,
        assigneePersonId: t.assigneePersonId,
        scheduledStartsAt: t.scheduledStartsAt,
        scheduledEndsAt: t.scheduledEndsAt,
      });
  return out;
}

/** A visible calendar's freshness, as M5's rules read it, plus "never succeeded" (§5.5). */
export type CalendarHealth = 'ok' | 'failed' | 'stale' | 'never';

/**
 * What a gap or its coverage stands on: ids, dates and times only, never
 * text, so nothing a person wrote travels with it (ADR 0008 §6).
 */
export type GapFact =
  | { kind: 'planning'; from: string; to: string }
  | { kind: 'range'; from: IsoDate; to: IsoDate }
  | { kind: 'person'; id: string }
  | { kind: 'event'; id: string; occurrenceDate: IsoDate }
  | { kind: 'task'; id: string }
  | { kind: 'calendar'; id: string; health: CalendarHealth; lastSyncedAt: string | null };
export type CommitmentFact = Extract<GapFact, { kind: 'event' | 'task' }>;
export type CalendarFact = Extract<GapFact, { kind: 'calendar' }>;

/** What HOME can vouch for, for this reader (§5.5): not per day, since calendar health has no date. */
export type Coverage = { rule: CoverageRule; calendars: CalendarFact[] };

export type Gap = {
  key: string;
  rule: GapRule;
  scope: GapScope;
  date: IsoDate;
  /** The identity: the stretch as if `now` were before the day began. */
  stretch: { from: Date; to: Date };
  /** What is shown: on today, from `now` once the stretch has begun. */
  shown: { from: Date; to: Date };
  /** The commitment that ends where the stretch begins, or null at the planning edge. */
  before: CommitmentFact | null;
  /** The commitment that begins where the stretch ends, or null at the planning edge. */
  after: CommitmentFact | null;
  /**
   * Recorded events that did not shorten it, named so the reader sees the
   * evidence (§5.4): the day's all-day events with no household person, and,
   * for a person, timed events with no household person over the shown span.
   */
  unblocking: CommitmentFact[];
  facts: GapFact[];
};

export type GapsInput = {
  now: Date;
  /** The home zone: planning hours, dates and keys use its wall clock. */
  timeZone: string;
  /** The home dates asked for, inclusive. */
  range: { from: IsoDate; to: IsoDate };
  /**
   * The home dates the agenda was computed over (what conflicts and Forward
   * call `coverage`). The agenda leaves empty days out, so only this says
   * which absent days were loaded and empty. It must hold the whole range.
   */
  agendaRange: { from: IsoDate; to: IsoDate };
  /** The shared agenda's days over at least the range (its scheduled-task items are not read). */
  days: readonly AgendaDay[];
  /** The people the reader can see. */
  people: readonly GapPerson[];
  /** The reader's scheduled tasks (`scheduledTasks`), each with its full window and assignee. */
  tasks: readonly GapTask[];
  /** The calendars the reader can see (archived ones are ignored). */
  calendars: readonly TodayCalendar[];
  /** `household`, and/or the ids of people the reader can see. */
  scopes: readonly GapScope[];
};

export type Gaps = { coverage: Coverage; gaps: Gap[] };

/** Thrown when the agenda does not cover the range: absence there would mean nothing. */
export class GapRangeError extends Error {
  constructor(range: { from: IsoDate; to: IsoDate }, agenda: { from: IsoDate; to: IsoDate }) {
    super(`the agenda covers ${agenda.from}…${agenda.to}, not the range ${range.from}…${range.to}`);
    this.name = 'GapRangeError';
  }
}

/** Thrown for a scope that is neither the household nor a person the reader can see. */
export class GapScopeError extends Error {
  constructor() {
    super('a scope is the household or a person the reader can see');
    this.name = 'GapScopeError';
  }
}

const MINUTE = 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** A commitment on one home date: its people, and whether any of them is in the household. */
type Commitment = {
  fact: CommitmentFact;
  /** `event:{id}:{date}` or `task:{id}`: the final tie-break. */
  ref: string;
  people: ReadonlySet<string>;
  /** Someone in the household is on it (so it is on that person's scope). */
  household: boolean;
};
type Timed = Commitment & { from: number; to: number; event: boolean };
type DayRecords = { allDay: Commitment[]; timed: Timed[] };

const refOf = (f: CommitmentFact) =>
  f.kind === 'event' ? `event:${f.id}:${f.occurrenceDate}` : `task:${f.id}`;
const byRef = (a: { ref: string }, b: { ref: string }) =>
  a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;

/** The instant a home wall clock names on a date, through the IANA zone (never date + 24 h). */
function atHome(date: IsoDate, clock: string, timeZone: string): number {
  const [hour, minute] = clock.split(':').map(Number) as [number, number];
  return instantFromWallClock(
    { ...parseIsoDate(date), hour, minute, second: 0 },
    timeZone,
  ).getTime();
}

/** The calendars the reader can see, with their health, and what HOME can vouch for. */
export function coverageOf(calendars: readonly TodayCalendar[], now: Date): Coverage {
  const live = calendars
    .filter((c) => c.archivedAt === null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (live.length === 0) return { rule: 'coverage.unknown', calendars: [] };
  // M5's thresholds (failed; last success over 24 hours old), then never succeeded.
  const unhealthy = new Map(
    unhealthyCalendars(live, now).map((u) => [
      u.calendar.id,
      u.rule === 'data_health.failed' ? ('failed' as const) : ('stale' as const),
    ]),
  );
  const facts = live.map((c): CalendarFact => ({
    kind: 'calendar',
    id: c.id,
    health: unhealthy.get(c.id) ?? (c.lastSyncedAt === null ? 'never' : 'ok'),
    lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
  }));
  return {
    rule: facts.every((f) => f.health === 'ok') ? 'coverage.recorded' : 'coverage.partial',
    calendars: facts,
  };
}

/**
 * The reader's gaps over the range, for each scope asked for, in order: date,
 * then the stretch's start, then the key (a total order). With no live
 * calendar the coverage is `unknown` and there are none.
 */
export function gaps(input: GapsInput): Gaps {
  const { now, timeZone, range, agendaRange } = input;
  parseIsoDate(range.from);
  parseIsoDate(range.to);
  if (agendaRange.from > range.from || agendaRange.to < range.to)
    throw new GapRangeError(range, agendaRange);

  const visible = new Set(input.people.map((p) => p.id));
  const household = new Set(input.people.filter((p) => p.inHousehold).map((p) => p.id));
  const scopes = [...new Set(input.scopes)];
  for (const s of scopes) if (s !== HOUSEHOLD && !visible.has(s)) throw new GapScopeError();

  const coverage = coverageOf(input.calendars, now);
  if (coverage.rule === 'coverage.unknown' || range.to < range.from) return { coverage, gaps: [] };

  const homeDate = (t: number) => formatIsoDate(wallClockOf(new Date(t), timeZone));
  // Each instant's wall clock once per run: stretches share their bounds.
  const clocks = new Map<number, string>();
  const hhmm = (t: number) => {
    let c = clocks.get(t);
    if (c === undefined) {
      const w = wallClockOf(new Date(t), timeZone);
      clocks.set(t, (c = `${pad(w.hour)}${pad(w.minute)}`));
    }
    return c;
  };
  const inRange = (d: IsoDate) => d >= range.from && d <= range.to;
  const records = new Map<IsoDate, DayRecords>();
  const recordsOn = (d: IsoDate) => {
    let r = records.get(d);
    if (!r) records.set(d, (r = { allDay: [], timed: [] }));
    return r;
  };
  const whoIsOn = (people: readonly AgendaPersonRef[]) => {
    const on = new Set(people.map((p) => p.personId).filter((id) => visible.has(id)));
    return { people: on, household: [...on].some((id) => household.has(id)) };
  };

  for (const d of input.days)
    for (const i of d.items) {
      if (i.kind === 'event' && inRange(d.date)) {
        const fact: CommitmentFact = {
          kind: 'event',
          id: i.eventId,
          occurrenceDate: i.occurrenceDate,
        };
        const c = { fact, ref: refOf(fact), ...whoIsOn(i.people) };
        // The agenda places an occurrence on every home day it covers.
        if (i.allDay) recordsOn(d.date).allDay.push(c);
        else if (i.endsAt > i.startsAt)
          recordsOn(d.date).timed.push({
            ...c,
            from: i.startsAt.getTime(),
            to: i.endsAt.getTime(),
            event: true,
          });
      }
    }

  // Scheduled tasks from their records, not the agenda's placement: each
  // blocks every requested home date its window covers, from the date it
  // starts to the date before it ends (an end at midnight does not reach the
  // next), wherever the range starts. Counted once, however often it is given.
  const seenTasks = new Set<string>();
  for (const t of input.tasks) {
    if (seenTasks.has(t.id)) continue;
    seenTasks.add(t.id);
    const from = t.scheduledStartsAt.getTime();
    const to = t.scheduledEndsAt.getTime();
    if (to <= from) continue;
    const fact: CommitmentFact = { kind: 'task', id: t.id };
    const who = t.assigneePersonId;
    const c = {
      fact,
      ref: refOf(fact),
      ...whoIsOn(who ? [{ personId: who, role: 'responsible' }] : []),
    };
    const first = homeDate(from);
    const last = homeDate(to - 1);
    for (
      let date = first < range.from ? range.from : first;
      date <= last && date <= range.to;
      date = addDays(date, 1)
    )
      recordsOn(date).timed.push({ ...c, from, to, event: false });
  }

  const peopleFacts = (scope: GapScope): GapFact[] =>
    (scope === HOUSEHOLD ? [...household].sort() : [scope]).map((id) => ({ kind: 'person', id }));
  const planning: GapFact = { kind: 'planning', from: PLANNING_FROM, to: PLANNING_TO };

  const out: Gap[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    const p0 = atHome(date, PLANNING_FROM, timeZone);
    const p1 = atHome(date, PLANNING_TO, timeZone);
    const day = records.get(date) ?? { allDay: [], timed: [] };
    // The day's all-day events with no household person: they never block (D12), and are named.
    const unassignedAllDay = day.allDay.filter((a) => !a.household).sort(byRef);

    for (const scope of scopes) {
      const person = scope === HOUSEHOLD ? null : scope;
      const onScope = (c: Commitment) => (person === null ? c.household : c.people.has(person));
      // An all-day event someone in the scope is on blocks the whole planning day.
      if (day.allDay.some(onScope)) continue;
      // The household's scope adds what has no household person on it (D11).
      const blocks = (t: Timed) => onScope(t) || (person === null && !t.household);
      const intervals: Timed[] = [];
      for (const t of day.timed)
        if (blocks(t)) {
          const from = Math.max(t.from, p0);
          const to = Math.min(t.to, p1);
          if (from < to) intervals.push({ ...t, from, to });
        }
      intervals.sort((a, b) => a.from - b.from || a.to - b.to || byRef(a, b));

      // One linear sweep over the merged intervals.
      const stretches: { from: number; to: number; before: Timed | null; after: Timed | null }[] =
        [];
      let reach = p0;
      let reachBy: Timed | null = null;
      for (const b of intervals) {
        if (b.from > reach) stretches.push({ from: reach, to: b.from, before: reachBy, after: b });
        // The commitment before a stretch: the one ending there that started
        // last; on equal bounds, the first by reference (sorted above).
        if (b.to > reach || (reachBy !== null && b.to === reach && b.from > reachBy.from)) {
          reach = Math.max(reach, b.to);
          reachBy = b;
        }
      }
      if (reach < p1) stretches.push({ from: reach, to: p1, before: reachBy, after: null });

      for (const s of stretches) {
        const shownFrom = Math.max(s.from, now.getTime());
        // Under the floor once clipped to now (or over already): not returned.
        if (s.to - shownFrom < GAP_FLOOR_MINUTES * MINUTE) continue;
        const named =
          person === null
            ? unassignedAllDay
            : [
                ...unassignedAllDay,
                ...day.timed
                  .filter((t) => t.event && !t.household && t.from < s.to && t.to > shownFrom)
                  .sort((a, b) => a.from - b.from || a.to - b.to || byRef(a, b)),
              ];
        const unblocking = named.map((c) => c.fact);
        const before = s.before?.fact ?? null;
        const after = s.after?.fact ?? null;
        const key = `gap:${scope}:${date}:${hhmm(s.from)}-${hhmm(s.to)}`;
        out.push({
          key,
          rule: person === null ? 'gap.household' : 'gap.person',
          scope,
          date,
          stretch: { from: new Date(s.from), to: new Date(s.to) },
          shown: { from: new Date(shownFrom), to: new Date(s.to) },
          before,
          after,
          unblocking,
          facts: [
            planning,
            { kind: 'range', from: date, to: date },
            ...peopleFacts(scope),
            ...(before ? [before] : []),
            ...(after ? [after] : []),
            ...unblocking,
            ...coverage.calendars,
          ],
        });
      }
    }
  }
  return { coverage, gaps: out.sort(compareGaps) };
}

/** The order (§5.4): date, then the stretch's start, then the key. Total. */
export function compareGaps(a: Gap, b: Gap): number {
  return (
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    a.stretch.from.getTime() - b.stretch.from.getTime() ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}
