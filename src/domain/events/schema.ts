import { z } from 'zod';
import { EVENT_KINDS, EVENT_PERSON_ROLES } from '@/db/schema/event';
import {
  domain,
  instant,
  isoDate,
  longText,
  recordId,
  requiredText,
  text,
  timeZone,
  visibility,
  isDates,
} from '../common/inputs';

// Event inputs (M2 contract §4.1–4.2). An event's time is one object, either
// timed (two instants and the IANA zone it was made in) or all-day (two
// calendar dates, the end EXCLUSIVE as RFC 5545), mirroring the database's
// event_time_shape_check and event_time_order_check exactly. Recurrence is
// stored as given and never parsed in M2 (D-M2-4). Source and the sync
// fields are never inputs: services create and edit manual events only.

export const timedTime = z
  .object({ allDay: z.literal(false), startsAt: instant, endsAt: instant, timeZone })
  .strict()
  // Zod runs object refinements even after a field failed; compare only Dates.
  .refine((t) => !isDates(t.startsAt, t.endsAt) || t.endsAt.getTime() >= t.startsAt.getTime(), {
    message: 'must not end before it starts',
    path: ['endsAt'],
  });

export const allDayTime = z
  .object({ allDay: z.literal(true), startDate: isoDate, endDate: isoDate })
  .strict()
  .refine((t) => t.endDate > t.startDate, {
    message: 'the end date is exclusive, so it must be after the start date',
    path: ['endDate'],
  });

export const eventTime = z.discriminatedUnion('allDay', [timedTime, allDayTime]);
export type EventTime = z.output<typeof eventTime>;

/** An ISO date or instant, as an EXDATE is stored (never parsed in M2). */
const exdate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/);

const fields = {
  title: requiredText(200),
  description: longText.nullable(),
  location: text(500).nullable(),
  kind: z.enum(EVENT_KINDS),
  domain: domain.nullable(),
  time: eventTime,
  rrule: text(1000).min(1).nullable(),
  exdates: z.array(exdate).max(500).nullable(),
  visibility,
};

export const createEventInput = z
  .object({
    ...fields,
    description: fields.description.optional(),
    location: fields.location.optional(),
    domain: fields.domain.optional(),
    rrule: fields.rrule.optional(),
    exdates: fields.exdates.optional(),
    visibility: fields.visibility.default('household'),
  })
  .strict();
export type CreateEventInput = z.input<typeof createEventInput>;

export const updateEventInput = z.object(fields).partial().strict();
export type UpdateEventInput = z.input<typeof updateEventInput>;

/**
 * What one occurrence of a repeating manual event can change on its own
 * (M4 contract §3.7): its title, details, kind, place and time (timed or
 * all-day, in any zone the event rules allow). Its visibility, owner,
 * domain and repetition are its series', so they are not inputs. At least
 * one field.
 */
export const occurrenceChangeInput = z
  .object({
    title: fields.title,
    description: fields.description,
    location: fields.location,
    kind: fields.kind,
    time: fields.time,
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'nothing to change' });
export type OccurrenceChangeInput = z.input<typeof occurrenceChangeInput>;

export const eventPersonInput = z
  .object({ eventId: recordId, personId: recordId, role: z.enum(EVENT_PERSON_ROLES) })
  .strict();
export type EventPersonInput = z.input<typeof eventPersonInput>;

/** The columns an event time occupies; the other shape's columns are cleared. */
export function timeColumns(t: EventTime) {
  return t.allDay
    ? {
        allDay: true,
        startDate: t.startDate,
        endDate: t.endDate,
        startsAt: null,
        endsAt: null,
        timeZone: null,
      }
    : {
        allDay: false,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        timeZone: t.timeZone,
        startDate: null,
        endDate: null,
      };
}
