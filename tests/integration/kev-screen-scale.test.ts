import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Conversation } from '@/app/(home)/kev/conversation';
import { byDay, toTurns } from '@/app/(home)/kev/turns';
import { listCalendars } from '@/domain/calendar/service';
import { listKeptMessageIds } from '@/domain/captures/service';
import { listCitedRecords } from '@/domain/citations/service';
import { listConversations, listMessages } from '@/domain/conversations/service';
import { getSpendStatus, getTurnInFlight } from '@/domain/kev-bookkeeping/service';
import type { UserActor } from '@/trust/actor';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { handleTurnRequest } from '@/app/(home)/kev/turn/handle';
import { clearConversation } from '@/domain/kev-bookkeeping/service';
import { localScript } from '@/kev/evals/local';
import { createScriptedProvider } from '@/kev/providers/scripted';
import { clockedPool, dropTestClock } from './clock';
import { adminDb, testDb } from './db';
import { clockTo, createTickingClock } from './kev-turn-helpers';
import { NOW } from './kev-fixture';
import { buildKevFixture, clearKevFixture, type KevFixture } from './kev-fixture';

// The Kev screen's reads at scale (M8 Package 4; contract §7.2 "loaded a
// week at a time", §15.3 "query counts", the brief's performance items):
// the reads `/kev` makes, and its server render of the conversation, for a
// quiet conversation and for the largest one the limits allow (60 turns a
// day for 90 days; the screen reads a week of it, 420 turns, each answer
// citing five records and carrying a trace). The query count must not grow
// with the conversation; the times are recorded, not asserted (local
// PostgreSQL, a developer's machine). KEV_PERF_OUT keeps the table.
// Synthetic only.

vi.mock('@/app/(home)/kev/actions', () => ({
  keepMessageAction: async () => ({ status: 'idle' }),
  clearConversationAction: async () => ({ status: 'idle' }),
}));

const { db, pool, close } = testDb();
const admin = adminDb();
let f: KevFixture;
let queries = 0;
const send = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof send>) => {
  queries++;
  return send(...args);
}) as typeof pool.query;

const ZONE = 'Pacific/Auckland';
const ui = (a: UserActor): UserActor => ({ ...a, via: 'ui' });

async function seedConversation(userId: string, perDay: number, days: number): Promise<number> {
  await admin.db.execute(sql`delete from conversation where user_id = ${userId}`);
  const [conv] = (
    await admin.db.execute<{ id: string }>(
      sql`insert into conversation (user_id) values (${userId}) returning id`,
    )
  ).rows;
  const cites = [
    { type: 'event', id: f.id.swimming, at: '2026-10-14T15:30:00+13:00' },
    { type: 'event', id: f.id.football, at: '2026-10-17T09:00:00+13:00' },
    { type: 'task', id: f.id.paint },
    { type: 'project', id: f.id.fence },
    { type: 'forecast', id: 'forecast:2026-10-17' },
  ];
  const kev = {
    v: 2,
    outcome: 'answer',
    say: 'Here’s this weekend.',
    blocks: [
      {
        kind: 'fact',
        text: '“Football”: Saturday 17 October, 09:00–10:00. Milo attending.',
        cites: [cites[1]],
      },
      { kind: 'fact', text: 'Saturday 17 October: Looks dry.', cites: [cites[4]] },
    ],
    cites,
    limits: ['gap_limit', 'forecast_credit'],
    forecastAt: '2026-10-14T06:55:00+13:00',
    trace: [
      {
        tool: 'get_agenda',
        ok: true,
        args: { from: '2026-10-17', to: '2026-10-18' },
        resultCount: 1,
        refs: cites.slice(0, 2),
        attemptId: '33333333-3333-4333-8333-333333333333',
      },
    ],
    calls: [],
    escalated: false,
  };
  const n = perDay * days;
  // One statement: n turns, a person's message and Kev's, each minute apart, newest now.
  await admin.db.execute(sql`
    insert into message (conversation_id, role, channel, content, tier, model, created_at)
    select ${conv!.id}, r.role, 'web', r.content::jsonb, r.tier, r.model,
           now() - make_interval(mins => (g.i * ${Math.floor((days * 24 * 60) / n)})) + r.offs
      from generate_series(0, ${n - 1}) as g(i),
           lateral (values
             ('user', ${JSON.stringify({ v: 2, text: 'What have we got this weekend?' })}, null, null, interval '0'),
             ('kev', ${JSON.stringify(kev)}, 'fast', 'synthetic', interval '5 seconds')
           ) as r(role, content, tier, model, offs)`);
  return n;
}

async function screen(actor: UserActor) {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 3_600_000);
  queries = 0;
  const t0 = performance.now();
  const convs = await listConversations(actor, { includeArchived: true }, { db });
  const active = convs.find((c) => c.archivedAt === null)!;
  const [rows, inFlight] = await Promise.all([
    listMessages(actor, active.id, { since }, { db }),
    getTurnInFlight(actor, { db }),
    getSpendStatus(actor, { db }),
  ]);
  const turns = toTurns(rows, inFlight, ZONE);
  const refs = turns.flatMap((t) => (t.kev?.kind === 'v2' ? t.kev.content.cites : []));
  const [cited, kept, calendars] = await Promise.all([
    listCitedRecords(actor, refs, { db }),
    listKeptMessageIds(
      actor,
      turns.flatMap((t) => (t.user ? [t.user.id] : [])),
      { db },
    ),
    listCalendars(actor, { now }, { db }),
  ]);
  const read = performance.now() - t0;
  const q = queries;
  const render = (shown: typeof turns) => {
    const t1 = performance.now();
    const html = renderToStaticMarkup(
      createElement(Conversation, {
        days: byDay(shown),
        today: '2026-10-16',
        ctx: {
          timeZone: ZONE,
          now,
          cited,
          kept,
          calendars: calendars.map((c) => ({
            id: c.id,
            name: c.name,
            lastSyncedAt: c.lastSyncedAt,
          })),
        },
      }),
    );
    return { ms: performance.now() - t1, bytes: Buffer.byteLength(html) };
  };
  // As the page: the latest 100 turns of the week first, the rest on "Show earlier".
  const first = render(turns.slice(-100));
  const whole = render(turns);
  return { turns: turns.length, queries: q, read, first, whole };
}

