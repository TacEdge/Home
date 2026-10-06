import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { calendarConnection, calendarSource, event, eventPerson, note, person } from '@/db/schema';
import { CalendarAddressError, normaliseCalendarAddress } from '@/lib/calendar-address';
import type { UserActor } from '@/trust/actor';
import { addressFingerprint, sameFingerprint, sealCredential } from '@/trust/credentials';
import { visibleTo } from '@/trust/visibility';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertCanWrite, assertFamilyWritesOpen } from '../common/guards';
import { checkReferences } from '../common/references';
import { auditedWrite, type DomainAudit, type Deps } from '../common/write';
import {
  connectCalendarInput,
  reconnectCalendarInput,
  updateCalendarInput,
  type ConnectCalendarInput,
  type ReconnectCalendarInput,
  type UpdateCalendarInput,
} from './inputs';
import { calendarBoundary } from './errors';
import { calendarKeys } from './keys';

// Calendar connections and their sources (M4 contract §3.2, §4.1, §4.4, §4.6;
// ADR 0007 §5, §6, §8, §34, §36). A connection is one adult's link to a
// provider and holds the sealed credential; only this module and the sync
// service read that table (tests/unit/calendar-credential-access.test.ts),
// and no read here ever returns its credential, key id or fingerprint. A
// source is the calendar a person sees: its id is the calendar's handle
// everywhere outside this module, and its visibility is its events'.
//
//   - Connecting is a person's own act (never Kev, the system or the sync
//     actor), through the real-data gate first. The address is normalised
//     and approved, fingerprinted with HOME_FINGERPRINT_KEY, refused if that
//     exact address is already live (whoever connected it), and sealed with
//     HOME_CREDENTIALS_KEY bound to the row and its owner. The plain address
//     is never stored, logged, audited or returned.
//   - Connecting an address that matches one of your own disconnected
//     connections reconnects it: the same connection and source rows return,
//     so the next refresh restores their events by identity, with their
//     people and notes. Never a second, ambiguous row.
//   - Disconnecting destroys the credential at once and archives the source
//     and its synced events; nothing is deleted, the fingerprint is kept.
//   - Only the owner changes a calendar. The other adult sees a household
//     calendar's name, owner and freshness, and may refresh it.

/** A source counts as stale, so a visit refreshes it, after this long (contract §3.3). */
export const STALE_AFTER_MS = 15 * 60 * 1000;

type Source = typeof calendarSource.$inferSelect;

/** What anyone who can see a calendar reads about it. Never a credential or fingerprint. */
export type CalendarView = {
  id: string;
  name: string;
  visibility: 'household' | 'private';
  defaultKind: Source['defaultKind'];
  defaultPersonIds: string[];
  ownerUserId: string;
  isOwner: boolean;
  lastAttemptAt: Date | null;
  lastSyncedAt: Date | null;
  lastSyncStatus: Source['lastSyncStatus'];
  lastSyncErrorCode: string | null;
  lastSkippedCount: number | null;
  stale: boolean;
  archivedAt: Date | null;
  /** The owner's own view of the connection; null for anyone else. */
  connection: {
    status: 'active' | 'disconnected';
    lastErrorCode: string | null;
    disconnectedAt: Date | null;
  } | null;
};

/** The source columns any reader may have: never connection_id or the feed hash. */
const sourceColumns = {
  id: calendarSource.id,
  name: calendarSource.name,
  visibility: calendarSource.visibility,
  defaultKind: calendarSource.defaultKind,
  defaultPersonIds: calendarSource.defaultPersonIds,
  externalCalendarId: calendarSource.externalCalendarId,
  createdBy: calendarSource.createdBy,
  createdVia: calendarSource.createdVia,
  createdAt: calendarSource.createdAt,
  updatedAt: calendarSource.updatedAt,
  archivedAt: calendarSource.archivedAt,
  lastAttemptAt: calendarSource.lastAttemptAt,
  lastSyncedAt: calendarSource.lastSyncedAt,
  lastSyncStatus: calendarSource.lastSyncStatus,
  lastSyncErrorCode: calendarSource.lastSyncErrorCode,
  lastSkippedCount: calendarSource.lastSkippedCount,
};
type SourceRow = { [K in keyof typeof sourceColumns]: Source[K] };

