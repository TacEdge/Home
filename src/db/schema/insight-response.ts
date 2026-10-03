import { index, pgTable, text, timestamp, unique, uuid, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { oneOf } from './common';

// The only persisted part of insights (FAMILY-DATA-MODEL §3, InsightResponse;
// CLAUDE.md rule 15): one person's response to one insight, by its
// deterministic key. Private to that person by `user_id`; upserted, so one
// row per (user, key).

export const INSIGHT_RESPONSES = ['dismissed', 'not_useful'] as const;
export type InsightResponseKind = (typeof INSIGHT_RESPONSES)[number];

export const insightResponse = pgTable(
  'insight_response',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    insightKey: text('insight_key').notNull(),
    response: text('response').notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('insight_response_response_check', oneOf(t.response, INSIGHT_RESPONSES)),
    unique('insight_response_user_key_unique').on(t.userId, t.insightKey),
    index('insight_response_insight_key_idx').on(t.insightKey),
  ],
);
