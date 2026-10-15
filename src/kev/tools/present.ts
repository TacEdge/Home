import 'server-only';
import { z } from 'zod';
import { EVENT_KINDS } from '@/domain/events/schema';
import type { AgendaDay, AgendaItem, AgendaPersonRef } from '@/domain/engines/agenda';
import type { Fact } from '@/domain/engines/day-facts';
import type { Insight } from '@/domain/engines/insights';
import { atHome } from '@/domain/engines/weather';
import type { IsoDate } from '@/lib/dates';
import {
  dateSchema,
  homeInstant,
  instantSchema,
  refSchema,
  TEXT_CAP,
  untrusted,
  untrustedSchema,
  type Ref,
} from './types';

// The minimised shapes several tools share (contract §6.2, §6.3): an agenda
// item, a person on it, an insight. Ids, titles, times, dates, kinds, first
// names and roles only: never a description, location, date of birth,
// email, user id or calendar address. Every title and name is labelled.

/** What the tools know of a visible person: their id and recorded name. */
export type PersonNames = ReadonlyMap<string, { name: string }>;

export const personOnSchema = z
  .object({
    ref: refSchema,
    name: untrustedSchema(TEXT_CAP.name),
    role: z.enum(['attending', 'responsible']),
  })
  .strict();
export type PersonOn = z.output<typeof personOnSchema>;

export const personRef = (id: string): Ref => ({ type: 'person', id });

/** The people recorded on an item who the reader can see, with their roles (the agenda already resolved them). */
export function peopleOn(people: readonly AgendaPersonRef[], names: PersonNames): PersonOn[] {
  const out: PersonOn[] = [];
  for (const p of people) {
    const who = names.get(p.personId);
    if (!who) continue;
    out.push({
      ref: personRef(p.personId),
      name: untrusted(who.name, TEXT_CAP.name),
      role: p.role,
    });
  }
  return out;
}

/** An occurrence's ref: the event, with its start (an all-day one's at the start of its home day). */
export function occurrenceRef(item: Extract<AgendaItem, { kind: 'event' }>, timeZone: string): Ref {
  const start = item.allDay ? atHome(item.occurrenceDate, '00:00', timeZone) : item.startsAt;
  return { type: 'event', id: item.eventId, at: homeInstant(start, timeZone) };
}

export const agendaItemSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('event'),
      ref: refSchema,
      title: untrustedSchema(TEXT_CAP.title),
      all_day: z.boolean(),
      start: instantSchema.optional(),
      end: instantSchema.optional(),
      /** For an occurrence over several home days: which of how many this day is. */
      day: z.number().int().min(1).optional(),
      days: z.number().int().min(2).optional(),
      kind: z.enum(EVENT_KINDS).nullable(),
      people: z.array(personOnSchema).max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal('birthday'),
      ref: refSchema,
      name: untrustedSchema(TEXT_CAP.name),
      age: z.number().int().min(0).max(150),
    })
    .strict(),
  z
    .object({
      type: z.literal('task_due'),
      ref: refSchema,
      title: untrustedSchema(TEXT_CAP.title),
      due: dateSchema,
    })
    .strict(),
  z
    .object({
      /** A project's target date (Today's Also today only). */
      type: z.literal('project_target'),
      ref: refSchema,
      title: untrustedSchema(TEXT_CAP.title),
      date: dateSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('task_scheduled'),
      ref: refSchema,
      title: untrustedSchema(TEXT_CAP.title),
      start: instantSchema,
      end: instantSchema,
    })
    .strict(),
]);
export type AgendaItemOut = z.output<typeof agendaItemSchema>;

