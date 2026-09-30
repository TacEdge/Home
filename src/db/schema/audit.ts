import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
  },
  (t) => [index('audit_log_at_idx').on(t.at)],
);

export type AuditRow = typeof auditLog.$inferSelect;
export type NewAuditRow = typeof auditLog.$inferInsert;
