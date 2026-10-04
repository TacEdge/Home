import 'server-only';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { capture, conversation, message, proposal } from '@/db/schema';
import {
  ORGANISED_TYPES,
  type CaptureStatus,
  type OrganisedRef,
  type OrganisedType,
} from '@/db/schema/capture';
import type { UserActor } from '@/trust/actor';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { records } from '../common/records';
import { auditedWrite, type Deps, type DomainAudit } from '../common/write';
import { captureInput, captureText, type CaptureInput } from './schema';

// Captures (FAMILY-DATA-MODEL §3, M2 contract §5.6). What someone told HOME,
// stored verbatim and privately before anyone decides what it is. The text,
// its author, time, created_via and channel never change after the insert
// (the database's capture_source_immutable trigger refuses it too); these
// functions only ever touch status, organisation, dismissal and archive.
// Captures are private to their creator: always `visibility = 'private'`.
//
// `captureVerbatim` is the one write Kev may make directly (CLAUDE.md rule
// 3): it stores the person's own words, never anything Kev wrote. Every
// other write here is a person's, directly or by approving a proposal.

export type Capture = typeof capture.$inferSelect;
type ReadOpts = { includeArchived?: boolean };

const R = records(capture, 'capture');
const audit = (
  name: string,
  row: Capture,
  meta?: Record<string, string | number>,
): DomainAudit => ({
  event: `capture.${name}`,
  subjectType: 'capture',
  subjectId: row.id,
  meta,
  record: row,
});

/**
 * The actor's own message, by id: in a live conversation they own. Another
 * adult's message is NotFound, like a missing one. Locked FOR SHARE so it
 * cannot vanish while a capture points at it.
 */
async function ownMessage(tx: DbOrTx, actor: UserActor, id: string) {
  const [row] = await tx
    .select({ role: message.role, content: message.content })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .where(
      and(
        eq(message.id, id),
        eq(conversation.userId, actor.userId),
        isNull(conversation.archivedAt),
      ),
    )
    .for('share')
    .limit(1);
  if (!row) throw new NotFoundError('message');
  return row;
}

/**
 * Stores what a person said, exactly, private to them (CLAUDE.md "capture
 * first"). A person passes their words as `text`. Kev never authors a
 * capture (rule 3): it passes only `messageId`, the person's own user
 * message, and the text is copied from that message unchanged. Any
 * `messageId` must be the actor's own. The system actor may not capture.
 */
export async function captureVerbatim(
  actor: UserActor,
  input: CaptureInput,
  deps: Deps = {},
): Promise<Capture> {
  if ((actor as { kind: string }).kind !== 'user') throw new NotPermittedError('not_a_user');
  const data = captureInput.parse(input);
  const kev = actor.via === 'kev';
  if (kev && (data.text !== undefined || data.messageId === undefined)) {
    throw new NotPermittedError('kev_cannot_author');
  }
  if (!kev && data.text === undefined) captureText.parse(undefined); // a person must give their words
  return auditedWrite(actor, deps, async (tx) => {
    let text = data.text;
    if (data.messageId) {
      const m = await ownMessage(tx, actor, data.messageId);
      if (kev) {
        // Only the person's own words: a user message, copied exactly.
        if (m.role !== 'user') throw new NotPermittedError('kev_cannot_author');
        text = captureText.parse((m.content as { text?: unknown }).text);
      }
    }
    const [row] = await tx
      .insert(capture)
      .values({
        text: text as string,
        channel: data.channel,
        messageId: data.messageId ?? null,
        visibility: 'private',
        createdBy: actor.userId,
        createdVia: actor.via,
      })
      .returning();
    if (!row) throw new Error('capture insert returned no row');
    return { result: row, audit: audit('create', row, { channel: row.channel }) };
  });
}

