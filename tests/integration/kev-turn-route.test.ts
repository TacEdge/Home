import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleTurnRequest,
  MAX_BODY_BYTES,
  type TurnRouteDeps,
} from '@/app/(home)/kev/turn/handle';
import { toTurns } from '@/app/(home)/kev/turns';
import { captureVerbatim, listKeptMessageIds } from '@/domain/captures/service';
import { listCitedRecords } from '@/domain/citations/service';
import { listConversations, listMessages } from '@/domain/conversations/service';
import { archiveEvent, createEvent, updateEvent } from '@/domain/events/service';
import {
  clearConversation,
  getOwnQuestionsThisMonth,
  getSpendStatus,
  getTurnInFlight,
} from '@/domain/kev-bookkeeping/service';
import { DECLINE_TEXT, ERROR_TEXT, ESCALATED_TEXT, WORKING_TEXT } from '@/kev/answer/language';
import { localScript } from '@/kev/evals/local';
import { createScriptedProvider, type ScriptEntry } from '@/kev/providers/scripted';
import type { Ref } from '@/kev/tools/types';
import type { UserActor } from '@/trust/actor';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { clockedPool, dropTestClock } from './clock';
import { adminDb, testDb } from './db';
import {
  at,
  buildKevFixture,
  clearKevFixture,
  NOW,
  SAT,
  SUN,
  writeForecast,
  type KevFixture,
} from './kev-fixture';
import {
  answer,
  clockForward,
  clockTo,
  createTickingClock,
  decline,
  messagesOf,
  plain,
  tools,
} from './kev-turn-helpers';

// POST /kev/turn, the Kev screen's channel adapter (M8 contract §9.6, §11.4;
// D17; matrix rows S8, S9, U3, U8's server half, U10 and U15's local half
// (G4: a client disconnect does not stop the turn), C14, L13 through the
// route, and the screen's reads: the two-adult boundary (U13), citations
// re-read as the reader (newly private, archived), Keep in To sort once, and
// no model input in any log line. As home_app, with the scripted provider:
// no live provider, no key. Synthetic only. Bookkeeping runs on a database
// clock of the suite's own (2043), ticking.

const { db, close } = testDb();
const admin = adminDb();
const { pool: clockedHandle, db: clocked } = clockedPool();
let f: KevFixture;
const savedEnv = { ...process.env };
let session: UserActor | null;
const pending: Promise<unknown>[] = [];

const ORIGIN = 'http://localhost:3000';
const deps = (over: Partial<TurnRouteDeps> = {}): TurnRouteDeps => ({
  getActor: async () => session,
  now: async () => NOW,
  after: (task) => void pending.push(task),
  db: clocked,
  ...over,
});
const settle = async () => {
  await Promise.all(pending.splice(0));
};
const ui = (a: UserActor): UserActor => ({ ...a, via: 'ui' });

function post(
  body: string,
  opts: { type?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request(`${ORIGIN}/kev/turn`, {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: ORIGIN,
      'content-type': opts.type ?? 'application/json',
      ...opts.headers,
    },
    body,
  });
}
const json = (text: string, extra: Record<string, unknown> = {}) =>
  post(JSON.stringify({ text, ...extra }));
const form = (text: string) =>
  post(new URLSearchParams({ text }).toString(), { type: 'application/x-www-form-urlencoded' });

type Ev = { event: string; data: Record<string, unknown> };
function parseSse(raw: string): Ev[] {
  return raw
    .split('\n\n')
    .filter((c) => c.trim())
    .map((c) => {
      const event = /^event: (.*)$/m.exec(c)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(c)?.[1] ?? '{}';
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}
async function streamed(res: Response): Promise<{ raw: string; events: Ev[] }> {
  const raw = await res.text();
  await settle();
  return { raw, events: parseSse(raw) };
}
const provider = (script: ScriptEntry[], onCall?: () => Promise<void>) =>
  createScriptedProvider(script, onCall ? { onCall } : {});

let swim: Ref;

beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  process.env.HOME_KEV_MONTHLY_CAP_NZD = '300';
  delete process.env.HOME_KEV;
  delete process.env.HOME_TEST_KEV;
  f = await buildKevFixture(db, admin.db);
  await writeForecast(admin.db, at('2026-10-14', '06:55'));
  swim = { type: 'event', id: f.id.swimming, at: '2026-10-14T15:30:00+13:00' };
  await createTickingClock(admin);
  await clockTo(admin, '2043-03-01T00:00:00Z');
});
afterAll(async () => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await settle();
  await clockedHandle.end();
  await dropTestClock(admin);
  await clearKevFixture(db, admin.db);
  await close();
  await admin.close();
});
beforeEach(async () => {
  await clockForward(admin, 31);
  for (const a of [f.kev.sam, f.kev.alex]) await clearConversation(a, { db: clocked });
  session = ui(f.kev.sam);
});

