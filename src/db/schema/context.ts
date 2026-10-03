import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { capture } from './capture';
import { commonColumns, CREATED_VIA, oneOf, SENSITIVITY, VISIBILITY } from './common';

// What Kev knows (FAMILY-DATA-MODEL §3, Context; M2 contract §4.2): family
// knowledge that can change. Dated and sourced; staleness is derived from
// `last_confirmed_at`, `valid_until` and the category by the staleness
// engine, never stored, and stale or retired context is never deleted.
// Context created in M2 starts `active` (P-6); `proposed` is reserved.

export const CONTEXT_SUBJECT_TYPES = ['person', 'household', 'project'] as const;
export type ContextSubjectType = (typeof CONTEXT_SUBJECT_TYPES)[number];

export const CONTEXT_CATEGORIES = [
  'interest',
  'preference',
  'routine',
  'intention',
  'practical',
  'other',
] as const;
export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

export const CONTEXT_SOURCE_TYPES = ['told_kev', 'manual', 'capture'] as const;
export type ContextSourceType = (typeof CONTEXT_SOURCE_TYPES)[number];

export const CONTEXT_STATUSES = ['proposed', 'active', 'retired'] as const;
export type ContextStatus = (typeof CONTEXT_STATUSES)[number];

export const context = pgTable(
  'context',
  {
    ...commonColumns(() => user.id),
    // Provenance: the capture it was organised from (§4.4, SET NULL).
    originCaptureId: uuid('origin_capture_id').references(() => capture.id, {
      onDelete: 'set null',
    }),
    // A person or project (no foreign key: the service validates it), or the household.
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    content: text('content').notNull(),
    category: text('category').notNull(),
    // Who said it, and where: a conversation or capture id (no foreign key).
    sourceType: text('source_type').notNull(),
    sourceUserId: text('source_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    sourceRef: uuid('source_ref'),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    validUntil: date('valid_until'),
    sensitivity: text('sensitivity').notNull().default('normal'),
    status: text('status').notNull().default('active'),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => [
    check('context_created_via_check', oneOf(t.createdVia, CREATED_VIA)),
    check('context_visibility_check', oneOf(t.visibility, VISIBILITY)),
    check('context_subject_type_check', oneOf(t.subjectType, CONTEXT_SUBJECT_TYPES)),
    // The household is the only subject without an id.
    check(
      'context_subject_check',
      sql`(${t.subjectType} = 'household') = (${t.subjectId} is null)`,
    ),
    check('context_content_check', sql`${t.content} ~ '[^[:space:]]'`),
    check('context_category_check', oneOf(t.category, CONTEXT_CATEGORIES)),
    check('context_source_type_check', oneOf(t.sourceType, CONTEXT_SOURCE_TYPES)),
    check('context_sensitivity_check', oneOf(t.sensitivity, SENSITIVITY)),
    check('context_status_check', oneOf(t.status, CONTEXT_STATUSES)),
    // retired_at is set exactly while the context is retired.
    check('context_retired_check', sql`(${t.status} = 'retired') = (${t.retiredAt} is not null)`),
    index('context_subject_idx').on(t.subjectType, t.subjectId),
    index('context_origin_capture_id_idx').on(t.originCaptureId),
    index('context_source_user_id_idx').on(t.sourceUserId),
    index('context_created_by_idx').on(t.createdBy),
    index('context_visibility_created_by_idx').on(t.visibility, t.createdBy),
    index('context_archived_at_idx').on(t.archivedAt),
  ],
);