/** Connecting, changing, disconnecting and refreshing are a person's own acts. */
export function assertPerson(actor: UserActor): void {
  assertCanWrite(actor); // not the system, not Kev, not the sync actor
  if (actor.via !== 'ui') throw new NotPermittedError('not_a_person');
}

const isStale = (s: { lastAttemptAt: Date | null }, now: Date) =>
  s.lastAttemptAt === null || now.getTime() - s.lastAttemptAt.getTime() >= STALE_AFTER_MS;

async function viewsOf(
  db: DbOrTx,
  actor: UserActor,
  rows: SourceRow[],
  now: Date,
): Promise<CalendarView[]> {
  const own = rows.filter((r) => r.createdBy === actor.userId).map((r) => r.id);
  const connections = own.length
    ? await db
        .select({
          sourceId: calendarSource.id,
          ownerUserId: calendarConnection.ownerUserId,
          status: calendarConnection.status,
          lastErrorCode: calendarConnection.lastErrorCode,
          disconnectedAt: calendarConnection.disconnectedAt,
        })
        .from(calendarSource)
        .innerJoin(calendarConnection, eq(calendarConnection.id, calendarSource.connectionId))
        .where(
          and(inArray(calendarSource.id, own), eq(calendarConnection.ownerUserId, actor.userId)),
        )
    : [];
  const byId = new Map(connections.map((c) => [c.sourceId, c]));
  return rows.map((r) => {
    const c = byId.get(r.id);
    return {
      id: r.id,
      name: r.name,
      visibility: r.visibility as CalendarView['visibility'],
      defaultKind: r.defaultKind,
      defaultPersonIds: [...r.defaultPersonIds],
      ownerUserId: r.createdBy ?? '',
      isOwner: r.createdBy === actor.userId,
      lastAttemptAt: r.lastAttemptAt,
      lastSyncedAt: r.lastSyncedAt,
      lastSyncStatus: r.lastSyncStatus,
      lastSyncErrorCode: r.lastSyncErrorCode,
      lastSkippedCount: r.lastSkippedCount,
      stale: r.archivedAt === null && isStale(r, now),
      archivedAt: r.archivedAt,
      connection: c
        ? {
            status: c.status as 'active' | 'disconnected',
            lastErrorCode: c.lastErrorCode,
            disconnectedAt: c.disconnectedAt,
          }
        : null,
    };
  });
}

const visibleSources = (actor: UserActor, includeArchived: boolean) =>
  and(
    visibleTo(actor, calendarSource),
    includeArchived ? undefined : isNull(calendarSource.archivedAt),
  );

/** The calendars this adult can see: their own and the household's. */
export async function listCalendars(
  actor: UserActor,
  opts: { includeArchived?: boolean; now?: Date } = {},
  deps: Deps = {},
): Promise<CalendarView[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select(sourceColumns)
    .from(calendarSource)
    .where(visibleSources(actor, opts.includeArchived === true))
    .orderBy(asc(calendarSource.createdAt), asc(calendarSource.id));
  return viewsOf(db, actor, rows, opts.now ?? new Date());
}

