import { sql, type SQL } from 'drizzle-orm';
import { text, timestamp, uuid, type PgColumn } from 'drizzle-orm/pg-core';

// Vocabulary and column helpers shared by HOME's user-facing tables
// (FAMILY-DATA-MODEL §2, M2 contract §4.1). Each value list is defined once
// and used by the table's CHECK constraint; later packages share the same
// lists with their Zod schemas. Enums are text + CHECK, never Postgres enum
// types, so a value can be added by an additive migration. These live in
// src/db because tables are defined here and db may not import domain.

export const CREATED_VIA = ['ui', 'kev', 'sync'] as const;
export type CreatedVia = (typeof CREATED_VIA)[number];

export const VISIBILITY = ['household', 'private'] as const;
export type Visibility = (typeof VISIBILITY)[number];

/** `<column> in ('a', 'b', …)` for a CHECK constraint, from a constant list. */
export function oneOf(column: PgColumn, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(list)})`;
}

/**
 * The common fields of a user-facing record. A function, so each table gets
 * its own column builders. `created_by` references Better Auth's `user.id`
 * (text) with ON DELETE RESTRICT, and is null only for `sync` records.
 */
export function commonColumns(userId: () => PgColumn) {
  return {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').references(userId, { onDelete: 'restrict' }),
    createdVia: text('created_via').notNull(),
    visibility: text('visibility').notNull().default('household'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  };
}
