import { checkboxOf, choiceOf, requiredTextOf, textOf } from '@/app/_forms/read';
import { FormFieldError } from '@/app/_forms/errors';
import {
  RecurrenceError,
  readRRule,
  toRRule,
  type EventStart,
  type Recurrence,
  type RecurrenceEnd,
} from '@/domain/engines/recurrence';
import type { EventPersonChoice, Event } from '@/domain/events/service';
import type { CreateEventInput, UpdateEventInput } from '@/domain/events/schema';
import { addDays, instantFromWallClock, isValidIsoDate, parseIsoDate } from '@/lib/dates';

// The event form, read into the shared Zod schema's shape (M3 contract
// §3.6, §4.1). Pure. Times are read as the person wrote them (a date, a
// start and an end time) in the event's zone and turned into instants;
// an all-day end date is shown inclusive and stored exclusive (ADR 0005
// §26). Recurrence is read into the model and written as an RRULE by the
// engine. The schema still validates everything else.

export type ReadEvent = {
  input: CreateEventInput | UpdateEventInput;
  people: EventPersonChoice[];
};

const TIME = /^(\d{2}):(\d{2})$/;

function wall(date: string, time: string) {
  const m = TIME.exec(time);
  if (!isValidIsoDate(date) || !m) return null;
  return { ...parseIsoDate(date), hour: Number(m[1]), minute: Number(m[2]), second: 0 };
}

function readTime(form: FormData, timeZone: string): CreateEventInput['time'] {
  const startDate = requiredTextOf(form, 'startDate').trim();
  if (checkboxOf(form, 'allDay')) {
    const shownEnd = textOf(form, 'endDate') ?? startDate;
    const fields: Record<string, string> = {};
    if (!isValidIsoDate(startDate)) fields.startDate = 'This needs a real date.';
    if (!isValidIsoDate(shownEnd)) fields.endDate = 'This needs a real date.';
    if (Object.keys(fields).length) throw new FormFieldError(fields);
    if (shownEnd < startDate) throw new FormFieldError({ endDate: 'The end is before the start.' });
    return { allDay: true, startDate, endDate: addDays(shownEnd, 1) };
  }
  const givenEnd = textOf(form, 'endDate') ?? null;
  const endDate = givenEnd ?? startDate;
  const startTime = requiredTextOf(form, 'startTime').trim();
  const endTime = requiredTextOf(form, 'endTime').trim();
  // Each control is judged on its own, so a bad date does not make the
  // times (or an end date it stands in for) look wrong too.
  const fields: Record<string, string> = {};
  if (!isValidIsoDate(startDate)) fields.startDate = 'This needs a real date.';
  if (givenEnd !== null && !isValidIsoDate(givenEnd)) fields.endDate = 'This needs a real date.';
  if (!TIME.test(startTime)) fields.startTime = 'This needs a time, like 15:30.';
  if (!TIME.test(endTime)) fields.endTime = 'This needs a time, like 16:15.';
  if (Object.keys(fields).length) throw new FormFieldError(fields);
  const startsAt = instantFromWallClock(wall(startDate, startTime)!, timeZone);
  const endsAt = instantFromWallClock(wall(endDate, endTime)!, timeZone);
  if (endsAt.getTime() < startsAt.getTime())
    throw new FormFieldError({ endTime: 'The end is before the start.' });
  return {
    allDay: false,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    timeZone,
  };
}

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function readRecurrence(form: FormData, start: EventStart): string | null | undefined {
  const repeat = choiceOf(form, 'repeat');
  if (repeat === undefined || repeat === 'custom') return undefined; // leave the stored rule alone
  if (repeat === 'none') return null;
  const endType = choiceOf(form, 'ends') ?? 'never';
  let end: RecurrenceEnd = { type: 'never' };
  if (endType === 'on') {
    const date = textOf(form, 'endsOn');
    if (!date || !isValidIsoDate(date))
      throw new FormFieldError({ endsOn: 'This needs a real date.' });
    end = { type: 'until', date };
  } else if (endType === 'after') {
    const n = Number(textOf(form, 'endsAfter'));
    if (!Number.isInteger(n) || n < 1)
      throw new FormFieldError({ endsAfter: 'How many times? A whole number, 1 or more.' });
    end = { type: 'count', count: n };
  }
  const weekdays = WEEKDAYS.filter((d) => form.get(`weekdays_${d}`) === 'on');
  let r: Recurrence;
  switch (repeat) {
    case 'daily':
    case 'monthly':
    case 'yearly':
      r = { preset: repeat, end };
      break;
    case 'weekly':
    case 'fortnightly':
      if (weekdays.length === 0) throw new FormFieldError({ weekdays: 'Pick at least one day.' });
      r = { preset: repeat, weekdays, end };
      break;
    default:
      throw new FormFieldError({ repeat: 'That doesn’t look right.' });
  }
  try {
    return toRRule(r, start);
  } catch (e) {
    if (e instanceof RecurrenceError) {
      const field = end.type === 'until' ? 'endsOn' : end.type === 'count' ? 'endsAfter' : 'repeat';
      throw new FormFieldError({ [field]: calm(e.message) });
    }
    throw e;
  }
}

