import 'server-only';
import { getDb } from '@/db/client';
import type { Db, DbOrTx } from '@/db/create';
import type { UserActor } from '@/trust/actor';
import { recordAudit } from '@/trust/audit';
import type { Visibility } from '@/trust/visibility';

export type Deps = { db?: Db };

/**
 * What a domain write audits (P-1, ADR 0005): structural only. The event, the
 * affected record, the changed field names and enum values; never a title,
 * name, body, captured text or any other record payload. The visibility
 * snapshot is the affected record's state after the write.
 */
export type DomainAudit = {
  event: string;
  subjectType: string;
  subjectId: string;
  meta?: Record<string, string | number | boolean | string[] | null>;
  snapshot: { visibility: string; createdBy: string | null };
};

/** The P-1 snapshot columns for a record's current state. */
export function snapshotOf(row: { visibility: string; createdBy: string | null }) {
  return { visibility: row.visibility, createdBy: row.createdBy };
}

/**
 * Runs a write and its audit row in one transaction (M2 contract §5.3): if
 * the audit insert fails, the write does not happen. The shared helper is the
 * only way services record domain audit rows, so none is written by hand.
 */
export async function auditedWrite<T>(
  actor: UserActor,
  deps: Deps,
  fn: (tx: DbOrTx) => Promise<{ result: T; audit: DomainAudit }>,
): Promise<T> {
  const db = deps.db ?? getDb();
  return db.transaction(async (tx) => {
    const { result, audit } = await fn(tx);
    const visibility = audit.snapshot.visibility as Visibility;
    await recordAudit(
      actor,
      {
        event: audit.event,
        subjectType: audit.subjectType,
        subjectId: audit.subjectId,
        meta: audit.meta,
        visibility,
        ...(visibility === 'private' && audit.snapshot.createdBy
          ? { visibleToUserId: audit.snapshot.createdBy }
          : {}),
      },
      { db: tx },
    );
    return result;
  });
}