describe('S8: the route’s door', () => {
  it('cross-site is 403; signed out (or not allowlisted: no session actor) is 401; a 9 KiB body is 413', async () => {
    const p = provider([answer('when', [swim])]);
    const cross = await handleTurnRequest(
      post(JSON.stringify({ text: 'hi' }), { headers: { origin: 'https://evil.example' } }),
      deps({ provider: p }),
    );
    expect(cross.status).toBe(403);
    const fetchSite = await handleTurnRequest(
      new Request(`${ORIGIN}/kev/turn`, {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'hi' }),
      }),
      deps({ provider: p }),
    );
    expect(fetchSite.status).toBe(403);
    session = null;
    expect((await handleTurnRequest(json('hi'), deps({ provider: p }))).status).toBe(401);
    session = ui(f.kev.sam);
    const big = await handleTurnRequest(
      json('x'.repeat(MAX_BODY_BYTES + 1024)),
      deps({ provider: p }),
    );
    expect(big.status).toBe(413);
    const odd = await handleTurnRequest(
      post('text=hi', { type: 'text/plain' }),
      deps({ provider: p }),
    );
    expect(odd.status).toBe(400);
    expect(p.requests).toHaveLength(0);
    expect(await messagesOf(admin, f.kev.sam.userId)).toEqual([]);
    for (const r of [cross, fetchSite, big, odd])
      expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('2,001 characters are refused before anything is stored', async () => {
    const p = provider([answer('when', [swim])]);
    const { events } = await streamed(
      await handleTurnRequest(json('x'.repeat(2_001)), deps({ provider: p })),
    );
    expect(events.map((e) => e.event)).toEqual(['error']);
    expect(events[0]!.data).toMatchObject({
      code: 'invalid_request',
      message: ERROR_TEXT.invalid_request,
    });
    expect(p.requests).toHaveLength(0);
    expect(await messagesOf(admin, f.kev.sam.userId)).toEqual([]);
  });
});

describe('S9: Kev off', () => {
  it('refuses before any read, with or without JavaScript', async () => {
    const reads: string[] = [];
    const watch = (sqlText: string) => reads.push(sqlText);
    clockedHandle.on('acquire', () => watch('acquire'));
    try {
      const res = await handleTurnRequest(json('What’s happening today?'), deps());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: 'off', message: ERROR_TEXT.off });
      const nojs = await handleTurnRequest(form('What’s happening today?'), deps());
      expect(nojs.status).toBe(303);
      expect(nojs.headers.get('location')).toBe('/kev');
      expect(reads).toEqual([]);
    } finally {
      clockedHandle.removeAllListeners('acquire');
    }
    expect(await messagesOf(admin, f.kev.sam.userId)).toEqual([]);
  });
});

