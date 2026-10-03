import 'server-only';
import { and, count, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@/db/create';
import { context, event, eventPerson, note, task } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { visibleTo } from '@/trust/visibility';
import { NotFoundError, NotPermittedError } from './errors';
import type { RecordTable } from './records';

// Reference rules (M2 contract §5.5), held in both directions:
//   - a record may reference only records the actor can see, and a household
//     record may not reference a private one, which it would reveal;
//   - a record may not become private while household records reference it,
//     which would leave them revealing it.
// Referenced rows are locked FOR SHARE while a write checks them, and a
// visibility change locks its row FOR UPDATE before counting references, so
// the two can never interleave: whichever commits first, the other sees it.

export type Ref = { table: RecordTable; entity: string; id: string };

/**
 * Locks and checks the records a write points at. NotFound when the actor
 * cannot see one (or it is archived); `references_private` when a household
 * record would point at a private one.
 */
export async function checkReferences(
  tx: DbOrTx,
  actor: UserActor,
  ownVisibility: string,
  refs: (Ref | null | undefined)[],
): Promise<void> {
  for (const ref of refs) {
    if (!ref) continue;
    const t = ref.table;
    const [row] = await tx
      .select({ visibility: t.visibility })
      .from(t as PgTable)
      .where(and(eq(t.id, ref.id), visibleTo(actor, t), isNull(t.archivedAt)))
      .for('share')
      .limit(1);
    if (!row) throw new NotFoundError(ref.entity);
    if (ownVisibility === 'household' && row.visibility === 'private') {
      throw new NotPermittedError('references_private');
    }
  }
}

type Incoming = { table: PgTable; column: PgColumn; visibility?: SQL; extra?: SQL };

/** Household records that point at a record of this kind. Archived ones count: they can be restored. */
function incomingFor(entity: 'person' | 'project' | 'event'): Incoming[] {
  const household = (t: { visibility: PgColumn }) => eq(t.visibility, 'household');
  const noteAbout = (type: string): Incoming => ({
    table: note,
    column: note.subjectId,
    visibility: household(note),
    extra: eq(note.subjectType, type),
  });
  const contextAbout = (type: string): Incoming => ({
    table: context,
    column: context.subjectId,
    visibility: household(context),
    extra: eq(context.subjectType, type),
  });
  if (entity === 'project') {
    return [
      { table: task, column: task.projectId, visibility: household(task) },
      noteAbout('project'),
      contextAbout('project'),
    ];
  }
  if (entity === 'event') return [noteAbout('event')];
  return [
    {
      table: task,
      column: task.assigneePersonId,
      visibility: household(task),
    },
    { table: task, column: task.aboutPersonId, visibility: household(task) },
    noteAbout('person'),
    contextAbout('person'),
    // An annotation is as visible as its event.
    {
      table: eventPerson,
      column: eventPerson.personId,
      extra: sql`exists (select 1 from ${event} where ${event.id} = ${eventPerson.eventId} and ${event.visibility} = 'household')`,
    },
  ];
}

/** Refuses to make a record private while household records reference it. Call with the row locked. */
export async function assertNotReferencedByHousehold(
  tx: DbOrTx,
  entity: 'person' | 'project' | 'event',
  id: string,
): Promise<void> {
  for (const inc of incomingFor(entity)) {
    const [r] = await tx
      .select({ n: count() })
      .from(inc.table)
      .where(and(eq(inc.column, id), inc.visibility, inc.extra) as SQL);
    if ((r?.n ?? 0) > 0) throw new NotPermittedError('referenced_by_household');
  }
}