/** One calendar this adult can see, or NotFound (missing and invisible read the same). */
export async function getCalendar(
  actor: UserActor,
  id: string,
  opts: { includeArchived?: boolean; now?: Date } = {},
  deps: Deps = {},
): Promise<CalendarView> {
  const db = deps.db ?? getDb();
  if (!isUuid(id)) throw new NotFoundError('calendar');
  const rows = await db
    .select(sourceColumns)
    .from(calendarSource)
    .where(and(eq(calendarSource.id, id), visibleSources(actor, opts.includeArchived === true)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('calendar');
  const [view] = await viewsOf(db, actor, rows, opts.now ?? new Date());
  return view!;
}

/** The calendar rows of this adult's export: what they can see, archived included. */
export async function listCalendarsForExport(
  actor: UserActor,
  deps: Deps = {},
): Promise<SourceRow[]> {
  const db = deps.db ?? getDb();
  return db
    .select(sourceColumns)
    .from(calendarSource)
    .where(visibleSources(actor, true))
    .orderBy(asc(calendarSource.createdAt), asc(calendarSource.id));
}

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** A connection's audit row: its owner's alone (registered owner-only). */
const connectionAudit = (
  name: string,
  connectionId: string,
  ownerUserId: string,
  meta: DomainAudit['meta'],
): DomainAudit => ({
  event: name,
  subjectType: 'calendar_connection',
  subjectId: connectionId,
  meta,
  record: { visibility: 'private', createdBy: ownerUserId },
});

/** A source's audit row: as visible as the calendar. */
const sourceAudit = (
  name: string,
  s: Pick<Source, 'id' | 'visibility' | 'createdBy'>,
  meta?: DomainAudit['meta'],
): DomainAudit => ({
  event: name,
  subjectType: 'calendar_source',
  subjectId: s.id,
  meta,
  record: { visibility: s.visibility, createdBy: s.createdBy },
});

/** People a calendar's events are usually for: visible to its readers (the reference rule). */
async function checkDefaultPeople(
  tx: DbOrTx,
  actor: UserActor,
  visibility: string,
  ids: readonly string[],
): Promise<void> {
  await checkReferences(
    tx,
    actor,
    visibility,
    ids.map((id) => ({ table: person, entity: 'person', id })),
  );
}

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === '23505'
    ? true
    : typeof e === 'object' && e !== null && 'cause' in e
      ? isUniqueViolation((e as { cause?: unknown }).cause)
      : false;

export type ConnectResult = { calendarId: string };

/**
 * Connect a Google calendar by its secret address (M4 contract §4.4).
 * Returns the calendar's id; its events arrive on its first refresh
 * (sync.ts). An address that is one of your own disconnected calendars is
 * refused (`calendar_can_reconnect`) and changes nothing: that is
 * reconnectCalendar's job.
 */
export async function connectCalendar(
  actor: UserActor,
  input: ConnectCalendarInput,
  deps: Deps = {},
): Promise<ConnectResult> {
  return calendarBoundary('connectCalendar', async () => {
    assertPerson(actor);
    // The gate first: in Production nothing about the address is even read
    // while family data is closed (ADR 0006 §2).
    assertFamilyWritesOpen();
    const data = connectCalendarInput.parse(input);
    let normalised: string;
    try {
      normalised = normaliseCalendarAddress(data.address);
    } catch (e) {
      if (e instanceof CalendarAddressError) throw new NotPermittedError('address_not_accepted');
      throw e;
    }
    const keys = calendarKeys();
    const fingerprint = addressFingerprint(keys.fingerprint, normalised);

    try {
      return await auditedWrite<ConnectResult>(actor, deps, async (tx) => {
        const live = await tx
          .select({ id: calendarConnection.id })
          .from(calendarConnection)
          .where(
            and(
              eq(calendarConnection.addressFingerprint, fingerprint),
              eq(calendarConnection.status, 'active'),
            ),
          )
          .limit(1);
        if (live[0]) throw new NotPermittedError('calendar_already_connected');

        // Your own disconnected calendar with this address: connecting is not
        // reconnecting. Nothing changes; reconnectCalendar restores it with its
        // own settings (ADR 0007 §42).
        const [mine] = await tx
          .select({ id: calendarConnection.id })
          .from(calendarConnection)
          .where(
            and(
              eq(calendarConnection.ownerUserId, actor.userId),
              eq(calendarConnection.addressFingerprint, fingerprint),
              eq(calendarConnection.status, 'disconnected'),
            ),
          )
          .limit(1);
        if (mine) throw new NotPermittedError('calendar_can_reconnect');

        const connectionId = randomUUID();
        const sealed = sealCredential(keys.credentials, normalised, {
          connectionId,
          ownerUserId: actor.userId,
        });
        const keyId = keys.credentials.current.id;

        await checkDefaultPeople(tx, actor, data.visibility, data.defaultPersonIds);
        await tx.insert(calendarConnection).values({
          id: connectionId,
          ownerUserId: actor.userId,
          provider: 'ics',
          credentialsEncrypted: sealed,
          credentialsKeyId: keyId,
          addressFingerprint: fingerprint,
          status: 'active',
        });
        const [source] = await tx
          .insert(calendarSource)
          .values({
            connectionId,
            externalCalendarId: 'default',
            name: data.name,
            visibility: data.visibility,
            defaultKind: data.defaultKind,
            defaultPersonIds: data.defaultPersonIds,
            createdBy: actor.userId,
            createdVia: 'ui',
          })
          .returning({
            id: calendarSource.id,
            visibility: calendarSource.visibility,
            createdBy: calendarSource.createdBy,
          });
        if (!source) throw new Error('connect: source insert returned no row');
        return {
          result: { calendarId: source.id },
          audit: [
            connectionAudit('calendar.connect', connectionId, actor.userId, { provider: 'ics' }),
            sourceAudit('calendar_source.create', source, {
              visibility: source.visibility,
              defaultKind: data.defaultKind,
              defaultPeople: data.defaultPersonIds.length,
            }),
          ],
        };
      });
    } catch (e) {
      // Two people connecting the same address at once: the live-fingerprint
      // index lets one through and refuses the other here.
      if (isUniqueViolation(e)) throw new NotPermittedError('calendar_already_connected');
      throw e;
    }
  });
}

/**
 * Reconnect one of your own disconnected calendars (ADR 0007 §5, §42). The
 * address proves identity: its fingerprint must be the one that calendar's
 * connection kept. Nothing else is accepted. The same connection and
 * calendar return with their own settings (default people are checked
 * again, and any that can no longer be named are dropped); the next
 * refresh restores the events by identity, with their people and notes.
 */
export async function reconnectCalendar(
  actor: UserActor,
  calendarId: string,
  input: ReconnectCalendarInput,
  deps: Deps = {},
): Promise<ConnectResult> {
  return calendarBoundary('reconnectCalendar', async () => {
    assertPerson(actor);
    assertFamilyWritesOpen();
    const data = reconnectCalendarInput.parse(input);
    let normalised: string;
    try {
      normalised = normaliseCalendarAddress(data.address);
    } catch (e) {
      if (e instanceof CalendarAddressError) throw new NotPermittedError('address_not_accepted');
      throw e;
    }
    const keys = calendarKeys();
    const fingerprint = addressFingerprint(keys.fingerprint, normalised);
    if (!isUuid(calendarId)) throw new NotFoundError('calendar');

    try {
      return await auditedWrite<ConnectResult>(actor, deps, async (tx) => {
        const [source] = await tx
          .select()
          .from(calendarSource)
          .where(and(eq(calendarSource.id, calendarId), visibleSources(actor, true)))
          .for('update')
          .limit(1);
        if (!source) throw new NotFoundError('calendar');
        if (source.createdBy !== actor.userId) throw new NotPermittedError('not_owner');
        const [conn] = await tx
          .select({
            id: calendarConnection.id,
            ownerUserId: calendarConnection.ownerUserId,
            status: calendarConnection.status,
            fingerprint: calendarConnection.addressFingerprint,
          })
          .from(calendarConnection)
          .where(eq(calendarConnection.id, source.connectionId))
          .for('update')
          .limit(1);
        if (!conn || conn.ownerUserId !== actor.userId) throw new NotPermittedError('not_owner');
        if (conn.status !== 'disconnected' || source.archivedAt === null)
          throw new NotPermittedError('calendar_already_connected');
        if (!conn.fingerprint || !sameFingerprint(conn.fingerprint, fingerprint))
          throw new NotPermittedError('calendar_address_mismatch');

        // The default people, checked again: any that is gone, hidden from the
        // owner, or private while the calendar is household is dropped.
        const people = await keptDefaultPeople(
          tx,
          actor,
          source.visibility,
          source.defaultPersonIds,
        );
        const sealed = sealCredential(keys.credentials, normalised, {
          connectionId: conn.id,
          ownerUserId: actor.userId,
        });
        await tx
          .update(calendarConnection)
          .set({
            status: 'active',
            credentialsEncrypted: sealed,
            credentialsKeyId: keys.credentials.current.id,
            disconnectedAt: null,
            lastErrorCode: null,
            updatedAt: sql`now()`,
          })
          .where(eq(calendarConnection.id, conn.id));
        const [restored] = await tx
          .update(calendarSource)
          .set({
            archivedAt: null,
            feedHash: null,
            defaultPersonIds: people,
            updatedAt: sql`now()`,
          })
          .where(eq(calendarSource.id, source.id))
          .returning({
            id: calendarSource.id,
            visibility: calendarSource.visibility,
            createdBy: calendarSource.createdBy,
          });
        if (!restored) throw new NotFoundError('calendar');
        return {
          result: { calendarId: restored.id },
          audit: [
            connectionAudit('calendar.reconnect', conn.id, actor.userId, { provider: 'ics' }),
            sourceAudit('calendar_source.restore', restored, {
              defaultPeopleDropped: source.defaultPersonIds.length - people.length,
            }),
          ],
        };
      });
    } catch (e) {
      // Someone connected this address as a new calendar meanwhile.
      if (isUniqueViolation(e)) throw new NotPermittedError('calendar_already_connected');
      throw e;
    }
  });
}

/** The default people a calendar may still name: visible to its owner, live, and household if it is. */
async function keptDefaultPeople(
  tx: DbOrTx,
  actor: UserActor,
  visibility: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: person.id, visibility: person.visibility })
    .from(person)
    .where(and(inArray(person.id, [...ids]), visibleTo(actor, person), isNull(person.archivedAt)))
    .for('share');
  const ok = new Set(
    rows.filter((r) => visibility !== 'household' || r.visibility === 'household').map((r) => r.id),
  );
  return ids.filter((id) => ok.has(id));
}

