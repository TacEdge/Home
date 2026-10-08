import type { AgendaDay, AgendaEventInput, AgendaItem } from './agenda';
import { weeklyCadence } from './recurrence';
import { clockOf, isoDateInZone, type IsoDate } from '@/lib/dates';

// What the Today and insights engines share (ADR 0008 §6, §9, M5 contract
// §5): the structural facts every statement carries, the routine rule, and
// the few words both engines say. Pure: no database, no clock, no text a
// person wrote except the titles and names the reader can already see.

/**
 * A record a statement was built from: ids and dates only, never text, so a
 * statement can be traced to what it came from (ADR 0008 §6) and nothing
 * private is copied anywhere a fact travels.
 */
export type Fact =
  | { kind: 'event'; id: string; occurrenceDate: IsoDate }
  | { kind: 'task'; id: string }
  | { kind: 'person'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'calendar'; id: string }
  | { kind: 'range'; from: IsoDate; to: IsoDate };

export type EventItem = Extract<AgendaItem, { kind: 'event' }>;
export type TimedItem = Extract<AgendaItem, { kind: 'event'; allDay: false }>;

/** The people the engines may name: the reader's visible people, in the order People lists them. */
export type DayPerson = {
  id: string;
  name: string;
  role: 'parent' | 'child' | 'other';
  inHousehold: boolean;
};

export const eventFact = (i: EventItem): Fact => ({
  kind: 'event',
  id: i.eventId,
  occurrenceDate: i.occurrenceDate,
});

/** The items of one day, or none. */
export const itemsOn = (days: readonly AgendaDay[], date: IsoDate): AgendaItem[] =>
  days.find((d) => d.date === date)?.items ?? [];

export const eventsOn = (days: readonly AgendaDay[], date: IsoDate): EventItem[] =>
  itemsOn(days, date).filter((i): i is EventItem => i.kind === 'event');

/** One occurrence once, however many days it covers. */
export const occurrenceKey = (i: EventItem) => `${i.eventId}:${i.occurrenceDate}`;

/**
 * Routine (`routine.regular_week`, M5 contract §5.1): an item whose event is
 * a plain weekly or fortnightly series (the regular week's own test,
 * `weeklyCadence`) of kind school or work, with at least one household
 * person on it. A changed occurrence is its own row with no rule, so it is
 * never routine: a change from the usual is said in full. Decided from the
 * recorded rule and kind only; nothing about who goes where is inferred.
 */
export function routineEvents(
  events: readonly AgendaEventInput[],
  household: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const e of events)
    if (
      (e.kind === 'school' || e.kind === 'work') &&
      weeklyCadence(e.rrule) !== null &&
      (e.people ?? []).some((p) => household.has(p.personId))
    )
      out.add(e.id);
  return out;
}

/** The home-zone date an instant falls on. */
export const homeDate = (instant: Date, timeZone: string) => isoDateInZone(instant, timeZone);

/** "15:30": the home-zone clock. */
export const homeClock = (instant: Date, timeZone: string) => clockOf(instant, timeZone);

const NUMBER_WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** Numbers as words up to ten, then digits (M5 contract §5.3). */
export const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

export const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Sam", "Sam and Alex", "Sam, Alex and Jo". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
