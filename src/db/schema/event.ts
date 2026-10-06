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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { calendarSource } from './calendar';
import { capture } from './capture';
import { commonColumns, CREATED_VIA, DOMAINS, oneOf, VISIBILITY } from './common';
import { person } from './person';

// Anything that happens at a time (FAMILY-DATA-MODEL §3, Event; M2 contract
// §4.2). Time conventions (§4.1): a timed event is two UTC instants plus the
// IANA zone it was made in; an all-day event is two calendar dates with an
// EXCLUSIVE end, as RFC 5545 (a one-day event on the 14th ends on the 15th).
// RRULE and EXDATEs are stored as given: nothing parses or expands them in
// M2 (ADR 0005, D-M2-4). Sync fields are provider-neutral; calendar_source_id
// gained its foreign key with calendar_source in migration 0007 (M4 Package
// 4a, D-M2-3). An occurrence override (an imported moved occurrence, or a
// manual single-occurrence edit) names the occurrence it replaces in
// recurrence_original and, when its series is there, the series in
// recurrence_parent_id; synced identity is the source, the external uid and
// recurrence_original, never the parent (ADR 0007 §13, §26).

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
    // RESTRICT: a source is archived, never deleted, so its events and their
    // people and notes are never removed with it (ADR 0007 §5).
    calendarSourceId: uuid('calendar_source_id').references(() => calendarSource.id, {
      onDelete: 'restrict',
    }),
    externalUid: text('external_uid'),
    externalEtag: text('external_etag'),
    // Migration 0007. SET NULL: an override outlives its series' removal as
    // an orphan, keeping its own identity and annotations.
    recurrenceParentId: uuid('recurrence_parent_id').references((): AnyPgColumn => event.id, {
      onDelete: 'set null',
    }),
    // The occurrence an override replaces: an ISO date (all-day series) or a
    // UTC instant (timed), as the provider layer writes it.
    recurrenceOriginal: text('recurrence_original'),
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
    // Only the sync path writes synced events, as the connection's owner (ADR 0007 §8).
    check(
      'event_sync_provenance_check',
      sql`(${t.source} = 'synced') = (${t.createdVia} = 'sync')`,
    ),
    check(
      'event_recurrence_original_check',
      sql`${t.recurrenceOriginal} is null
       or ${t.recurrenceOriginal} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)?$'`,
    ),
    // A parent only with the occurrence it replaces; an original without a
    // parent is an override whose series is not (or no longer) there.
    check(
      'event_recurrence_parent_check',
      sql`${t.recurrenceParentId} is null or ${t.recurrenceOriginal} is not null`,
    ),
    // Synced identity: one row per source, uid and occurrence; a series or
    // single event (no original) counts as the empty occurrence, so it is
    // unique too (a NULL would never collide).
    uniqueIndex('event_synced_identity_unique')
      .on(t.calendarSourceId, t.externalUid, sql`coalesce(${t.recurrenceOriginal}, '')`)
      .where(sql`${t.source} = 'synced'`),
    // A manual series has at most one live change per occurrence; "back to
    // the series" archives it, so an archived one never blocks a new one.
    uniqueIndex('event_manual_override_unique')
      .on(t.recurrenceParentId, t.recurrenceOriginal)
      .where(
        sql`${t.source} = 'manual' and ${t.recurrenceParentId} is not null and ${t.archivedAt} is null`,
      ),
    index('event_recurrence_parent_id_idx')
      .on(t.recurrenceParentId)
      .where(sql`${t.recurrenceParentId} is not null`),
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
