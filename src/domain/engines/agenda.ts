import { birthdayInYear } from './profile';
import { expandEvent, type RecurringEvent } from './recurrence';
import { addDays, daysBetween, isoDateInZone, parseIsoDate, type IsoDate } from '@/lib/dates';

// The agenda engine (M3 contract §5): one deterministic list of dated items
// over a range of days, for Today, Forward and a person's Coming up. Pure:
// the caller reads the records through the domain services (so visibility,
// archive and sensitivity are already applied), computes the range in the
// home time zone, and passes everything in. No screen re-implements dates.
//
// Within a day: all-day items first (all-day events, then birthdays, then
// project target dates, then tasks due), then timed events by start
// (ADR 0005 §27). Ties break by title, then id, so the order never depends
// on the order the inputs arrived in.

export type AgendaEventInput = RecurringEvent & {
  id: string;
  title: string;
  /** People attending or responsible, as the caller resolved them. */
  people?: readonly AgendaPersonRef[];
};
export type AgendaPersonRef = { personId: string; role: 'attending' | 'responsible' };
export type AgendaPersonInput = { id: string; name: string; dateOfBirth: IsoDate | null };
export type AgendaTaskInput = {
  id: string;
  title: string;
  status: string;
  dueDate: IsoDate | null;
};
export type AgendaProjectInput = {
  id: string;
  title: string;
  status: string;
  targetDate: IsoDate | null;
};

export type AgendaItem =
  | {
      kind: 'event';
      allDay: true;
      date: IsoDate;
      eventId: string;
      title: string;
      /** The occurrence's own start date, for "skip this one". */
      occurrenceDate: IsoDate;
      /** For an all-day event over several days: which day of how many this is. */
      day: number;
      days: number;
      people: readonly AgendaPersonRef[];
    }
  | {
      kind: 'event';
      allDay: false;
      date: IsoDate;
      eventId: string;
      title: string;
      occurrenceDate: IsoDate;
      startsAt: Date;
      endsAt: Date;
      timeZone: string;
      people: readonly AgendaPersonRef[];
    }
  | { kind: 'birthday'; date: IsoDate; personId: string; name: string; age: number }
  | { kind: 'project_target'; date: IsoDate; projectId: string; title: string }
  | { kind: 'task_due'; date: IsoDate; taskId: string; title: string };

export type AgendaDay = { date: IsoDate; items: AgendaItem[] };

export type AgendaInput = {
  /** First and last day, inclusive, as calendar dates in `timeZone`. */
  from: IsoDate;
  to: IsoDate;
  /** The home time zone: timed events are placed on the day they start there. */
  timeZone: string;
  events?: readonly AgendaEventInput[];
  people?: readonly AgendaPersonInput[];
  tasks?: readonly AgendaTaskInput[];
  projects?: readonly AgendaProjectInput[];
};

/** Longest range the engine expands: a year and a bit (Forward needs 90 days). */
export const MAX_AGENDA_DAYS = 400;

const OPEN_TASK = 'open';
const DONE_PROJECT = 'done';

/** All-day kinds in their order within a day. */
const ALL_DAY_RANK: Record<AgendaItem['kind'], number> = {
  event: 0,
  birthday: 1,
  project_target: 2,
  task_due: 3,
};

const titleOf = (i: AgendaItem) => (i.kind === 'birthday' ? i.name : i.title);
const idOf = (i: AgendaItem) =>
  i.kind === 'event'
    ? `${i.eventId}:${i.occurrenceDate}`
    : i.kind === 'birthday'
      ? i.personId
      : i.kind === 'project_target'
        ? i.projectId
        : i.taskId;
const isTimed = (i: AgendaItem): i is Extract<AgendaItem, { allDay: false }> =>
  i.kind === 'event' && i.allDay === false;

