import 'server-only';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { event, eventPerson, person } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { visibleTo } from '@/trust/visibility';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { records } from '../common/records';
import { assertNotReferencedByHousehold, checkReferences } from '../common/references';
import { auditedWrite, provenanceOf, type Deps } from '../common/write';
import { assertFamilyWritesOpen } from '../common/guards';
import { skipOccurrence } from '../engines/recurrence';
import { isValidIsoDate, type IsoDate } from '@/lib/dates';
import {
  isOccurrence,
  isOccurrenceChange,
  isSkippedOccurrence,
  occurrenceOf,
  skippedChanges,
} from './occurrences';
import {
  createEventInput,
  eventPersonInput,
  occurrenceChangeInput,
  type OccurrenceChangeInput,
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
//
// One occurrence of a repeating manual event can be changed on its own
// (M4 contract §3.7, ADR 0007 §46): an override row pointing at its series,
// written only by changeEventOccurrence and put back by
// returnOccurrenceToSeries. It belongs to its series: the series' owner and
// visibility, always; the series' people unless it has its own. The series
// row itself is never changed by it.

export type Event = typeof event.$inferSelect;
export type EventPerson = typeof eventPerson.$inferSelect;
type ReadOpts = { includeArchived?: boolean };

const R = records(event, 'event');
const audit = (
  name: string,
  row: Event,
  meta?: Record<string, string | boolean | string[] | null>,
) => ({
  event: name,
  subjectType: 'event',
  subjectId: row.id,
  meta,
  record: row,
});

function refuseSynced(row: Event): void {
  if (row.source !== 'manual') throw new NotPermittedError('synced_event');
}

/** An occurrence change is changed through changeEventOccurrence, never as an event of its own. */
function refuseOccurrenceChange(row: Event): void {
  if (isOccurrenceChange(row)) throw new NotPermittedError('occurrence_change');
}

/** A series' manual occurrence changes, live or archived, locked in id order. */
async function lockChanges(tx: DbOrTx, seriesId: string, live: boolean): Promise<Event[]> {
  return tx
    .select()
    .from(event)
    .where(
      and(
        eq(event.recurrenceParentId, seriesId),
        eq(event.source, 'manual'),
        live ? isNull(event.archivedAt) : undefined,
      ),
    )
    .orderBy(asc(event.id))
    .for('update');
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
    refuseOccurrenceChange(current);
    const next = data.visibility ?? current.visibility;
    // A series' occurrence changes, archived ones too, share its visibility
    // (and owner), so they are checked and moved with it: one changed
    // Wednesday can never stay household on a series made private.
    const changes = await lockChanges(tx, current.id, false);
    // Skipping a changed occurrence by an exdates patch is refused, before
    // anything is written: an occurrence is never skipped and changed (§46).
    if (data.exdates !== undefined) {
      const prospective = { ...current, ...data, ...(time ? timeColumns(time) : {}) } as Event;
      if (skippedChanges(prospective, data.exdates, changes).length > 0)
        throw new NotPermittedError('occurrence_already_changed');
    }
    if (next !== current.visibility) {
      if (current.createdBy !== actor.userId) throw new NotPermittedError('not_creator');
      for (const target of [current, ...changes]) {
        if (next === 'private') await assertNotReferencedByHousehold(tx, 'event', target.id);
        else await checkAnnotatedPeople(tx, actor, target.id);
      }
    }
    const row = await R.update(tx, actor, current.id, 'exclude', {
      ...data,
      ...(time ? timeColumns(time) : {}),
    });
    const audits = [audit('event.update', row, { fields })];
    for (const c of changes) {
      // A whole-series edit keeps each change whose original occurrence the
      // rule still reaches; one it no longer reaches is archived with this
      // edit (contract §3.7), never re-keyed onto another occurrence.
      const unreached = c.archivedAt === null && occurrenceOf(row, c.recurrenceOriginal!) === null;
      if (!unreached && c.visibility === row.visibility) continue;
      const [moved] = await tx
        .update(event)
        .set({
          visibility: row.visibility,
          ...(unreached ? { archivedAt: sql`now()` } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(event.id, c.id))
        .returning();
      if (c.visibility !== row.visibility)
        audits.push(audit('event.update', moved!, { fields: ['visibility'], seriesId: row.id }));
      if (unreached)
        audits.push(audit('event.archive', moved!, { seriesId: row.id, reason: 'series_changed' }));
    }
    return { result: row, audit: audits };
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

/**
 * Restores an archived event. An occurrence change comes back only into a
 * live series whose rule still reaches its occurrence, and never beside
 * another live change of the same occurrence (refused calmly here, not left
 * to the unique index). The series is locked before the change, as in
 * changeEventOccurrence, so the two cannot cross.
 */
export async function restoreEvent(actor: UserActor, id: string, deps: Deps = {}): Promise<Event> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const seen = await R.get(tx, actor, id, 'include');
    if (isOccurrenceChange(seen)) {
      const series = seen.recurrenceParentId
        ? await R.lock(tx, actor, seen.recurrenceParentId, 'include')
        : null;
      if (!series || series.archivedAt !== null) throw new NotPermittedError('series_archived');
      const occurrence = occurrenceOf(series, seen.recurrenceOriginal!);
      if (occurrence === null) throw new NotPermittedError('not_an_occurrence');
      // Skipped since it went back: put it back first (§46).
      if (isSkippedOccurrence(series, occurrence))
        throw new NotPermittedError('occurrence_skipped');
      const live = await liveChange(tx, series.id, seen.recurrenceOriginal!);
      if (live && live.id !== seen.id) throw new NotPermittedError('occurrence_already_changed');
    }
    const current = await R.lock(tx, actor, id, 'include');
    refuseSynced(current);
    if (current.archivedAt === null) throw new NotPermittedError('not_archived');
    const row = await R.update(tx, actor, current.id, 'only', { archivedAt: null });
    return { result: row, audit: audit('event.restore', row) };
  });
}

/** The live change of one occurrence of a series, locked, if there is one. */
async function liveChange(tx: DbOrTx, seriesId: string, original: string): Promise<Event | null> {
  const [row] = await tx
    .select()
    .from(event)
    .where(
      and(
        eq(event.recurrenceParentId, seriesId),
        eq(event.recurrenceOriginal, original),
        eq(event.source, 'manual'),
        isNull(event.archivedAt),
      ),
    )
    .for('update')
    .limit(1);
  return row ?? null;
}

/**
 * Changes one occurrence of a repeating manual event, leaving the series as
 * it is (M4 contract §3.7, ADR 0007 §46). `original` names the occurrence as
 * the series has it (occurrenceIdentity: a date, or a UTC instant to the
 * second); it is proved against the series' current rule by the recurrence
 * engine, never trusted from a form. The first change of an occurrence
 * makes its override row, starting from that occurrence's own details and
 * time; a later one updates the same row. The series is locked first, so
 * two changes of one occurrence queue: the second updates what the first
 * made. Who it is for and its notes are not copied (who.ts).
 */
export async function changeEventOccurrence(
  actor: UserActor,
  seriesId: string,
  original: string,
  patch: OccurrenceChangeInput,
  deps: Deps = {},
): Promise<Event> {
  assertCanWrite(actor);
  const parsed = occurrenceChangeInput.parse(patch);
  const { time, ...data } = parsed;
  const fields = Object.keys(parsed).sort();
  return auditedWrite(actor, deps, async (tx) => {
    const series = await R.lock(tx, actor, seriesId, 'exclude');
    refuseSynced(series);
    refuseOccurrenceChange(series);
    if (!series.rrule) throw new NotPermittedError('not_recurring');
    const occurrence = typeof original === 'string' ? occurrenceOf(series, original) : null;
    if (!occurrence) throw new NotPermittedError('not_an_occurrence');
    if (isSkippedOccurrence(series, occurrence)) throw new NotPermittedError('occurrence_skipped');
    const meta = { seriesId: series.id, occurrence: original, fields };
    const existing = await liveChange(tx, series.id, original);
    if (existing) {
      const row = await R.update(tx, actor, existing.id, 'exclude', {
        ...data,
        ...(time ? timeColumns(time) : {}),
      });
      return {
        result: row,
        audit: audit('event.occurrence_change', row, { ...meta, created: false }),
      };
    }
    const own = occurrence.allDay
      ? timeColumns({ allDay: true, startDate: occurrence.startDate, endDate: occurrence.endDate })
      : timeColumns({
          allDay: false,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          timeZone: occurrence.timeZone,
        });
    const [row] = await tx
      .insert(event)
      .values({
        title: series.title,
        description: series.description,
        location: series.location,
        kind: series.kind,
        domain: series.domain,
        ...own,
        ...data,
        ...(time ? timeColumns(time) : {}),
        rrule: null,
        exdates: null,
        source: 'manual',
        recurrenceParentId: series.id,
        recurrenceOriginal: original,
        // It belongs to its series: the same owner and visibility, so it is
        // seen by exactly who sees the series. The audit row says who changed it.
        visibility: series.visibility,
        createdBy: series.createdBy,
        ...provenanceOf(deps),
      })
      .returning();
    if (!row) throw new Error('occurrence change insert returned no row');
    return {
      result: row,
      audit: audit('event.occurrence_change', row, { ...meta, created: true }),
    };
  });
}

/**
 * "Back to the series" (M4 contract §3.7): the occurrence's live change is
 * archived, never deleted, so its own people and notes stay with it; the
 * series is untouched, and its regular occurrence shows again. There must
 * be a live change of that occurrence to put back.
 */
export async function returnOccurrenceToSeries(
  actor: UserActor,
  seriesId: string,
  original: string,
  deps: Deps = {},
): Promise<Event> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const series = await R.lock(tx, actor, seriesId, 'exclude');
    refuseSynced(series);
    const live = typeof original === 'string' ? await liveChange(tx, series.id, original) : null;
    if (!live) throw new NotPermittedError('not_changed');
    const row = await R.update(tx, actor, live.id, 'exclude', { archivedAt: sql`now()` });
    return {
      result: row,
      audit: audit('event.occurrence_return', row, { seriesId: series.id, occurrence: original }),
    };
  });
}

