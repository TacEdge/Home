import 'server-only';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import type { UserActor } from '@/trust/actor';
import { recordAudit } from '@/trust/audit';
import type { Visibility } from '@/trust/visibility';
import { NotPermittedError } from './errors';
import { assertFamilyWritesOpen } from './guards';

/**
 * An approved proposal being executed (M2 contract §5.7). Only the proposal
 * executor issues one; services receive it in `deps` and use it for nothing
 * but provenance: `created_via` as the proposal was made, `origin_capture_id`, context's
 * source, and an `executed` marker in audit meta. It never relaxes a check.
 */
export type Execution = Readonly<{
  proposalId: string;
  requestedBy: string;
  /** How the proposal was made: `kev` if Kev proposed it, `ui` if the person did (ADR 0005 §43). */
  createdVia: 'ui' | 'kev';
  captureId: string | null;
  conversationId: string | null;
}>;

export type Deps = { db?: DbOrTx; execution?: Execution };

const issued = new WeakSet<object>();

/** For the proposal executor only (tests/unit/execution-guard.test.ts enforces it). */
export function issueExecution(e: Execution): Execution {
  const token = Object.freeze({ ...e });
  issued.add(token);
  return token;
}

/** The execution in `deps`, if the executor issued it; a hand-made object is ignored. */
export function executionOf(deps: Deps): Execution | null {
  return deps.execution && issued.has(deps.execution) ? deps.execution : null;
}

const syncActors = new WeakSet<object>();

/**
 * The calendar sync actor (M4 contract §3.4, ADR 0007 §8): the calendar
 * owner's user actor with `via: 'sync'`. For the sync service only
 * (tests/unit/execution-guard.test.ts enforces it); never from a request.
 * Its writes are the owner's, audited as from a calendar.
 */
export function issueSyncActor(owner: { userId: string; email: string }): UserActor {
  const actor: UserActor = Object.freeze({
    kind: 'user',
    userId: owner.userId,
    email: owner.email,
    via: 'sync',
    channel: 'web',
  });
  syncActors.add(actor);
  return actor;
}

/** Whether an actor is one the sync service issued; a hand-made `via: 'sync'` is not. */
function isSyncActor(actor: UserActor): boolean {
  return actor.via === 'sync' && syncActors.has(actor);
}

/** `created_via` and `origin_capture_id` for a record a service creates. */
export function provenanceOf(deps: Deps): {
  createdVia: 'ui' | 'kev';
  originCaptureId: string | null;
} {
  const e = executionOf(deps);
  // Provenance follows the proposal: only what Kev proposed is created_via 'kev'.
  return e
    ? { createdVia: e.createdVia, originCaptureId: e.captureId }
    : { createdVia: 'ui', originCaptureId: null };
}

/** Values allowed in domain audit meta: structure, never user-written text. */
export type StructuralMeta = Record<string, string | number | boolean | null | string[]>;

/**
 * What a domain write audits (P-1, ADR 0005 §9): the event, the affected
 * record, changed field names and enum values. Never a title, name, note,
 * captured text or any other record payload. `record` is the affected
 * record's state after the write; it supplies the visibility snapshot.
 */
export type DomainAudit = {
  event: string;
  subjectType: string;
  subjectId: string;
  meta?: StructuralMeta;
  record: { visibility: string; createdBy: string | null };
};

/** The P-1 snapshot for a record: its visibility, and its owner if private. */
export function snapshotOf(record: DomainAudit['record']) {
  const visibility = record.visibility as Visibility;
  return {
    visibility,
    visibleToUserId: visibility === 'private' ? record.createdBy : null,
  };
}

/**
 * Runs a domain write and its audit row in one transaction (M2 contract
 * §5.3): if either fails, neither happens. This is the only way services
 * record domain audit rows. `audit: null` means the call changed nothing
 * (an idempotent repeat), so there is nothing to audit. Several audits are
 * written in order, all in the same transaction.
 *
 * Every family-domain write passes the production real-data gate first,
 * before any row is locked or written (ADR 0006 §2).
 */
export async function auditedWrite<T>(
  actor: UserActor,
  deps: Deps,
  fn: (tx: DbOrTx) => Promise<{ result: T; audit: DomainAudit | DomainAudit[] | null }>,
): Promise<T> {
  assertFamilyWritesOpen();
  // Sync authority is minted, never claimed: an actor saying `via: 'sync'`
  // writes only if the sync service issued it (M4 contract §3.4).
  if (actor.via === 'sync' && !isSyncActor(actor)) throw new NotPermittedError('sync_actor');
  const db = deps.db ?? getDb();
  return db.transaction(async (tx) => {
    const { result, audit } = await fn(tx);
    await writeAudits(actor, deps, tx, audit);
    return result;
  });
}

/**
 * Audit rows about a read (e.g. `context.sensitive_read`), with no domain
 * write. Not gated: auditing what a person read is part of the audit trail,
 * which stays operational while the real-data gate is closed. Never use it
 * for a row that accompanies a change; that is `auditedWrite`.
 */
export async function auditRead(
  actor: UserActor,
  deps: Deps,
  audit: DomainAudit | DomainAudit[],
): Promise<void> {
  const db = deps.db ?? getDb();
  await db.transaction((tx) => writeAudits(actor, deps, tx, audit));
}

async function writeAudits(
  actor: UserActor,
  deps: Deps,
  tx: DbOrTx,
  audit: DomainAudit | DomainAudit[] | null,
): Promise<void> {
  const execution = executionOf(deps);
  for (const a of audit === null ? [] : Array.isArray(audit) ? audit : [audit]) {
    await recordAudit(
      actor,
      {
        event: a.event,
        subjectType: a.subjectType,
        subjectId: a.subjectId,
        // A write the executor makes says so. It does not name the proposal:
        // that is private to its requester, while this record may be household.
        // The proposal's own (private) approve row links the two.
        meta: execution ? { ...a.meta, executed: 'proposal' } : a.meta,
        snapshot: snapshotOf(a.record),
      },
      { db: tx },
    );
  }
}