/** Locks a calendar the actor owns (NotFound if they cannot see it; not_owner if not theirs). */
async function lockOwned(tx: DbOrTx, actor: UserActor, id: string): Promise<Source> {
  if (!isUuid(id)) throw new NotFoundError('calendar');
  const [row] = await tx
    .select()
    .from(calendarSource)
    .where(and(eq(calendarSource.id, id), visibleSources(actor, false)))
    .for('update')
    .limit(1);
  if (!row) throw new NotFoundError('calendar');
  if (row.createdBy !== actor.userId) throw new NotPermittedError('not_owner');
  return row;
}

/** The ids of a calendar's synced events, locked, archived ones included. */
async function lockEventsOf(tx: DbOrTx, sourceId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: event.id })
    .from(event)
    .where(and(eq(event.calendarSourceId, sourceId), eq(event.source, 'synced')))
    .for('update');
  return rows.map((r) => r.id);
}

/**
 * Change a calendar's own settings: its name, who can see it, its usual kind
 * and whose events these usually are. Owner only. A change of who can see it
 * applies to its events at once, under the reference rules: it cannot
 * become private while household notes point at its events, nor household
 * while its events name private people.
 */
export async function updateCalendar(
  actor: UserActor,
  id: string,
  patch: UpdateCalendarInput,
  deps: Deps = {},
): Promise<CalendarView> {
  return calendarBoundary('updateCalendar', async () => {
    assertPerson(actor);
    const parsed = updateCalendarInput.parse(patch);
    const fields = Object.keys(parsed).sort();
    if (fields.length === 0) return getCalendar(actor, id, {}, deps);
    await auditedWrite(actor, deps, async (tx) => {
      const current = await lockOwned(tx, actor, id);
      const visibility = parsed.visibility ?? current.visibility;
      const people = parsed.defaultPersonIds ?? current.defaultPersonIds;
      if (parsed.defaultPersonIds !== undefined || visibility !== current.visibility)
        await checkDefaultPeople(tx, actor, visibility, people);
      const events = await lockEventsOf(tx, current.id);
      if (visibility !== current.visibility && events.length) {
        if (visibility === 'private') {
          const [n] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(note)
            .where(
              and(
                eq(note.subjectType, 'event'),
                inArray(note.subjectId, events),
                eq(note.visibility, 'household'),
              ),
            );
          if ((n?.n ?? 0) > 0) throw new NotPermittedError('referenced_by_household');
        } else {
          const [n] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(eventPerson)
            .innerJoin(person, eq(person.id, eventPerson.personId))
            .where(and(inArray(eventPerson.eventId, events), eq(person.visibility, 'private')));
          if ((n?.n ?? 0) > 0) throw new NotPermittedError('references_private');
        }
      }
      const [row] = await tx
        .update(calendarSource)
        .set({ ...parsed, updatedAt: sql`now()` })
        .where(eq(calendarSource.id, current.id))
        .returning();
      if (!row) throw new NotFoundError('calendar');
      // The events follow their calendar's visibility and usual kind now, not
      // at the next refresh (the sync writes the same values).
      if (events.length && (visibility !== current.visibility || parsed.defaultKind !== undefined))
        await tx
          .update(event)
          .set({ visibility, kind: row.defaultKind ?? 'other', updatedAt: sql`now()` })
          .where(and(eq(event.calendarSourceId, current.id), eq(event.source, 'synced')));
      const audits: DomainAudit[] = [sourceAudit('calendar_source.update', row, { fields })];
      return { result: null, audit: audits };
    });
    return getCalendar(actor, id, {}, deps);
  });
}