/** One agenda item as the model sees it, with the refs of every record in it. */
export function agendaItem(
  item: AgendaItem,
  names: PersonNames,
  timeZone: string,
): { out: AgendaItemOut; refs: Ref[] } {
  switch (item.kind) {
    case 'event': {
      const ref = occurrenceRef(item, timeZone);
      const people = peopleOn(item.people, names);
      return {
        out: {
          type: 'event',
          ref,
          title: untrusted(item.title, TEXT_CAP.title),
          all_day: item.allDay,
          ...(item.allDay
            ? {}
            : {
                start: homeInstant(item.startsAt, timeZone),
                end: homeInstant(item.endsAt, timeZone),
              }),
          ...(item.days > 1 ? { day: item.day, days: item.days } : {}),
          kind: item.eventKind,
          people,
        },
        refs: [ref, ...people.map((p) => p.ref)],
      };
    }
    case 'birthday': {
      const ref = personRef(item.personId);
      return {
        out: { type: 'birthday', ref, name: untrusted(item.name, TEXT_CAP.name), age: item.age },
        refs: [ref],
      };
    }
    case 'task_due': {
      const ref: Ref = { type: 'task', id: item.taskId };
      return {
        out: {
          type: 'task_due',
          ref,
          title: untrusted(item.title, TEXT_CAP.title),
          due: item.date,
        },
        refs: [ref],
      };
    }
    case 'task_scheduled': {
      const ref: Ref = { type: 'task', id: item.taskId };
      return {
        out: {
          type: 'task_scheduled',
          ref,
          title: untrusted(item.title, TEXT_CAP.title),
          start: homeInstant(item.startsAt, timeZone),
          end: homeInstant(item.endsAt, timeZone),
        },
        refs: [ref],
      };
    }
    case 'project_target': {
      const ref: Ref = { type: 'project', id: item.projectId };
      return {
        out: {
          type: 'project_target',
          ref,
          title: untrusted(item.title, TEXT_CAP.title),
          date: item.date,
        },
        refs: [ref],
      };
    }
  }
}

/** Every event occurrence on the days, by `{eventId}:{occurrenceDate}`, for a fact's ref. */
export function occurrenceIndex(
  days: readonly AgendaDay[],
): Map<string, Extract<AgendaItem, { kind: 'event' }>> {
  const out = new Map<string, Extract<AgendaItem, { kind: 'event' }>>();
  for (const d of days)
    for (const i of d.items)
      if (i.kind === 'event') {
        const k = `${i.eventId}:${i.occurrenceDate}`;
        if (!out.has(k)) out.set(k, i);
      }
  return out;
}

/**
 * A fact's ref (the records an insight, conflict or gap stands on). An
 * event's carries its occurrence's start when the read placed it; ranges,
 * planning hours, daylight and the forecast are not records.
 */
export function factRef(
  f: Fact | { kind: 'calendar'; id: string },
  occurrences: ReadonlyMap<string, Extract<AgendaItem, { kind: 'event' }>>,
  timeZone: string,
): Ref | null {
  switch (f.kind) {
    case 'event': {
      const placed = occurrences.get(`${f.id}:${f.occurrenceDate}`);
      if (placed) return occurrenceRef(placed, timeZone);
      return {
        type: 'event',
        id: f.id,
        at: homeInstant(atHome(f.occurrenceDate as IsoDate, '00:00', timeZone), timeZone),
      };
    }
    case 'task':
    case 'person':
    case 'project':
    case 'calendar':
      return { type: f.kind, id: f.id };
    default:
      return null;
  }
}

export const insightSchema = z
  .object({
    ref: refSchema,
    key: z.string().min(1).max(200),
    kind: z.enum(['data_health', 'conflict', 'preparation', 'busy_day', 'open_window']),
    rule: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
    when: dateSchema,
    /** The insight's template sentence: code wrote it, but it carries recorded titles and names. */
    text: untrustedSchema(TEXT_CAP.sentence),
    /** `list`: in the surface's list; `item`: said on its item or indicator instead (never listed). */
    shown_on: z.enum(['list', 'item']),
    refs: z.array(refSchema).max(20),
  })
  .strict();
export type InsightOut = z.output<typeof insightSchema>;

export function insightOut(
  i: Insight,
  shownOn: 'list' | 'item',
  occurrences: ReadonlyMap<string, Extract<AgendaItem, { kind: 'event' }>>,
  timeZone: string,
): { out: InsightOut; refs: Ref[] } {
  const ref: Ref = { type: 'insight', id: i.key };
  const facts: Ref[] = [];
  const seen = new Set<string>();
  for (const f of i.facts) {
    const r = factRef(f, occurrences, timeZone);
    if (!r) continue;
    const k = `${r.type}|${r.id}|${r.at ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    facts.push(r);
  }
  const refs = facts.slice(0, 20);
  return {
    out: {
      ref,
      key: i.key,
      kind: i.kind,
      rule: i.rule,
      when: i.when,
      text: untrusted(i.text, TEXT_CAP.sentence),
      shown_on: shownOn,
      refs,
    },
    refs: [ref, ...refs],
  };
}
