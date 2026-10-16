import 'server-only';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { calendarSource, context, event, note, person, project, task } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { sensitivityFilter, visibleTo } from '@/trust/visibility';
import { NotPermittedError } from '../common/errors';
import { recordId } from '../common/inputs';
import type { Deps } from '../common/write';

// What a Kev answer's citations point at, read again when the answer is shown
// (M8 contract §8.1, §11.2; Package 4). A stored answer keeps the refs it
// cited; the screen turns each into a row that links to the record's own
// page. The row is built from the record as it is now, as the reader may see
// it now: the visibility predicate in SQL, archived records left out, and
// sensitive context never read. A record that has since been deleted,
// archived or made private to the other adult simply does not come back, so
// the screen can neither link to it nor name it (it says only that something
// it rested on can't be opened now). No content beyond a title or a name is
// read: never a description, a note's body, a context's words, a location or
// a calendar's address.

/** The record types a cited row can link to: the ones with a page of their own in HOME. */
export const CITABLE_TYPES = [
  'event',
  'task',
  'project',
  'person',
  'note',
  'context',
  'calendar',
] as const;
export type CitableType = (typeof CITABLE_TYPES)[number];

export type CitedRecord = Readonly<{
  type: CitableType;
  id: string;
  /** The title or name as recorded now; null for a note or context, whose words are never read here. */
  title: string | null;
  /** A note's subject, the page it lives on. */
  subject?: { type: 'project' | 'person' | 'event'; id: string };
}>;

const MAX_IDS = 500;

/**
 * The cited records the reader can still see, by `type:id`. One query for
 * the lot (a union of one branch per type), whatever the number of answers
 * on screen. Ids that are not uuids, and types with no page, are ignored.
 */
export async function listCitedRecords(
  actor: UserActor,
  refs: readonly { type: string; id: string }[],
  deps: Deps = {},
): Promise<Map<string, CitedRecord>> {
  if ((actor as { kind?: string } | null)?.kind !== 'user')
    throw new NotPermittedError('not_a_user');
  const ids = new Map<CitableType, Set<string>>();
  for (const r of refs) {
    if (!(CITABLE_TYPES as readonly string[]).includes(r.type)) continue;
    if (!recordId.safeParse(r.id).success) continue;
    const set = ids.get(r.type as CitableType) ?? new Set<string>();
    if (set.size < MAX_IDS) set.add(r.id);
    ids.set(r.type as CitableType, set);
  }
  const out = new Map<string, CitedRecord>();
  if (ids.size === 0) return out;
  const db = deps.db ?? getDb();
  const want = (t: CitableType) => [...(ids.get(t) ?? [])];

  const branches: SQL[] = [];
  const titled = (type: CitableType, table: typeof event | typeof task | typeof project) => {
    const list = want(type);
    if (list.length === 0) return;
    branches.push(
      sql`(select ${type}::text as type, ${table.id}::text as id, ${table.title} as title,
               null::text as subject_type, null::text as subject_id
             from ${table}
            where ${and(inArray(table.id, list), visibleTo(actor, table), isNull(table.archivedAt))})`,
    );
  };
  titled('event', event);
  titled('task', task);
  titled('project', project);
  if (want('person').length > 0)
    branches.push(
      sql`(select 'person'::text as type, ${person.id}::text as id, ${person.name} as title,
               null::text as subject_type, null::text as subject_id
             from ${person}
            where ${and(inArray(person.id, want('person')), visibleTo(actor, person), isNull(person.archivedAt))})`,
    );
  if (want('calendar').length > 0)
    branches.push(
      sql`(select 'calendar'::text as type, ${calendarSource.id}::text as id, ${calendarSource.name} as title,
               null::text as subject_type, null::text as subject_id
             from ${calendarSource}
            where ${and(
              inArray(calendarSource.id, want('calendar')),
              visibleTo(actor, calendarSource),
              isNull(calendarSource.archivedAt),
            )})`,
    );
  if (want('note').length > 0)
    branches.push(
      sql`(select 'note'::text as type, ${note.id}::text as id, null::text as title,
               ${note.subjectType} as subject_type, ${note.subjectId}::text as subject_id
             from ${note}
            where ${and(inArray(note.id, want('note')), visibleTo(actor, note), isNull(note.archivedAt))})`,
    );
  if (want('context').length > 0)
    branches.push(
      sql`(select 'context'::text as type, ${context.id}::text as id, null::text as title,
               null::text as subject_type, null::text as subject_id
             from ${context}
            where ${and(
              inArray(context.id, want('context')),
              visibleTo(actor, context),
              isNull(context.archivedAt),
              sensitivityFilter(context),
              eq(context.status, 'active'),
            )})`,
    );
  if (branches.length === 0) return out;
  const result = await db.execute<{
    type: CitableType;
    id: string;
    title: string | null;
    subject_type: string | null;
    subject_id: string | null;
  }>(sql.join(branches, sql` union all `));
  for (const r of result.rows) {
    const subject =
      r.type === 'note' &&
      r.subject_id &&
      (r.subject_type === 'project' || r.subject_type === 'person' || r.subject_type === 'event')
        ? { type: r.subject_type as 'project' | 'person' | 'event', id: r.subject_id }
        : undefined;
    out.set(`${r.type}:${r.id}`, {
      type: r.type,
      id: r.id,
      title: r.title,
      ...(subject ? { subject } : {}),
    });
  }
  return out;
}
