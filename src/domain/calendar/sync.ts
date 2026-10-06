import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { calendarConnection, calendarSource, event, user } from '@/db/schema';
import type { EventKind } from '@/db/schema/event';
import { isoDateInZone, type IsoDate } from '@/lib/dates';
import { env } from '@/lib/env';
import type { UserActor } from '@/trust/actor';
import {
  CredentialError,
  openCredential,
  sealCredential,
  sealedWithPreviousKey,
} from '@/trust/credentials';
import { visibleTo } from '@/trust/visibility';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertFamilyWritesOpen } from '../common/guards';
import { auditedWrite, issueSyncActor, type DomainAudit, type Deps } from '../common/write';
import { calendarKeys } from './keys';
import {
  assertMirrored,
  identityKey,
  mirroredColumns,
  type MirrorSource,
  type MirroredWrite,
} from './mirror';
import {
  CalendarProviderError,
  importWindow,
  uidFits,
  type CalendarProvider,
  type ExternalEvent,
  type FetchResult,
} from './provider';
import { assertPerson, STALE_AFTER_MS } from './service';

// The sync service (M4 contract §3.3–3.4, §3.8, §4.6; ADR 0007 §4, §8, §12,
// §13, §26, §36–37). One refresh of one calendar source:
//
//   1. A person asks (their own calendar, or a household one they can see;
//      never Kev, the system or the sync actor), through the gate first.
//   2. One transaction, which first takes the source's advisory lock with
//      pg_try_advisory_xact_lock: a second refresh of the same source
//      returns `busy` at once and never interleaves (no in-memory lock; the
//      database's lock works across servers). The source and its connection
//      are locked and checked: active, the same owner.
//   3. The credential is opened only here, for the fetch, and dropped: the
//      provider (Package 3) fetches it through Package 2's safe fetch. The
//      address is never logged, returned or stored in plain text.
//   4. A provider failure (one of §3.8's codes) records the failure on the
//      source and connection and changes no event: last-known events stay.
//      Any other error rolls everything back.
//   5. An unchanged feed (the same feed hash after a good refresh) moves
//      only the freshness.
//   6. Otherwise the feed is applied by identity (source, UID, original
//      occurrence): new events added, changed ones updated in place,
//      returning ones restored, missing ones archived, never deleted. A row
//      keeps its id, so its people and notes survive every change. Overrides
//      are linked to their series when the series is in the feed, and stored
//      as orphans otherwise; their identity never depends on the link.
//   7. Every write is the owner's, made through the sync actor (`via:
//      sync`), checked against the mirror invariants, and audited as one
//      structural row with counts only.

export type SyncStatus = NonNullable<(typeof calendarSource.$inferSelect)['lastSyncStatus']>;

export type SyncCounts = {
  added: number;
  changed: number;
  archived: number;
  restored: number;
  skipped: number;
};

export type RefreshOutcome =
  { status: 'busy' } | { status: SyncStatus; unchanged: boolean; counts: SyncCounts };

const zero = (): SyncCounts => ({ added: 0, changed: 0, archived: 0, restored: 0, skipped: 0 });

type Opts = { today?: IsoDate };

/** The advisory-lock key of one source: one refresh at a time per source, across servers. */
const lockKey = (sourceId: string) => `home:calendar_source:${sourceId}`;

/**
 * Refresh one calendar now (Settings › Calendars' Refresh now, and the
 * refresh-on-use route). `calendarId` is the source's id.
 */
