import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { capture } from './capture';
import { CHANNELS, commonColumns, CREATED_VIA, oneOf } from './common';

// A change Kev wants to make, awaiting a person's approval (FAMILY-DATA-MODEL
// §3, Proposal; M2 contract §4.2, §5.7). Private to the user who asked
// (P-2): only they can see, approve or reject it, and the database refuses
// any other decider. Pending proposals expire 7 days after creation,
// evaluated on read (P-3); the stored status catches up when next touched.
// Each status has one shape (proposal_status_shape_check), so a decision
// always records who, when, where and what came of it.

export const PROPOSAL_ACTIONS = [
  'task.create',
  'task.update',
  'task.schedule',
  'event.create',
  'event.update',
  'event_person.set',
  'project.create',
  'project.update',
  'note.create',
  'context.create',
  'context.update',
  'capture.dismiss',
] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'failed'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** How long a pending proposal stays approvable (P-3). */
export const PROPOSAL_TTL = '7 days';

export const proposal = pgTable(
  'proposal',
  {
    ...commonColumns(() => user.id),
    visibility: text('visibility').notNull().default('private'),
    // The conversation it came from; its foreign key arrives with
    // `conversation` in Package 5 (ON DELETE SET NULL).
    conversationId: uuid('conversation_id'),
    requestedByUserId: text('requested_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    captureId: uuid('capture_id').references(() => capture.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    summary: text('summary').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql.raw(`(now() + interval '${PROPOSAL_TTL}')`)),
    decidedBy: text('decided_by').references(() => user.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedChannel: text('decided_channel'),
    // What an approval created or changed: `{type, id}` references, set with `approved`.
    resultRef: jsonb('result_ref'),
    // A fixed code (e.g. `not_found`), never free text: it is shown and audited.
    failureReason: text('failure_reason'),
  },
  (t) => [
    check('proposal_created_via_check', oneOf(t.createdVia, CREATED_VIA)),
    check('proposal_visibility_check', sql`${t.visibility} = 'private'`),
    // The requester is the creator; Kev proposes as the requesting user (rule 2).
    check(
      'proposal_requester_check',
      sql`${t.createdBy} is not null and ${t.createdBy} = ${t.requestedByUserId}
       and ${t.createdVia} <> 'sync'`,
    ),
    check('proposal_action_check', oneOf(t.action, PROPOSAL_ACTIONS)),
    check('proposal_payload_check', sql`jsonb_typeof(${t.payload}) = 'object'`),
    check('proposal_summary_check', sql`${t.summary} ~ '[^[:space:]]'`),
    check('proposal_status_check', oneOf(t.status, PROPOSAL_STATUSES)),
    check('proposal_expiry_check', sql`${t.expiresAt} > ${t.createdAt}`),
    check('proposal_decided_channel_check', oneOf(t.decidedChannel, CHANNELS)),
    // Only the requester decides (P-2).
    check(
      'proposal_decider_check',
      sql`${t.decidedBy} is null or ${t.decidedBy} = ${t.requestedByUserId}`,
    ),
    check(
      'proposal_failure_reason_check',
      sql`${t.failureReason} is null or ${t.failureReason} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    // pending and expired: undecided. approved: decided, with its result.
    // rejected: decided, nothing done. failed: decided, with a reason, nothing done.
    check(
      'proposal_status_shape_check',
      sql`case ${t.status}
        when 'pending' then ${t.decidedBy} is null and ${t.decidedAt} is null and ${t.decidedChannel} is null
          and ${t.resultRef} is null and ${t.failureReason} is null
        when 'expired' then ${t.decidedBy} is null and ${t.decidedAt} is null and ${t.decidedChannel} is null
          and ${t.resultRef} is null and ${t.failureReason} is null
        when 'approved' then ${t.decidedBy} is not null and ${t.decidedAt} is not null and ${t.decidedChannel} is not null
          and ${t.resultRef} is not null and ${t.failureReason} is null
        when 'rejected' then ${t.decidedBy} is not null and ${t.decidedAt} is not null and ${t.decidedChannel} is not null
          and ${t.resultRef} is null and ${t.failureReason} is null
        when 'failed' then ${t.decidedBy} is not null and ${t.decidedAt} is not null and ${t.decidedChannel} is not null
          and ${t.resultRef} is null and ${t.failureReason} is not null
        else false end`,
    ),
    index('proposal_requested_by_status_idx').on(t.requestedByUserId, t.status),
    index('proposal_capture_id_idx').on(t.captureId),
    index('proposal_conversation_id_idx').on(t.conversationId),
    index('proposal_decided_by_idx').on(t.decidedBy),
    index('proposal_created_by_idx').on(t.createdBy),
    index('proposal_visibility_created_by_idx').on(t.visibility, t.createdBy),
    index('proposal_archived_at_idx').on(t.archivedAt),
  ],
);
