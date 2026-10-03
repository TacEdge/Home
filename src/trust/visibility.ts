import 'server-only';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { SENSITIVITY, VISIBILITY, type Sensitivity, type Visibility } from '@/db/schema/common';
import type { Actor } from './actor';

// Visibility and sensitivity are enforced in one place — the query layer —
// never in UI code and never by asking the LLM (CLAUDE.md rules 1 and 6).
// Every domain query filters with these predicates in SQL.

export { SENSITIVITY, VISIBILITY };
export type { Sensitivity, Visibility };

export type VisibilityColumns = { visibility: PgColumn; createdBy: PgColumn };
export type SensitivityColumns = { sensitivity: PgColumn };

/** A predicate selecting only the rows this actor may see. */
export function visibleTo(actor: Actor, cols: VisibilityColumns): SQL {
  if (actor.kind === 'system') return sql`true`;
  const household = eq(cols.visibility, 'household');
  const own = and(eq(cols.visibility, 'private'), eq(cols.createdBy, actor.userId));
  return or(household, own) ?? sql`false`;
}

/**
 * Sensitive records are never read by default (D15, SYSTEM-ARCHITECTURE
 * §5.3). Only a caller that explicitly asks gets them; the caller audits it.
 * This holds for the system actor too.
 */
export function sensitivityFilter(cols: SensitivityColumns, includeSensitive = false): SQL {
  return includeSensitive ? sql`true` : eq(cols.sensitivity, 'normal');
}

/** Visibility and sensitivity together: what this actor may read. */
export function readableBy(
  actor: Actor,
  cols: VisibilityColumns & SensitivityColumns,
  opts: { includeSensitive?: boolean } = {},
): SQL {
  return and(visibleTo(actor, cols), sensitivityFilter(cols, opts.includeSensitive)) ?? sql`false`;
}
