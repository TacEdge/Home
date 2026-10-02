import { sql, type SQL } from 'drizzle-orm';
import { text, timestamp, uuid, type PgColumn } from 'drizzle-orm/pg-core';

// Shared vocabulary and column helpers for every user-facing table
// (FAMILY-DATA-MODEL §2, M2 contract §4.1). Each value list is defined once
// here and shared by the Drizzle CHECK constraint, the Zod schema and the
// TypeScript type. Enums are text + CHECK, never Postgres enum types, so a
// value can be added by an additive migration.

export const CREATED_VIA = ['ui', 'kev', 'sync'] as const;
export type CreatedVia = (typeof CREATED_VIA)[number];

export const VISIBILITY = ['household', 'private'] as const;
export type Visibility = (typeof VISIBILITY)[number];

export const SENSITIVITY = ['normal', 'sensitive'] as const;
export type Sensitivity = (typeof SENSITIVITY)[number];

/** `<column> in ('a', 'b', …)` for a CHECK constraint, from a const list. */
export function oneOf(column: PgColumn, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(list)})`;
}

/**
 * The common fields of a user-facing record. Called once per table so each
 * table gets its own column builders. `created_by` references Better Auth's
 * `user.id` (text) and is null only for records created by `sync`.
 */
export function commonColumns(userId: PgColumn) {
  return {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').references(() => userId, { onDelete: 'restrict' }),
    createdVia: text('created_via').notNull(),
    visibility: text('visibility').notNull().default('household'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  };
}
