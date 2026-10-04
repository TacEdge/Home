import 'server-only';
import { and, desc, eq, getTableColumns, lte, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { conversation, proposal } from '@/db/schema';
import type { ProposalAction, ProposalStatus } from '@/db/schema/proposal';
import { log } from '@/lib/log';
import type { UserActor } from '@/trust/actor';
import { lockForProposal, settleCapture } from '../captures/service';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertCanWrite, assertFamilyWritesOpen } from '../common/guards';
import { records } from '../common/records';
import { auditedWrite, issueExecution, type Deps, type DomainAudit } from '../common/write';
import { execute, failureCode, type ResultRef } from './executor';
import { createProposalInput, PROPOSAL_PAYLOADS, type CreateProposalInput } from './schema';

// Proposals (M2 contract §5.7, P-2, P-3; ADR 0005 §30, §32). Kev never
// writes directly: it proposes, and only the person who asked can approve or
// reject, from the app (`via: 'ui'`). A proposal is private to its requester
// everywhere: reads, decisions and the Activity list.
//
// Approval is one transaction: lock the proposal, run the action through the
// target service in a savepoint, record the outcome and settle the capture.
// If the action fails, the savepoint rolls back every write it made and the
// proposal is marked `failed` with a fixed code; nothing partial survives.
// A pending proposal expires 7 days after creation, evaluated on read; its
// stored status catches up when it is next touched. Decided or expired
// proposals never execute.

type Row = typeof proposal.$inferSelect;
export type Proposal = Omit<Row, 'status'> & { status: ProposalStatus };

export type Decision =
  | { outcome: 'approved'; proposal: Proposal; resultRef: ResultRef[] }
  | { outcome: 'rejected'; proposal: Proposal }
  | { outcome: 'failed'; proposal: Proposal; reason: string }
  | { outcome: 'expired'; proposal: Proposal };

const R = records(proposal, 'proposal');
const audit = (name: string, row: Row, meta: Record<string, string | string[]>): DomainAudit => ({
  event: `proposal.${name}`,
  subjectType: 'proposal',
  subjectId: row.id,
  meta: { action: row.action, ...meta },
  record: row,
});

/** Pending, but past its expiry: reported as expired (P-3). Evaluated on the database clock. */
const overdue = sql<boolean>`(${proposal.status} = 'pending' and ${proposal.expiresAt} <= now())`;
const effectiveStatus = sql<ProposalStatus>`case when ${overdue} then 'expired' else ${proposal.status} end`;
const withEffectiveStatus = { ...getTableColumns(proposal), status: effectiveStatus };

/** Only the requester ever reaches a proposal: private, and theirs (P-2). */
const own = (actor: UserActor): SQL =>
  and(R.readable(actor, 'exclude'), eq(proposal.requestedByUserId, actor.userId)) as SQL;

export async function createProposal(
  actor: UserActor,
  input: CreateProposalInput,
  deps: Deps = {},
): Promise<Proposal> {
  // Kev may propose (CLAUDE.md rule 3); the system actor never acts as a person.
  if ((actor as { kind: string }).kind !== 'user') throw new NotPermittedError('not_a_user');
  const data = createProposalInput.parse(input);
  PROPOSAL_PAYLOADS[data.action].parse(data.payload);
  return auditedWrite(actor, deps, async (tx) => {
    if (data.captureId) await lockForProposal(tx, actor, data.captureId);
    // Only the requester's own conversation, as recordUsage requires (ADR 0005 §43).
    if (data.conversationId) {
      const [c] = await tx
        .select({ id: conversation.id })
        .from(conversation)
        .where(and(eq(conversation.id, data.conversationId), eq(conversation.userId, actor.userId)))
        .for('share')
        .limit(1);
      if (!c) throw new NotFoundError('conversation');
    }
    const [row] = await tx
      .insert(proposal)
      .values({
        action: data.action,
        payload: data.payload,
        summary: data.summary,
        captureId: data.captureId ?? null,
        conversationId: data.conversationId ?? null,
        visibility: 'private',
        requestedByUserId: actor.userId,
        createdBy: actor.userId,
        createdVia: actor.via,
      })
      .returning();
    if (!row) throw new Error('proposal insert returned no row');
    const audits = [audit('create', row, {})];
    if (row.captureId) {
      const settled = await settleCapture(tx, actor, row.captureId);
      if (settled) audits.push(settled);
    }
    return { result: row as Proposal, audit: audits };
  });
}

export async function getProposal(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Proposal> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .select(withEffectiveStatus)
    .from(proposal)
    .where(and(eq(proposal.id, R.validId(id)), own(actor)))
    .limit(1);
  if (!row) throw new NotFoundError('proposal');
  return row;
}

