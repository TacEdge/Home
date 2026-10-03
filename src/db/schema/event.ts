import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { capture } from './capture';
import { commonColumns, CREATED_VIA, DOMAINS, oneOf, VISIBILITY } from './common';
import { person } from './person';

// Anything that happens at a time (FAMILY-DATA-MODEL §3, Event; M2 contract
// §4.2). Time conventions (§4.1): a timed event is two UTC instants plus the
// IANA zone it was made in; an all-day event is two calendar dates with an
// EXCLUSIVE end, as RFC 5545 (a one-day event on the 14th ends on the 15th).
// RRULE and EXDATEs are stored as given: nothing parses or expands them in
// M2 (ADR 0005, D-M2-4). Sync fields are provider-neutral; calendar_source_id
// has no foreign key until CalendarSource exists in M4 (D-M2-3).
// Package 3a defines the tables only; services arrive in Package 3b.

export const EVENT_KINDS = [
  'appointment',
  'activity',
  'work',
  'school',
  'social',
  'travel',
  'birthday',
  'deadline',
  'other',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_SOURCES = ['manual', 'synced'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const EVENT_PERSON_ROLES = ['attending', 'responsible'] as const;
export type EventPersonRole = (typeof EVENT_PERSON_ROLES)[number];

export const event = pgTable(
  'event',
  {
    ...commonColumns(() => user.id),
    // Provenance: the capture it was organised from (migration 0005, §4.4).
    originCaptureId: uuid('origin_capture_id').references(() => capture.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    allDay: boolean('all_day').notNull().default(false),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    timeZone: text('time_zone'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    rrule: text('rrule'),
    exdates: text('exdates').array(),
    kind: text('kind').notNull(),
    domain: text('domain'),
    source: text('source').notNull().default('manual'),
    calendarSourceId: uuid('calendar_source_id'),
    externalUid: text('external_uid'),
    externalEtag: text('external_etag'),
  },
  (t) => [
    check('event_created_via_check', oneOf(t.createdVia, CREATED_VIA)),
    check('event_visibility_check', oneOf(t.visibility, VISIBILITY)),
    check('event_kind_check', oneOf(t.kind, EVENT_KINDS)),
    check('event_domain_check', oneOf(t.domain, DOMAINS)),
    check('event_source_check', oneOf(t.source, EVENT_SOURCES)),
    // Timed: instants and a zone, no dates. All-day: dates, no instants or zone.
    check(
      'event_time_shape_check',
      sql`(${t.allDay} and ${t.startDate} is not null and ${t.endDate} is not null
            and ${t.startsAt} is null and ${t.endsAt} is null and ${t.timeZone} is null)
       or (not ${t.allDay} and ${t.startsAt} is not null and ${t.endsAt} is not null
            and ${t.timeZone} is not null and ${t.startDate} is null and ${t.endDate} is null)`,
    ),
    // The end is never before the start; an all-day end is exclusive, so it is after.
    check(
      'event_time_order_check',
      sql`(${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt})
       and (${t.endDate} is null or ${t.endDate} > ${t.startDate})`,
    ),
    check(
      'event_synced_check',
      sql`${t.source} <> 'synced' or (${t.calendarSourceId} is not null and ${t.externalUid} is not null)`,
    ),
    index('event_origin_capture_id_idx').on(t.originCaptureId),
    index('event_created_by_idx').on(t.createdBy),
    index('event_visibility_created_by_idx').on(t.visibility, t.createdBy),
    index('event_archived_at_idx').on(t.archivedAt),
    // Agenda reads are by time range (Today, Forward).
    index('event_starts_at_idx').on(t.startsAt),
    index('event_start_date_idx').on(t.startDate),
  ],
);

// Who is involved in an event, and how (FAMILY-DATA-MODEL §3, EventPerson).
// No visibility column: an annotation is visible exactly when its event is.
export const eventPerson = pgTable(
  'event_person',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'restrict' }),
    createdVia: text('created_via').notNull(),
  },
  (t) => [
    check('event_person_role_check', oneOf(t.role, EVENT_PERSON_ROLES)),
    check('event_person_created_via_check', oneOf(t.createdVia, CREATED_VIA)),
    uniqueIndex('event_person_event_person_role_unique').on(t.eventId, t.personId, t.role),
    index('event_person_person_id_idx').on(t.personId),
    index('event_person_created_by_idx').on(t.createdBy),
  ],
);
