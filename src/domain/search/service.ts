import 'server-only';
import { and, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { event, person, project, task } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { visibleTo } from '@/trust/visibility';
import { NotPermittedError } from '../common/errors';
import type { Deps } from '../common/write';

// Title search (M8 contract §6.2, D10; ADR 0012 §19): find a record by its
// title. Titles only: events, tasks and projects by title, people by name,
// that the reader can see (the visibility predicate, in SQL) and that are
// not archived. A case-insensitive substring match, `strpos` on the
// lower-cased title, so the query is a parameter and never a pattern: `%`,
// `_` and `\` match themselves (no LIKE, nothing to escape). One query, at
// most `SEARCH_LIMIT` rows plus one to know whether there were more. No
// index, no full-text engine, no migration; notes, context and captures are
// never searched. An event's changed occurrence is part of its series and is
// found through it.

export const SEARCH_LIMIT = 20;
export const SEARCH_QUERY = z.string().min(2).max(60);

export const SEARCH_TYPES = ['project', 'task', 'event', 'person'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
export type TitleMatch = { type: SearchType; id: string; title: string };

type Searchable = PgTable & {
  id: PgColumn;
  visibility: PgColumn;
  createdBy: PgColumn;
  archivedAt: PgColumn;
};

/** Up to `SEARCH_LIMIT` titles the reader can see containing the query, by type, then title, then id. */
export async function searchTitles(
  actor: UserActor,
  query: string,
  deps: Deps = {},
): Promise<{ matches: TitleMatch[]; truncated: boolean }> {
  if ((actor as { kind?: string } | null)?.kind !== 'user')
    throw new NotPermittedError('not_a_user');
  const q = SEARCH_QUERY.parse(query);
  const db = deps.db ?? getDb();
  const branch = (
    rank: number,
    type: SearchType,
    table: Searchable,
    title: PgColumn,
    extra?: SQL,
  ) =>
    sql`(select ${rank}::int as rank, ${type}::text as type, ${table.id}::text as id, ${title} as title
         from ${table}
         where ${and(
           visibleTo(actor, table),
           isNull(table.archivedAt),
           sql`strpos(lower(${title}), lower(${q})) > 0`,
           extra,
         )})`;
  const rows = await db.execute<{ type: SearchType; id: string; title: string }>(sql`
    select type, id, title from (
      ${branch(0, 'project', project, project.title)}
      union all ${branch(1, 'task', task, task.title)}
      union all ${branch(2, 'event', event, event.title, isNull(event.recurrenceOriginal))}
      union all ${branch(3, 'person', person, person.name)}
    ) as found
    order by rank, lower(title) collate "C", id
    limit ${SEARCH_LIMIT + 1}`);
  const matches = rows.rows.map((r) => ({ type: r.type, id: r.id, title: r.title }));
  return { matches: matches.slice(0, SEARCH_LIMIT), truncated: matches.length > SEARCH_LIMIT };
}
