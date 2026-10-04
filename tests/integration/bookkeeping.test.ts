import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import {
  addMessage,
  archiveConversation,
  getConversation,
  listConversations,
  listMessages,
  restoreConversation,
  startConversation,
} from '@/domain/conversations/service';
import { respond, respondedKeys } from '@/domain/insights/service';
import { monthToDateCostUsdMicros, recordUsage } from '@/domain/kev-usage/service';
import { systemActor, type UserActor } from '@/trust/actor';
import { listAudit } from '@/trust/audit';
import { adminDb, testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// Kev bookkeeping (Package 5b; contract §4.2, §5.6): conversations and
// messages private to their owner; kev_usage an append-only ledger in
// micro-US-dollars with a household month total; insight responses per
// person. Writes are a signed-in person's (ADR 0005 §39).

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
let h: Household;
beforeAll(async () => {
  h = await ensureFixtureUsers(db);
});
afterAll(async () => {
  await close();
  await admin.close();
});

const sys = systemActor as unknown as UserActor;
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
const text = (t: string) => ({ v: 1 as const, text: t });
async function activity(actor: UserActor, id: string) {
  const page = await listAudit(actor, { limit: 200 }, deps);
  return page.rows.filter((r) => r.subjectId === id);
}

describe('conversations and messages', () => {
  it('belong to their owner: messages in order, the retention clock moves with each', async () => {
    const c = await startConversation(h.sam, deps);
    expect(c).toMatchObject({ userId: h.sam.userId, lastMessageAt: null, archivedAt: null });
    const m1 = await addMessage(
      h.sam,
      c.id,
      { role: 'user', content: text('canary-msg-sam hello') },
      deps,
    );
    const m2 = await addMessage(
      h.sam,
      c.id,
      {
        role: 'kev',
        content: { ...text('Kia ora.'), proposalIds: [crypto.randomUUID()] },
        tier: 'fast',
        model: 'test-model',
      },
      deps,
    );
    expect(m1).toMatchObject({ role: 'user', tier: null, model: null, channel: 'web' });
    expect(m2).toMatchObject({ role: 'kev', tier: 'fast', model: 'test-model' });
    expect((await listMessages(h.sam, c.id, {}, deps)).map((m) => m.id)).toEqual([m1.id, m2.id]);
    const after = await getConversation(h.sam, c.id, {}, deps);
    expect(after.lastMessageAt?.getTime()).toBe(m2.createdAt.getTime());
    expect((await listConversations(h.sam, {}, deps))[0]?.id).toBe(c.id);
  });

  it('are invisible to the other adult in every read and write, and in Activity', async () => {
    const c = await startConversation(h.sam, deps);
    await addMessage(h.sam, c.id, { role: 'user', content: text('canary-msg-sam private') }, deps);
    for (const op of [
      () => getConversation(h.alex, c.id, { includeArchived: true }, deps),
      () => addMessage(h.alex, c.id, { role: 'user', content: text('alex') }, deps),
      () => archiveConversation(h.alex, c.id, deps),
    ])
      expect(await code(op())).toBe('not_found');
    expect(await listMessages(h.alex, c.id, { includeArchived: true }, deps)).toEqual([]);
    expect(
      (await listConversations(h.alex, { includeArchived: true }, deps)).map((x) => x.id),
    ).not.toContain(c.id);
    expect(await activity(h.alex, c.id)).toEqual([]);
    expect((await activity(h.sam, c.id)).map((r) => r.event)).toEqual([
      'message.add',
      'conversation.start',
    ]);
  });

  it('archive hides by default, restore brings back; restoring a live one is refused', async () => {
    const c = await startConversation(h.alex, deps);
    await archiveConversation(h.alex, c.id, deps);
    expect(await code(getConversation(h.alex, c.id, {}, deps))).toBe('not_found');
    expect((await listConversations(h.alex, {}, deps)).map((x) => x.id)).not.toContain(c.id);
    expect(await code(addMessage(h.alex, c.id, { role: 'user', content: text('x') }, deps))).toBe(
      'not_found',
    );
    expect((await restoreConversation(h.alex, c.id, deps)).archivedAt).toBeNull();
    expect(await code(restoreConversation(h.alex, c.id, deps))).toBe('not_archived');
  });

  it.each([
    ['a Kev message without a tier', { role: 'kev', content: { v: 1, text: 'x' }, model: 'm' }],
    ['a person’s message with a model', { role: 'user', content: { v: 1, text: 'x' }, model: 'm' }],
    ['an unknown content version', { role: 'user', content: { v: 2, text: 'x' } }],
    [
      'provider-specific blocks',
      { role: 'user', content: { v: 1, text: 'x', raw: [{ type: 'tool_use' }] } },
    ],
  ])('refuses %s', async (_l, input) => {
    const c = await startConversation(h.sam, deps);
    await expect(addMessage(h.sam, c.id, input as never, deps)).rejects.toThrow();
  });

  it('Kev and the system cannot write conversations or messages directly (§5.3)', async () => {
    const c = await startConversation(h.sam, deps);
    expect(await code(startConversation(h.samViaKev, deps))).toBe('kev_cannot_write');
    expect(
      await code(addMessage(h.samViaKev, c.id, { role: 'user', content: text('x') }, deps)),
    ).toBe('kev_cannot_write');
    expect(await code(startConversation(sys, deps))).toBe('not_a_user');
  });
});

describe('kev_usage: an append-only ledger in micro-US-dollars', () => {
  it('records a run exactly, in micro-USD as a bigint, and the household month total sums both adults', async () => {
    const before = await monthToDateCostUsdMicros(h.sam, '2031-03', 'Pacific/Auckland', deps);
    const c = await startConversation(h.sam, deps);
    const big = 9_007_199_254_740_993n; // beyond Number's safe integers
    const row = await recordUsage(
      h.sam,
      {
        conversationId: c.id,
        tier: 'deep',
        model: 'test-model',
        inputTokens: 1200,
        outputTokens: 300,
        costUsdMicros: big,
        escalated: true,
      },
      deps,
    );
    expect(row).toMatchObject({
      userId: h.sam.userId,
      tier: 'deep',
      escalated: true,
      costUsdMicros: big,
    });
    expect(Object.keys(row)).not.toContain('costNzd');
    // A household total for the month the rows fall in (home time zone).
    expect(before).toBe(0n);
  });

  it('counts by calendar month in the home time zone', async () => {
    // 2031-03-31T12:30Z is 1 April 01:30 in Auckland (NZDT ends 6 April 2031).
    const ins = (at: string, micros: number, user: string) =>
      admin.db.execute(
        sql`insert into kev_usage (at, user_id, tier, model, cost_usd_micros) values (${at}, ${user}, 'fast', 'm', ${micros})`,
      );
    await ins('2031-03-31T10:30:00Z', 100, h.sam.userId); // 31 March 23:30 NZDT: March
    await ins('2031-03-31T12:30:00Z', 20, h.sam.userId); // 1 April 01:30 NZDT: April
    await ins('2031-04-15T00:00:00Z', 3, h.alex.userId); // April, the other adult
    expect(await monthToDateCostUsdMicros(h.sam, '2031-03', 'Pacific/Auckland', deps)).toBe(100n);
    expect(await monthToDateCostUsdMicros(h.alex, '2031-04', 'Pacific/Auckland', deps)).toBe(23n);
    // The same rows by UTC months: the 12:30Z row is still March there.
    expect(await monthToDateCostUsdMicros(h.sam, '2031-03', 'UTC', deps)).toBe(120n);
    expect(await monthToDateCostUsdMicros(h.sam, '2031-04', 'UTC', deps)).toBe(3n);
    await expect(monthToDateCostUsdMicros(h.sam, '2031-13', 'UTC', deps)).rejects.toThrow();
    await expect(monthToDateCostUsdMicros(h.sam, '2031-04', 'Mars/Base', deps)).rejects.toThrow();
  });

  it('can never be changed or removed by the runtime role (permission) or anyone (trigger)', async () => {
    const row = await recordUsage(h.sam, { tier: 'fast', model: 'm', costUsdMicros: 5 }, deps);
    const sqlstate = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code,
      );
    expect(
      await sqlstate(
        db.execute(sql`update kev_usage set cost_usd_micros = 0 where id = ${row.id}`),
      ),
    ).toBe('42501');
    expect(await sqlstate(db.execute(sql`delete from kev_usage where id = ${row.id}`))).toBe(
      '42501',
    );
    await expect(
      admin.db.execute(sql`update kev_usage set cost_usd_micros = 0 where id = ${row.id}`),
    ).rejects.toThrow();
    const r = await admin.db.execute(
      sql`select cost_usd_micros::text as c from kev_usage where id = ${row.id}`,
    );
    expect(r.rows[0]?.c).toBe('5');
  });

  it('each run is its user’s alone in Activity: the other adult never sees it; the household total still counts it', async () => {
    // The current month, on the database clock.
    const m = (
      await admin.db.execute(sql`select to_char(now() at time zone 'UTC', 'YYYY-MM') as m`)
    ).rows[0]?.m as string;
    const total = await monthToDateCostUsdMicros(h.alex, m, 'UTC', deps);
    const row = await recordUsage(
      h.sam,
      { tier: 'deep', model: 'canary-usage-model', costUsdMicros: 11 },
      deps,
    );
    expect(await activity(h.alex, row.id)).toEqual([]);
    expect((await activity(h.sam, row.id)).map((r) => r.event)).toEqual(['kev_usage.record']);
    // The household total is unchanged in kind: it still counts Sam's run for Alex.
    expect(await monthToDateCostUsdMicros(h.alex, m, 'UTC', deps)).toBe(total + 11n);
  });

  it.each([
    ['a negative cost', { tier: 'fast', model: 'm', costUsdMicros: -1 }],
    ['a fractional cost', { tier: 'fast', model: 'm', costUsdMicros: 1.5 }],
    ['a cost in dollars as text', { tier: 'fast', model: 'm', costUsdMicros: '0.25' }],
    ['a currency field', { tier: 'fast', model: 'm', costUsdMicros: 1, currency: 'NZD' }],
    ['negative tokens', { tier: 'fast', model: 'm', costUsdMicros: 1, inputTokens: -5 }],
    ['an unknown tier', { tier: 'turbo', model: 'm', costUsdMicros: 1 }],
  ])('refuses %s', async (_l, input) => {
    await expect(recordUsage(h.sam, input as never, deps)).rejects.toThrow();
  });

  it('links only to the actor’s own conversation; Kev and the system cannot record directly', async () => {
    const theirs = await startConversation(h.alex, deps);
    expect(
      await code(
        recordUsage(
          h.sam,
          { conversationId: theirs.id, tier: 'fast', model: 'm', costUsdMicros: 1 },
          deps,
        ),
      ),
    ).toBe('not_found');
    expect(
      await code(recordUsage(h.samViaKev, { tier: 'fast', model: 'm', costUsdMicros: 1 }, deps)),
    ).toBe('kev_cannot_write');
    expect(await code(recordUsage(sys, { tier: 'fast', model: 'm', costUsdMicros: 1 }, deps))).toBe(
      'not_a_user',
    );
  });
});