describe('the event stream carries only code-approved text (D17, U3)', () => {
  it('U3: a slow first answer that fails the check never reaches the stream; only the checked answer does, once', async () => {
    const unchecked = 'UNCHECKED-MODEL-WORDS-7d1e';
    const p = provider(
      [
        tools(['get_agenda', { from: SAT, to: SUN }]),
        plain(JSON.stringify({ lead: unchecked, facts: [], view: null, decline: null })),
        answer('when', [swim]),
      ],
      () => new Promise((r) => setTimeout(r, 60)),
    );
    const res = await handleTurnRequest(json('What’s happening today?'), deps({ provider: p }));
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { raw, events } = await streamed(res);
    expect(raw).not.toContain(unchecked);
    const names = events.map((e) => e.event);
    expect(names[0]).toBe('started');
    expect(names.at(-1)).toBe('answer');
    expect(
      names.filter((n) => ['answer', 'declined', 'fallback', 'refused', 'error'].includes(n)),
    ).toHaveLength(1);
    expect(events.filter((e) => e.event === 'working').map((e) => e.data.text)).toEqual([
      WORKING_TEXT.start,
      WORKING_TEXT.get_agenda,
    ]);
    const outcome = events.at(-1)!.data;
    expect(outcome.say).toBe('Here’s today.');
    expect(outcome.blocks).toEqual([
      { kind: 'fact', text: '“Swimming”: today, 15:30–16:15. Milo attending, Sam responsible.' },
    ]);
    // Never a ref, an id, a tool name, a trace, a model or a token count.
    for (const leak of [
      f.id.swimming,
      'get_agenda',
      'attemptId',
      'claude-',
      'inputTokens',
      'cites',
    ])
      expect(raw).not.toContain(leak);
  });

  it('U4: an escalation streams "Give me a moment…", then the safe fallback', async () => {
    const bad = plain('Scripted reply.');
    const p = provider([bad, bad, bad, bad]);
    const { events } = await streamed(
      await handleTurnRequest(json('Help me think it through'), deps({ provider: p })),
    );
    expect(events.find((e) => e.event === 'escalated')?.data).toEqual({ text: ESCALATED_TEXT });
    expect(events.at(-1)!.event).toBe('fallback');
    expect(events.at(-1)!.data.keepable).toBe(true);
  });

  it('a provider failure: HOME’s line, keepable, with the words stored', async () => {
    const p = provider([{ kind: 'error', code: 'unreachable' }]);
    const { events } = await streamed(
      await handleTurnRequest(json('What’s on tomorrow?'), deps({ provider: p })),
    );
    expect(events.map((e) => e.event)).toEqual(['started', 'working', 'error']);
    expect(events.at(-1)!.data).toEqual({
      code: 'provider_unavailable',
      message: ERROR_TEXT.provider_unavailable,
      keepable: true,
    });
    expect((await messagesOf(admin, f.kev.sam.userId)).map((m) => m.role)).toEqual(['user']);
  });
});

describe('failed persistence through the route (§9.9, I-4)', () => {
  it('when the words cannot be stored, the stream says nothing was saved: no started, nothing keepable', async () => {
    // A session whose login has no user row: storing the words fails.
    session = { ...ui(f.kev.sam), userId: `u-ghost-${crypto.randomUUID().slice(0, 8)}` };
    const p = provider([answer('when', [swim])]);
    const { events } = await streamed(
      await handleTurnRequest(json('What’s happening today?'), deps({ provider: p })),
    );
    expect(events).toEqual([
      {
        event: 'error',
        data: { code: 'not_saved', message: ERROR_TEXT.not_saved, keepable: false },
      },
    ]);
    expect(p.requests).toHaveLength(0);
    const nojs = await handleTurnRequest(
      form('What’s happening today?'),
      deps({ provider: provider([]) }),
    );
    expect(nojs.headers.get('location')).toBe(`/kev?e=not_saved&at=${NOW.getTime()}#latest`);
  });
});

