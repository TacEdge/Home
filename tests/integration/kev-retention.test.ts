import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { authorised } from '@/app/kev/retention/authorised';
import { GET, POST } from '@/app/kev/retention/route';
import { captureVerbatim } from '@/domain/captures/service';
import { PURGE_BATCH_ROWS } from '@/domain/kev-bookkeeping/constants';
import { purgeExpiredMessages } from '@/domain/kev-bookkeeping/service';
import { log } from '@/lib/log';
import { systemActor } from '@/trust/actor';
import { listAudit } from '@/trust/audit';
import { adminDb, testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// The daily retention cleanup route (M8 contract §7.2, O6, D13; matrix rows
// C19–C23, and §15.1's "retention route" unit points: the constant-time
// secret check, the 404 without CRON_SECRET, the batch bounds). As home_app,
// on synthetic messages only. No schedule is configured: G18 is NOT
// VERIFIED, so vercel.json has no `crons` entry (a test below holds that).

const { db, close } = testDb();
const admin = adminDb();
let h: Household;
const SECRET = 'test-only-not-a-real-cron-value';
const saved = process.env.CRON_SECRET;

const request = (method: 'GET' | 'POST', auth?: string) =>
  new Request('http://localhost/kev/retention', {
    method,
    headers: auth === undefined ? {} : { authorization: auth },
  });
const count = async (where = sql`true`) =>
  Number(
    (
      await admin.db.execute<{ n: number }>(
        sql`select count(*)::int as n from message where ${where}`,
      )
    ).rows[0]!.n,
  );
const expired = sql`created_at < now() - interval '90 days'`;

async function conversationOf(userId: string): Promise<string> {
  const r = await admin.db.execute<{ id: string }>(
    sql`insert into conversation (user_id) values (${userId}) returning id`,
  );
  return r.rows[0]!.id;
}
/** `n` synthetic messages, `days` old, in a conversation. */
async function plant(conversationId: string, n: number, days: number): Promise<void> {
  await admin.db.execute(sql`
    insert into message (conversation_id, role, channel, content, created_at)
    select ${conversationId}::uuid, 'user', 'web', '{"v":2,"text":"synthetic"}'::jsonb,
           now() - make_interval(days => ${days}) - make_interval(secs => g)
      from generate_series(1, ${n}) g`);
}

beforeAll(async () => {
  h = await ensureFixtureUsers(db);
  await admin.db.execute(sql`delete from message`);
});
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
  vi.restoreAllMocks();
});
afterAll(async () => {
  await admin.db.execute(sql`delete from message`);
  await close();
  await admin.close();
});

describe('C20: the secret', () => {
  it('without the header, or with a wrong one: 401 and nothing deleted; CRON_SECRET unset: 404', async () => {
    const conv = await conversationOf(h.sam.userId);
    await plant(conv, 3, 95);
    process.env.CRON_SECRET = SECRET;
    for (const auth of [
      undefined,
      '',
      SECRET,
      `Bearer ${SECRET}x`,
      `bearer ${SECRET}`,
      `Bearer  ${SECRET}`,
      'Bearer',
    ])
      for (const m of [GET, POST]) {
        const res = await m(request('GET', auth));
        expect(res.status, String(auth)).toBe(401);
      }
    expect(await count(expired)).toBe(3);
    delete process.env.CRON_SECRET;
    expect((await GET(request('GET', `Bearer ${SECRET}`))).status).toBe(404);
    process.env.CRON_SECRET = 'short';
    expect((await GET(request('GET', 'Bearer short'))).status).toBe(404);
    expect(await count(expired)).toBe(3);
    await admin.db.execute(sql`delete from message`);
  });

  it('the check is exact and constant-time (both sides hashed; any length)', () => {
    expect(authorised(`Bearer ${SECRET}`, SECRET)).toBe(true);
    for (const wrong of [
      null,
      '',
      `Bearer ${SECRET} `,
      `Bearer ${SECRET.slice(0, -1)}`,
      `Basic ${SECRET}`,
      'x'.repeat(10_000),
    ])
      expect(authorised(wrong, SECRET)).toBe(false);
  });
});

