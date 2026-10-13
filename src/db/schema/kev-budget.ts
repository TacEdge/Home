import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { KEV_TIERS } from './conversation';
import { oneOf } from './common';

// Kev's budget reservations (FAMILY-DATA-MODEL §3, AuditLog / KevUsage; M8
// contract §4.6, §13.6; ADR 0012 §35; migration 0009, M8 Package 1a). One
// row per Kev attempt, holding the attempt's maximum permitted exposure
// while it runs, so the household spend cap stays hard when both adults'
// turns run at once. Content-free accounting: no text, no model, no
// visibility. Money is whole micro-US-dollars (bigint), as in kev_usage.
//
// Settle-only: home_app has only SELECT, INSERT and UPDATE (migration 0009
// revokes DELETE and TRUNCATE), and a trigger, for every role, refuses any
// change to the identity, owner, tier, period, reserved amount or creation
// time, any change to a row that is no longer open, any update that leaves
// a row open, and every delete and truncate. `user_id` is a plain value with
// no foreign key, as in kev_usage. No application code uses the table until
// Package 1b (migration-first).

/** A reservation's state (contract §13.6): taken, closed with its usage, or counted in full. */
export const KEV_RESERVATION_STATUSES = ['open', 'settled', 'unreconciled'] as const;
export type KevReservationStatus = (typeof KEV_RESERVATION_STATUSES)[number];

export const kevBudgetReservation = pgTable(
  'kev_budget_reservation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id').notNull(),
    userId: text('user_id').notNull(),
    tier: text('tier').notNull(),
    // The home-zone month the reservation was taken in, as its first day.
    period: date('period').notNull(),
    reservedUsdMicros: bigint('reserved_usd_micros', { mode: 'bigint' }).notNull(),
    status: text('status').notNull().default('open'),
    settledUsdMicros: bigint('settled_usd_micros', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    check('kev_budget_reservation_tier_check', oneOf(t.tier, KEV_TIERS)),
    check('kev_budget_reservation_status_check', oneOf(t.status, KEV_RESERVATION_STATUSES)),
    check('kev_budget_reservation_period_check', sql`extract(day from ${t.period}) = 1`),
    // A reservation is never empty; a settlement is never negative. No upper
    // bound on the settlement: recording real usage is never refused (the
    // budget is enforced when reserving, Package 1b).
    check(
      'kev_budget_reservation_amounts_check',
      sql`${t.reservedUsdMicros} > 0 and (${t.settledUsdMicros} is null or ${t.settledUsdMicros} >= 0)`,
    ),
    // Each state has one shape: open has neither settlement nor close time;
    // settled has both; unreconciled is closed with no settlement (it counts
    // at its full reserved amount and is never settled).
    check(
      'kev_budget_reservation_lifecycle_check',
      sql`(${t.status} = 'open' and ${t.settledUsdMicros} is null and ${t.closedAt} is null)
       or (${t.status} = 'settled' and ${t.settledUsdMicros} is not null and ${t.closedAt} is not null)
       or (${t.status} = 'unreconciled' and ${t.settledUsdMicros} is null and ${t.closedAt} is not null)`,
    ),
    check(
      'kev_budget_reservation_closed_at_check',
      sql`${t.closedAt} is null or ${t.closedAt} >= ${t.createdAt}`,
    ),
    unique('kev_budget_reservation_attempt_id_unique').on(t.attemptId),
    // Serves the reservation's sum of a month's open and unreconciled rows.
    index('kev_budget_reservation_period_status_idx').on(t.period, t.status),
  ],
);
