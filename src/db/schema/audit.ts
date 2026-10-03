import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { oneOf, VISIBILITY } from './common';

// Append-only record of every write and every Kev tool call (contract §5.8).
// Immutability is enforced in the database by a trigger (see the migration
// that creates `audit_log_immutable`), not just by convention.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: text('actor_user_id'),
    actorVia: text('actor_via').notNull(), // ui | kev | sync | system
    actorChannel: text('actor_channel'), // web | voice | … (null for system)
    event: text('event').notNull(), // e.g. auth.sign_in
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    summary: text('summary'),
    meta: jsonb('meta'),
    // P-1 (ADR 0005 §9), added by migration 0003: a write-time snapshot of the
    // affected record's visibility, and the owner of a private record. Rows
    // with no domain subject (auth.*) are household. No foreign key: the
    // table is append-only. Package S keeps every audit query naming its
    // columns, so code deployed before 0003 runs never asks for these.
    visibility: text('visibility').notNull().default('household'),
    visibleToUserId: text('visible_to_user_id'),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at),
    check('audit_log_visibility_check', oneOf(t.visibility, VISIBILITY)),
  ],
);

export type AuditRow = typeof auditLog.$inferSelect;
export type NewAuditRow = typeof auditLog.$inferInsert;