export async function getCapture(
  actor: UserActor,
  id: string,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<Capture> {
  return R.get(deps.db ?? getDb(), actor, id, opts.includeArchived ? 'include' : 'exclude');
}

/** The actor's own captures, newest first ("To sort" is `status: 'new'`). */
export async function listCaptures(
  actor: UserActor,
  opts: ReadOpts & { status?: CaptureStatus } = {},
  deps: Deps = {},
): Promise<Capture[]> {
  const db = deps.db ?? getDb();
  return db
    .select()
    .from(capture)
    .where(
      and(
        R.readable(actor, opts.includeArchived ? 'include' : 'exclude'),
        opts.status ? eq(capture.status, opts.status) : undefined,
      ),
    )
    .orderBy(desc(capture.createdAt), desc(capture.id));
}

/** Dismisses a capture: it stays, untouched, until the 30-day purge (§4.4). Repeating is a no-op. */
export async function dismissCapture(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Capture> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    if (current.status === 'dismissed') return { result: current, audit: null };
    const row = await R.update(tx, actor, current.id, 'exclude', {
      status: 'dismissed',
      dismissedAt: sql`now()`,
    });
    return { result: row, audit: audit('dismiss', row, { status: row.status }) };
  });
}

/** Brings a dismissed capture back, to whatever its proposals and organisation make it. */
export async function undismissCapture(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Capture> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    if (current.status !== 'dismissed') throw new NotPermittedError('not_eligible');
    const status = await settledStatus(tx, current.id, current.organisedInto);
    const row = await R.update(tx, actor, current.id, 'exclude', { status, dismissedAt: null });
    return { result: row, audit: audit('undismiss', row, { status: row.status }) };
  });
}

export async function archiveCapture(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Capture> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    const row = await R.update(tx, actor, current.id, 'exclude', { archivedAt: sql`now()` });
    return { result: row, audit: audit('archive', row) };
  });
}

export async function restoreCapture(
  actor: UserActor,
  id: string,
  deps: Deps = {},
): Promise<Capture> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'include');
    if (current.archivedAt === null) throw new NotPermittedError('not_archived');
    const row = await R.update(tx, actor, current.id, 'only', { archivedAt: null });
    return { result: row, audit: audit('restore', row) };
  });
}

// Organisation, for the proposal service only. Both run inside the caller's
// transaction, as the requesting user, and return the audit to record.

/** Locks a capture a new proposal will point at: the requester's own, live and not dismissed. */
export async function lockForProposal(tx: DbOrTx, actor: UserActor, id: string): Promise<Capture> {
  const row = await R.lock(tx, actor, id, 'exclude');
  if (row.status === 'dismissed') throw new NotPermittedError('not_eligible');
  return row;
}

/** What a capture's status should be: proposed while proposals wait, organised once any led somewhere. */
async function settledStatus(
  tx: DbOrTx,
  id: string,
  organisedInto: OrganisedRef[],
): Promise<CaptureStatus> {
  const [p] = await tx
    .select({ n: count() })
    .from(proposal)
    .where(
      and(
        eq(proposal.captureId, id),
        eq(proposal.status, 'pending'),
        gt(proposal.expiresAt, sql`now()`),
      ),
    );
  if ((p?.n ?? 0) > 0) return 'proposed';
  return organisedInto.length > 0 ? 'organised' : 'new';
}

const ORGANISED = new Set<string>(ORGANISED_TYPES);

/**
 * Records what a capture became (contract §5.7): adds the records an approved
 * proposal created or changed to `organised_into`, and settles its status.
 * The text is never touched. A dismissed capture stays dismissed. Returns
 * null when nothing changed, or when the capture is gone or not the actor's.
 */
export async function settleCapture(
  tx: DbOrTx,
  actor: UserActor,
  id: string,
  refs: { type: string; id: string }[] = [],
): Promise<DomainAudit | null> {
  const [current] = await tx
    .select()
    .from(capture)
    .where(R.target(actor, id, 'include'))
    .for('update')
    .limit(1);
  if (!current) return null;
  const into = [...current.organisedInto];
  for (const r of refs) {
    if (!ORGANISED.has(r.type)) continue;
    if (!into.some((x) => x.type === r.type && x.id === r.id))
      into.push({ type: r.type as OrganisedType, id: r.id });
  }
  const added = into.length - current.organisedInto.length;
  const status =
    current.status === 'dismissed' ? 'dismissed' : await settledStatus(tx, current.id, into);
  if (added === 0 && status === current.status) return null;
  const row = await R.update(tx, actor, current.id, 'include', {
    status,
    organisedInto: into,
    ...(into.length > 0 && current.organisedAt === null ? { organisedAt: sql`now()` } : {}),
  });
  return audit(added > 0 ? 'organise' : 'update', row, {
    status: row.status,
    organised: into.length,
  });
}