/** The actor's own proposals, newest first, each with its effective status. */
export async function listProposals(
  actor: UserActor,
  opts: { status?: ProposalStatus; captureId?: string } = {},
  deps: Deps = {},
): Promise<Proposal[]> {
  const db = deps.db ?? getDb();
  return db
    .select(withEffectiveStatus)
    .from(proposal)
    .where(
      and(
        own(actor),
        opts.status ? sql`${effectiveStatus} = ${opts.status}` : undefined,
        opts.captureId ? eq(proposal.captureId, R.validId(opts.captureId)) : undefined,
      ),
    )
    .orderBy(desc(proposal.createdAt), desc(proposal.id));
}

/** Locks the requester's proposal for a decision, with whether it is overdue. */
async function lockForDecision(tx: DbOrTx, actor: UserActor, id: string) {
  const [row] = await tx
    .select({ ...getTableColumns(proposal), overdue })
    .from(proposal)
    .where(and(eq(proposal.id, R.validId(id)), own(actor)))
    .for('update')
    .limit(1);
  if (!row) throw new NotFoundError('proposal');
  if (row.status !== 'pending') throw new NotPermittedError('proposal_not_pending');
  const { overdue: isOverdue, ...current } = row;
  return { current, isOverdue };
}

/** Writes a decision under the same predicate the lock used. */
const decide = (tx: DbOrTx, actor: UserActor, id: string, values: Record<string, unknown>) =>
  R.update(tx, actor, id, 'exclude', values, and(own(actor), eq(proposal.status, 'pending')));

const decidedBy = (actor: UserActor) => ({
  decidedBy: actor.userId,
  decidedAt: sql`now()`,
  decidedChannel: actor.channel,
});

/** Marks an overdue proposal expired: undecided, never executed. */
async function expire(
  tx: DbOrTx,
  actor: UserActor,
  current: Row,
): Promise<{ row: Row; audits: DomainAudit[] }> {
  const row = await decide(tx, actor, current.id, { status: 'expired' });
  const audits = [audit('expire', row, { status: 'expired' })];
  if (row.captureId) {
    const settled = await settleCapture(tx, actor, row.captureId);
    if (settled) audits.push(settled);
  }
  return { row, audits };
}

/**
 * Approves and executes a proposal, atomically (contract §5.7). Only its
 * requester, signed in and acting directly, may approve. Returns the
 * outcome: approved with its result reference, failed with a fixed code
 * (nothing written), or expired (nothing written). Throws NotFound for a
 * proposal that is not the actor's, and `proposal_not_pending` for one
 * already decided.
 */
export async function approveProposal(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Decision> {
  assertCanWrite(actor);
  return auditedWrite<Decision>(actor, deps, async (tx) => {
    const { current, isOverdue } = await lockForDecision(tx, actor, id);
    if (isOverdue) {
      const { row, audits } = await expire(tx, actor, current);
      return { result: { outcome: 'expired', proposal: row as Proposal }, audit: audits };
    }
    const execution = issueExecution({
      proposalId: current.id,
      requestedBy: current.requestedByUserId,
      createdVia: current.createdVia === 'kev' ? 'kev' : 'ui',
      captureId: current.captureId,
      conversationId: current.conversationId,
    });
    let refs: ResultRef[] | null = null;
    let reason = '';
    try {
      // A savepoint: if the action fails, every write it made is undone.
      refs = await tx.transaction((sp) =>
        execute(actor, current.action as ProposalAction, current.payload, { db: sp, execution }),
      );
    } catch (e) {
      reason = failureCode(e);
      if (reason === 'execution_error') {
        log.error('proposal.execution_error', {
          action: current.action,
          error: (e as Error)?.name,
        });
      }
    }
    const audits: DomainAudit[] = [];
    let decision: Decision;
    if (refs) {
      const row = await decide(tx, actor, current.id, {
        status: 'approved',
        ...decidedBy(actor),
        resultRef: refs,
      });
      audits.push(
        audit('approve', row, {
          status: 'approved',
          requested_by: row.requestedByUserId,
          approved_by: actor.userId,
          result_types: refs.map((r) => r.type),
        }),
      );
      decision = { outcome: 'approved', proposal: row as Proposal, resultRef: refs };
    } else {
      const row = await decide(tx, actor, current.id, {
        status: 'failed',
        ...decidedBy(actor),
        failureReason: reason,
      });
      audits.push(
        audit('fail', row, {
          status: 'failed',
          reason,
          requested_by: row.requestedByUserId,
          approved_by: actor.userId,
        }),
      );
      decision = { outcome: 'failed', proposal: row as Proposal, reason };
    }
    if (current.captureId) {
      const settled = await settleCapture(tx, actor, current.captureId, refs ?? []);
      if (settled) audits.push(settled);
    }
    return { result: decision, audit: audits };
  });
}

/** Rejects a proposal: nothing is executed. Only its requester, acting directly. */
export async function rejectProposal(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Decision> {
  assertCanWrite(actor);
  return auditedWrite<Decision>(actor, deps, async (tx) => {
    const { current, isOverdue } = await lockForDecision(tx, actor, id);
    if (isOverdue) {
      const { row, audits } = await expire(tx, actor, current);
      return { result: { outcome: 'expired', proposal: row as Proposal }, audit: audits };
    }
    const row = await decide(tx, actor, current.id, { status: 'rejected', ...decidedBy(actor) });
    const audits = [audit('reject', row, { status: 'rejected', rejected_by: actor.userId })];
    if (row.captureId) {
      const settled = await settleCapture(tx, actor, row.captureId);
      if (settled) audits.push(settled);
    }
    return { result: { outcome: 'rejected', proposal: row as Proposal }, audit: audits };
  });
}

/** Stores `expired` on the actor's own overdue proposals (P-3: no job; this is "next touched"). */
export async function expireOverdueProposals(
  actor: UserActor,
  deps: Deps = {},
): Promise<Proposal[]> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const due = await tx
      .select()
      .from(proposal)
      .where(and(own(actor), eq(proposal.status, 'pending'), lte(proposal.expiresAt, sql`now()`)))
      .orderBy(proposal.createdAt, proposal.id)
      .for('update');
    const expired: Proposal[] = [];
    const audits: DomainAudit[] = [];
    for (const p of due) {
      const { row, audits: a } = await expire(tx, actor, p);
      expired.push(row as Proposal);
      audits.push(...a);
    }
    return { result: expired, audit: audits };
  });
}

