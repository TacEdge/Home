import 'server-only';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { DbOrTx } from '@/db/create';
import { conversation, kevBudgetReservation, kevUsage, message } from '@/db/schema';
import type { KevTier } from '@/db/schema/conversation';
import { env, kevMonthlyCapNzd } from '@/lib/env';
import { systemActor, type Actor, type UserActor } from '@/trust/actor';
import { recordAudit } from '@/trust/audit';
import { capState, monthlyCapUsdMicros, type CapState } from '@/trust/usage';
import { NotFoundError, NotPermittedError } from '../common/errors';
import { assertFamilyWritesOpen } from '../common/guards';
import { auditedWrite, type Deps, type DomainAudit } from '../common/write';
import {
  DEEP_WITHDRAWN_AT_PERCENT,
  DEFAULT_MONTHLY_CAP_NZD,
  MESSAGE_RETENTION_DAYS,
  NZD_PER_USD,
  PURGE_BATCH_ROWS,
  PURGE_MAX_BATCHES,
  RESERVATION_STALE_SECONDS,
  TURN_IN_FLIGHT_SECONDS,
  TURNS_PER_DAY,
  TURNS_PER_MINUTE,
} from './constants';
import {
  recordKevMessageInput,
  recordUserMessageInput,
  reserveAttemptInput,
  settleAttemptInput,
  type RecordKevMessageInput,
  type RecordUserMessageInput,
  type ReserveAttemptInput,
  type SettleAttemptInput,
  type UserContentV2,
} from './schema';

// Kev's bookkeeping path (M8 contract §7.2, §9.6, §9.7, §13.6; D5; ADR 0012
// §25, §35, §42). The one narrow, named exception to `kev_cannot_write`:
// six functions that record Kev's own turn, acting as the requesting adult
// (a user actor `via: 'kev'` whose `userId` owns the conversation), and one
// system function, the daily retention cleanup. Nothing here writes a family
// record: only the adult's own conversation and messages, their usage and
// the household's budget reservations.
//
// - Who: the six refuse the system actor (`not_a_user`) and any actor not
//   `via: 'kev'` (`kev_bookkeeping_only`); the conversation is always the
//   actor's own, resolved from `actor.userId`, never named by the caller, so
//   another adult's is unreachable. `purgeExpiredMessages` refuses every
//   actor but the system (`kev_cannot_write` via Kev, else `system_only`).
// - Gated: the six pass the production real-data gate first, before any
//   other check or any lock (`real_data_closed`). The cleanup only deletes
//   expired rows, so it does not depend on the gate.
// - Audited: structurally, privately to the adult (role, tier, counts; never
//   text, a model name or a cost). The cleanup's one system row is shown to
//   neither adult.
// - Short transactions only: each function is one transaction, held for
//   milliseconds, and never across a model call (contract §4.2).
//
// Locks, each a transaction-level advisory lock (released at commit or
// rollback; no session lock, so the Neon pooler's transaction mode suits it):
// - `home:kev_budget` serialises every reservation household-wide (§13.6);
// - `home:kev_conversation:<user id>` serialises one adult's turns on every
//   device, including the first turn that creates the conversation, before
//   the conversation row itself is locked `FOR UPDATE` (§7.2).

/** The fixed key of the household budget lock (ADR 0012 §42). */
export const BUDGET_LOCK_KEY = 'home:kev_budget';
const conversationLockKey = (userId: string) => `home:kev_conversation:${userId}`;

export type KevMessage = typeof message.$inferSelect;

// ---------------------------------------------------------------------------
// Who may call.

function assertGate(): void {
  assertFamilyWritesOpen();
}

/** The six adult functions: the gate, then a user actor via Kev. */
function assertKevAsAdult(actor: UserActor): void {
  assertGate();
  if ((actor as { kind: string }).kind !== 'user') throw new NotPermittedError('not_a_user');
  if (actor.via !== 'kev') throw new NotPermittedError('kev_bookkeeping_only');
}

const privateTo = (userId: string) => ({ visibility: 'private', createdBy: userId });

