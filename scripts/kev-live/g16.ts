import { inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/create';
import { kevBudgetReservation, user } from '@/db/schema';
import { BUDGET_LOCK_KEY, reserveAttempt, settleAttempt } from '@/domain/kev-bookkeeping/service';
import { attemptReservation } from '@/kev/router';
import type { UserActor } from '@/trust/actor';
import { ALEX, SAM } from '../../tests/fixtures/users';

// G16 on a pooled connection (contract §5.7; M8 live-verification plan §8;
// owner decision 5, 2026-10-16): reservation-only, no model and no key. Two
// synthetic adults (the fixture adults, by their .test addresses) reserve
// concurrently through HOME's real bookkeeping path, then settle with no
// calls, for `rounds` rounds; and once, with the household budget lock held
// by another transaction, both reservations must wait for it (they
// serialise on the transaction-level advisory lock through this
// connection). Reports timings and counts only.

export type G16Report = Readonly<{
  rounds: number;
  reservationsTaken: number;
  settled: number;
  /** Per round, ms from start to both settled. */
  roundMs: readonly number[];
  /** Both reservations waited for the held lock (neither finished while it was held). */
  serialisedOnLock: boolean;
  lockHeldMs: number;
  /** After the run: the run's reservations not `settled`, or settled at anything but 0. */
  leftOpenOrUnreconciled: number;
  passed: boolean;
}>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_r, reject) => setTimeout(() => reject(new Error('g16_timeout')), ms)),
  ]);
}

/** The fixture adults, created if absent (synthetic accounts that can never sign in: .test addresses). */
async function adults(db: Db): Promise<[UserActor, UserActor]> {
  const out: UserActor[] = [];
  for (const [f, id] of [
    [SAM, 'fixture-sam'],
    [ALEX, 'fixture-alex'],
  ] as const) {
    await db.insert(user).values({ id, name: f.name, email: f.email }).onConflictDoNothing();
    const [row] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`${user.email} = ${f.email}`);
    if (!row) throw new Error('g16: a fixture adult is missing');
    out.push({ kind: 'user', userId: row.id, email: f.email, via: 'kev', channel: 'web' });
  }
  return [out[0]!, out[1]!];
}

export async function runG16(
  db: Db,
  opts: { rounds?: number; holdMs?: number; timeoutMs?: number } = {},
): Promise<G16Report> {
  const rounds = opts.rounds ?? 10;
  const holdMs = opts.holdMs ?? 1_000;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deps = { db };
  const [sam, alex] = await adults(db);
  const attempts: string[] = [];
  let taken = 0;
  let settled = 0;
  const reserve = async (a: UserActor) => {
    const attemptId = crypto.randomUUID();
    attempts.push(attemptId);
    const r = await reserveAttempt(
      a,
      { attemptId, tier: 'fast', reservedUsdMicros: attemptReservation('fast') },
      deps,
    );
    if (r.ok) taken += 1;
    return { a, attemptId, ok: r.ok };
  };
  const settle = async (x: { a: UserActor; attemptId: string; ok: boolean }) => {
    if (!x.ok) return;
    const s = await settleAttempt(
      x.a,
      { attemptId: x.attemptId, conversationId: null, calls: [] },
      deps,
    );
    if (s.ok) settled += 1;
  };

  // 1. Serialisation: while another transaction holds the household budget
  // lock, neither adult's reservation can finish.
  let finishedWhileHeld = 0;
  let pending: Promise<{ a: UserActor; attemptId: string; ok: boolean }[]> | null = null;
  const lockStarted = Date.now();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${BUDGET_LOCK_KEY}, 0))`);
    pending = Promise.all(
      [sam, alex].map((a) =>
        reserve(a).then((x) => {
          if (Date.now() - lockStarted < holdMs) finishedWhileHeld += 1;
          return x;
        }),
      ),
    );
    await sleep(holdMs);
  });
  const lockHeldMs = Date.now() - lockStarted;
  const held = await withTimeout(pending!, timeoutMs);
  for (const x of held) await settle(x);
  const serialisedOnLock = finishedWhileHeld === 0 && held.every((x) => x.ok);

  // 2. Rounds: both adults at once, then both settled with no calls.
  const roundMs: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t = Date.now();
    const both = await withTimeout(Promise.all([reserve(sam), reserve(alex)]), timeoutMs);
    await withTimeout(Promise.all(both.map(settle)), timeoutMs);
    roundMs.push(Date.now() - t);
  }

  // 3. Nothing of the run left open or unreconciled.
  const rows = await db
    .select({ status: kevBudgetReservation.status, settled: kevBudgetReservation.settledUsdMicros })
    .from(kevBudgetReservation)
    .where(inArray(kevBudgetReservation.attemptId, attempts));
  const left =
    rows.filter((r) => r.status !== 'settled' || r.settled !== 0n).length +
    (attempts.length - rows.length);
  const expected = 2 * (rounds + 1);
  return Object.freeze({
    rounds,
    reservationsTaken: taken,
    settled,
    roundMs: Object.freeze(roundMs),
    serialisedOnLock,
    lockHeldMs,
    leftOpenOrUnreconciled: left,
    passed: serialisedOnLock && taken === expected && settled === expected && left === 0,
  });
}