const calm = (m: string) =>
  m.startsWith('the end date is before')
    ? 'That’s before the first one.'
    : `${m[0]!.toUpperCase()}${m.slice(1)}.`;

/** The people ticked, among those the form offered. */
export function readPeople(form: FormData, peopleIds: readonly string[]): EventPersonChoice[] {
  const out: EventPersonChoice[] = [];
  for (const id of peopleIds) {
    if (form.get(`attending_${id}`) === 'on') out.push({ personId: id, role: 'attending' });
    if (form.get(`responsible_${id}`) === 'on') out.push({ personId: id, role: 'responsible' });
  }
  return out;
}

/** Reads the whole form. `peopleIds` are the people the form offered (so no other id can be sent). */
export function readEventForm(
  form: FormData,
  opts: { timeZone: string; peopleIds: readonly string[]; current?: Event },
): ReadEvent {
  const time = readTime(form, opts.current?.timeZone ?? opts.timeZone);
  const start: EventStart = time.allDay
    ? { allDay: true, startDate: time.startDate }
    : { allDay: false, startsAt: new Date(time.startsAt as string), timeZone: time.timeZone };
  const rrule = readRecurrence(form, start);
  const base = {
    title: requiredTextOf(form, 'title'),
    kind: (choiceOf(form, 'kind') ?? 'other') as CreateEventInput['kind'],
    location: textOf(form, 'location') ?? null,
    description: textOf(form, 'description') ?? null,
    domain: (textOf(form, 'domain') ?? null) as CreateEventInput['domain'],
    visibility: (choiceOf(form, 'visibility') ?? 'household') as CreateEventInput['visibility'],
    time,
  };
  const input: CreateEventInput | UpdateEventInput =
    rrule === undefined
      ? base
      : rrule === null
        ? { ...base, rrule: null, exdates: null }
        : { ...base, rrule };
  return { input, people: readPeople(form, opts.peopleIds) };
}

/** The repeat controls' values for an existing event, from its stored rule. */
export function recurrenceFields(e: Event) {
  const start: EventStart = e.allDay
    ? { allDay: true, startDate: e.startDate! }
    : { allDay: false, startsAt: e.startsAt!, timeZone: e.timeZone! };
  const r = readRRule(e.rrule, start);
  const end = r.preset === 'none' || r.preset === 'custom' ? null : r.end;
  return {
    repeat: r.preset,
    weekdays: new Set(
      (r.preset === 'weekly' || r.preset === 'fortnightly' ? r.weekdays : []).map(String),
    ),
    ends: end?.type === 'until' ? 'on' : end?.type === 'count' ? 'after' : 'never',
    endsOn: end?.type === 'until' ? end.date : '',
    endsAfter: end?.type === 'count' ? String(end.count) : '',
    read: r,
  };
}
