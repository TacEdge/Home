import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { capture } from './capture';
import { commonColumns, CREATED_VIA, oneOf, VISIBILITY } from './common';

// A note (FAMILY-DATA-MODEL §3, Note; M2 contract §4.2), optionally about a
// project, person or event. The subject has no foreign key (it can point at
// three tables); the service validates it, with the reference rules (§5.5).

export const NOTE_SUBJECT_TYPES = ['project', 'person', 'event'] as const;
export type NoteSubjectType = (typeof NOTE_SUBJECT_TYPES)[number];

export const note = pgTable(
  'note',
  {
    ...commonColumns(() => user.id),
    // Provenance: the capture it was organised from (migration 0005, §4.4).
    originCaptureId: uuid('origin_capture_id').references(() => capture.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
  },
  (t) => [
    check('note_created_via_check', oneOf(t.createdVia, CREATED_VIA)),
    check('note_visibility_check', oneOf(t.visibility, VISIBILITY)),
    check('note_subject_type_check', oneOf(t.subjectType, NOTE_SUBJECT_TYPES)),
    // A subject is a type and an id together, or neither.
    check('note_subject_pair_check', sql`(${t.subjectType} is null) = (${t.subjectId} is null)`),
    index('note_subject_idx').on(t.subjectType, t.subjectId),
    index('note_origin_capture_id_idx').on(t.originCaptureId),
    index('note_created_by_idx').on(t.createdBy),
    index('note_visibility_created_by_idx').on(t.visibility, t.createdBy),
    index('note_archived_at_idx').on(t.archivedAt),
  ],
);