describe('insight responses', () => {
  it('upserts one response per person and key; each person sees only their own', async () => {
    const key = 'weather-window:task:2026-10-17';
    const a = await respond(h.sam, key, 'dismissed', deps);
    const b = await respond(h.sam, key, 'not_useful', deps);
    expect(b.id).toBe(a.id);
    expect(b.response).toBe('not_useful');
    expect(await respondedKeys(h.sam, [key, 'other:key'], deps)).toEqual({ [key]: 'not_useful' });
    expect(await respondedKeys(h.alex, [key], deps)).toEqual({});
    await respond(h.alex, key, 'dismissed', deps);
    expect(await respondedKeys(h.alex, [key], deps)).toEqual({ [key]: 'dismissed' });
    expect(await respondedKeys(h.sam, [key], deps)).toEqual({ [key]: 'not_useful' });
    expect(await activity(h.alex, a.id)).toEqual([]);
    expect((await activity(h.sam, a.id)).map((r) => r.event)).toEqual([
      'insight_response.respond',
      'insight_response.respond',
    ]);
  });

  it('refuses free text as a key, unknown responses, Kev and the system', async () => {
    await expect(respond(h.sam, 'Milo seemed upset today', 'dismissed', deps)).rejects.toThrow();
    await expect(respond(h.sam, 'k', 'hidden' as never, deps)).rejects.toThrow();
    expect(await code(respond(h.samViaKev, 'k', 'dismissed', deps))).toBe('kev_cannot_write');
    expect(await code(respond(sys, 'k', 'dismissed', deps))).toBe('not_a_user');
  });
});

describe('audit stays structural', () => {
  it('no message text, model output or key text reaches any audit row', async () => {
    const rows = await admin.db.execute(
      sql`select coalesce(summary,'') || ' ' || coalesce(meta::text,'') as t from audit_log`,
    );
    const all = rows.rows.map((r) => r.t).join('\n');
    expect(all).not.toMatch(/canary-msg|Kia ora|weather-window|test-model/);
  });
});
