import 'server-only';
import { getDb } from '@/db/client';
import type { Db, DbOrTx } from '@/db/create';
import type { UserActor } from '@/trust/actor';
import { recordAudit } from '@/trust/audit';
import type { Visibility } from '@/trust/visibility';

export type Deps = { db?: Db };

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
 * record domain audit rows.
 */
export async function auditedWrite<T>(
  actor: UserActor,
  deps: Deps,
  fn: (tx: DbOrTx) => Promise<{ result: T; audit: DomainAudit }>,
): Promise<T> {
  const db = deps.db ?? getDb();
  return db.transaction(async (tx) => {
    const { result, audit } = await fn(tx);
    await recordAudit(
      actor,
      {
        event: audit.event,
        subjectType: audit.subjectType,
        subjectId: audit.subjectId,
        meta: audit.meta,
        snapshot: snapshotOf(audit.record),
      },
      { db: tx },
    );
    return result;
  });
}