/** A series' occurrence changes the actor can see, live and archived, for its page (Package 8b). */
export async function listOccurrenceChanges(
  actor: UserActor,
  seriesId: string,
  deps: Deps = {},
): Promise<Event[]> {
  const db = deps.db ?? getDb();
  const series = await getEvent(actor, seriesId, { includeArchived: true }, { db });
  return db
    .select()
    .from(event)
    .where(
      and(
        eq(event.recurrenceParentId, series.id),
        eq(event.source, 'manual'),
        R.readable(actor, 'include'),
      ),
    )
    .orderBy(asc(event.recurrenceOriginal), asc(event.archivedAt), asc(event.id));
}

/**
 * "Skip this one" (ADR 0006 §37, §42; ADR 0007 §46): one more exdate, by the
 * occurrence's own date, refused while that occurrence has a live change. Only a repeating event can be skipped, and only on a date its
 * rule actually puts it on, judged by the engine here and never trusted
 * from a form; so a one-off event cannot be hidden by a crafted post.
 */
export async function skipEventOccurrence(
  actor: UserActor,
  id: string,
  date: IsoDate,
  deps: Deps = {},
): Promise<Event> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    refuseSynced(current);
    if (!current.rrule) throw new NotPermittedError('not_recurring');
    if (!isValidIsoDate(date) || !isOccurrence(current, date))
      throw new NotPermittedError('not_an_occurrence');
    // A changed occurrence is not skipped as well: back to the series first,
    // then skip it (ADR 0007 §46). The date is the series' own, as is each
    // change's original, so a change is found whatever day home calls it.
    const exdates = skipOccurrence(current.exdates, date);
    if (skippedChanges(current, exdates, await lockChanges(tx, current.id, true)).length > 0)
      throw new NotPermittedError('occurrence_already_changed');
    const row = await R.update(tx, actor, current.id, 'exclude', { exdates });
    return { result: row, audit: audit('event.skip', row, { date }) };
  });
}

