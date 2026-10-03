import 'server-only';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import type { UserActor } from '@/trust/actor';
import { recordAudit } from '@/trust/audit';
import type { Visibility } from '@/trust/visibility';

/**
 * An approved proposal being executed (M2 contract §5.7). Only the proposal
 * executor issues one; services receive it in `deps` and use it for nothing
 * but provenance: `created_via = 'kev'`, `origin_capture_id`, context's
 * source, and an `executed` marker in audit meta. It never relaxes a check.
 */
export type Execution = Readonly<{
  proposalId: string;
  requestedBy: string;
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

/** `created_via` and `origin_capture_id` for a record a service creates. */
export function provenanceOf(deps: Deps): {
  createdVia: 'ui' | 'kev';
  originCaptureId: string | null;
} {
  const e = executionOf(deps);
  return e
    ? { createdVia: 'kev', originCaptureId: e.captureId }
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
 */
export async function auditedWrite<T>(
  actor: UserActor,
  deps: Deps,
  fn: (tx: DbOrTx) => Promise<{ result: T; audit: DomainAudit | DomainAudit[] | null }>,
): Promise<T> {
  const db = deps.db ?? getDb();
  const execution = executionOf(deps);
  return db.transaction(async (tx) => {
    const { result, audit } = await fn(tx);
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
    return result;
  });
}