/**
 * What a person may organise a capture into, by hand (M3 contract §3.8):
 * the five records To sort offers. Nothing that edits or dismisses.
 */
export const ORGANISE_ACTIONS = [
  'task.create',
  'event.create',
  'project.create',
  'note.create',
  'context.create',
] as const satisfies readonly ProposalAction[];
export type OrganiseAction = (typeof ORGANISE_ACTIONS)[number];

/**
 * Organises one of the person's own captures into a record, by hand (M3
 * contract §3.8, ADR 0006 §11): in one transaction, the person proposes the
 * action against their capture and approves it, so the tested executor and
 * capture settlement run unchanged. The record carries `origin_capture_id`
 * and `created_via = 'ui'`, context so created is sourced `capture`, and the
 * capture's `organised_into` and status are settled. There is no second
 * organising path: this is `createProposal` then `approveProposal`.
 *
 * Only a person, signed in and acting directly. A payload the target schema
 * refuses throws before anything is stored (the form shows the fields). An
 * execution that fails returns the stored `failed` decision with its fixed
 * code, and nothing it tried to write survives (the executor's savepoint).
 * Calling it again on an organised capture makes another record from it.
 */
export async function organiseCapture(
  actor: UserActor,
  captureId: string,
  step: { action: OrganiseAction; payload: Record<string, unknown>; summary: string },
  deps: Deps = {},
): Promise<Decision> {
  assertCanWrite(actor);
  assertFamilyWritesOpen();
  if (!(ORGANISE_ACTIONS as readonly string[]).includes(step.action))
    throw new NotPermittedError('not_eligible');
  const db = deps.db ?? getDb();
  return db.transaction(async (tx) => {
    const d = { ...deps, db: tx };
    const p = await createProposal(
      actor,
      {
        action: step.action,
        payload: step.payload,
        summary: step.summary.slice(0, 500),
        captureId,
      },
      d,
    );
    return approveProposal(actor, p.id, d);
  });
}

export type ManyResult =
  | { id: string; ok: true; decision: Decision }
  | { id: string; ok: false; error: 'not_found' | string };

/** Approves each proposal independently, in its own transaction, and reports each result. */
export async function approveMany(
  actor: UserActor,
  ids: string[],
  deps: Deps = {},
): Promise<ManyResult[]> {
  assertCanWrite(actor);
  // Refuse the whole batch while the real-data gate is closed, rather than
  // reporting each proposal as refused (ADR 0006 §2).
  assertFamilyWritesOpen();
  const results: ManyResult[] = [];
  for (const id of ids) {
    try {
      results.push({ id, ok: true, decision: await approveProposal(actor, id, deps) });
    } catch (e) {
      if (e instanceof NotFoundError) results.push({ id, ok: false, error: 'not_found' });
      else if (e instanceof NotPermittedError) results.push({ id, ok: false, error: e.code });
      else throw e;
    }
  }
  return results;
}
