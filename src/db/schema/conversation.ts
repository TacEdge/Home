import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { CHANNELS, oneOf } from './common';

// Kev chat history (FAMILY-DATA-MODEL §3, Conversation / Message; M2
// contract §4.2). Owned by one user and private to them by `user_id`, so no
// visibility column. Retained 90 days and never used as memory (CLAUDE.md
// rule 6). Messages are the conversation's owned children: they go with it
// (CASCADE). Content is HOME's provider-neutral format, validated by a
// versioned schema in the application; the database checks only its shape.

export const MESSAGE_ROLES = ['user', 'kev'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** Model tiers (CLAUDE.md, Kev specifics): code asks for a tier, never a model. */
export const KEV_TIERS = ['fast', 'deep'] as const;
export type KevTier = (typeof KEV_TIERS)[number];

export const conversation = pgTable(
  'conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // The 90-day retention clock (§4.4).
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('conversation_user_id_last_message_at_idx').on(t.userId, t.lastMessageAt),
    index('conversation_archived_at_idx').on(t.archivedAt),
  ],
);

export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    channel: text('channel').notNull(),
    // { v: 1, text, citations?, toolSummaries?, proposalIds?, captureIds? }
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    tier: text('tier'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('message_role_check', oneOf(t.role, MESSAGE_ROLES)),
    check('message_channel_check', oneOf(t.channel, CHANNELS)),
    check('message_tier_check', oneOf(t.tier, KEV_TIERS)),
    // A versioned JSON object; the application validates the version's schema.
    check(
      'message_content_check',
      sql`jsonb_typeof(${t.content}) = 'object' and ${t.content} ? 'v'
       and jsonb_typeof(${t.content} -> 'v') = 'number'`,
    ),
    // Kev's messages say which tier and model wrote them; a person's never do.
    check(
      'message_author_check',
      sql`(${t.role} = 'kev' and ${t.tier} is not null and ${t.model} is not null)
       or (${t.role} = 'user' and ${t.tier} is null and ${t.model} is null)`,
    ),
    index('message_conversation_id_created_at_idx').on(t.conversationId, t.createdAt),
    // The 90-day retention clock (§4.4).
    index('message_created_at_idx').on(t.createdAt),
  ],
);