async function lockConversation(tx: DbOrTx, actor: UserActor) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${conversationLockKey(actor.userId)}, 0))`,
  );
  const [row] = await tx
    .select()
    .from(conversation)
    .where(and(eq(conversation.userId, actor.userId), isNull(conversation.archivedAt)))
    .orderBy(desc(conversation.createdAt), desc(conversation.id))
    .for('update')
    .limit(1);
  return row ?? null;
}

/** A person's message under 70 seconds old with no Kev reply after it: a turn is in flight. */
async function turnInFlight(tx: DbOrTx, conversationId: string): Promise<boolean> {
  const [latest] = await tx
    .select({
      role: message.role,
      recent: sql<boolean>`${message.createdAt} > now() - make_interval(secs => ${TURN_IN_FLIGHT_SECONDS})`,
    })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(1);
  return latest?.role === 'user' && latest.recent === true;
}

/**
 * The adult's turns already counted (contract §9.6): their `message.add`
 * audit rows with role `user`, in the last minute and since the start of
 * today in the home zone. Audit rows are append-only, so Clear, purge and
 * the cleanup never reset a limit (L19). Served by `audit_log_at_idx`
 * (an index range on `at`; EXPLAIN evidence in ADR 0012's Package 1b note).
 */
async function turnsCounted(tx: DbOrTx, userId: string) {
  const tz = env.HOME_TIMEZONE;
  const result = await tx.execute<{ last_minute: number; today: number }>(sql`
    with d as (select date_trunc('day', now() at time zone ${tz}) at time zone ${tz} as starts)
    select
      count(*) filter (where at >= now() - interval '1 minute')::int as last_minute,
      count(*) filter (where at >= d.starts)::int as today
    from audit_log, d
    where at >= least(now() - interval '1 minute', d.starts)
      and actor_user_id = ${userId}
      and event = 'message.add'
      and meta ->> 'role' = 'user'`);
  const row = result.rows[0];
  return { lastMinute: Number(row?.last_minute ?? 0), today: Number(row?.today ?? 0) };
}

// ---------------------------------------------------------------------------
// 1. recordUserMessage: the person's words, before any model call.

export type RecordUserMessageOutcome =
  | { ok: true; message: KevMessage; conversationId: string }
  | { ok: false; code: 'turn_in_flight' | 'rate_limited_minute' | 'rate_limited_day' };

/**
 * Stores the person's words verbatim as their conversation's message (D6),
 * in one short transaction under the adult's conversation lock: refused,
 * with nothing stored, while a turn is in flight (one at a time, atomic;
 * L12, L13) or over the per-adult limits (6 a minute, 60 a home-zone day;
 * L11). Creates the adult's one conversation on their first turn (or after
 * they archived it).
 */
export async function recordUserMessage(
  actor: UserActor,
  input: RecordUserMessageInput,
  deps: Deps = {},
): Promise<RecordUserMessageOutcome> {
  assertKevAsAdult(actor);
  const data = recordUserMessageInput.parse(input);
  return auditedWrite<RecordUserMessageOutcome>(actor, deps, async (tx) => {
    const current = await lockConversation(tx, actor);
    const counted = await turnsCounted(tx, actor.userId);
    if (counted.today >= TURNS_PER_DAY)
      return { result: { ok: false, code: 'rate_limited_day' } as const, audit: null };
    if (counted.lastMinute >= TURNS_PER_MINUTE)
      return { result: { ok: false, code: 'rate_limited_minute' } as const, audit: null };
    if (current && (await turnInFlight(tx, current.id)))
      return { result: { ok: false, code: 'turn_in_flight' } as const, audit: null };

    const audits: DomainAudit[] = [];
    let conv = current;
    if (!conv) {
      const [created] = await tx.insert(conversation).values({ userId: actor.userId }).returning();
      if (!created) throw new Error('conversation insert returned no row');
      conv = created;
      audits.push({
        event: 'conversation.start',
        subjectType: 'conversation',
        subjectId: created.id,
        record: privateTo(actor.userId),
      });
    }
    const content: UserContentV2 = {
      v: 2,
      text: data.text,
      ...(data.focus ? { focus: data.focus } : {}),
    };
    const [row] = await tx
      .insert(message)
      .values({ conversationId: conv.id, role: 'user', channel: actor.channel, content })
      .returning();
    if (!row) throw new Error('message insert returned no row');
    await tx
      .update(conversation)
      .set({ lastMessageAt: row.createdAt, updatedAt: sql`now()` })
      .where(eq(conversation.id, conv.id));
    audits.push({
      event: 'message.add',
      subjectType: 'conversation',
      subjectId: conv.id,
      meta: { role: 'user' },
      record: privateTo(actor.userId),
    });
    return {
      result: { ok: true, message: row, conversationId: conv.id } as const,
      audit: audits,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. recordKevMessage: Kev's answer, as validated, with its trace.

/** Stores Kev's message (content v2) in the adult's conversation. */
export async function recordKevMessage(
  actor: UserActor,
  input: RecordKevMessageInput,
  deps: Deps = {},
): Promise<KevMessage> {
  assertKevAsAdult(actor);
  const data = recordKevMessageInput.parse(input);
  return auditedWrite(actor, deps, async (tx) => {
    const conv = await lockConversation(tx, actor);
    if (!conv) throw new NotFoundError('conversation');
    const [row] = await tx
      .insert(message)
      .values({
        conversationId: conv.id,
        role: 'kev',
        channel: actor.channel,
        content: data.content,
        tier: data.tier,
        model: data.model,
      })
      .returning();
    if (!row) throw new Error('message insert returned no row');
    await tx
      .update(conversation)
      .set({ lastMessageAt: row.createdAt, updatedAt: sql`now()` })
      .where(eq(conversation.id, conv.id));
    return {
      result: row,
      audit: {
        event: 'message.add',
        subjectType: 'conversation',
        subjectId: conv.id,
        // The tier, never the model's name (S13).
        meta: { role: 'kev', tier: data.tier },
        record: privateTo(actor.userId),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// 3. reserveAttempt: the attempt's maximum exposure, under the budget lock.

/** A live reservation, minted only here; a provider call needs one (contract §13.6). */
export type Reservation = Readonly<{
  reservationId: string;
  attemptId: string;
  userId: string;
  tier: KevTier;
  reservedUsdMicros: bigint;
}>;

const live = new WeakSet<Reservation>();
const liveByAttempt = new Map<string, WeakRef<Reservation>>();

/** Whether a reservation was minted by reserveAttempt and its attempt has not settled. */
export function isLiveReservation(r: unknown): r is Reservation {
  return typeof r === 'object' && r !== null && live.has(r as Reservation);
}

/** Revokes the actor's own live reservation for an attempt; another adult's is never touched. */
function revoke(attemptId: string, userId: string): void {
  const r = liveByAttempt.get(attemptId)?.deref();
  if (r && r.userId !== userId) return;
  if (r) live.delete(r);
  liveByAttempt.delete(attemptId);
}

/**
 * The household's monthly cap in µ$, derived here from the server's
 * validated configuration (HOME_KEV_MONTHLY_CAP_NZD, read on every call;
 * unset is NZ$100) at the fixed rate, never from a caller (ADR 0012 §43). A
 * value the boot would refuse counts as 0: Kev paused, fail closed.
 */
function householdCapUsdMicros(): bigint {
  const nzd = kevMonthlyCapNzd();
  if (nzd === null) return 0n;
  return monthlyCapUsdMicros(nzd ?? DEFAULT_MONTHLY_CAP_NZD, NZD_PER_USD);
}

/** The month's counted total and its parts (µ$), as the cap check reads them. */
export type BudgetCount = Readonly<{
  /** `kev_usage` cost with `at` in the home-zone month: actual recorded usage. */
  settledUsdMicros: bigint;
  /** Every `open` reservation, whatever its period. */
  openUsdMicros: bigint;
  /** `unreconciled` reservations of the month, or created in the 120 s before it began. */
  unreconciledUsdMicros: bigint;
  /** What the cap counts: the three above together. */
  countedUsdMicros: bigint;
}>;

/**
 * What the reserving adult learns: whether the reservation was taken (and
 * their own handle to it), or why not. Never a household figure: a count
 * or amount here would change with the other adult's turns in flight
 * (ADR 0012 §43, I5).
 */
export type ReserveOutcome =
  | Readonly<{ ok: true; reservation: Reservation }>
  | Readonly<{ ok: false; code: 'cap_reached' | 'duplicate_attempt' }>;

/**
 * The month's counted total (contract §13.6, "Which reservations count"),
 * household-wide (never filtered by user, L24), with the month derived in
 * SQL from the database's `now()` in the home zone (L28). Sums of bigint are
 * numeric in PostgreSQL and come back as text, never cast back to bigint.
 */
async function countMonth(tx: DbOrTx): Promise<BudgetCount> {
  const tz = env.HOME_TIMEZONE;
  const result = await tx.execute<{ settled: string; open: string; unreconciled: string }>(sql`
    with m as (
      select date_trunc('month', now() at time zone ${tz})::date as period,
             date_trunc('month', now() at time zone ${tz}) at time zone ${tz} as starts,
             (date_trunc('month', now() at time zone ${tz}) + interval '1 month') at time zone ${tz} as ends
    )
    select
      (select coalesce(sum(u.cost_usd_micros), 0) from kev_usage u, m
        where u.at >= m.starts and u.at < m.ends)::text as settled,
      (select coalesce(sum(r.reserved_usd_micros), 0) from kev_budget_reservation r
        where r.status = 'open')::text as open,
      (select coalesce(sum(r.reserved_usd_micros), 0) from kev_budget_reservation r, m
        where r.status = 'unreconciled'
          and (r.period = m.period
               or (r.created_at >= m.starts - make_interval(secs => ${RESERVATION_STALE_SECONDS})
                   and r.created_at < m.starts)))::text as unreconciled
    from m`);
  const row = result.rows[0];
  const settled = BigInt(row?.settled ?? '0');
  const open = BigInt(row?.open ?? '0');
  const unreconciled = BigInt(row?.unreconciled ?? '0');
  return {
    settledUsdMicros: settled,
    openUsdMicros: open,
    unreconciledUsdMicros: unreconciled,
    countedUsdMicros: settled + open + unreconciled,
  };
}

/**
 * The sweep (contract §13.6): every `open` reservation older than 120 s
 * becomes `unreconciled`, counted in full and never released. It runs in the
 * reserving adult's transaction, whether that reservation is then taken or
 * refused, and is audited there (CLAUDE.md rule 8) by one structural
 * `kev_budget.sweep` row with the count only, when anything was swept. The
 * row is the system's and private to no one, like `message.retention_purge`:
 * a swept reservation may be the other adult's, so attributing the row to the
 * reserving adult, or showing it to the swept row's owner with the reserving
 * adult as its actor, would tell one adult about the other's turns. The
 * month's unreconciled count is the system-only report's (getSpendReport).
 */
async function sweepStale(tx: DbOrTx): Promise<number> {
  const swept = await tx.execute<{ id: string }>(sql`
    update kev_budget_reservation set status = 'unreconciled', closed_at = now()
    where status = 'open'
      and created_at < now() - make_interval(secs => ${RESERVATION_STALE_SECONDS})
    returning id`);
  const n = swept.rows.length;
  if (n > 0)
    await recordAudit(
      systemActor,
      {
        event: 'kev_budget.sweep',
        meta: { count: n },
        snapshot: { visibility: 'private', visibleToUserId: null },
      },
      { db: tx },
    );
  return n;
}

const isAttemptUnique = (e: unknown): boolean => {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 5; i++) {
    const c = x as { code?: string; constraint?: string; cause?: unknown };
    if (c.code === '23505' && c.constraint === 'kev_budget_reservation_attempt_id_unique')
      return true;
    x = c.cause;
  }
  return false;
};

/**
 * Reserves an attempt's maximum permitted exposure before it starts
 * (contract §13.6), in one short transaction under the household budget
 * lock: (a) sweeps every `open` reservation older than 120 seconds to
 * `unreconciled`; (b) counts the month; (c) inserts this attempt's `open`
 * reservation, its `period` and `created_at` from the database's clock,
 * only if the count plus this reservation stays within the cap. Refusals are
 * outcomes, never thrown: `cap_reached`, and `duplicate_attempt` for a
 * second reservation of the same attempt (23505 on the unique attempt, L27).
 */
export async function reserveAttempt(
  actor: UserActor,
  input: ReserveAttemptInput,
  deps: Deps = {},
): Promise<ReserveOutcome> {
  assertKevAsAdult(actor);
  const data = reserveAttemptInput.parse(input);
  const cap = householdCapUsdMicros();
  try {
    return await auditedWrite<ReserveOutcome>(actor, deps, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${BUDGET_LOCK_KEY}, 0))`);
      await sweepStale(tx);
      const count = await countMonth(tx);
      if (count.countedUsdMicros + data.reservedUsdMicros > cap)
        return { result: { ok: false, code: 'cap_reached' } as const, audit: null };
      const tz = env.HOME_TIMEZONE;
      const [row] = await tx
        .insert(kevBudgetReservation)
        .values({
          attemptId: data.attemptId,
          userId: actor.userId,
          tier: data.tier,
          // The home-zone month of the database's now(), the same instant as
          // created_at's default (never the application's clock).
          period: sql`date_trunc('month', now() at time zone ${tz})::date`,
          reservedUsdMicros: data.reservedUsdMicros,
          // Written as now() rather than left to the column default, so the
          // reservation's period and creation time are one reading of the
          // database's clock (and a test can move that clock; L21, L28).
          createdAt: sql`now()`,
        })
        .returning({ id: kevBudgetReservation.id });
      if (!row) throw new Error('kev_budget_reservation insert returned no row');
      const reservation: Reservation = Object.freeze({
        reservationId: row.id,
        attemptId: data.attemptId,
        userId: actor.userId,
        tier: data.tier,
        reservedUsdMicros: data.reservedUsdMicros,
      });
      return {
        result: { ok: true, reservation } as const,
        audit: {
          event: 'kev_budget.reserve',
          subjectType: 'kev_budget_reservation',
          subjectId: row.id,
          meta: { tier: data.tier },
          record: privateTo(actor.userId),
        },
      };
    }).then((outcome) => {
      // Minted only once the transaction has committed.
      if (outcome.ok) {
        live.add(outcome.reservation);
        liveByAttempt.set(outcome.reservation.attemptId, new WeakRef(outcome.reservation));
      }
      return outcome;
    });
  } catch (e) {
    if (isAttemptUnique(e)) return { ok: false, code: 'duplicate_attempt' };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 4. settleAttempt: per-call usage, then the reservation closed.

export type SettleOutcome =
  | Readonly<{ ok: true; late: false; settledUsdMicros: bigint }>
  /** The sweep had already marked the reservation `unreconciled`: usage recorded, counted twice. */
  | Readonly<{ ok: true; late: true; settledUsdMicros: bigint }>
  | Readonly<{ ok: false; code: 'already_settled' }>;

/**
 * Settles an attempt (contract §13.6), in the caller's `finally`, in one
 * transaction, all or nothing (L26): one `kev_usage` row per provider call
 * (retried and aborted calls included; a call of unknown usage at the
 * per-call maximum, computed by the caller), each with the attempt's id and
 * `at` from the database; then the reservation `settled` at the sum of the
 * attempt's usage rows (L25), in full even above the reservation (L29).
 *
 * If the sweep already marked it `unreconciled` (late settlement, L23), the
 * usage rows are still committed (real usage is never discarded), the
 * reservation stays `unreconciled` and keeps counting in full, and an
 * explicit `kev_budget.late_settle` audit row records the double count. A
 * late settlement happens at most once (I3): under the reservation's row
 * lock, an `unreconciled` reservation whose attempt already has usage rows
 * (or a `kev_budget.late_settle` row) is `already_settled`, nothing written,
 * so two late settlements, even concurrent ones, record one set of rows.
 * With no reservation of the actor's for the attempt, nothing is written
 * (NotFound): no usage exists without a reservation. Whatever happens, the
 * actor's live handle for the attempt is revoked at the end (also when
 * settlement throws), so no further call can be made on it.
 */
export async function settleAttempt(
  actor: UserActor,
  input: SettleAttemptInput,
  deps: Deps = {},
): Promise<SettleOutcome> {
  assertKevAsAdult(actor);
  const data = settleAttemptInput.parse(input);
  try {
    return await settleLocked(actor, data, deps);
  } finally {
    revoke(data.attemptId, actor.userId);
  }
}

async function settleLocked(
  actor: UserActor,
  data: ReturnType<typeof settleAttemptInput.parse>,
  deps: Deps,
): Promise<SettleOutcome> {
  return auditedWrite<SettleOutcome>(actor, deps, async (tx) => {
    const [reservation] = await tx
      .select({
        id: kevBudgetReservation.id,
        status: kevBudgetReservation.status,
      })
      .from(kevBudgetReservation)
      .where(
        and(
          eq(kevBudgetReservation.attemptId, data.attemptId),
          eq(kevBudgetReservation.userId, actor.userId),
        ),
      )
      .for('update')
      .limit(1);
    if (!reservation) throw new NotFoundError('kev_budget_reservation');
    if (reservation.status === 'settled')
      return { result: { ok: false, code: 'already_settled' } as const, audit: null };
    // A late settlement already recorded (I3): checked after the row lock,
    // so a concurrent second settlement waits for the first to commit and
    // then sees its rows (each statement reads the latest committed data).
    // Its usage rows, or (for one with no calls) its audit row: a scan of
    // the audit log on this rare path only (no index serves the subject).
    if (reservation.status === 'unreconciled') {
      const prior = await tx.execute<{ n: number }>(sql`
        select (exists (select 1 from kev_usage where attempt_id = ${data.attemptId})
             or exists (select 1 from audit_log
                         where event = 'kev_budget.late_settle'
                           and subject_type = 'kev_budget_reservation'
                           and subject_id = ${reservation.id}))::int as n`);
      if (Number(prior.rows[0]?.n ?? 0) > 0)
        return { result: { ok: false, code: 'already_settled' } as const, audit: null };
    }
    if (data.conversationId) {
      const [c] = await tx
        .select({ id: conversation.id })
        .from(conversation)
        .where(and(eq(conversation.id, data.conversationId), eq(conversation.userId, actor.userId)))
        .limit(1);
      if (!c) throw new NotFoundError('conversation');
    }
    if (data.calls.length > 0)
      await tx.insert(kevUsage).values(
        data.calls.map((c) => ({
          ...c,
          userId: actor.userId,
          conversationId: data.conversationId,
          attemptId: data.attemptId,
          // The database's clock, at settlement (L28): never the application's.
          at: sql`now()`,
        })),
      );
    const [sum] = await tx
      .select({ total: sql<string>`coalesce(sum(${kevUsage.costUsdMicros}), 0)::text` })
      .from(kevUsage)
      .where(eq(kevUsage.attemptId, data.attemptId));
    const total = BigInt(sum?.total ?? '0');
    const audits: DomainAudit[] = [
      {
        event: 'kev_usage.record',
        subjectType: 'kev_budget_reservation',
        subjectId: reservation.id,
        meta: { calls: data.calls.length },
        record: privateTo(actor.userId),
      },
    ];
    if (reservation.status === 'unreconciled') {
      audits.push({
        event: 'kev_budget.late_settle',
        subjectType: 'kev_budget_reservation',
        subjectId: reservation.id,
        meta: { calls: data.calls.length },
        record: privateTo(actor.userId),
      });
      return {
        result: { ok: true, late: true, settledUsdMicros: total } as const,
        audit: audits,
      };
    }
    const closed = await tx.execute(sql`
      update kev_budget_reservation
         set status = 'settled', settled_usd_micros = ${total.toString()}::bigint, closed_at = now()
       where attempt_id = ${data.attemptId} and user_id = ${actor.userId} and status = 'open'`);
    if (closed.rowCount !== 1) throw new Error('kev_budget_reservation did not settle');
    return {
      result: { ok: true, late: false, settledUsdMicros: total } as const,
      audit: audits,
    };
  });
}

// ---------------------------------------------------------------------------
// The spend-cap status (for the later Usage view; no UI in Package 1b).

/**
 * What any signed-in adult may see of the household's month (ADR 0005 §43's
 * shared figure; ADR 0012 §43, I5): the cap and the month's **recorded**
 * usage (settled `kev_usage` cost in the home-zone month), with a threshold
 * state computed from that recorded total alone. Nothing here changes while
 * another adult's turn is in flight: no reservation, open or unreconciled,
 * no late settlement, no tier, no attempt, no count of anything.
 */
export type SpendStatus = Readonly<{
  capUsdMicros: bigint;
  recordedUsdMicros: bigint;
  /** From the recorded total only: `paused` at or above the cap (or a cap of 0), `deep_withdrawn` at 80%. */
  state: CapState;
}>;

/** The month's recorded usage, household-wide (settled `kev_usage` cost in the home-zone month). */
async function recordedMonth(tx: DbOrTx): Promise<bigint> {
  const tz = env.HOME_TIMEZONE;
  const result = await tx.execute<{ settled: string }>(sql`
    with m as (
      select date_trunc('month', now() at time zone ${tz}) at time zone ${tz} as starts,
             (date_trunc('month', now() at time zone ${tz}) + interval '1 month') at time zone ${tz} as ends
    )
    select (select coalesce(sum(u.cost_usd_micros), 0) from kev_usage u, m
             where u.at >= m.starts and u.at < m.ends)::text as settled
    from m`);
  return BigInt(result.rows[0]?.settled ?? '0');
}

/**
 * The household's month as an adult may see it (above). Any signed-in adult
 * may read it (the cap is the household's); it names no adult and reads no
 * content. Not gated: it writes nothing. The enforcement itself (reserve)
 * still counts open and unreconciled reservations; this view does not.
 */
export async function getSpendStatus(actor: UserActor, deps: Deps = {}): Promise<SpendStatus> {
  if ((actor as { kind: string }).kind !== 'user') throw new NotPermittedError('not_a_user');
  const db = deps.db ?? getDb();
  const cap = householdCapUsdMicros();
  const recorded = await recordedMonth(db);
  return {
    capUsdMicros: cap,
    recordedUsdMicros: recorded,
    state: capState({
      counted: recorded,
      cap,
      nextFastReservation: 0n,
      deepWithdrawnAtPercent: DEEP_WITHDRAWN_AT_PERCENT,
    }),
  };
}

/**
 * The household's budget in full, for the system only (an operator or
 * maintenance view; ADR 0012 §43, I5): what the cap counts and its parts
 * (§13.6), and the month's open, unreconciled and late-settled reservations.
 * These change with each adult's turns in flight, so no user actor may read
 * them: showing any of it to an adult (the owner's Usage view, Package 4)
 * needs the owner's explicit decision first.
 */
export type SpendReport = Readonly<{
  capUsdMicros: bigint;
  /** What the cap counts (settled usage + open + unreconciled, as the reservation reads it). */
  count: BudgetCount;
  openCount: number;
  unreconciledCount: number;
  /** Attempts whose usage arrived after the sweep: counted twice, visibly (L23). */
  lateSettledCount: number;
  lateSettledUsdMicros: bigint;
}>;

export async function getSpendReport(actor: Actor, deps: Deps = {}): Promise<SpendReport> {
  if (actor.kind !== 'system') throw new NotPermittedError('system_only');
  const db = deps.db ?? getDb();
  const tz = env.HOME_TIMEZONE;
  return db.transaction(async (tx) => {
    const count = await countMonth(tx);
    const result = await tx.execute<{
      open_count: number;
      unreconciled_count: number;
      late_count: number;
      late_total: string;
    }>(sql`
      with m as (
        select date_trunc('month', now() at time zone ${tz})::date as period,
               date_trunc('month', now() at time zone ${tz}) at time zone ${tz} as starts,
               (date_trunc('month', now() at time zone ${tz}) + interval '1 month') at time zone ${tz} as ends
      )
      select
        (select count(*) from kev_budget_reservation where status = 'open')::int as open_count,
        (select count(*) from kev_budget_reservation r, m where r.status = 'unreconciled'
           and (r.period = m.period
                or (r.created_at >= m.starts - make_interval(secs => ${RESERVATION_STALE_SECONDS})
                    and r.created_at < m.starts)))::int as unreconciled_count,
        (select count(distinct u.attempt_id) from kev_usage u
           join kev_budget_reservation r on r.attempt_id = u.attempt_id and r.status = 'unreconciled', m
           where u.at >= m.starts and u.at < m.ends)::int as late_count,
        (select coalesce(sum(u.cost_usd_micros), 0) from kev_usage u
           join kev_budget_reservation r on r.attempt_id = u.attempt_id and r.status = 'unreconciled', m
           where u.at >= m.starts and u.at < m.ends)::text as late_total
      from m`);
    const row = result.rows[0];
    return {
      capUsdMicros: householdCapUsdMicros(),
      count,
      openCount: Number(row?.open_count ?? 0),
      unreconciledCount: Number(row?.unreconciled_count ?? 0),
      lateSettledCount: Number(row?.late_count ?? 0),
      lateSettledUsdMicros: BigInt(row?.late_total ?? '0'),
    };
  });
}

// ---------------------------------------------------------------------------
// The model's window: a read, not a write.

export type WindowRow = Readonly<{ role: 'user' | 'kev'; content: unknown; createdAt: Date }>;

/** The most messages the window read returns: ten exchanges, two messages each, with room to spare. */
const WINDOW_ROWS = 40;

/**
 * The adult's own messages for the model's window (contract §7.2, O3): their
 * active conversation's messages created in the last `hours` hours (an
 * instant bound on the database's clock, so a night that changes the clock
 * is measured in real hours, C16) and never expired (90 days, C17), oldest
 * first, at most 40. Kev only, as the adult: the conversation is always
 * the actor's own. Reads `message` and `conversation`; writes nothing.
 * The window's pairing and its exchange and token limits are the
 * orchestrator's (src/kev/context/window.ts).
 */
export async function listConversationWindow(
  actor: UserActor,
  opts: { hours: number },
  deps: Deps = {},
): Promise<WindowRow[]> {
  if ((actor as { kind: string }).kind !== 'user') throw new NotPermittedError('not_a_user');
  if (actor.via !== 'kev') throw new NotPermittedError('kev_bookkeeping_only');
  if (!Number.isInteger(opts.hours) || opts.hours < 1 || opts.hours > 24)
    throw new RangeError('hours');
  const db = deps.db ?? getDb();
  const rows = await db
    .select({ role: message.role, content: message.content, createdAt: message.createdAt })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .where(
      and(
        eq(conversation.userId, actor.userId),
        isNull(conversation.archivedAt),
        sql`${message.createdAt} > now() - make_interval(hours => ${opts.hours})`,
        sql`${message.createdAt} >= now() - make_interval(days => ${MESSAGE_RETENTION_DAYS})`,
      ),
    )
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(WINDOW_ROWS);
  return rows.reverse().map((r) => ({
    role: r.role as 'user' | 'kev',
    content: r.content,
    createdAt: r.createdAt,
  }));
}

// ---------------------------------------------------------------------------
// 5. purgeExpired and 6. clearConversation: the adult's own messages.

const expired = sql`${message.createdAt} < now() - make_interval(days => ${MESSAGE_RETENTION_DAYS})`;

/**
 * Deletes the adult's own messages older than 90 days, in every one of
 * their conversations, at the start of their turn (the backstop to the
 * daily cleanup; contract §7.2). Audited per conversation with the count.
 */
export async function purgeExpired(
  actor: UserActor,
  deps: Deps = {},
): Promise<{ deleted: number }> {
  assertKevAsAdult(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const rows = await tx
      .delete(message)
      .where(
        and(
          expired,
          sql`${message.conversationId} in (select id from conversation where user_id = ${actor.userId})`,
        ),
      )
      .returning({ conversationId: message.conversationId });
    const per = new Map<string, number>();
    for (const r of rows) per.set(r.conversationId, (per.get(r.conversationId) ?? 0) + 1);
    return {
      result: { deleted: rows.length },
      audit: [...per].map(([id, n]) => ({
        event: 'conversation.purge',
        subjectType: 'conversation',
        subjectId: id,
        meta: { count: n },
        record: privateTo(actor.userId),
      })),
    };
  });
}

