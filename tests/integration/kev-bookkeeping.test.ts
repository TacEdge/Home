import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { user } from '@/db/schema';
import { captureVerbatim } from '@/domain/captures/service';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import { exportFor } from '@/domain/export/service';
import type { KevContentV2 } from '@/domain/kev-bookkeeping/schema';
import {
  clearConversation,
  getSpendStatus,
  isLiveReservation,
  purgeExpired,
  purgeExpiredMessages,
  recordKevMessage,
  recordUserMessage,
  reserveAttempt,
  settleAttempt,
} from '@/domain/kev-bookkeeping/service';
import { TurnBudget } from '@/kev/budget';
import { TIERS } from '@/kev/config';
import { createScriptedProvider } from '@/kev/providers/scripted';
import { attemptReservation, perCallMax } from '@/kev/router';
import { env } from '@/lib/env';
import { systemActor, type UserActor } from '@/trust/actor';
import { listAudit } from '@/trust/audit';
import { assertTestDatabase } from '../db-guard';
import { TEST_APP_DATABASE_URL } from '../env';
import { adminDb, testDb } from './db';

// Kev's bookkeeping path as home_app (M8 contract §7.2, §9.6, §9.7, §13.6;
// matrix rows L9–L11, L13–L17, L20–L29, S5, S13, S16). Synthetic adults
// only. Reservations and usage rows can never be deleted (triggers), so the
// money tests run in months of their own, years ahead, on a database clock
// the test moves (below), and nothing here depends on another suite's rows.
//
// Moving the database's clock without passing the application's: a
// test-only schema, `home_test_clock`, holds a `now()` that returns a
// stored instant (or the real one when none is set). Connections of the
// `clocked` pool put that schema before pg_catalog in their search_path, so
// every unqualified now() the bookkeeping path writes or compares (the
// reservation's period and created_at, the sweep, the month, each usage
// row's at) and the born-open trigger read the moved clock. The code under
// test is unchanged and never receives a time from the application.

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
const clockedPool = new Pool({
  connectionString: assertTestDatabase(TEST_APP_DATABASE_URL),
  max: 60,
  options: '-c search_path=home_test_clock,public,pg_catalog',
});
clockedPool.on('connect', (c) => c.on('error', () => undefined));
const clocked = drizzle(clockedPool, { schema, casing: 'snake_case' });
const cdeps = { db: clocked };

async function setClock(instant: string | null) {
  await admin.db.execute(sql`update home_test_clock.clock set now = ${instant}::timestamptz`);
}

beforeAll(async () => {
  await admin.db.execute(
    sql.raw(`
    drop schema if exists home_test_clock cascade;
    create schema home_test_clock;
    create table home_test_clock.clock (now timestamptz);
    insert into home_test_clock.clock values (null);
    create function home_test_clock.now() returns timestamptz language sql stable
      as $$ select coalesce((select c.now from home_test_clock.clock c), pg_catalog.now()) $$;
    grant usage on schema home_test_clock to home_app;
    grant select on home_test_clock.clock to home_app;
    grant execute on function home_test_clock.now() to home_app;
  `),
  );
});
afterAll(async () => {
  await setClock(null);
  await clockedPool.end();
  await admin.db.execute(sql.raw('drop schema if exists home_test_clock cascade'));
  await close();
  await admin.close();
});

