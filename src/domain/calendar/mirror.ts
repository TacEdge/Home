import { createHash } from 'node:crypto';
import type { EventKind } from '@/db/schema/event';
import type { Visibility } from '@/db/schema/common';
import type { ExternalEvent } from './provider';

// How a provider's event becomes a synced HOME event (M4 contract §3.2–3.3,
// ADR 0007 §8, §13, §36). Pure: no database. The sync service (sync.ts)
// writes what these return and checks every row against `assertMirrored`
// before writing it, so a synced event can only ever be the owner's, from a
// calendar, in its own source, with a parent from that same source.

/** The calendar a synced event belongs to, as the sync service read it. */
export type MirrorSource = {
  id: string;
  ownerUserId: string;
  visibility: Visibility;
  defaultKind: EventKind | null;
};

/** One synced event's identity within its source: its UID and its original occurrence. */
export function identityKey(uid: string, original: string | null): string {
  return JSON.stringify([uid, original ?? '']);
}

/** What HOME shows for an event its calendar gave no title. */
export const UNTITLED = 'Untitled';

/**
 * A tag of the provider-owned content (`external_etag`, `e1:` + SHA-256), so
 * an unchanged event is not rewritten. Covers exactly what the sync writes
 * from the provider: never identity-free extras like the revision counter.
 */
export function etagOf(e: ExternalEvent): string {
  const time = e.time.allDay
    ? { allDay: true, startDate: e.time.startDate, endDate: e.time.endDate }
    : {
        allDay: false,
        startsAt: e.time.startsAt.toISOString(),
        endsAt: e.time.endsAt.toISOString(),
        timeZone: e.time.timeZone,
      };
  const content = [
    e.uid,
    e.recurrenceId,
    time,
    e.recurrence === 'rule' ? e.rrule : null,
    e.exdates,
    e.title,
    e.description,
    e.location,
  ];
  return `e1:${createHash('sha256').update(JSON.stringify(content)).digest('hex')}`;
}

/**
 * The columns a synced event has, from its provider event and its source.
 * The provider owns the title, details, place, time, zone, all-day, rule,
 * exdates, UID and original occurrence; the source decides the kind and who
 * can see it; the owner is always the connection's owner, made `via sync`.
 * HOME's own annotations (people, notes) are other tables, never touched.
 */
export function mirroredColumns(e: ExternalEvent, src: MirrorSource) {
  const time = e.time.allDay
    ? {
        allDay: true,
        startDate: e.time.startDate,
        endDate: e.time.endDate,
        startsAt: null,
        endsAt: null,
        timeZone: null,
      }
    : {
        allDay: false,
        startsAt: e.time.startsAt,
        endsAt: e.time.endsAt,
        timeZone: e.time.timeZone,
        startDate: null,
        endDate: null,
      };
  return {
    title: e.title ?? UNTITLED,
    description: e.description,
    location: e.location,
    ...time,
    rrule: e.recurrence === 'rule' ? e.rrule : null,
    exdates: e.exdates.length ? [...e.exdates] : null,
    kind: src.defaultKind ?? 'other',
    domain: null,
    visibility: src.visibility,
    source: 'synced' as const,
    calendarSourceId: src.id,
    externalUid: e.uid,
    externalEtag: etagOf(e),
    recurrenceOriginal: e.recurrenceId,
    createdBy: src.ownerUserId,
    createdVia: 'sync' as const,
  };
}

export type MirroredColumns = ReturnType<typeof mirroredColumns>;

/** A row about to be written, with its parent resolved. */
export type MirroredWrite = MirroredColumns & { id?: string; recurrenceParentId: string | null };

/** The series rows of this source, by UID, that a parent may point at. */
export type SeriesInSource = ReadonlyMap<string, { id: string; uid: string }>;

export class SyncInvariantError extends Error {
  constructor(rule: string) {
    super(`sync invariant: ${rule}`);
    this.name = 'SyncInvariantError';
  }
}

/**
 * The rules every synced write keeps (ADR 0007 §8, §26, §36), checked before
 * the database sees the row; a breach is a programming error, so the whole
 * refresh rolls back. The database adds its own: provenance, identity,
 * parent-needs-original and the source foreign key (migration 0007).
 */
export function assertMirrored(
  row: MirroredWrite,
  ctx: { source: MirrorSource; connectionOwner: string; series: SeriesInSource },
): void {
  if (ctx.source.ownerUserId !== ctx.connectionOwner)
    throw new SyncInvariantError('the source belongs to its connection’s owner');
  if (row.createdBy !== ctx.connectionOwner)
    throw new SyncInvariantError('a synced event is created by the connection’s owner');
  if (row.createdVia !== 'sync' || row.source !== 'synced')
    throw new SyncInvariantError('a synced event is made via sync');
  if (row.calendarSourceId !== ctx.source.id)
    throw new SyncInvariantError('a synced event is in its own source');
  if (row.visibility !== ctx.source.visibility)
    throw new SyncInvariantError('a synced event has its source’s visibility');
  if (row.recurrenceParentId !== null) {
    if (row.recurrenceOriginal === null)
      throw new SyncInvariantError('only an override has a parent');
    if (row.id !== undefined && row.recurrenceParentId === row.id)
      throw new SyncInvariantError('an event is never its own parent');
    const parent = [...ctx.series.values()].find((s) => s.id === row.recurrenceParentId);
    if (!parent || parent.uid !== row.externalUid)
      throw new SyncInvariantError('a parent is the same series, in the same source');
  }
}