export async function refreshCalendar(
  actor: UserActor,
  calendarId: string,
  provider: CalendarProvider,
  opts: Opts = {},
  deps: Deps = {},
): Promise<RefreshOutcome> {
  assertPerson(actor);
  assertFamilyWritesOpen();
  const db = deps.db ?? getDb();
  if (!/^[0-9a-f-]{36}$/i.test(calendarId)) throw new NotFoundError('calendar');
  // Who may cause a refresh: anyone who can see the calendar (a private one
  // is its owner's alone). The writes are always the owner's.
  const [visible] = await db
    .select({ id: calendarSource.id, ownerUserId: calendarSource.createdBy })
    .from(calendarSource)
    .where(
      and(
        eq(calendarSource.id, calendarId),
        visibleTo(actor, calendarSource),
        isNull(calendarSource.archivedAt),
      ),
    )
    .limit(1);
  if (!visible?.ownerUserId) throw new NotFoundError('calendar');
  const [owner] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, visible.ownerUserId))
    .limit(1);
  if (!owner) throw new NotFoundError('calendar');
  const syncActor = issueSyncActor({ userId: visible.ownerUserId, email: owner.email });
  const keys = calendarKeys();
  const today = opts.today ?? isoDateInZone(new Date(), env.HOME_TIMEZONE);

  return auditedWrite<RefreshOutcome>(syncActor, deps, async (tx) => {
    const lock = await tx.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${lockKey(calendarId)}, 0)) as ok`,
    );
    if (lock.rows[0]?.ok !== true) return { result: { status: 'busy' }, audit: null };

    const [source] = await tx
      .select()
      .from(calendarSource)
      .where(and(eq(calendarSource.id, calendarId), isNull(calendarSource.archivedAt)))
      .for('update')
      .limit(1);
    if (!source || source.createdBy !== visible.ownerUserId) throw new NotFoundError('calendar');
    const [conn] = await tx
      .select({
        id: calendarConnection.id,
        ownerUserId: calendarConnection.ownerUserId,
        status: calendarConnection.status,
        sealed: calendarConnection.credentialsEncrypted,
      })
      .from(calendarConnection)
      .where(eq(calendarConnection.id, source.connectionId))
      .for('update')
      .limit(1);
    if (!conn || conn.status !== 'active' || !conn.sealed)
      throw new NotPermittedError('calendar_disconnected');
    if (conn.ownerUserId !== source.createdBy) throw new NotFoundError('calendar');

    // Key rotation (ADR 0007 §34, DEPLOY.md §D): a credential still sealed
    // with the previous key is resealed with the current one, bound to the
    // same row and owner, before anything else happens.
    if (sealedWithPreviousKey(keys.credentials, conn.sealed)) {
      const binding = { connectionId: conn.id, ownerUserId: conn.ownerUserId };
      const resealed = sealCredential(
        keys.credentials,
        openSealed(keys.credentials, conn.sealed, binding),
        binding,
      );
      await tx
        .update(calendarConnection)
        .set({
          credentialsEncrypted: resealed,
          credentialsKeyId: keys.credentials.current.id,
          updatedAt: sql`now()`,
        })
        .where(eq(calendarConnection.id, conn.id));
      conn.sealed = resealed;
    }

    let result: FetchResult;
    try {
      result = await fetchWith(provider, keys.credentials, conn, source.externalCalendarId, today);
    } catch (e) {
      if (!(e instanceof CalendarProviderError)) throw e;
      return recordFailure(tx, source, conn.id, e.code);
    }

    const status: SyncStatus = 'ok';
    const unchanged =
      source.feedHash === result.feedHash &&
      (source.lastSyncStatus === 'ok' || source.lastSyncStatus === 'partial');
    const counts = unchanged
      ? { ...zero(), skipped: result.skipped }
      : await apply(tx, result, {
          source: {
            id: source.id,
            ownerUserId: conn.ownerUserId,
            visibility: source.visibility as MirrorSource['visibility'],
            defaultKind: source.defaultKind as EventKind | null,
          },
          connectionOwner: conn.ownerUserId,
        });
    const final: SyncStatus = counts.skipped > 0 ? 'partial' : status;
    await tx
      .update(calendarSource)
      .set({
        feedHash: result.feedHash,
        lastAttemptAt: sql`now()`,
        lastSyncedAt: sql`now()`,
        lastSyncStatus: final,
        lastSyncErrorCode: null,
        lastSkippedCount: counts.skipped,
      })
      .where(eq(calendarSource.id, source.id));
    await tx
      .update(calendarConnection)
      .set({ lastErrorCode: null, updatedAt: sql`now()` })
      .where(eq(calendarConnection.id, conn.id));
    return {
      result: { status: final, unchanged, counts },
      audit: syncAudit(source, final, unchanged, counts),
    };
  });
}

/** Opens a sealed credential, or refuses calmly when HOME's keys no longer open it. */
function openSealed(
  keys: Parameters<typeof openCredential>[0],
  sealed: string,
  binding: { connectionId: string; ownerUserId: string },
): string {
  try {
    return openCredential(keys, sealed, binding);
  } catch (e) {
    if (e instanceof CredentialError) throw new NotPermittedError('calendar_credential_unreadable');
    throw e;
  }
}

/** Opens the credential for this one fetch; the plain address lives only in this call. */
async function fetchWith(
  provider: CalendarProvider,
  keys: Parameters<typeof openCredential>[0],
  conn: { id: string; ownerUserId: string; sealed: string | null },
  externalCalendarId: string,
  today: IsoDate,
): Promise<FetchResult> {
  const address = openSealed(keys, conn.sealed ?? '', {
    connectionId: conn.id,
    ownerUserId: conn.ownerUserId,
  });
  return provider.fetchEvents(
    { kind: 'ics', address },
    { id: externalCalendarId, name: null },
    importWindow(today),
  );
}

/** The one structural audit row of a refresh: the status and counts, nothing else (§4.6). */
function syncAudit(
  source: Pick<typeof calendarSource.$inferSelect, 'id' | 'visibility' | 'createdBy'>,
  status: SyncStatus,
  unchanged: boolean,
  counts: SyncCounts,
): DomainAudit {
  return {
    event: 'calendar.sync',
    subjectType: 'calendar_source',
    subjectId: source.id,
    meta: { status, unchanged, ...counts },
    record: { visibility: source.visibility, createdBy: source.createdBy },
  };
}

/** A failed fetch or parse: freshness and the code are recorded; no event changes. */
async function recordFailure(
  tx: DbOrTx,
  source: typeof calendarSource.$inferSelect,
  connectionId: string,
  code: SyncStatus,
): Promise<{ result: RefreshOutcome; audit: DomainAudit }> {
  await tx
    .update(calendarSource)
    .set({ lastAttemptAt: sql`now()`, lastSyncStatus: code, lastSyncErrorCode: code })
    .where(eq(calendarSource.id, source.id));
  await tx
    .update(calendarConnection)
    .set({ lastErrorCode: code, updatedAt: sql`now()` })
    .where(eq(calendarConnection.id, connectionId));
  return {
    result: { status: code, unchanged: false, counts: zero() },
    audit: syncAudit(source, code, false, zero()),
  };
}

type Existing = {
  id: string;
  externalUid: string | null;
  recurrenceOriginal: string | null;
  externalEtag: string | null;
  archivedAt: Date | null;
  recurrenceParentId: string | null;
  visibility: string;
  kind: string;
  createdBy: string | null;
  createdVia: string;
};

/** Applies a successful feed to the source's synced events, by identity. */
async function apply(
  tx: DbOrTx,
  result: FetchResult,
  ctx: { source: MirrorSource; connectionOwner: string },
): Promise<SyncCounts> {
  const counts = { ...zero(), skipped: result.skipped };
  const existing = await tx
    .select({
      id: event.id,
      externalUid: event.externalUid,
      recurrenceOriginal: event.recurrenceOriginal,
      externalEtag: event.externalEtag,
      archivedAt: event.archivedAt,
      recurrenceParentId: event.recurrenceParentId,
      visibility: event.visibility,
      kind: event.kind,
      createdBy: event.createdBy,
      createdVia: event.createdVia,
    })
    .from(event)
    .where(and(eq(event.calendarSourceId, ctx.source.id), eq(event.source, 'synced')))
    .for('update');
  const byIdentity = new Map<string, Existing>(
    existing.map((r) => [identityKey(r.externalUid ?? '', r.recurrenceOriginal), r]),
  );

  // Whatever any provider returns, only events that can be identities are
  // written, each identity once (ADR 0007 §35); the rest are counted.
  const seen = new Set<string>();
  const usable: ExternalEvent[] = [];
  for (const e of result.events) {
    const key = identityKey(e.uid, e.recurrenceId);
    if (!uidFits(e.uid) || seen.has(key)) {
      counts.skipped++;
      continue;
    }
    seen.add(key);
    usable.push(e);
  }

  // Series (and single events) first, so their overrides can point at them.
  const series = new Map<string, { id: string; uid: string }>();
  const ordered = [
    ...usable.filter((e) => e.recurrenceId === null),
    ...usable.filter((e) => e.recurrenceId !== null),
  ];
  for (const e of ordered) {
    const cols = mirroredColumns(e, ctx.source);
    const parentId = e.recurrenceId === null ? null : (series.get(e.uid)?.id ?? null);
    const key = identityKey(e.uid, e.recurrenceId);
    const prior = byIdentity.get(key);
    const row: MirroredWrite = { ...cols, id: prior?.id, recurrenceParentId: parentId };
    assertMirrored(row, { ...ctx, series });

    let id: string;
    if (!prior) {
      const [inserted] = await tx
        .insert(event)
        .values({ ...cols, recurrenceParentId: parentId })
        .returning({ id: event.id });
      if (!inserted) throw new Error('sync: event insert returned no row');
      id = inserted.id;
      counts.added++;
    } else {
      id = prior.id;
      const differs =
        prior.externalEtag !== cols.externalEtag ||
        prior.recurrenceParentId !== parentId ||
        prior.visibility !== cols.visibility ||
        prior.kind !== cols.kind ||
        prior.createdBy !== cols.createdBy ||
        prior.createdVia !== cols.createdVia;
      if (prior.archivedAt !== null || differs) {
        await tx
          .update(event)
          .set({
            ...cols,
            recurrenceParentId: parentId,
            archivedAt: null,
            updatedAt: sql`now()`,
          })
          .where(and(eq(event.id, prior.id), eq(event.calendarSourceId, ctx.source.id)));
        if (prior.archivedAt !== null) counts.restored++;
        else counts.changed++;
      }
    }
    if (e.recurrenceId === null) series.set(e.uid, { id, uid: e.uid });
  }

  // Missing from a successful feed: archived, never deleted (ADR 0007 §13).
  const missing = existing
    .filter((r) => r.archivedAt === null)
    .filter((r) => !seen.has(identityKey(r.externalUid ?? '', r.recurrenceOriginal)))
    .map((r) => r.id);
  if (missing.length) {
    await tx
      .update(event)
      .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          inArray(event.id, missing),
          eq(event.calendarSourceId, ctx.source.id),
          isNull(event.archivedAt),
        ),
      );
    counts.archived = missing.length;
  }
  return counts;
}

/**
 * Refresh-on-use (contract §3.3, ADR 0007 §12): every calendar this adult
 * can see that is older than 15 minutes, one after another. A calendar
 * another refresh is already working on answers `busy`; a calendar that
 * cannot be refreshed (disconnected, keys missing) is reported, never
 * retried in a loop. Called by the refresh route, never while rendering.
 */
export async function refreshStaleCalendars(
  actor: UserActor,
  provider: CalendarProvider,
  opts: Opts & { now?: Date } = {},
  deps: Deps = {},
): Promise<
  { calendarId: string; outcome: RefreshOutcome | { status: 'refused'; code: string } }[]
> {
  assertPerson(actor);
  assertFamilyWritesOpen();
  const db = deps.db ?? getDb();
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ id: calendarSource.id, lastAttemptAt: calendarSource.lastAttemptAt })
    .from(calendarSource)
    .where(and(visibleTo(actor, calendarSource), isNull(calendarSource.archivedAt)));
  const stale = rows.filter(
    (r) => r.lastAttemptAt === null || now.getTime() - r.lastAttemptAt.getTime() >= STALE_AFTER_MS,
  );
  const out: {
    calendarId: string;
    outcome: RefreshOutcome | { status: 'refused'; code: string };
  }[] = [];
  for (const r of stale) {
    try {
      out.push({
        calendarId: r.id,
        outcome: await refreshCalendar(actor, r.id, provider, opts, deps),
      });
    } catch (e) {
      if (e instanceof NotPermittedError && e.code !== 'real_data_closed')
        out.push({ calendarId: r.id, outcome: { status: 'refused', code: e.code } });
      else throw e;
    }
  }
  return out;
}