/**
 * Disconnect a calendar (ADR 0007 §5): in one transaction the credential is
 * destroyed, the connection marked disconnected (its fingerprint kept), the
 * calendar archived and its synced events archived. Nothing is deleted;
 * people and notes on the events stay, and return if the owner connects the
 * same address again.
 */
export async function disconnectCalendar(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<void> {
  return calendarBoundary('disconnectCalendar', async () => {
    assertPerson(actor);
    await auditedWrite(actor, deps, async (tx) => {
      const current = await lockOwned(tx, actor, id);
      const [conn] = await tx
        .update(calendarConnection)
        .set({
          status: 'disconnected',
          credentialsEncrypted: null,
          credentialsKeyId: null,
          disconnectedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(calendarConnection.id, current.connectionId),
            eq(calendarConnection.ownerUserId, actor.userId),
            eq(calendarConnection.status, 'active'),
          ),
        )
        .returning({ id: calendarConnection.id });
      if (!conn) throw new NotPermittedError('calendar_disconnected');
      const [source] = await tx
        .update(calendarSource)
        .set({ archivedAt: sql`now()`, feedHash: null, updatedAt: sql`now()` })
        .where(eq(calendarSource.id, current.id))
        .returning();
      if (!source) throw new NotFoundError('calendar');
      const archived = await tx
        .update(event)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(event.calendarSourceId, current.id),
            eq(event.source, 'synced'),
            isNull(event.archivedAt),
          ),
        )
        .returning({ id: event.id });
      return {
        result: null,
        audit: [
          connectionAudit('calendar.disconnect', conn.id, actor.userId, { provider: 'ics' }),
          sourceAudit('calendar_source.archive', source, { events: archived.length }),
        ],
      };
    });
  });
}