/** Undoes a skip: the date comes off the exdates; it must be there. Nothing else changes. */
export async function putBackEventOccurrence(
  actor: UserActor,
  id: string,
  date: IsoDate,
  deps: Deps = {},
): Promise<Event> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    refuseSynced(current);
    if (!(current.exdates ?? []).includes(date)) throw new NotPermittedError('not_skipped');
    const remaining = current.exdates!.filter((x) => x !== date);
    const row = await R.update(tx, actor, current.id, 'exclude', {
      exdates: remaining.length ? remaining : null,
    });
    return { result: row, audit: audit('event.put_back', row, { date }) };
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

/**
 * Many events' annotations in one read (M5 Package 1, ADR 0008 §7): for each
 * of these events the actor can read, its people the actor can see, exactly
 * as `listEventPeople` returns them one event at a time and in the same
 * order. An event the actor cannot read (private to the other adult,
 * archived unless asked for, missing, or not an id) contributes nothing, as
 * one that has no people: the result never says which. Events with no
 * readable people are absent from the map.
 */
export async function listEventPeopleFor(
  actor: UserActor,
  eventIds: readonly string[],
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<Map<string, EventPerson[]>> {
  const ids = [...new Set(eventIds)].filter((id) => UUID.test(id));
  const out = new Map<string, EventPerson[]>();
  if (ids.length === 0) return out;
  const db = deps.db ?? getDb();
  const rows = await db
    .select({ annotation: eventPerson })
    .from(eventPerson)
    .innerJoin(event, eq(event.id, eventPerson.eventId))
    .innerJoin(person, eq(person.id, eventPerson.personId))
    .where(
      and(
        inArray(eventPerson.eventId, ids),
        R.readable(actor, opts.includeArchived ? 'include' : 'exclude'),
        visibleTo(actor, person),
      ),
    )
    .orderBy(
      asc(eventPerson.eventId),
      asc(eventPerson.role),
      asc(eventPerson.createdAt),
      asc(eventPerson.id),
    );
  for (const { annotation } of rows) {
    const list = out.get(annotation.eventId);
    if (list) list.push(annotation);
    else out.set(annotation.eventId, [annotation]);
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EventPersonChoice = { personId: string; role: 'attending' | 'responsible' };

const choiceKey = (p: { personId: string; role: string }) => `${p.personId}:${p.role}`;

/**
 * The difference between an event's annotations (for people the actor can
 * see) and a wanted set, for the two halves of a people change. The event
 * must already be locked by the caller.
 */
async function peopleDiff(
  actor: UserActor,
  eventId: string,
  people: readonly EventPersonChoice[],
  d: Deps,
) {
  const wanted = new Map(people.map((p) => [choiceKey(p), p]));
  const current = await listEventPeople(actor, eventId, {}, d);
  const remove: EventPersonInput[] = [];
  for (const c of current) {
    const key = choiceKey(c);
    if (wanted.has(key)) wanted.delete(key);
    else remove.push({ eventId, personId: c.personId, role: c.role as EventPersonChoice['role'] });
  }
  return { remove, add: [...wanted.values()] };
}

/**
 * Makes an event's annotations exactly this set, in one transaction (M3
 * contract §3.6): missing ones are set, extra ones removed, each through
 * setEventPerson / removeEventPerson so every rule and audit row is as
 * usual. The event is locked before its annotations are read, so two edits
 * at once queue rather than cross. Only annotations for people the actor
 * can see are compared, so another adult's private annotation (invisible
 * here) is left alone.
 */
export async function setEventPeople(
  actor: UserActor,
  eventId: string,
  people: readonly EventPersonChoice[],
  deps: Deps = {},
): Promise<EventPerson[]> {
  assertCanWrite(actor);
  assertFamilyWritesOpen();
  const db = deps.db ?? getDb();
  return db.transaction(async (tx) => {
    const d = { ...deps, db: tx };
    await R.lock(tx, actor, eventId, 'exclude');
    const { remove, add } = await peopleDiff(actor, eventId, people, d);
    for (const r of remove) await removeEventPerson(actor, r, d);
    for (const p of add) await setEventPerson(actor, { eventId, ...p }, d);
    return listEventPeople(actor, eventId, {}, d);
  });
}

/**
 * Edits an event and its people as one change (ADR 0006 §40): the event is
 * locked, the people no longer wanted are removed, the fields (visibility
 * among them) are updated, then the newly wanted people are set, each
 * audited, all in one transaction. So a private event with a private person
 * on it can become household-visible in one save when that person comes
 * off in the same edit, and a refused person leaves the fields unchanged.
 */
export async function editEventWithPeople(
  actor: UserActor,
  id: string,
  patch: UpdateEventInput,
  people: readonly EventPersonChoice[],
  deps: Deps = {},
): Promise<Event> {
  assertCanWrite(actor);
  assertFamilyWritesOpen();
  const db = deps.db ?? getDb();
  return db.transaction(async (tx) => {
    const d = { ...deps, db: tx };
    const current = await R.lock(tx, actor, id, 'exclude');
    refuseSynced(current);
    const { remove, add } = await peopleDiff(actor, id, people, d);
    for (const r of remove) await removeEventPerson(actor, r, d);
    const updated = await updateEvent(actor, id, patch, d);
    for (const p of add) await setEventPerson(actor, { eventId: id, ...p }, d);
    return updated;
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
