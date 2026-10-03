import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { CHANNELS, commonColumns, CREATED_VIA, oneOf } from './common';
import { message } from './conversation';

// Something a user told HOME, stored verbatim before anyone decides what it
// is (FAMILY-DATA-MODEL §3, Capture; M2 contract §4.2). Capture first,
// organise second: `text` is the user's own words, exactly as given, and a
// trigger (migration 0005) refuses any change to it, or to who said it, when,
// how (created_via) and through which channel, for every role. `message_id`
// stays writable so Package 5 can attach the message. Organising records the result alongside the text
// (`status`, `organised_into`, `organised_at`); it never rewrites it.
// `created_by` is the person who captured it (captured_by). Captures are
// always private to their creator.

export const CAPTURE_STATUSES = ['new', 'proposed', 'organised', 'dismissed'] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

/** What a capture can be organised into: the records an approved proposal creates. */
export const ORGANISED_TYPES = ['task', 'event', 'project', 'note', 'context'] as const;
export type OrganisedType = (typeof ORGANISED_TYPES)[number];
export type OrganisedRef = { type: OrganisedType; id: string };

// Any element that is not {type: <one of ORGANISED_TYPES>, id: <uuid>} fails the check.
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const badOrganisedRef = `'$[*] ? (@.type() != "object"
  || !(exists(@."type")) || @."type".type() != "string"
  || !(@."type" like_regex "^(${ORGANISED_TYPES.join('|')})$")
  || !(exists(@."id")) || @."id".type() != "string" || !(@."id" like_regex "${UUID}"))'`;

export const capture = pgTable(
  'capture',
  {
    ...commonColumns(() => user.id),
    visibility: text('visibility').notNull().default('private'),
    text: text('text').notNull(),
    channel: text('channel').notNull(),
    // The conversation message it came from (provenance, ON DELETE SET NULL:
    // the 90-day message purge clears it and leaves the capture).
    messageId: uuid('message_id').references(() => message.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('new'),
    organisedInto: jsonb('organised_into').$type<OrganisedRef[]>().notNull().default([]),
    organisedAt: timestamp('organised_at', { withTimezone: true }),
    // When it was dismissed: the 30-day purge clock for dismissed captures (§4.4).
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => [
    check('capture_created_via_check', oneOf(t.createdVia, CREATED_VIA)),
    check('capture_visibility_check', sql`${t.visibility} = 'private'`),
    // Someone always said it: never a sync record.
    check(
      'capture_created_by_check',
      sql`${t.createdBy} is not null and ${t.createdVia} <> 'sync'`,
    ),
    check('capture_text_check', sql`${t.text} ~ '[^[:space:]]'`),
    check('capture_channel_check', oneOf(t.channel, CHANNELS)),
    check('capture_status_check', oneOf(t.status, CAPTURE_STATUSES)),
    // A JSON array of {type, id} references to the records it became.
    check(
      'capture_organised_into_check',
      sql`jsonb_typeof(${t.organisedInto}) = 'array'
       and not jsonb_path_exists(${t.organisedInto}, ${sql.raw(badOrganisedRef)})`,
    ),
    // Organised means organised into something, at a known time.
    check(
      'capture_organised_check',
      sql`${t.status} <> 'organised'
       or (${t.organisedAt} is not null and jsonb_array_length(${t.organisedInto}) > 0)`,
    ),
    // dismissed_at is set exactly while the capture is dismissed, so the purge clock is right.
    check(
      'capture_dismissed_check',
      sql`(${t.status} = 'dismissed') = (${t.dismissedAt} is not null)`,
    ),
    index('capture_created_by_status_idx').on(t.createdBy, t.status),
    index('capture_visibility_created_by_idx').on(t.visibility, t.createdBy),
    index('capture_archived_at_idx').on(t.archivedAt),
    index('capture_dismissed_at_idx').on(t.dismissedAt),
    index('capture_message_id_idx').on(t.messageId),
  ],
);
