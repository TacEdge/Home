import 'server-only';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { event, eventPerson, person } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { visibleTo } from '@/trust/visibility';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { records } from '../common/records';
import { assertNotReferencedByHousehold, checkReferences } from '../common/references';
import { auditedWrite, provenanceOf, type Deps } from '../common/write';
import { assertFamilyWritesOpen } from '../common/guards';
import {
  createEventInput,
  eventPersonInput,
  timeColumns,
  updateEventInput,
  type CreateEventInput,
  type EventPersonInput,
  type UpdateEventInput,
} from './schema';

// Events and their people (FAMILY-DATA-MODEL §3, M2 contract §5). Services
// create and edit manual events only; a synced event (created by M4's sync
// path) is read-only here. Nothing parses recurrence. Write discipline as
// every record (common/records.ts): Kev refused, row locked under the
// visibility predicate and the predicate repeated in the UPDATE, database
// clock, one transaction with a structural audit row.
//
// EventPerson annotations have no visibility of their own: they are as
// visible as their event, and their audit rows are about the event.

export type Event = typeof event.$inferSelect;
export type EventPerson = typeof eventPerson.$inferSelect;
type ReadOpts = { includeArchived?: boolean };

const R = records(event, 'event');
const audit = (name: string, row: Event, meta?: Record<string, string | boolean | string[]>) => ({
  event: name,
  subjectType: 'event',
  subjectId: row.id,
  meta,
  record: row,
});

function refuseSynced(row: Event): void {
  if (row.source !== 'manual') throw new NotPermittedError('synced_event');
}

export async function createEvent(
  actor: UserActor,
  input: CreateEventInput,
  deps: Deps = {},
): Promise<Event> {
  assertCanWrite(actor);
  const { time, ...data } = createEventInput.parse(input);
  return auditedWrite(actor, deps, async (tx) => {
    const [row] = await tx
      .insert(event)
      .values({
        ...data,
        ...timeColumns(time),
        source: 'manual',
        createdBy: actor.userId,
        ...provenanceOf(deps),
      })
      .returning();
    if (!row) throw new Error('event insert returned no row');
    return {
      result: row,
      audit: audit('event.create', row, {
        kind: row.kind,
        allDay: row.allDay,
        visibility: row.visibility,
      }),
    };
  });
}

export async function getEvent(actor: UserActor, id: string, opts: ReadOpts = {}, deps: Deps = {}) {
  return R.get(deps.db ?? getDb(), actor, id, opts.includeArchived ? 'include' : 'exclude');
}

/** Events in calendar order: by their local start date, then start instant. */
export async function listEvents(
  actor: UserActor,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<Event[]> {
  const db = deps.db ?? getDb();
  return db
    .select()
    .from(event)
    .where(R.readable(actor, opts.includeArchived ? 'include' : 'exclude'))
    .orderBy(
      asc(
        sql`coalesce(${event.startDate}, (${event.startsAt} at time zone coalesce(${event.timeZone}, 'UTC'))::date)`,
      ),
      desc(event.allDay),
      asc(event.startsAt),
      asc(event.id),
    );
}

export async function updateEvent(
  actor: UserActor,
  id: string,
  patch: UpdateEventInput,
  deps: Deps = {},
): Promise<Event> {
  assertCanWrite(actor);
  const parsed = updateEventInput.parse(patch);
  const { time, ...data } = parsed;
  const fields = Object.keys(parsed).sort();
  if (fields.length === 0) return getEvent(actor, id, {}, deps);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    refuseSynced(current);
    const next = data.visibility ?? current.visibility;
    if (next !== current.visibility) {
      if (current.createdBy !== actor.userId) throw new NotPermittedError('not_creator');
      if (next === 'private') await assertNotReferencedByHousehold(tx, 'event', current.id);
      else await checkAnnotatedPeople(tx, actor, current.id);
    }
    const row = await R.update(tx, actor, current.id, 'exclude', {
      ...data,
      ...(time ? timeColumns(time) : {}),
    });
    return { result: row, audit: audit('event.update', row, { fields }) };
  });
}

/** A household event must not reveal a private person through its annotations. */
async function checkAnnotatedPeople(
  tx: Parameters<typeof checkReferences>[0],
  actor: UserActor,
  eventId: string,
) {
  const annotated = await tx
    .select({ personId: eventPerson.personId })
    .from(eventPerson)
    .where(eq(eventPerson.eventId, eventId));
  await checkReferences(
    tx,
    actor,
    'household',
    annotated.map((a) => ({ table: person, entity: 'person', id: a.personId })),
  );
}

export async function archiveEvent(actor: UserActor, id: string, deps: Deps = {}): Promise<Event> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    refuseSynced(current);
    const row = await R.update(tx, actor, current.id, 'exclude', { archivedAt: sql`now()` });
    return { result: row, audit: audit('event.archive', row) };
  });
}

export async function restoreEvent(actor: UserActor, id: string, deps: Deps = {}): Promise<Event> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'include');
    refuseSynced(current);
    if (current.archivedAt === null) throw new NotPermittedError('not_archived');
    const row = await R.update(tx, actor, current.id, 'only', { archivedAt: null });
    return { result: row, audit: audit('event.restore', row) };
  });
}

