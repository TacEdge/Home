import 'server-only';
import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { conversation, message } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { recordId } from '../common/inputs';
import { auditedWrite, type Deps, type DomainAudit } from '../common/write';
import { addMessageInput, type AddMessageInput } from './schema';

// Conversations and messages (FAMILY-DATA-MODEL §3, M2 contract §5.6). Kev
// chat history, private to the conversation's owner by `user_id`, enforced
// in every query: another adult's conversation is NotFound, like a missing
// one. Retained 90 days (`last_message_at`, `message.created_at`) and never
// used as memory. Writes follow §5.3 (a signed-in person, never Kev or the
// system directly; ADR 0005 §39). Audit rows are structural and owner-only:
// messages are audited as their conversation.

export type Conversation = typeof conversation.$inferSelect;
export type Message = typeof message.$inferSelect;
type ReadOpts = { includeArchived?: boolean };

const audit = (name: string, row: Conversation, meta?: Record<string, string>): DomainAudit => ({
  event: name,
  subjectType: 'conversation',
  subjectId: row.id,
  meta,
  // Owner-only: the P-1 snapshot is private to the owner.
  record: { visibility: 'private', createdBy: row.userId },
});

const validId = (id: string) => {
  if (!recordId.safeParse(id).success) throw new NotFoundError('conversation');
  return id;
};

/** The actor's own conversation by id, in an archive state. */
const own = (actor: UserActor, id: string, archived: 'exclude' | 'include' | 'only'): SQL =>
  and(
    eq(conversation.id, validId(id)),
    eq(conversation.userId, actor.userId),
    archived === 'exclude'
      ? isNull(conversation.archivedAt)
      : archived === 'only'
        ? isNotNull(conversation.archivedAt)
        : undefined,
  ) as SQL;

async function lockOwn(tx: DbOrTx, actor: UserActor, id: string, archived: 'exclude' | 'include') {
  const [row] = await tx
    .select()
    .from(conversation)
    .where(own(actor, id, archived))
    .for('update')
    .limit(1);
  if (!row) throw new NotFoundError('conversation');
  return row;
}

export async function startConversation(actor: UserActor, deps: Deps = {}): Promise<Conversation> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const [row] = await tx.insert(conversation).values({ userId: actor.userId }).returning();
    if (!row) throw new Error('conversation insert returned no row');
    return { result: row, audit: audit('conversation.start', row) };
  });
}

export async function getConversation(
  actor: UserActor,
  id: string,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<Conversation> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .select()
    .from(conversation)
    .where(own(actor, id, opts.includeArchived ? 'include' : 'exclude'))
    .limit(1);
  if (!row) throw new NotFoundError('conversation');
  return row;
}

/** The actor's own conversations, most recently active first. */
export async function listConversations(
  actor: UserActor,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<Conversation[]> {
  const db = deps.db ?? getDb();
  return db
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.userId, actor.userId),
        opts.includeArchived ? undefined : isNull(conversation.archivedAt),
      ),
    )
    .orderBy(
      sql`coalesce(${conversation.lastMessageAt}, ${conversation.createdAt}) desc`,
      desc(conversation.id),
    );
}

/** Appends a message and moves the conversation's retention clock, in one transaction. */
export async function addMessage(
  actor: UserActor,
  conversationId: string,
  input: AddMessageInput,
  deps: Deps = {},
): Promise<Message> {
  assertCanWrite(actor);
  const data = addMessageInput.parse(input);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lockOwn(tx, actor, conversationId, 'exclude');
    const [row] = await tx
      .insert(message)
      .values({
        conversationId: current.id,
        role: data.role,
        channel: data.channel,
        content: data.content,
        tier: data.role === 'kev' ? data.tier : null,
        model: data.role === 'kev' ? data.model : null,
      })
      .returning();
    if (!row) throw new Error('message insert returned no row');
    const [conv] = await tx
      .update(conversation)
      .set({ lastMessageAt: row.createdAt, updatedAt: sql`now()` })
      .where(own(actor, current.id, 'exclude'))
      .returning();
    if (!conv) throw new NotFoundError('conversation');
    const meta: Record<string, string> = { role: row.role };
    if (row.tier) meta.tier = row.tier;
    return { result: row, audit: audit('message.add', conv, meta) };
  });
}

/** A conversation's messages, oldest first. Only its owner sees them. */
export async function listMessages(
  actor: UserActor,
  conversationId: string,
  opts: ReadOpts = {},
  deps: Deps = {},
): Promise<Message[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select({ message })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .where(own(actor, conversationId, opts.includeArchived ? 'include' : 'exclude'))
    .orderBy(asc(message.createdAt), asc(message.id));
  return rows.map((r) => r.message);
}

export async function archiveConversation(actor: UserActor, id: string, deps: Deps = {}) {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lockOwn(tx, actor, id, 'exclude');
    const [row] = await tx
      .update(conversation)
      .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
      .where(own(actor, current.id, 'exclude'))
      .returning();
    if (!row) throw new NotFoundError('conversation');
    return { result: row, audit: audit('conversation.archive', row) };
  });
}

export async function restoreConversation(actor: UserActor, id: string, deps: Deps = {}) {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await lockOwn(tx, actor, id, 'include');
    if (current.archivedAt === null) throw new NotPermittedError('not_archived');
    const [row] = await tx
      .update(conversation)
      .set({ archivedAt: null, updatedAt: sql`now()` })
      .where(own(actor, current.id, 'only'))
      .returning();
    if (!row) throw new NotFoundError('conversation');
    return { result: row, audit: audit('conversation.restore', row) };
  });
}