describe('C19, C22: a run deletes every adult’s expired messages in bounded batches and touches nothing else', () => {
  it('2,500 expired messages for both adults: batches of at most 1,000; one log line and one system audit row, counts only, in neither adult’s Activity; no provider, no other table', async () => {
    const sam = await conversationOf(h.sam.userId);
    const alex = await conversationOf(h.alex.userId);
    await plant(sam, 1_500, 91);
    await plant(alex, 1_000, 120);
    await plant(sam, 5, 89); // kept
    process.env.CRON_SECRET = SECRET;
    const info = vi.spyOn(log, 'info');
    const seen: string[] = [];
    const query = Client.prototype.query;
    vi.spyOn(Client.prototype, 'query').mockImplementation(function (
      this: Client,
      ...args: unknown[]
    ) {
      const q = args[0] as string | { text?: string };
      seen.push(typeof q === 'string' ? q : (q?.text ?? ''));
      return (query as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (() => {
      fetched++;
      throw new Error('no network');
    }) as typeof fetch;
    const httpsSpy = vi.spyOn(https, 'request');
    const httpSpy = vi.spyOn(http, 'request');
    let res: Response;
    try {
      res = await GET(request('GET', `Bearer ${SECRET}`));
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2_500, batches: 3 });
    expect(await count(expired)).toBe(0);
    expect(await count()).toBe(5);
    // One log line, counts only.
    expect(info.mock.calls.filter((c) => c[0] === 'kev_retention')).toEqual([
      ['kev_retention', { deleted: 2_500, batches: 3 }],
    ]);
    // C22: no provider, no network at all; no table but `message` and the audit insert.
    expect(fetched).toBe(0);
    expect(httpsSpy).not.toHaveBeenCalled();
    expect(httpSpy).not.toHaveBeenCalled();
    const statements = seen.filter(
      (s) => !/^(begin|commit|rollback|set |select set_config)/i.test(s.trim()),
    );
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      const tables = [...s.matchAll(/\b(?:from|into|update|join)\s+"?([a-z_]+)"?/gi)].map((m) =>
        m[1]!.toLowerCase(),
      );
      for (const t of tables) expect(['message', 'audit_log'], s).toContain(t);
      expect(s, 'never reads message content').not.toMatch(/\bcontent\b/);
    }
    // Batches never exceed 1,000 rows a statement.
    expect(
      seen.filter((s) => /delete from message/i.test(s)).every((s) => s.includes('limit')),
    ).toBe(true);
    // One structural system row, private to no one.
    const rows = await admin.db.execute<{
      meta: unknown;
      actor_user_id: string | null;
      visible_to_user_id: string | null;
    }>(sql`
      select meta, actor_user_id, visible_to_user_id from audit_log where event = 'message.retention_purge' order by at desc limit 1`);
    expect(rows.rows[0]).toEqual({
      meta: { deleted: 2_500, batches: 3 },
      actor_user_id: null,
      visible_to_user_id: null,
    });
    for (const a of [h.sam, h.alex]) {
      const page = await listAudit(a, { limit: 200 }, { db });
      expect(JSON.stringify(page)).not.toContain('retention_purge');
    }
    await admin.db.execute(sql`delete from message`);
  });
});

describe('C21: idempotent, and an interrupted run leaves nothing to repair', () => {
  it('a run interrupted after its first batch: the next deletes the rest; a third finds nothing', async () => {
    const conv = await conversationOf(h.alex.userId);
    await plant(conv, 2_200, 100);
    let statements = 0;
    const interrupted = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'execute')
          return (...args: unknown[]) => {
            if (++statements > 1) throw new Error('synthetic interruption');
            return (target.execute as (...a: unknown[]) => unknown).apply(target, args);
          };
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(
      purgeExpiredMessages(systemActor, { db: interrupted as typeof db }),
    ).rejects.toThrow();
    expect(await count(expired)).toBe(2_200 - PURGE_BATCH_ROWS);
    process.env.CRON_SECRET = SECRET;
    expect(await (await POST(request('POST', `Bearer ${SECRET}`))).json()).toEqual({
      deleted: 1_200,
      batches: 2,
    });
    expect(await (await POST(request('POST', `Bearer ${SECRET}`))).json()).toEqual({
      deleted: 0,
      batches: 1,
    });
    expect(await count(expired)).toBe(0);
  });

  it('a run is bounded: at most 20 statements of 1,000 rows; the rest wait for the next', async () => {
    const conv = await conversationOf(h.sam.userId);
    await plant(conv, 20_050, 95);
    process.env.CRON_SECRET = SECRET;
    expect(await (await GET(request('GET', `Bearer ${SECRET}`))).json()).toEqual({
      deleted: 20_000,
      batches: 20,
    });
    expect(await count(expired)).toBe(50);
    await admin.db.execute(sql`delete from message`);
  }, 60_000);
});

describe('C23: a capture kept from a deleted message', () => {
  it('the capture and its words are unchanged; its message_id becomes null', async () => {
    const conv = await conversationOf(h.sam.userId);
    await admin.db.execute(sql`
      insert into message (conversation_id, role, channel, content, created_at)
      values (${conv}::uuid, 'user', 'web', '{"v":2,"text":"Keep the shed key words"}'::jsonb, now() - interval '91 days')`);
    const [m] = (
      await admin.db.execute<{ id: string }>(
        sql`select id from message where conversation_id = ${conv}::uuid`,
      )
    ).rows;
    const kept = await captureVerbatim(
      h.sam,
      { text: 'Keep the shed key words', messageId: m!.id },
      { db },
    );
    expect(kept.messageId).toBe(m!.id);
    process.env.CRON_SECRET = SECRET;
    await GET(request('GET', `Bearer ${SECRET}`));
    const row = await admin.db.execute(
      sql`select text, message_id from capture where id = ${kept.id}`,
    );
    expect(row.rows[0]).toEqual({ text: 'Keep the shed key words', message_id: null });
  });
});

describe('the schedule (G18) and the job’s reach', () => {
  it('vercel.json has no `crons` entry while G18 is NOT VERIFIED', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as Record<string, unknown>;
    expect(config).not.toHaveProperty('crons');
  });

  it('the route imports nothing of Kev’s, no provider and no other domain service', () => {
    const files = ['src/app/kev/retention/route.ts', 'src/app/kev/retention/authorised.ts'].map(
      (f) => readFileSync(f, 'utf8'),
    );
    for (const src of files) {
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const i of imports)
        expect([
          'node:crypto',
          '@/domain/kev-bookkeeping/service',
          '@/lib/env',
          '@/lib/log',
          '@/trust/actor',
          './authorised',
        ]).toContain(i);
    }
  });
});