describe('without JavaScript (U8, the server half)', () => {
  it('the form post runs to completion and returns 303 to /kev, the answer stored', async () => {
    const p = provider([answer('when', [swim])]);
    const res = await handleTurnRequest(form('What’s happening today?'), deps({ provider: p }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/kev#latest');
    const rows = await messagesOf(admin, f.kev.sam.userId);
    expect(rows.map((r) => r.role)).toEqual(['user', 'kev']);
    expect(rows[1]!.content).toMatchObject({ outcome: 'answer', say: 'Here’s today.' });
  });

  it('an error returns to /kev with its closed code and when, never words', async () => {
    const p = provider([{ kind: 'error', code: 'unreachable' }]);
    const res = await handleTurnRequest(form('What’s on tomorrow?'), deps({ provider: p }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `/kev?e=provider_unavailable&at=${NOW.getTime()}#latest`,
    );
    expect(res.headers.get('location')).not.toContain('tomorrow');
  });
});

describe('G4 / U10 / U15 (local half): a client disconnect does not stop the turn', () => {
  it('the reader goes after the first event; the turn completes, settles and records', async () => {
    const p = provider(
      [tools(['get_agenda', { from: SAT, to: SUN }]), answer('when', [swim])],
      () => new Promise((r) => setTimeout(r, 150)),
    );
    const res = await handleTurnRequest(json('What’s happening today?'), deps({ provider: p }));
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: started');
    await reader.cancel(); // the phone goes into a tunnel
    await settle();
    const rows = await messagesOf(admin, f.kev.sam.userId);
    expect(rows.map((r) => r.role)).toEqual(['user', 'kev']);
    const r = await admin.db.execute<{ status: string; n: number }>(sql`
      select r.status, (select count(*)::int from kev_usage u where u.attempt_id = r.attempt_id) as n
        from kev_budget_reservation r where r.user_id = ${f.kev.sam.userId}
       order by r.created_at desc limit 1`);
    // The read, the read phase's end and the answer phase (ADR 0012 §54).
    expect(r.rows[0]).toEqual({ status: 'settled', n: 3 });
    expect(await getTurnInFlight(ui(f.kev.sam), { db: clocked })).toBe(false);
  });
});

describe('one turn at a time, through the route (L13) and Clear during a turn (C18)', () => {
  it('two submissions at once from two devices: one runs, the other is "Kev’s still answering."', async () => {
    const slow = () => new Promise<void>((r) => setTimeout(r, 200));
    const [a, b] = await Promise.all([
      handleTurnRequest(
        json('What’s happening today?'),
        deps({ provider: provider([answer('when', [swim])], slow) }),
      ),
      handleTurnRequest(
        json('What’s happening today?'),
        deps({ provider: provider([answer('when', [swim])], slow) }),
      ),
    ]);
    const outcomes = [(await streamed(a)).events.at(-1)!, (await streamed(b)).events.at(-1)!];
    expect(outcomes.map((o) => o.event).sort()).toEqual(['answer', 'error']);
    expect(outcomes.find((o) => o.event === 'error')!.data).toMatchObject({
      code: 'turn_in_flight',
      message: ERROR_TEXT.turn_in_flight,
      keepable: false,
    });
    expect(
      (await messagesOf(admin, f.kev.sam.userId)).filter((m) => m.role === 'user'),
    ).toHaveLength(1);
  });

  it('Clear while a turn is in flight is refused and deletes nothing; the screen says Kev is still answering', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let midTurn: { clear: unknown; inFlight: boolean; turns: ReturnType<typeof toTurns> } | null =
      null;
    const p = provider([answer('when', [swim])], async () => {
      const conv = (await listConversations(ui(f.kev.sam), {}, { db: clocked }))[0]!;
      const rows = await listMessages(ui(f.kev.sam), conv.id, {}, { db: clocked });
      const inFlight = await getTurnInFlight(ui(f.kev.sam), { db: clocked });
      midTurn = {
        clear: await clearConversation(f.kev.sam, { db: clocked }),
        inFlight,
        turns: toTurns(rows, inFlight, 'Pacific/Auckland'),
      };
      release();
    });
    const res = await handleTurnRequest(json('What’s happening today?'), deps({ provider: p }));
    await gate;
    await streamed(res);
    expect(midTurn!.clear).toEqual({ ok: false, code: 'turn_in_flight' });
    expect(midTurn!.inFlight).toBe(true);
    expect(midTurn!.turns.at(-1)).toMatchObject({ answering: true, keepable: false });
    expect((await messagesOf(admin, f.kev.sam.userId)).map((m) => m.role)).toEqual(['user', 'kev']);
  });
});

describe('C14: Keep in To sort, once, as the person', () => {
  it('a memory decline is keepable; keeping it twice keeps it once, verbatim, via the UI; a plain answer is not keepable', async () => {
    const words = 'Remember that Milo likes trains now.';
    await streamed(
      await handleTurnRequest(json(words), deps({ provider: provider([decline('memory')]) })),
    );
    await clockForward(admin, 2);
    await streamed(
      await handleTurnRequest(
        json('What’s happening today?'),
        deps({ provider: provider([answer('when', [swim])]) }),
      ),
    );
    const sam = ui(f.kev.sam);
    const conv = (await listConversations(sam, {}, { db: clocked }))[0]!;
    const rows = await listMessages(sam, conv.id, {}, { db: clocked });
    const turns = toTurns(rows, false, 'Pacific/Auckland');
    expect(turns.map((t) => [t.user?.text, t.keepable])).toEqual([
      [words, true],
      ['What’s happening today?', false],
    ]);
    expect(turns[0]!.kev?.kind === 'v2' && turns[0]!.kev.content.say).toBe(DECLINE_TEXT.memory);
    const id = turns[0]!.user!.id;
    const [one, two] = await Promise.all([
      captureVerbatim(sam, { text: words, messageId: id, channel: 'web' }, { db: clocked }),
      captureVerbatim(sam, { text: words, messageId: id, channel: 'web' }, { db: clocked }),
    ]);
    expect(one.id).toBe(two.id);
    const kept = await admin.db.execute<{
      text: string;
      created_via: string;
      visibility: string;
      created_by: string;
    }>(sql`select text, created_via, visibility, created_by from capture where message_id = ${id}`);
    expect(kept.rows).toEqual([
      { text: words, created_via: 'ui', visibility: 'private', created_by: f.kev.sam.userId },
    ]);
    expect(await listKeptMessageIds(sam, [id, turns[1]!.user!.id], { db: clocked })).toEqual(
      new Set([id]),
    );
    // Alex cannot keep Sam's message, or learn that it was kept.
    await expect(
      captureVerbatim(
        ui(f.kev.alex),
        { text: words, messageId: id, channel: 'web' },
        { db: clocked },
      ),
    ).rejects.toThrow();
    expect(await listKeptMessageIds(ui(f.kev.alex), [id], { db: clocked })).toEqual(new Set());
    await admin.db.execute(sql`delete from capture where message_id = ${id}`);
  });
});

describe('U13 and the citations: the screen’s reads are the reader’s own, now', () => {
  it('Alex never reads Sam’s conversation, its count, or its in-flight state; usage stays the recorded aggregate', async () => {
    const before = await getSpendStatus(ui(f.kev.alex), { db: clocked });
    const beforeOwn = await getOwnQuestionsThisMonth(ui(f.kev.alex), { db });
    let seen: { alexConvs: number; alexInFlight: boolean; spend: unknown; own: number } | null =
      null;
    const p = provider([answer('when', [swim])], async () => {
      seen = {
        alexConvs: (await listConversations(ui(f.kev.alex), {}, { db: clocked })).length,
        alexInFlight: await getTurnInFlight(ui(f.kev.alex), { db: clocked }),
        spend: await getSpendStatus(ui(f.kev.alex), { db: clocked }),
        own: await getOwnQuestionsThisMonth(ui(f.kev.alex), { db }),
      };
    });
    const { events } = await streamed(
      await handleTurnRequest(json('What’s happening today?'), deps({ provider: p })),
    );
    expect(events.at(-1)!.event).toBe('answer');
    const samConv = (await listConversations(ui(f.kev.sam), {}, { db: clocked }))[0]!;
    // Another adult's conversation id reads as nothing at all.
    expect(await listMessages(ui(f.kev.alex), samConv.id, {}, { db: clocked })).toEqual([]);
    // While Sam's turn was in flight, nothing Alex can read moved.
    expect(seen!.alexInFlight).toBe(false);
    expect(seen!.spend).toEqual(before);
    expect(seen!.own).toBe(beforeOwn);
    expect(await getOwnQuestionsThisMonth(ui(f.kev.sam), { db })).toBeGreaterThan(0);
  });

  it('a cited record made private by the other adult, or archived, is gone from the reader’s rows; a title stays text', async () => {
    const title = '<script>alert("x")</script> **Soccer** [link](https://example.test)';
    const ev = await createEvent(
      f.h.alex,
      {
        title,
        kind: 'activity',
        time: { allDay: true, startDate: '2026-10-14', endDate: '2026-10-15' },
      },
      { db },
    );
    const ref: Ref = { type: 'event', id: ev.id, at: '2026-10-14T00:00:00+13:00' };
    const p = provider([tools(['get_today', {}]), answer('when', [ref])]);
    const { events } = await streamed(
      await handleTurnRequest(json('What’s happening today?'), deps({ provider: p })),
    );
    const outcome = events.at(-1)!;
    expect(outcome.event).toBe('answer');
    // HOME rendered the title as quoted recorded text; the screen renders it as a text node (S15, unit).
    expect(JSON.stringify(outcome.data.blocks)).toContain('<script>');
    const sam = ui(f.kev.sam);
    expect((await listCitedRecords(sam, [ref], { db })).get(`event:${ev.id}`)?.title).toBe(title);
    await updateEvent(f.h.alex, ev.id, { visibility: 'private' }, { db });
    expect((await listCitedRecords(sam, [ref], { db })).size).toBe(0);
    expect((await listCitedRecords(ui(f.kev.alex), [ref], { db })).size).toBe(1);
    await updateEvent(f.h.alex, ev.id, { visibility: 'household' }, { db });
    await archiveEvent(f.h.alex, ev.id, { db });
    expect((await listCitedRecords(sam, [ref], { db })).size).toBe(0);
  });

  it('only pages exist as rows: unknown types and malformed ids are ignored; sensitive context never read', async () => {
    const out = await listCitedRecords(
      ui(f.kev.sam),
      [
        { type: 'conflict', id: f.id.swimming },
        { type: 'event', id: 'not-a-uuid' },
        { type: 'task', id: f.id.paint },
        { type: 'note', id: f.id.note },
        { type: 'context', id: f.id.dinosaurs },
      ],
      { db },
    );
    expect([...out.keys()].sort()).toEqual(
      [`context:${f.id.dinosaurs}`, `note:${f.id.note}`, `task:${f.id.paint}`].sort(),
    );
    expect(out.get(`note:${f.id.note}`)).toEqual({
      type: 'note',
      id: f.id.note,
      title: null,
      subject: { type: 'project', id: f.id.fence },
    });
    const sensitive = await admin.db.execute<{ id: string }>(
      sql`select id from context where sensitivity = 'sensitive' limit 5`,
    );
    const s = await listCitedRecords(
      ui(f.kev.sam),
      sensitive.rows.map((r) => ({ type: 'context', id: r.id })),
      { db },
    );
    expect(s.size).toBe(0);
  });
});

describe('no model input in any log line (§9.5, S12 through the route)', () => {
  it('the question, the answer and the record titles never reach stdout or stderr', async () => {
    const lines: string[] = [];
    const out = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((c) => (lines.push(String(c)), true));
    const err = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((c) => (lines.push(String(c)), true));
    try {
      const question = 'What’s happening today with the purple-giraffe-4411?';
      await streamed(
        await handleTurnRequest(
          json(question),
          deps({ provider: provider([answer('when', [swim])]) }),
        ),
      );
      await streamed(
        await handleTurnRequest(
          json('second question'),
          deps({ provider: provider([{ kind: 'error', code: 'unreachable' }]) }),
        ),
      );
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    const all = lines.join('');
    expect(all).toContain('kev_turn');
    for (const s of ['purple-giraffe', 'Swimming', 'Here’s today', 'second question', 'Milo'])
      expect(all).not.toContain(s);
  });
});

describe('the local scripted model (local and CI only)', () => {
  it('answers the screen’s suggestions with checked answers over the fixture', async () => {
    const ask = async (q: string) => {
      const l = localScript(q, { now: NOW, timeZone: 'Pacific/Auckland' });
      await clockForward(admin, 2);
      return (
        await streamed(
          await handleTurnRequest(
            json(q),
            deps({ provider: createScriptedProvider(l.script, l.opts ?? {}) }),
          ),
        )
      ).events.at(-1)!;
    };
    const today = await ask('What’s happening today?');
    expect(today.event).toBe('answer');
    expect(today.data.say).toBe('Here’s today.');
    const weekend = await ask('What have we got this weekend?');
    expect(weekend.event).toBe('answer');
    expect(JSON.stringify(weekend.data.blocks)).toContain('Football');
    const think = await ask('Help me think through our weekend.');
    expect(think.event).toBe('answer');
    expect((think.data.blocks as { kind: string }[]).some((b) => b.kind === 'view')).toBe(true);
    const tasks = await ask('What tasks have I still got outstanding?');
    expect(JSON.stringify(tasks.data.blocks)).toContain('Paint the back fence');
    const remember = await ask('Remember that Milo likes trains now.');
    expect(remember).toMatchObject({
      event: 'declined',
      data: { say: DECLINE_TEXT.memory, keepable: true },
    });
    const other = await ask('Tell me a joke');
    expect(other.event).toBe('answer');
    const tomorrow = await ask('What’s on tomorrow?');
    expect(tomorrow.event).toBe('answer');
  });
});