/** The order of items within one day. Exported so every screen sorts alike. */
export function compareAgendaItems(a: AgendaItem, b: AgendaItem): number {
  const ta = isTimed(a);
  const tb = isTimed(b);
  if (ta !== tb) return ta ? 1 : -1; // all-day first
  if (ta && tb) {
    const d = a.startsAt.getTime() - b.startsAt.getTime();
    if (d !== 0) return d;
  } else {
    const r = ALL_DAY_RANK[a.kind] - ALL_DAY_RANK[b.kind];
    if (r !== 0) return r;
  }
  const t = titleOf(a).localeCompare(titleOf(b), 'en-NZ');
  if (t !== 0) return t;
  const x = idOf(a);
  const y = idOf(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The agenda for a range of days: one entry per day that has anything, in
 * date order, each with its items in agenda order. Empty days are left out.
 * Tasks count only while open; projects only until done. An all-day event
 * appears on every day it covers; a timed event on the day it starts in
 * the home zone.
 */
export function agenda(input: AgendaInput): AgendaDay[] {
  const { from, to, timeZone } = input;
  parseIsoDate(from);
  parseIsoDate(to);
  if (to < from) return [];
  if (addDays(from, MAX_AGENDA_DAYS) < to)
    throw new RangeError(`an agenda covers at most ${MAX_AGENDA_DAYS} days`);
  const inRange = (d: IsoDate) => d >= from && d <= to;
  const items: AgendaItem[] = [];

  for (const e of input.events ?? []) {
    const people = e.people ?? [];
    if (e.allDay) {
      // An occurrence covering any day in range: start up to its length before `from`.
      const length = Math.max(1, daysOf(e.startDate, e.endDate));
      for (const o of expandEvent(e, addDays(from, -(length - 1)), to)) {
        if (!o.allDay) continue;
        const days = Math.max(1, daysOf(o.startDate, o.endDate));
        for (let k = 0; k < days; k++) {
          const date = addDays(o.startDate, k);
          if (inRange(date))
            items.push({
              kind: 'event',
              allDay: true,
              date,
              eventId: e.id,
              title: e.title,
              occurrenceDate: o.date,
              day: k + 1,
              days,
              people,
            });
        }
      }
    } else {
      // Expand a day either side in the event's zone, then place each start
      // on its date in the home zone, which may differ.
      for (const o of expandEvent(e, addDays(from, -1), addDays(to, 1))) {
        if (o.allDay) continue;
        const date = isoDateInZone(o.startsAt, timeZone);
        if (inRange(date))
          items.push({
            kind: 'event',
            allDay: false,
            date,
            eventId: e.id,
            title: e.title,
            occurrenceDate: o.date,
            startsAt: o.startsAt,
            endsAt: o.endsAt,
            timeZone: o.timeZone,
            people,
          });
      }
    }
  }

  const firstYear = parseIsoDate(from).year;
  const lastYear = parseIsoDate(to).year;
  for (const p of input.people ?? []) {
    if (!p.dateOfBirth) continue;
    const born = parseIsoDate(p.dateOfBirth).year;
    for (let year = Math.max(firstYear, born + 1); year <= lastYear; year++) {
      const date = birthdayInYear(p.dateOfBirth, year);
      if (inRange(date))
        items.push({ kind: 'birthday', date, personId: p.id, name: p.name, age: year - born });
    }
  }

  for (const t of input.tasks ?? [])
    if (t.status === OPEN_TASK && t.dueDate && inRange(t.dueDate))
      items.push({ kind: 'task_due', date: t.dueDate, taskId: t.id, title: t.title });

  for (const p of input.projects ?? [])
    if (p.status !== DONE_PROJECT && p.targetDate && inRange(p.targetDate))
      items.push({ kind: 'project_target', date: p.targetDate, projectId: p.id, title: p.title });

  const byDate = new Map<IsoDate, AgendaItem[]>();
  for (const i of items) {
    const list = byDate.get(i.date);
    if (list) list.push(i);
    else byDate.set(i.date, [i]);
  }
  return [...byDate.keys()]
    .sort()
    .map((date) => ({ date, items: byDate.get(date)!.sort(compareAgendaItems) }));
}

/** Days an all-day span covers (its end is exclusive). */
const daysOf = (start: IsoDate, end: IsoDate) => daysBetween(start, end);

/** The agenda of a single day. */
export function agendaDay(
  input: Omit<AgendaInput, 'from' | 'to'> & { date: IsoDate },
): AgendaItem[] {
  const { date, ...rest } = input;
  return agenda({ ...rest, from: date, to: date })[0]?.items ?? [];
}

/** Only the items involving one person: their events (any role) and their birthday. */
export function forPerson(days: AgendaDay[], personId: string): AgendaDay[] {
  return days
    .map((d) => ({
      date: d.date,
      items: d.items.filter((i) =>
        i.kind === 'event'
          ? i.people.some((p) => p.personId === personId)
          : i.kind === 'birthday' && i.personId === personId,
      ),
    }))
    .filter((d) => d.items.length > 0);
}