const savedEnv = { ...process.env };
beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  f = await buildKevFixture(db, admin.db);
});
afterAll(async () => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  for (const a of [f.kev.sam, f.kev.alex])
    await admin.db.execute(sql`delete from conversation where user_id = ${a.userId}`);
  await clearKevFixture(db, admin.db);
  await close();
  await admin.close();
});

describe('the screen’s reads do not grow with the conversation', () => {
  it('a quiet week and the largest conversation the limits allow: equal query counts; a week on screen', async () => {
    const sam = ui(f.kev.sam);
    await seedConversation(sam.userId, 2, 1);
    await screen(sam); // warm
    const small = await screen(sam);
    const total = await seedConversation(sam.userId, 60, 90);
    await screen(sam); // warm
    const large = await screen(sam);
    expect(total).toBe(5_400);
    expect(large.queries).toBe(small.queries);
    // Only the week is read and rendered: at most 60 a day for 7 days.
    expect(large.turns).toBeLessThanOrEqual(60 * 7 + 1);
    expect(large.turns).toBeGreaterThan(400);
    const kib = (b: number) => (b / 1024).toFixed(1);
    const table = [
      '| Conversation | Turns in the week | Queries | Reads (ms) | First view: render (ms), HTML (KiB) | Whole week ("Show earlier"): render (ms), HTML (KiB) |',
      '|---|---|---|---|---|---|',
      `| quiet (2 turns) | ${small.turns} | ${small.queries} | ${small.read.toFixed(1)} | ${small.first.ms.toFixed(1)}, ${kib(small.first.bytes)} | ${small.whole.ms.toFixed(1)}, ${kib(small.whole.bytes)} |`,
      `| largest (5,400 turns over 90 days) | ${large.turns} | ${large.queries} | ${large.read.toFixed(1)} | ${large.first.ms.toFixed(1)}, ${kib(large.first.bytes)} | ${large.whole.ms.toFixed(1)}, ${kib(large.whole.bytes)} |`,
    ].join('\n');
    if (process.env.KEV_PERF_OUT) writeFileSync(process.env.KEV_PERF_OUT, table + '\n');
  });
});

describe('the turn route, measured with the scripted provider (not model latency)', () => {
  it(
    'time to the first working event and to the checked answer, six turns (the per-minute limit)',
    { timeout: 60_000 },
    async () => {
      const sam = f.kev.sam;
      await admin.db.execute(sql`delete from conversation where user_id = ${sam.userId}`);
      // The turns' bookkeeping runs on a ticking database clock in a month
      // no other suite uses (2044), so the per-adult limits count only these
      // six turns, not other suites' turns as the same adult in the same run.
      await createTickingClock(admin);
      await clockTo(admin, '2044-03-01T00:00:00Z');
      const { pool: clockedHandle, db: clocked } = clockedPool(10);
      try {
        const first: number[] = [];
        const answered: number[] = [];
        const pending: Promise<unknown>[] = [];
        for (let i = 0; i < 6; i++) {
          await clearConversation(sam, { db: clocked });
          const l = localScript('What’s happening today?', { now: NOW, timeZone: ZONE });
          const t0 = performance.now();
          const res = await handleTurnRequest(
            new Request('http://localhost:3000/kev/turn', {
              method: 'POST',
              headers: {
                host: 'localhost:3000',
                origin: 'http://localhost:3000',
                'content-type': 'application/json',
              },
              body: JSON.stringify({ text: 'What’s happening today?' }),
            }),
            {
              getActor: async () => ({ ...sam, via: 'ui' }),
              now: async () => NOW,
              after: (t) => void pending.push(t),
              db: clocked,
              provider: createScriptedProvider(l.script),
            },
          );
          const reader = res.body!.getReader();
          const dec = new TextDecoder();
          let text = '';
          let sawWorking = false;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            text += dec.decode(value, { stream: true });
            if (!sawWorking && text.includes('event: working')) {
              first.push(performance.now() - t0);
              sawWorking = true;
            }
          }
          answered.push(performance.now() - t0);
          expect(text).toContain('event: answer');
          await Promise.all(pending.splice(0));
          await new Promise((r) => setTimeout(r, 1_100));
        }
        const p = (xs: number[], q: number) =>
          [...xs].sort((a, b) => a - b)[Math.ceil(q * xs.length) - 1]!;
        const line = `| scripted turn, "What’s happening today?" (local PostgreSQL) | ${p(first, 0.5).toFixed(1)} / ${p(first, 0.95).toFixed(1)} | ${p(answered, 0.5).toFixed(1)} / ${p(answered, 0.95).toFixed(1)} |`;
        if (process.env.KEV_PERF_OUT)
          writeFileSync(
            process.env.KEV_PERF_OUT,
            `\n| Turn | First working, p50 / p95 (ms) | Checked answer, p50 / p95 (ms) |\n|---|---|---|\n${line}\n`,
            { flag: 'a' },
          );
      } finally {
        await clockedHandle.end();
        await dropTestClock(admin);
      }
    },
  );
});