/** A synthetic adult of its own, so limits and conversations never cross tests or suites. */
async function adult(label: string): Promise<UserActor> {
  const id = `u-kev-${label}-${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(user).values({ id, name: label, email: `${id}@example.test` });
  return { kind: 'user', userId: id, email: `${id}@example.test`, via: 'kev', channel: 'web' };
}
const asUi = (a: UserActor): UserActor => ({ ...a, via: 'ui' });
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: unknown) =>
      e instanceof NotPermittedError
        ? e.code
        : e instanceof NotFoundError
          ? 'not_found'
          : String(e),
  );
const uuid = () => crypto.randomUUID();

const kevAnswer = (attemptId: string): KevContentV2 => ({
  v: 2,
  outcome: 'answer',
  say: 'Nothing is recorded for today.',
  blocks: [],
  cites: [],
  limits: [],
  trace: [],
  calls: [
    {
      attemptId,
      tier: 'fast',
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      ms: 1,
      stop: 'end_turn',
    },
  ],
  escalated: false,
});
const call = (costUsdMicros: bigint, over: Record<string, unknown> = {}) => ({
  tier: 'fast' as const,
  model: TIERS.fast.model.id,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsdMicros,
  escalated: false,
  ...over,
});
/** Sweeps every stale open reservation at the clock's now (a refused reservation still sweeps). */
async function sweep(a: UserActor, d = cdeps) {
  const r = await reserveAttempt(
    a,
    { attemptId: uuid(), tier: 'fast', reservedUsdMicros: 1n, capUsdMicros: 0n },
    d,
  );
  expect(r.ok).toBe(false);
}
async function reservationRow(attemptId: string) {
  const r = await admin.db.execute<{
    status: string;
    settled_usd_micros: string | null;
    period: string;
    created_at: Date;
    closed_at: Date | null;
  }>(sql`select status, settled_usd_micros::text, period::text, created_at, closed_at
         from kev_budget_reservation where attempt_id = ${attemptId}`);
  return r.rows;
}
async function usageRows(attemptId: string) {
  return (
    await admin.db.execute<{ cost: string; at: Date; input_tokens: number }>(
      sql`select cost_usd_micros::text as cost, at, input_tokens from kev_usage where attempt_id = ${attemptId} order by at, id`,
    )
  ).rows;
}

// ---------------------------------------------------------------------------

describe('S5: who may call the six adult functions', () => {
  it('the system actor, a person’s own UI and the gate closed are each refused before any write', async () => {
    const sam = await adult('s5');
    const sys = systemActor as unknown as UserActor;
    const calls = (a: UserActor) => [
      recordUserMessage(a, { text: 'x' }, deps),
      recordKevMessage(a, { content: kevAnswer(uuid()), tier: 'fast', model: 'm' }, deps),
      reserveAttempt(
        a,
        { attemptId: uuid(), tier: 'fast', reservedUsdMicros: 1n, capUsdMicros: 10n },
        deps,
      ),
      settleAttempt(a, { attemptId: uuid(), conversationId: null, calls: [] }, deps),
      purgeExpired(a, deps),
      clearConversation(a, deps),
    ];
    const audit = async () =>
      Number((await admin.db.execute(sql`select count(*)::int as n from audit_log`)).rows[0]?.n);
    const before = await audit();
    for (const p of calls(sys)) expect(await code(p)).toBe('not_a_user');
    for (const p of calls(asUi(sam))) expect(await code(p)).toBe('kev_bookkeeping_only');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('HOME_REAL_DATA', '');
    try {
      for (const p of calls(sam)) expect(await code(p)).toBe('real_data_closed');
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await audit()).toBe(before);
  });

  it('another adult’s conversation and attempts are unreachable: each function resolves the actor’s own', async () => {
    const sam = await adult('s5-sam');
    const alex = await adult('s5-alex');
    const m = await recordUserMessage(sam, { text: 'Sam’s synthetic question' }, deps);
    expect(m.ok).toBe(true);
    // Alex has no conversation: his Kev message has nowhere to go; Sam's is untouched.
    expect(
      await code(
        recordKevMessage(alex, { content: kevAnswer(uuid()), tier: 'fast', model: 'm' }, deps),
      ),
    ).toBe('not_found');
    expect(await clearConversation(alex, deps)).toEqual({ ok: true, deleted: 0 });
    const r = await reserveAttempt(
      sam,
      { attemptId: uuid(), tier: 'fast', reservedUsdMicros: 1n, capUsdMicros: 10n ** 15n },
      deps,
    );
    if (!r.ok) throw new Error('reserve');
    expect(
      await code(
        settleAttempt(
          alex,
          { attemptId: r.reservation.attemptId, conversationId: null, calls: [] },
          deps,
        ),
      ),
    ).toBe('not_found');
    expect((await reservationRow(r.reservation.attemptId))[0]?.status).toBe('open');
    await settleAttempt(
      sam,
      { attemptId: r.reservation.attemptId, conversationId: null, calls: [] },
      deps,
    );
  });
});

describe('recordUserMessage: stored first, one turn at a time, rate-limited from audit rows', () => {
  it('stores the words verbatim as content v2, creating the adult’s one conversation', async () => {
    const sam = await adult('store');
    const r = await recordUserMessage(sam, { text: '  What’s on today?  ', focus: 'today' }, deps);
    if (!r.ok) throw new Error(r.code);
    // Verbatim: not trimmed or rewritten; a blank message is refused.
    expect(r.message.content).toEqual({ v: 2, text: '  What’s on today?  ', focus: 'today' });
    expect(r.message).toMatchObject({ role: 'user', tier: null, model: null, channel: 'web' });
    await expect(recordUserMessage(sam, { text: '   ' }, deps)).rejects.toThrow();
    await recordKevMessage(sam, { content: kevAnswer(uuid()), tier: 'fast', model: 'm' }, deps);
    const again = await recordUserMessage(sam, { text: 'And tomorrow?' }, deps);
    if (!again.ok) throw new Error(again.code);
    expect(again.conversationId).toBe(r.conversationId);
    // A v2 message is readable where messages are read: Keep in To sort copies it.
    const kept = await captureVerbatim(sam, { messageId: again.message.id }, deps);
    expect(kept.text).toBe('And tomorrow?');
  });

  it('L12: refused while the adult’s last message is a person’s under 70 s old; allowed at 71 s', async () => {
    const sam = await adult('inflight');
    const first = await recordUserMessage(sam, { text: 'one' }, deps);
    if (!first.ok) throw new Error(first.code);
    expect(await recordUserMessage(sam, { text: 'two' }, deps)).toEqual({
      ok: false,
      code: 'turn_in_flight',
    });
    await admin.db.execute(
      sql`update message set created_at = now() - interval '30 seconds' where id = ${first.message.id}`,
    );
    expect((await recordUserMessage(sam, { text: 'two' }, deps)).ok).toBe(false);
    expect(await clearConversation(sam, deps)).toEqual({ ok: false, code: 'turn_in_flight' });
    await admin.db.execute(
      sql`update message set created_at = now() - interval '71 seconds' where id = ${first.message.id}`,
    );
    expect((await recordUserMessage(sam, { text: 'two' }, deps)).ok).toBe(true);
  });

  it('L13: two turns at the same instant on two devices: exactly one proceeds, one message stored', async () => {
    const sam = await adult('devices');
    const pool = new Pool({ connectionString: assertTestDatabase(TEST_APP_DATABASE_URL), max: 10 });
    const d2 = { db: drizzle(pool, { schema, casing: 'snake_case' }) };
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => recordUserMessage(sam, { text: `device ${i}` }, d2)),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok).map((r) => (r as { code: string }).code)).toEqual(
        Array(7).fill('turn_in_flight'),
      );
      const n = await admin.db.execute(sql`
        select count(*)::int as n, count(distinct m.conversation_id)::int as c from message m
        join conversation c on c.id = m.conversation_id where c.user_id = ${sam.userId}`);
      expect(n.rows[0]).toEqual({ n: 1, c: 1 });
    } finally {
      await pool.end();
    }
  });

  it('L11: the 7th turn in a minute and the 61st in a day are refused, nothing stored; another adult unaffected', async () => {
    const sam = await adult('rate');
    const alex = await adult('rate-other');
    for (let i = 0; i < 6; i++) {
      expect((await recordUserMessage(sam, { text: `q${i}` }, deps)).ok).toBe(true);
      await recordKevMessage(sam, { content: kevAnswer(uuid()), tier: 'fast', model: 'm' }, deps);
    }
    const count = async () =>
      Number(
        (
          await admin.db.execute(sql`select count(*)::int as n from message m join conversation c
            on c.id = m.conversation_id where c.user_id = ${sam.userId}`)
        ).rows[0]?.n,
      );
    const before = await count();
    expect(await recordUserMessage(sam, { text: 'q7' }, deps)).toEqual({
      ok: false,
      code: 'rate_limited_minute',
    });
    expect(await count()).toBe(before);
    expect((await recordUserMessage(alex, { text: 'mine' }, deps)).ok).toBe(true);

    // The day: 59 more of Alex's `message.add` rows today, but over a minute ago.
    const tz = env.HOME_TIMEZONE;
    await admin.db.execute(sql`
      insert into audit_log (actor_user_id, actor_via, actor_channel, event, subject_type, meta, visibility, visible_to_user_id, at)
      select ${alex.userId}, 'kev', 'web', 'message.add', 'conversation', '{"role":"user"}'::jsonb, 'private', ${alex.userId},
             greatest(date_trunc('day', now() at time zone ${tz}) at time zone ${tz}, now() - interval '61 seconds')
      from generate_series(1, 59)`);
    await recordKevMessage(alex, { content: kevAnswer(uuid()), tier: 'fast', model: 'm' }, deps);
    expect(await recordUserMessage(alex, { text: 'the 61st' }, deps)).toEqual({
      ok: false,
      code: 'rate_limited_day',
    });
  });

  it('L19: rate limits survive Clear (they count audit rows)', async () => {
    const sam = await adult('rate-clear');
    for (let i = 0; i < 6; i++) {
      await recordUserMessage(sam, { text: `q${i}` }, deps);
      await recordKevMessage(sam, { content: kevAnswer(uuid()), tier: 'fast', model: 'm' }, deps);
    }
    expect((await clearConversation(sam, deps)).ok).toBe(true);
    expect(await recordUserMessage(sam, { text: 'q7' }, deps)).toEqual({
      ok: false,
      code: 'rate_limited_minute',
    });
  });

  it('the rate count is served by audit_log_at_idx (EXPLAIN)', async () => {
    const tz = env.HOME_TIMEZONE;
    const plan = async (seqscan: boolean) => {
      const rows = await admin.db.transaction(async (tx) => {
        if (!seqscan) await tx.execute(sql`set local enable_seqscan = off`);
        return (
          await tx.execute<{ 'QUERY PLAN': string }>(sql`explain
            with d as (select date_trunc('day', now() at time zone ${tz}) at time zone ${tz} as starts)
            select count(*) filter (where at >= now() - interval '1 minute')::int,
                   count(*) filter (where at >= d.starts)::int
            from audit_log, d
            where at >= least(now() - interval '1 minute', d.starts)
              and actor_user_id = 'u' and event = 'message.add' and meta ->> 'role' = 'user'`)
        ).rows;
      });
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    };
    // With sequential scans off, the planner uses the index on `at`: it can
    // serve the count. (On a tiny test table it may prefer a scan otherwise.)
    expect(await plan(false)).toMatch(/audit_log_at_idx/);
  });
});

describe('recordKevMessage, purgeExpired, clearConversation', () => {
  it('stores Kev’s content v2 with its tier and model; audit carries the tier only', async () => {
    const sam = await adult('kevmsg');
    await recordUserMessage(sam, { text: 'q' }, deps);
    const m = await recordKevMessage(
      sam,
      { content: kevAnswer(uuid()), tier: 'deep', model: TIERS.deep.model.id },
      deps,
    );
    expect(m).toMatchObject({ role: 'kev', tier: 'deep', model: TIERS.deep.model.id });
    await expect(
      recordKevMessage(
        sam,
        { content: { ...kevAnswer(uuid()), thinking: 'x' } as never, tier: 'fast', model: 'm' },
        deps,
      ),
    ).rejects.toThrow();
  });

  it('purgeExpired deletes only the adult’s own messages over 90 days old, audited with the count', async () => {
    const sam = await adult('purge');
    const alex = await adult('purge-other');
    const a = await recordUserMessage(sam, { text: 'old' }, deps);
    await recordKevMessage(sam, { content: kevAnswer(uuid()), tier: 'fast', model: 'm' }, deps);
    const b = await recordUserMessage(alex, { text: 'Alex’s old' }, deps);
    if (!a.ok || !b.ok) throw new Error('setup');
    await admin.db.execute(sql`update message set created_at = now() - interval '91 days'
      where id in (${a.message.id}, ${b.message.id})`);
    expect(await purgeExpired(sam, deps)).toEqual({ deleted: 1 });
    expect(await purgeExpired(sam, deps)).toEqual({ deleted: 0 });
    const left = await admin.db.execute(sql`select id from message where id = ${b.message.id}`);
    expect(left.rows).toHaveLength(1);
    const rows = (await listAudit(asUi(sam), { limit: 50 }, deps)).rows.filter(
      (r) => r.event === 'conversation.purge',
    );
    expect(rows.map((r) => r.meta)).toContainEqual({ count: 1 });
  });

  it('Clear deletes every message, nulls last_message_at, keeps the conversation and usage', async () => {
    const sam = await adult('clear');
    const r = await recordUserMessage(sam, { text: 'q' }, deps);
    await recordKevMessage(sam, { content: kevAnswer(uuid()), tier: 'fast', model: 'm' }, deps);
    if (!r.ok) throw new Error(r.code);
    expect(await clearConversation(sam, deps)).toEqual({ ok: true, deleted: 2 });
    const c = await admin.db.execute(
      sql`select last_message_at from conversation where id = ${r.conversationId}`,
    );
    expect(c.rows[0]).toEqual({ last_message_at: null });
  });
});

describe('purgeExpiredMessages: the system’s daily cleanup', () => {
  it('deletes every adult’s expired messages in bounded batches, not gated, audited for no one', async () => {
    const sam = await adult('cleanup');
    const r = await recordUserMessage(sam, { text: 'expired' }, deps);
    if (!r.ok) throw new Error(r.code);
    await admin.db.execute(
      sql`update message set created_at = now() - interval '90 days 1 second' where id = ${r.message.id}`,
    );
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('HOME_REAL_DATA', '');
    let result;
    try {
      result = await purgeExpiredMessages(systemActor, deps);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(result.batches).toBe(1);
    const gone = await admin.db.execute(sql`select id from message where id = ${r.message.id}`);
    expect(gone.rows).toEqual([]);
    const row = (
      await admin.db.execute<{
        actor_user_id: string | null;
        visibility: string;
        visible_to_user_id: string | null;
        meta: unknown;
      }>(
        sql`select actor_user_id, visibility, visible_to_user_id, meta from audit_log
            where event = 'message.retention_purge' order by at desc limit 1`,
      )
    ).rows[0];
    expect(row).toMatchObject({
      actor_user_id: null,
      visibility: 'private',
      visible_to_user_id: null,
    });
    expect(Object.keys(row?.meta as object).sort()).toEqual(['batches', 'deleted']);
    for (const a of [asUi(sam)]) {
      const seen = (await listAudit(a, { limit: 200 }, deps)).rows.map((x) => x.event);
      expect(seen).not.toContain('message.retention_purge');
    }
  });

  it('refuses every actor but the system', async () => {
    const sam = await adult('cleanup-refuse');
    expect(await code(purgeExpiredMessages(sam, deps))).toBe('kev_cannot_write');
    expect(await code(purgeExpiredMessages(asUi(sam), deps))).toBe('system_only');
  });
});

// ---------------------------------------------------------------------------
// Reservations and settlement, each in a month of its own on the moved clock.

describe('reserveAttempt and settleAttempt', () => {
  it('reserve then settle: the reservation is born open, settled at the sum of its usage rows (L25)', async () => {
    const sam = await adult('cycle');
    await setClock('2033-02-10T00:00:00Z');
    await sweep(sam);
    const attemptId = uuid();
    const r = await reserveAttempt(
      sam,
      {
        attemptId,
        tier: 'fast',
        reservedUsdMicros: attemptReservation('fast'),
        capUsdMicros: 55_555_556n,
      },
      cdeps,
    );
    if (!r.ok) throw new Error(r.code);
    expect(isLiveReservation(r.reservation)).toBe(true);
    expect(r.count.countedUsdMicros).toBe(665_280n);
    const s = await settleAttempt(
      sam,
      {
        attemptId,
        conversationId: null,
        // Three calls, one of unknown usage at the per-call maximum.
        calls: [
          call(27_720n),
          call(3_300n),
          call(perCallMax('fast'), { inputTokens: 0, outputTokens: 0 }),
        ],
      },
      cdeps,
    );
    expect(s).toEqual({ ok: true, late: false, settledUsdMicros: 27_720n + 3_300n + 133_056n });
    expect(isLiveReservation(r.reservation)).toBe(false);
    const [row] = await reservationRow(attemptId);
    expect(row).toMatchObject({
      status: 'settled',
      settled_usd_micros: String(164_076n),
      period: '2033-02-01',
    });
    expect((await usageRows(attemptId)).map((u) => u.cost).sort()).toEqual([
      '133056',
      '27720',
      '3300',
    ]);
    // A second settlement of the same attempt writes nothing.
    expect(
      await settleAttempt(sam, { attemptId, conversationId: null, calls: [call(1n)] }, cdeps),
    ).toEqual({
      ok: false,
      code: 'already_settled',
    });
    expect(await usageRows(attemptId)).toHaveLength(3);
  });

  it('L9, L24: a reservation that would pass the cap is refused, household-wide (never per adult)', async () => {
    const sam = await adult('l24-sam');
    const alex = await adult('l24-alex');
    await setClock('2033-03-10T00:00:00Z');
    await sweep(sam);
    const R = attemptReservation('fast');
    const cap = 1_000_000n;
    // Sam: 200,000 settled, plus one open reservation.
    const s1 = await reserveAttempt(
      sam,
      { attemptId: uuid(), tier: 'fast', reservedUsdMicros: R, capUsdMicros: cap },
      cdeps,
    );
    if (!s1.ok) throw new Error(s1.code);
    await settleAttempt(
      sam,
      { attemptId: s1.reservation.attemptId, conversationId: null, calls: [call(200_000n)] },
      cdeps,
    );
    const s2 = await reserveAttempt(
      sam,
      { attemptId: uuid(), tier: 'fast', reservedUsdMicros: 100_000n, capUsdMicros: cap },
      cdeps,
    );
    expect(s2.ok).toBe(true);
    // 300,000 counted; Alex's 665,280 would make 965,280 ≤ 1,000,000: allowed.
    const a1 = await reserveAttempt(
      alex,
      { attemptId: uuid(), tier: 'fast', reservedUsdMicros: R, capUsdMicros: cap },
      cdeps,
    );
    expect(a1.ok).toBe(true);
    // Now 965,280 counted: Alex's second (or Sam's) is refused, whoever asks.
    for (const who of [alex, sam]) {
      const refused = await reserveAttempt(
        who,
        { attemptId: uuid(), tier: 'fast', reservedUsdMicros: R, capUsdMicros: cap },
        cdeps,
      );
      expect(refused).toMatchObject({ ok: false, code: 'cap_reached' });
    }
    const status = await getSpendStatus(sam, cap, cdeps);
    expect(status.count).toEqual({
      settledUsdMicros: 200_000n,
      openUsdMicros: 100_000n + R,
      unreconciledUsdMicros: 0n,
      countedUsdMicros: 300_000n + R,
    });
    expect(status.count.countedUsdMicros).toBeLessThanOrEqual(cap);
  });

  it('L27: a second reservation for the same attempt is a refusal outcome, never thrown; one row remains', async () => {
    const sam = await adult('l27');
    const attemptId = uuid();
    const input = {
      attemptId,
      tier: 'fast' as const,
      reservedUsdMicros: 1n,
      capUsdMicros: 10n ** 15n,
    };
    expect((await reserveAttempt(sam, input, deps)).ok).toBe(true);
    expect(await reserveAttempt(sam, input, deps)).toMatchObject({
      ok: false,
      code: 'duplicate_attempt',
    });
    expect(await reservationRow(attemptId)).toHaveLength(1);
    await settleAttempt(sam, { attemptId, conversationId: null, calls: [] }, deps);
  });

  it('L17: an open reservation 121 s old is marked unreconciled by the next, counted in full, shown and audited', async () => {
    const sam = await adult('l17');
    const alex = await adult('l17-other');
    /** The sweep's audit rows written by `p`. */
    const sweepRows = async (p: Promise<unknown>) => {
      const since = (
        await admin.db.execute<{ t: string }>(sql`select clock_timestamp()::text as t`)
      ).rows[0]!.t;
      await p;
      return (
        await admin.db.execute<{
          actor_user_id: string | null;
          actor_via: string;
          subject_type: string | null;
          meta: unknown;
          visibility: string;
          visible_to_user_id: string | null;
        }>(sql`select actor_user_id, actor_via, subject_type, meta, visibility, visible_to_user_id
               from audit_log where event = 'kev_budget.sweep' and at > ${since}::timestamptz`)
      ).rows;
    };
    await setClock('2033-04-10T00:00:00Z');
    await sweep(sam);
    const crashed = uuid();
    await reserveAttempt(
      sam,
      { attemptId: crashed, tier: 'fast', reservedUsdMicros: 50_000n, capUsdMicros: 10n ** 12n },
      cdeps,
    );
    await setClock('2033-04-10T00:02:00Z'); // 120 s: not yet; nothing stale, nothing audited
    const notYet = uuid();
    expect(
      await sweepRows(
        reserveAttempt(
          sam,
          { attemptId: notYet, tier: 'fast', reservedUsdMicros: 1n, capUsdMicros: 0n },
          cdeps,
        ),
      ),
    ).toEqual([]);
    expect((await reservationRow(crashed))[0]?.status).toBe('open');
    // 121 s, on the refused (cap_reached) path: swept and audited once; the
    // refused attempt itself writes no reservation.
    await setClock('2033-04-10T00:02:01Z');
    const refused = uuid();
    const rows = await sweepRows(
      reserveAttempt(
        alex,
        { attemptId: refused, tier: 'fast', reservedUsdMicros: 1n, capUsdMicros: 0n },
        cdeps,
      ),
    );
    expect(rows).toEqual([
      {
        actor_user_id: null,
        actor_via: 'system',
        subject_type: null,
        meta: { count: 1 },
        visibility: 'private',
        visible_to_user_id: null,
      },
    ]);
    expect(await reservationRow(refused)).toEqual([]);
    expect(await reservationRow(notYet)).toEqual([]);
    const [row] = await reservationRow(crashed);
    expect(row?.status).toBe('unreconciled');
    expect(new Date(row!.closed_at!).toISOString()).toBe('2033-04-10T00:02:01.000Z');
    const status = await getSpendStatus(sam, 10n ** 12n, cdeps);
    expect(status.count.unreconciledUsdMicros).toBe(50_000n);
    expect(status.unreconciledCount).toBe(1);
    // Shown in neither adult's Activity.
    for (const a of [sam, alex])
      expect(
        (await listAudit(asUi(a), { limit: 200 }, deps)).rows.map((r) => r.event),
      ).not.toContain('kev_budget.sweep');
    // The success path: two stale reservations swept by a reservation that is taken.
    const c1 = uuid();
    const c2 = uuid();
    for (const [who, id] of [
      [sam, c1],
      [alex, c2],
    ] as const)
      await reserveAttempt(
        who,
        { attemptId: id, tier: 'fast', reservedUsdMicros: 7n, capUsdMicros: 10n ** 12n },
        cdeps,
      );
    await setClock('2033-04-10T00:05:00Z');
    const taken = uuid();
    const okRows = await sweepRows(
      reserveAttempt(
        sam,
        { attemptId: taken, tier: 'fast', reservedUsdMicros: 1n, capUsdMicros: 10n ** 12n },
        cdeps,
      ),
    );
    expect(okRows.map((r) => [r.actor_via, r.meta])).toEqual([['system', { count: 2 }]]);
    expect((await reservationRow(taken))[0]?.status).toBe('open');
    // Never released: settling a swept one now is a late settlement, below.
    await settleAttempt(sam, { attemptId: taken, conversationId: null, calls: [] }, cdeps);
  });

  it('L23: a late settlement records its usage, never reopens the reservation, and is counted twice, visibly', async () => {
    const sam = await adult('l23');
    await setClock('2033-05-10T00:00:00Z');
    await sweep(sam);
    const attemptId = uuid();
    const r = await reserveAttempt(
      sam,
      { attemptId, tier: 'fast', reservedUsdMicros: 665_280n, capUsdMicros: 10n ** 12n },
      cdeps,
    );
    expect(r.ok).toBe(true);
    await setClock('2033-05-10T00:03:00Z');
    await sweep(sam);
    const s = await settleAttempt(
      sam,
      { attemptId, conversationId: null, calls: [call(40_000n)] },
      cdeps,
    );
    expect(s).toEqual({ ok: true, late: true, settledUsdMicros: 40_000n });
    const [row] = await reservationRow(attemptId);
    expect(row).toMatchObject({ status: 'unreconciled', settled_usd_micros: null });
    expect(await usageRows(attemptId)).toHaveLength(1);
    const status = await getSpendStatus(sam, 10n ** 12n, cdeps);
    expect(status.count.countedUsdMicros).toBe(665_280n + 40_000n);
    expect(status.lateSettledCount).toBe(1);
    expect(status.lateSettledUsdMicros).toBe(40_000n);
    const events = (await listAudit(asUi(sam), { limit: 50 }, deps)).rows.map((x) => x.event);
    expect(events).toContain('kev_budget.late_settle');
  });

  it('L26: a settlement that fails after its usage rows are written leaves nothing; the reservation stays open, later unreconciled', async () => {
    const sam = await adult('l26');
    await setClock('2033-06-10T00:00:00Z');
    await sweep(sam);
    const attemptId = uuid();
    await reserveAttempt(
      sam,
      { attemptId, tier: 'fast', reservedUsdMicros: 10_000n, capUsdMicros: 10n ** 12n },
      cdeps,
    );
    // The fault, injected between the inserts and the update: a trigger on
    // the reservation's update for this attempt only.
    await admin.db.execute(
      sql.raw(`
      create or replace function home_test_clock.fault() returns trigger language plpgsql as $$
      begin raise exception 'injected settlement fault'; end $$;
      create trigger home_test_fault before update on kev_budget_reservation
        for each row when (new.attempt_id = '${attemptId}') execute function home_test_clock.fault();`),
    );
    try {
      await expect(
        settleAttempt(
          sam,
          { attemptId, conversationId: null, calls: [call(1_000n), call(2_000n)] },
          cdeps,
        ),
      ).rejects.toThrow();
    } finally {
      await admin.db.execute(sql.raw('drop trigger home_test_fault on kev_budget_reservation'));
    }
    expect(await usageRows(attemptId)).toEqual([]);
    expect((await reservationRow(attemptId))[0]?.status).toBe('open');
    await setClock('2033-06-10T00:02:01Z');
    await sweep(sam);
    expect((await reservationRow(attemptId))[0]?.status).toBe('unreconciled');
  });

  it('L29: an attempt reserved at 665,280 µ$ whose calls cost 700,000 µ$ is settled in full and counted in full', async () => {
    const sam = await adult('l29');
    await setClock('2033-07-10T00:00:00Z');
    await sweep(sam);
    const attemptId = uuid();
    await reserveAttempt(
      sam,
      { attemptId, tier: 'fast', reservedUsdMicros: 665_280n, capUsdMicros: 10n ** 12n },
      cdeps,
    );
    expect(
      await settleAttempt(
        sam,
        { attemptId, conversationId: null, calls: [call(350_000n), call(350_000n)] },
        cdeps,
      ),
    ).toEqual({ ok: true, late: false, settledUsdMicros: 700_000n });
    expect((await getSpendStatus(sam, 10n ** 12n, cdeps)).count.countedUsdMicros).toBe(700_000n);
  });

  it('no usage without a reservation: settling an attempt that never reserved writes nothing', async () => {
    const sam = await adult('nores');
    const attemptId = uuid();
    expect(
      await code(settleAttempt(sam, { attemptId, conversationId: null, calls: [call(5n)] }, deps)),
    ).toBe('not_found');
    expect(await usageRows(attemptId)).toEqual([]);
  });
});

describe('the month boundary on the database clock (L21, L22)', () => {
  it('L21: open October reservations count in November’s check; once settled their usage falls in November', async () => {
    const sam = await adult('l21-sam');
    const alex = await adult('l21-alex');
    // 31 October 2032, 23:59:59 in Auckland (NZDT, UTC+13).
    await setClock('2032-10-31T10:59:59Z');
    await sweep(sam);
    const R = attemptReservation('fast');
    const big = 10n ** 12n;
    const s = await reserveAttempt(
      sam,
      { attemptId: uuid(), tier: 'fast', reservedUsdMicros: R, capUsdMicros: big },
      cdeps,
    );
    const a = await reserveAttempt(
      alex,
      { attemptId: uuid(), tier: 'fast', reservedUsdMicros: R, capUsdMicros: big },
      cdeps,
    );
    if (!s.ok || !a.ok) throw new Error('reserve');
    expect((await reservationRow(s.reservation.attemptId))[0]?.period).toBe('2032-10-01');
    // 1 November, 00:00:01: room for a third only if the two were left out.
    await setClock('2032-10-31T11:00:01Z');
    const cap = 2n * R; // the two October ones fill it exactly
    const third = await reserveAttempt(
      sam,
      { attemptId: uuid(), tier: 'fast', reservedUsdMicros: R, capUsdMicros: cap },
      cdeps,
    );
    expect(third).toMatchObject({ ok: false, code: 'cap_reached' });
    let nov = await getSpendStatus(sam, cap, cdeps);
    expect(nov.count.countedUsdMicros).toBe(2n * R);
    // They settle at 00:00:30: their usage rows fall in November.
    await setClock('2032-10-31T11:00:30Z');
    await settleAttempt(
      sam,
      { attemptId: s.reservation.attemptId, conversationId: null, calls: [call(80_000n)] },
      cdeps,
    );
    nov = await getSpendStatus(sam, cap, cdeps);
    expect(nov.count.countedUsdMicros).toBe(80_000n + R);
    expect(nov.count.countedUsdMicros).toBeLessThanOrEqual(cap);
    await settleAttempt(
      alex,
      { attemptId: a.reservation.attemptId, conversationId: null, calls: [call(70_000n)] },
      cdeps,
    );
    nov = await getSpendStatus(sam, cap, cdeps);
    expect(nov.count).toMatchObject({
      settledUsdMicros: 150_000n,
      openUsdMicros: 0n,
      countedUsdMicros: 150_000n,
    });
    const rows = await usageRows(s.reservation.attemptId);
    expect(new Date(rows[0]!.at).toISOString()).toBe('2032-10-31T11:00:30.000Z');
    // And October no longer counts them at all (settled, usage in November).
    await setClock('2032-10-31T10:59:59Z');
    expect((await getSpendStatus(sam, cap, cdeps)).count.countedUsdMicros).toBe(0n);
  });

  it('L22: unreconciled October reservations from 23:58:30 count in November; from 23:55:00 they do not; both in October', async () => {
    const sam = await adult('l22');
    await setClock('2034-10-31T10:50:00Z');
    await sweep(sam);
    const big = 10n ** 12n;
    await setClock('2034-10-31T10:55:00Z'); // 23:55:00 NZDT
    const early = uuid();
    await reserveAttempt(
      sam,
      { attemptId: early, tier: 'fast', reservedUsdMicros: 1_111n, capUsdMicros: big },
      cdeps,
    );
    await setClock('2034-10-31T10:58:30Z'); // 23:58:30 NZDT
    const late = uuid();
    await reserveAttempt(
      sam,
      { attemptId: late, tier: 'fast', reservedUsdMicros: 2_222n, capUsdMicros: big },
      cdeps,
    );
    await setClock('2034-10-31T11:02:00Z'); // 1 November, 00:02 NZDT: both swept
    await sweep(sam);
    expect((await reservationRow(early))[0]?.status).toBe('unreconciled');
    expect((await reservationRow(late))[0]?.status).toBe('unreconciled');
    const nov = await getSpendStatus(sam, big, cdeps);
    expect(nov.count.unreconciledUsdMicros).toBe(2_222n);
    await setClock('2034-10-31T10:59:00Z');
    const oct = await getSpendStatus(sam, big, cdeps);
    expect(oct.count.unreconciledUsdMicros).toBe(3_333n);
  });
});

describe('concurrency (L14, L15) and the database clock (L28)', () => {
  it('L14: both adults reserving at the same instant with room for one: exactly one inserted, every time', async () => {
    const sam = await adult('l14-sam');
    const alex = await adult('l14-alex');
    await setClock('2035-01-10T00:00:00Z');
    await sweep(sam);
    const R = attemptReservation('fast');
    for (let round = 0; round < 10; round++) {
      const before = (await getSpendStatus(sam, 0n, cdeps)).count.countedUsdMicros;
      const cap = before + R + R - 1n; // room for one more, not two
      const results = await Promise.all(
        [sam, alex].map((who) =>
          reserveAttempt(
            who,
            { attemptId: uuid(), tier: 'fast', reservedUsdMicros: R, capUsdMicros: cap },
            cdeps,
          ),
        ),
      );
      expect(
        results.filter((r) => r.ok),
        `round ${round}`,
      ).toHaveLength(1);
      expect(results.filter((r) => !r.ok)[0]).toMatchObject({ code: 'cap_reached' });
      const after = (await getSpendStatus(sam, cap, cdeps)).count.countedUsdMicros;
      expect(after).toBe(before + R);
      expect(after).toBeLessThanOrEqual(cap);
    }
  });

  it('L15: fifty concurrent reservations against a month near the cap never pass it', async () => {
    const adults = await Promise.all(Array.from({ length: 5 }, (_, i) => adult(`l15-${i}`)));
    await setClock('2035-02-10T00:00:00Z');
    await sweep(adults[0]!);
    const settled = uuid();
    const pre = await reserveAttempt(
      adults[0]!,
      { attemptId: settled, tier: 'fast', reservedUsdMicros: 1n, capUsdMicros: 10n ** 12n },
      cdeps,
    );
    if (!pre.ok) throw new Error('pre');
    await settleAttempt(
      adults[0]!,
      { attemptId: settled, conversationId: null, calls: [call(123_457n)] },
      cdeps,
    );
    const R = attemptReservation('fast');
    const cap = 123_457n + 10n * R + R / 2n; // room for ten and a half
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        reserveAttempt(
          adults[i % 5]!,
          { attemptId: uuid(), tier: 'fast', reservedUsdMicros: R, capUsdMicros: cap },
          cdeps,
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(
      results.filter((r) => !r.ok).every((r) => (r as { code: string }).code === 'cap_reached'),
    ).toBe(true);
    const status = await getSpendStatus(adults[0]!, cap, cdeps);
    expect(status.count.countedUsdMicros).toBe(123_457n + 10n * R);
    expect(status.count.countedUsdMicros).toBeLessThanOrEqual(cap);
    // Leave nothing open in this month.
    for (const r of results)
      if (r.ok)
        await settleAttempt(
          adults.find((a) => a.userId === r.reservation.userId)!,
          { attemptId: r.reservation.attemptId, conversationId: null, calls: [] },
          cdeps,
        );
  });

  it('L28: with the application’s clock a day ahead or behind, created_at, closed_at and at are the database’s', async () => {
    await setClock(null);
    const sam = await adult('l28');
    for (const offset of [86_400_000, -86_400_000]) {
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + offset });
      try {
        const attemptId = uuid();
        const r = await reserveAttempt(
          sam,
          { attemptId, tier: 'fast', reservedUsdMicros: 1n, capUsdMicros: 10n ** 15n },
          deps,
        );
        expect(r.ok).toBe(true);
        await settleAttempt(sam, { attemptId, conversationId: null, calls: [call(1n)] }, deps);
        const check = await admin.db.execute<{ ok: boolean }>(sql`
          select (abs(extract(epoch from (r.created_at - now()))) < 60
              and abs(extract(epoch from (r.closed_at - now()))) < 60
              and abs(extract(epoch from (u.at - now()))) < 60
              and r.period = date_trunc('month', r.created_at at time zone ${env.HOME_TIMEZONE})::date) as ok
          from kev_budget_reservation r join kev_usage u on u.attempt_id = r.attempt_id
          where r.attempt_id = ${attemptId}`);
        expect(check.rows[0]?.ok).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    }
  });
});

describe('L20, L16: no transaction is held while the model runs; every call is settled', () => {
  it('a test provider sees no checked-out connection and no open transaction while it runs', async () => {
    await setClock(null);
    const sam = await adult('l20');
    const pool = new Pool({ connectionString: assertTestDatabase(TEST_APP_DATABASE_URL), max: 4 });
    const d = { db: drizzle(pool, { schema, casing: 'snake_case' }) };
    const probes: { checkedOut: number; inTx: number }[] = [];
    try {
      const attemptId = uuid();
      const r = await reserveAttempt(
        sam,
        {
          attemptId,
          tier: 'fast',
          reservedUsdMicros: attemptReservation('fast'),
          capUsdMicros: 10n ** 15n,
        },
        d,
      );
      if (!r.ok) throw new Error(r.code);
      const provider = createScriptedProvider(
        [
          {
            kind: 'answer',
            toolUses: [{ name: 'get_today', input: {} }],
            usage: { inputTokens: 4_100, outputTokens: 450, cacheWriteTokens: 5_000 },
          },
          {
            kind: 'error',
            code: 'unreachable',
            partialUsage: { inputTokens: 900, outputTokens: 12 },
          },
          { kind: 'error', code: 'timeout', partialUsage: null },
        ],
        {
          onCall: async () => {
            const inTx = await admin.db.execute<{
              n: number;
            }>(sql`select count(*)::int as n from pg_stat_activity
              where usename = 'home_app' and state like 'idle in transaction%'`);
            probes.push({
              checkedOut: pool.totalCount - pool.idleCount,
              inTx: inTx.rows[0]?.n ?? -1,
            });
          },
        },
        {},
      );
      const budget = TurnBudget.open(r.reservation, { deadline: Date.now() + 55_000 });
      const req = {
        tier: 'fast' as const,
        system: 's',
        tools: [],
        toolChoice: 'auto' as const,
        messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'q' }] }],
      };
      await provider.run(req, { budget });
      await provider.run(req, { budget }).catch(() => undefined);
      await provider.run(req, { budget }).catch(() => undefined);
      expect(probes).toEqual(Array(3).fill({ checkedOut: 0, inTx: 0 }));
      // Settlement records every call: known, partial (aborted mid-stream), unknown (L16).
      const s = await settleAttempt(
        sam,
        {
          attemptId,
          conversationId: null,
          calls: budget.calls.map((c) => ({
            tier: c.tier,
            model: c.model,
            inputTokens: c.usage?.inputTokens ?? 0,
            outputTokens: c.usage?.outputTokens ?? 0,
            cacheReadTokens: c.usage?.cacheReadTokens ?? 0,
            cacheWriteTokens: c.usage?.cacheWriteTokens ?? 0,
            costUsdMicros: c.costUsdMicros,
            escalated: false,
          })),
        },
        d,
      );
      // The aborted call's reported tokens are kept (900 input), but it ended
      // without the provider's final usage, so it is charged at the per-call
      // maximum, never the 2,112 µ$ its partial tokens would price at (I2).
      expect(budget.calls.map((c) => c.stop)).toEqual(['tool_use', 'partial', 'error']);
      expect(s).toEqual({ ok: true, late: false, settledUsdMicros: 27_720n + 133_056n + 133_056n });
      expect((await usageRows(attemptId)).map((u) => `${u.cost}:${u.input_tokens}`).sort()).toEqual(
        ['133056:0', '133056:900', '27720:4100'],
      );
      expect(budget.canCall(Date.now())).toEqual({ ok: false, reason: 'reservation_closed' });
    } finally {
      await pool.end();
    }
  });

  it('a database failure at reserve: no reservation, so no budget and no provider call', async () => {
    const sam = await adult('dbfail');
    const broken = new Pool({
      connectionString: 'postgres://home_app:wrong@localhost:5432/home_test',
      max: 1,
    });
    try {
      await expect(
        reserveAttempt(
          sam,
          { attemptId: uuid(), tier: 'fast', reservedUsdMicros: 1n, capUsdMicros: 10n },
          { db: drizzle(broken, { schema, casing: 'snake_case' }) },
        ),
      ).rejects.toThrow();
    } finally {
      await broken.end();
    }
    expect(() =>
      TurnBudget.open(
        {
          reservationId: uuid(),
          attemptId: uuid(),
          userId: sam.userId,
          tier: 'fast',
          reservedUsdMicros: 1n,
        },
        { deadline: Date.now() + 55_000 },
      ),
    ).toThrow(/live reservation/);
  });
});

describe('S13, S16: audit rows and the export', () => {
  it('bookkeeping audit rows are the adult’s own, structural, with no text, model name or cost', async () => {
    await setClock(null);
    const sam = await adult('s16');
    const alex = await adult('s16-other');
    await recordUserMessage(sam, { text: 'canary-question-s16' }, deps);
    await recordKevMessage(
      sam,
      { content: kevAnswer(uuid()), tier: 'deep', model: TIERS.deep.model.id },
      deps,
    );
    const attemptId = uuid();
    await reserveAttempt(
      sam,
      { attemptId, tier: 'fast', reservedUsdMicros: 5n, capUsdMicros: 10n ** 15n },
      deps,
    );
    await settleAttempt(sam, { attemptId, conversationId: null, calls: [call(424_242n)] }, deps);
    await clearConversation(sam, deps);
    const rows = await admin.db.execute<{
      event: string;
      meta: Record<string, unknown> | null;
      visibility: string;
      visible_to_user_id: string | null;
      actor_via: string;
    }>(
      sql`select event, meta, visibility, visible_to_user_id, actor_via from audit_log where actor_user_id = ${sam.userId}`,
    );
    expect(rows.rows.map((r) => r.event).sort()).toEqual(
      [
        'conversation.clear',
        'conversation.start',
        'kev_budget.reserve',
        'kev_usage.record',
        'message.add',
        'message.add',
      ].sort(),
    );
    for (const r of rows.rows) {
      expect(r).toMatchObject({
        visibility: 'private',
        visible_to_user_id: sam.userId,
        actor_via: 'kev',
      });
      for (const k of Object.keys(r.meta ?? {}))
        expect(['role', 'tier', 'count', 'calls']).toContain(k);
      const text = JSON.stringify(r.meta);
      for (const s of ['canary-question-s16', 'claude', '424242', 'cost', 'model'])
        expect(text).not.toContain(s);
    }
    const alexSees = (await listAudit(asUi(alex), { limit: 200 }, deps)).rows;
    expect(alexSees.filter((r) => rows.rows.some(() => r.actorUserId === sam.userId))).toEqual([]);
    const samSees = (await listAudit(asUi(sam), { limit: 200 }, deps)).rows.map((r) => r.event);
    expect(samSees).toEqual(expect.arrayContaining(['kev_budget.reserve', 'kev_usage.record']));
  });

  it('the export carries v2 messages and kevUsage’s attemptId; never a reservation', async () => {
    const sam = await adult('export');
    await recordUserMessage(sam, { text: 'export question' }, deps);
    await recordKevMessage(sam, { content: kevAnswer(uuid()), tier: 'fast', model: 'm' }, deps);
    const attemptId = uuid();
    await reserveAttempt(
      sam,
      { attemptId, tier: 'fast', reservedUsdMicros: 5n, capUsdMicros: 10n ** 15n },
      deps,
    );
    await settleAttempt(sam, { attemptId, conversationId: null, calls: [call(5n)] }, deps);
    const e = await exportFor(asUi(sam), {}, deps);
    expect(e.version).toBe(3);
    expect(e.records.messages.map((m) => (m.content as { v: number }).v)).toEqual([2, 2]);
    expect(e.records.kevUsage.map((u) => u.attemptId)).toContain(attemptId);
    // The reservation table is never a record type (its Activity rows name it as their subject only).
    expect(Object.keys(e.records)).not.toContain('kevBudgetReservations');
    expect(
      JSON.stringify(e, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
    ).not.toMatch(/reserved_?usd/i);
  });
});