export type ClearOutcome = { ok: true; deleted: number } | { ok: false; code: 'turn_in_flight' };

/**
 * Clear (contract §7.2): deletes every message in the adult's conversation
 * (their words and Kev's, traces and citations included) and nulls
 * `last_message_at`, under the conversation lock; refused while a turn is in
 * flight. Keeps the conversation row, usage, reservations, audit rows and
 * the captures the adult kept. Rate limits survive it (they count audit rows).
 */
export async function clearConversation(actor: UserActor, deps: Deps = {}): Promise<ClearOutcome> {
  assertKevAsAdult(actor);
  return auditedWrite<ClearOutcome>(actor, deps, async (tx) => {
    const conv = await lockConversation(tx, actor);
    if (!conv) return { result: { ok: true, deleted: 0 } as const, audit: null };
    if (await turnInFlight(tx, conv.id))
      return { result: { ok: false, code: 'turn_in_flight' } as const, audit: null };
    const rows = await tx
      .delete(message)
      .where(eq(message.conversationId, conv.id))
      .returning({ id: message.id });
    await tx
      .update(conversation)
      .set({ lastMessageAt: null, updatedAt: sql`now()` })
      .where(eq(conversation.id, conv.id));
    return {
      result: { ok: true, deleted: rows.length } as const,
      audit: {
        event: 'conversation.clear',
        subjectType: 'conversation',
        subjectId: conv.id,
        meta: { count: rows.length },
        record: privateTo(actor.userId),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// 7. purgeExpiredMessages: the daily retention cleanup, the system's alone.

/**
 * Deletes every adult's expired messages (contract §7.2, O6), in bounded
 * batches (at most 1,000 rows a statement, 20 statements a run), each
 * statement its own short transaction, as `home_app`. Idempotent: a partial
 * run leaves only rows the next run deletes. Reads no table but `message`,
 * reads no content, calls nothing. Writes one structural system audit row
 * with the totals only, private to no one, so neither adult's Activity shows
 * it (no user id, no per-adult count). Not gated: it only deletes expired
 * rows. Reachable only from the secret-protected retention route (Package 3).
 */
export async function purgeExpiredMessages(
  actor: Actor,
  deps: Deps = {},
): Promise<{ deleted: number; batches: number }> {
  if (actor.kind !== 'system')
    throw new NotPermittedError(actor.via === 'kev' ? 'kev_cannot_write' : 'system_only');
  const db = deps.db ?? getDb();
  let deleted = 0;
  let batches = 0;
  for (; batches < PURGE_MAX_BATCHES;) {
    const result = await db.execute(sql`
      delete from message where id in (
        select id from message
         where created_at < now() - make_interval(days => ${MESSAGE_RETENTION_DAYS})
         order by created_at limit ${PURGE_BATCH_ROWS})`);
    batches += 1;
    const n = result.rowCount ?? 0;
    deleted += n;
    if (n < PURGE_BATCH_ROWS) break;
  }
  await recordAudit(
    actor,
    {
      event: 'message.retention_purge',
      meta: { deleted, batches },
      // Private to no one: shown in neither adult's Activity.
      snapshot: { visibility: 'private', visibleToUserId: null },
    },
    { db },
  );
  return { deleted, batches };
}