/**
 * Says who is involved in an event, and how. Idempotent: an existing
 * annotation is returned unchanged and not audited again. The event is
 * locked (so its visibility cannot change meanwhile) and the person is
 * checked under the reference rules: visible to the actor, and household if
 * the event is.
 */
export async function setEventPerson(
  actor: UserActor,
  input: EventPersonInput,
  deps: Deps = {},
): Promise<EventPerson> {
  assertCanWrite(actor);
  const data = eventPersonInput.parse(input);
  return auditedWrite(actor, deps, async (tx) => {
    const ev = await R.lock(tx, actor, data.eventId, 'exclude');
    await checkReferences(tx, actor, ev.visibility, [
      { table: person, entity: 'person', id: data.personId },
    ]);
    const [created] = await tx
      .insert(eventPerson)
      .values({ ...data, createdBy: actor.userId, createdVia: provenanceOf(deps).createdVia })
      .onConflictDoNothing()
      .returning();
    const row =
      created ??
      (
        await tx
          .select()
          .from(eventPerson)
          .where(
            and(
              eq(eventPerson.eventId, data.eventId),
              eq(eventPerson.personId, data.personId),
              eq(eventPerson.role, data.role),
            ),
          )
      )[0];
    if (!row) throw new NotFoundError('event_person');
    return {
      result: row,
      audit: created
        ? audit('event_person.set', ev, { personId: data.personId, role: data.role })
        : null,
    };
  });
}

/** Removes one annotation. NotFound if there is none, or the event is not visible. */
export async function removeEventPerson(
  actor: UserActor,
  input: EventPersonInput,
  deps: Deps = {},
): Promise<void> {
  assertCanWrite(actor);
  const data = eventPersonInput.parse(input);
  await auditedWrite(actor, deps, async (tx) => {
    const ev = await R.lock(tx, actor, data.eventId, 'exclude');
    const [gone] = await tx
      .delete(eventPerson)
      .where(
        and(
          eq(eventPerson.eventId, ev.id),
          eq(eventPerson.personId, data.personId),
          eq(eventPerson.role, data.role),
        ),
      )
      .returning({ id: eventPerson.id });
    if (!gone) throw new NotFoundError('event_person');
    return {
      result: undefined,
      audit: audit('event_person.remove', ev, { personId: data.personId, role: data.role }),
    };
  });
}

/** The annotations of an event the actor can see, for people the actor can see. */
export async function listEventPeople(
  actor: UserActor,
  eventId: string,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<EventPerson[]> {
  const db = deps.db ?? getDb();
  const ev = await getEvent(actor, eventId, opts, { db });
  const rows = await db
    .select({ annotation: eventPerson })
    .from(eventPerson)
    .innerJoin(person, eq(person.id, eventPerson.personId))
    .where(and(eq(eventPerson.eventId, ev.id), visibleTo(actor, person)))
    .orderBy(asc(eventPerson.role), asc(eventPerson.createdAt), asc(eventPerson.id));
  return rows.map((r) => r.annotation);
}

export type EventPersonChoice = { personId: string; role: 'attending' | 'responsible' };

/**
 * Makes an event's annotations exactly this set, in one transaction (M3
 * contract §3.6): missing ones are set, extra ones removed, each through
 * setEventPerson / removeEventPerson so every rule and audit row is as
 * usual. Only annotations for people the actor can see are compared, so
 * another adult's private annotation (invisible here) is left alone.
 */
export async function setEventPeople(
  actor: UserActor,
  eventId: string,
  people: readonly EventPersonChoice[],
  deps: Deps = {},
): Promise<EventPerson[]> {
  assertCanWrite(actor);
  assertFamilyWritesOpen();
  const wanted = new Map(people.map((p) => [`${p.personId}:${p.role}`, p]));
  const db = deps.db ?? getDb();
  return db.transaction(async (tx) => {
    const d = { ...deps, db: tx };
    const current = await listEventPeople(actor, eventId, {}, d);
    for (const c of current) {
      const key = `${c.personId}:${c.role}`;
      if (!wanted.has(key)) {
        await removeEventPerson(
          actor,
          { eventId, personId: c.personId, role: c.role as EventPersonChoice['role'] },
          d,
        );
      }
      wanted.delete(key);
    }
    for (const p of wanted.values()) await setEventPerson(actor, { eventId, ...p }, d);
    return listEventPeople(actor, eventId, {}, d);
  });
}

/** Creates an event and says who is involved, in one transaction: a refused annotation leaves no event. */
export async function createEventWithPeople(
  actor: UserActor,
  input: CreateEventInput,
  people: readonly EventPersonChoice[],
  deps: Deps = {},
): Promise<Event> {
  assertCanWrite(actor);
  const db = deps.db ?? getDb();
  return db.transaction(async (tx) => {
    const d = { ...deps, db: tx };
    const created = await createEvent(actor, input, d);
    if (people.length > 0) await setEventPeople(actor, created.id, people, d);
    return created;
  });
}
