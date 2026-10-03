import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { KEV_TIERS } from './conversation';
import { oneOf } from './common';

// One row per Kev run (FAMILY-DATA-MODEL §3, AuditLog / KevUsage; M2
// contract §4.2). Append-only: migration 0006 revokes UPDATE, DELETE and
// TRUNCATE from home_app and adds a trigger, as for audit_log. It holds no
// content. Cost is the provider's cost in micro-US-dollars, exactly as
// reported; M2 does no NZD conversion (that is the M8 spend cap's concern).
// `user_id` and `conversation_id` are plain values with no foreign key, so
// deleting a user or a conversation never blocks on, or rewrites, this log.

export const kevUsage = pgTable(
  'kev_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    userId: text('user_id').notNull(),
    conversationId: uuid('conversation_id'),
    tier: text('tier').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsdMicros: bigint('cost_usd_micros', { mode: 'bigint' }).notNull(),
    escalated: boolean('escalated').notNull().default(false),
  },
  (t) => [
    check('kev_usage_tier_check', oneOf(t.tier, KEV_TIERS)),
    check(
      'kev_usage_counts_check',
      sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.cacheReadTokens} >= 0
       and ${t.cacheWriteTokens} >= 0 and ${t.costUsdMicros} >= 0`,
    ),
    index('kev_usage_at_idx').on(t.at),
    index('kev_usage_user_id_at_idx').on(t.userId, t.at),
  ],
);
