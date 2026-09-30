import 'server-only';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Actor } from './actor';

// Visibility is enforced in one place — the query layer — never in UI code and
// never by asking the LLM (CLAUDE.md rule 1). Every domain query filters with
// visibleTo(). Sensitivity (M2) will be added here too.

export const VISIBILITY = ['household', 'private'] as const;
export type Visibility = (typeof VISIBILITY)[number];

export type VisibilityColumns = { visibility: PgColumn; createdBy: PgColumn };

/** A predicate selecting only the rows this actor may see. */
export function visibleTo(actor: Actor, cols: VisibilityColumns): SQL {
  if (actor.kind === 'system') return sql`true`;
  const household = eq(cols.visibility, 'household');
  const own = and(eq(cols.visibility, 'private'), eq(cols.createdBy, actor.userId));
  return or(household, own) ?? sql`false`;
}
