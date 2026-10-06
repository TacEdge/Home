import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { commonColumns, CREATED_VIA, oneOf, VISIBILITY } from './common';

// Calendar connections and sources (FAMILY-DATA-MODEL §3, M4 contract §3.2
// and §7, ADR 0007; migration 0007, M4 Package 4a). A connection is one
// adult's link to a provider and holds the credential; a source is one
// calendar within it and holds HOME's own settings for that calendar. The
// plain calendar address never enters the database: only its sealed form
// (Package 2) and a keyed fingerprint, and CHECKs refuse anything else in
// those columns. Neither table is ever hard-deleted by HOME: disconnecting
// clears the credential and archives the source, and the source's synced
// events are archived by the sync service, so people and notes on them stay.

export const CALENDAR_PROVIDERS = ['ics'] as const;
export type CalendarProviderKind = (typeof CALENDAR_PROVIDERS)[number];

export const CALENDAR_CONNECTION_STATUSES = ['active', 'disconnected'] as const;
export type CalendarConnectionStatus = (typeof CALENDAR_CONNECTION_STATUSES)[number];

/** A source's last refresh, in the words of M4 contract §3.8. */
export const CALENDAR_SYNC_STATUSES = [
  'ok',
  'partial',
  'unreachable',
  'address_rejected',
  'not_a_calendar',
  'too_large',
] as const;
export type CalendarSyncStatus = (typeof CALENDAR_SYNC_STATUSES)[number];

/** The kinds a source may give its events: the event kinds (src/db/schema/event.ts). */
const SOURCE_KINDS = [
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

/** A structural error code: lower-case words joined by underscores, never provider text. */
const CODE = '^[a-z][a-z_]{0,39}$';

export const calendarConnection = pgTable(
  'calendar_connection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Owner-only, like a conversation: no visibility column.
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    // Package 2's sealed credential, bound to this row and its owner; cleared
    // on disconnect. Its key id names the key that sealed it, for rotation.
    credentialsEncrypted: text('credentials_encrypted'),
    credentialsKeyId: text('credentials_key_id'),
    // Keyed HMAC of the normalised address; kept after disconnect so the same
    // owner reconnecting the same address is recognised (ADR 0007 §5–6).
    addressFingerprint: text('address_fingerprint'),
    status: text('status').notNull().default('active'),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  },
  (t) => [
    check('calendar_connection_provider_check', oneOf(t.provider, CALENDAR_PROVIDERS)),
    check('calendar_connection_status_check', oneOf(t.status, CALENDAR_CONNECTION_STATUSES)),
    // Live: a sealed credential and its key, never a disconnection time.
    // Disconnected: the credential destroyed, the time recorded.
    check(
      'calendar_connection_state_check',
      sql`(${t.status} = 'active' and ${t.credentialsEncrypted} is not null
            and ${t.credentialsKeyId} is not null and ${t.disconnectedAt} is null)
       or (${t.status} = 'disconnected' and ${t.credentialsEncrypted} is null
            and ${t.credentialsKeyId} is null and ${t.disconnectedAt} is not null)`,
    ),
    // Only Package 2's shapes, so a plain address can never be stored here.
    check(
      'calendar_connection_credentials_check',
      sql`${t.credentialsEncrypted} is null or (char_length(${t.credentialsEncrypted}) <= 8192
            and ${t.credentialsEncrypted} ~ '^hc[0-9]+\\.[0-9a-f]{16}(\\.[A-Za-z0-9_-]+){3}$')`,
    ),
    check(
      'calendar_connection_key_id_check',
      sql`${t.credentialsKeyId} is null or ${t.credentialsKeyId} ~ '^[0-9a-f]{16}$'`,
    ),
    check(
      'calendar_connection_fingerprint_check',
      sql`${t.addressFingerprint} is null or (char_length(${t.addressFingerprint}) <= 128
            and ${t.addressFingerprint} ~ '^fp[0-9]+\\.[A-Za-z0-9_-]{16,}$')`,
    ),
    // An ICS connection is recognised by its address, so it always has one.
    check(
      'calendar_connection_ics_fingerprint_check',
      sql`${t.provider} <> 'ics' or ${t.addressFingerprint} is not null`,
    ),
    check(
      'calendar_connection_error_code_check',
      sql`${t.lastErrorCode} is null or ${t.lastErrorCode} ~ ${sql.raw(`'${CODE}'`)}`,
    ),
    index('calendar_connection_owner_user_id_idx').on(t.ownerUserId),
    // One live connection per address, whoever made it (contract §4.4).
    uniqueIndex('calendar_connection_live_fingerprint_unique')
      .on(t.addressFingerprint)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const calendarSource = pgTable(
  'calendar_source',
  {
    // created_by is the connection's owner; visibility decides who sees the
    // calendar and its events; archived on disconnect.
    ...commonColumns(() => user.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => calendarConnection.id, { onDelete: 'restrict' }),
    externalCalendarId: text('external_calendar_id').notNull(),
    name: text('name').notNull(),
    // The synced events' kind; `other` when unset (contract §3.3).
    defaultKind: text('default_kind'),
    // Whose events these usually are: shown where an event has no people of
    // its own, never written as annotations (ADR 0007 §14). Checked by the
    // service, as person ids in an array cannot carry a foreign key.
    defaultPersonIds: uuid('default_person_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    feedHash: text('feed_hash'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncStatus: text('last_sync_status'),
    lastSyncErrorCode: text('last_sync_error_code'),
    lastSkippedCount: integer('last_skipped_count'),
  },
  (t) => [
    check('calendar_source_created_via_check', oneOf(t.createdVia, CREATED_VIA)),
    check('calendar_source_visibility_check', oneOf(t.visibility, VISIBILITY)),
    check('calendar_source_default_kind_check', oneOf(t.defaultKind, SOURCE_KINDS)),
    check(
      'calendar_source_last_sync_status_check',
      oneOf(t.lastSyncStatus, CALENDAR_SYNC_STATUSES),
    ),
    // A name a person can read, and never an address.
    check(
      'calendar_source_name_check',
      sql`char_length(btrim(${t.name})) between 1 and 200 and ${t.name} !~ '://'`,
    ),
    check(
      'calendar_source_external_calendar_id_check',
      sql`char_length(${t.externalCalendarId}) between 1 and 200 and ${t.externalCalendarId} !~ '://'`,
    ),
    check(
      'calendar_source_feed_hash_check',
      sql`${t.feedHash} is null or ${t.feedHash} ~ '^h[0-9]+:[0-9a-f]{64}$'`,
    ),
    check(
      'calendar_source_error_code_check',
      sql`${t.lastSyncErrorCode} is null or ${t.lastSyncErrorCode} ~ ${sql.raw(`'${CODE}'`)}`,
    ),
    check(
      'calendar_source_skipped_check',
      sql`${t.lastSkippedCount} is null or ${t.lastSkippedCount} >= 0`,
    ),
    // ICS: exactly one source per connection; in general one per provider calendar.
    uniqueIndex('calendar_source_connection_calendar_unique').on(
      t.connectionId,
      t.externalCalendarId,
    ),
    index('calendar_source_created_by_idx').on(t.createdBy),
    index('calendar_source_visibility_created_by_idx').on(t.visibility, t.createdBy),
  ],
);
