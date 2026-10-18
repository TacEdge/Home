import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTask } from '@/domain/tasks/service';
import { TIERS } from '@/kev/config';
import { ANSWER_PHASE_NOTE, handle, type KevEvent } from '@/kev/orchestrator';
import { buildAnthropicProvider } from '@/kev/providers/anthropic';
import { createProviderFetchForTests } from '@/kev/providers/fetch';
import {
  ev,
  messageEnd,
  messageStart,
  startStub,
  textBlock,
  toolBlock,
  type Handler,
  type Stub,
} from '../unit/kev-stub';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { clockedPool, dropTestClock } from './clock';
import { adminDb, testDb } from './db';
import { buildKevFixture, clearKevFixture, NOW, SAT, type KevFixture } from './kev-fixture';
import { clockTo, createTickingClock, messagesOf } from './kev-turn-helpers';

// N15 on the wire (M8 contract §4.2, §15.6; gates G9 and G21's offline
// half): a real orchestrated attempt through the real Anthropic adapter and
// HOME's fetch, against a local stub of the Messages API (never the
// provider), with two tool rounds, thinking blocks (one with empty text)
// and their signatures, a result truncated before it is first sent, and a
// regeneration. Every request body's `system`, `tools` and `messages` must
// be a byte-prefix extension of the one before; only the final,
// answer-without-tools request changes `tool_choice`. Each request is
// counted first (G22), with the same body less what counting does not take.
// G9 and G21 still need one live attempt (stage C): this proves HOME sends
// what it should, not that the provider accepts it. Synthetic only.

const { db, close } = testDb();
const admin = adminDb();
const { pool: clockedHandle, db: clocked } = clockedPool();
const KEY = 'test-only-not-a-key';
const FAST = TIERS.fast.model.id;
let stub: Stub;
let f: KevFixture;
const savedEnv = { ...process.env };

const thinking = (index: number, text: string, signature: string) =>
  ev('content_block_start', {
    index,
    content_block: { type: 'thinking', thinking: '', signature: '' },
  }) +
  (text
    ? ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: text } })
    : '') +
  ev('content_block_delta', { index, delta: { type: 'signature_delta', signature } }) +
  ev('content_block_stop', { index });

const sse =
  (body: string): Handler =>
  (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(body);
  };
const usage = { input_tokens: 2_000, cache_creation_input_tokens: 0 };
const PROSE_CANARY = 'canary-read-phase-prose-41';
/** An answer plan (owner amendment, ADR 0012 §46): a lead and the records chosen, by ref. */
/** A lead by HOME's catalogue id ('when'); any other string is a model's own words (refused whole). */
const planOf = (lead: string, refs: { type: string; id: string; at?: string }[]) => ({
  lead,
  facts: refs.map((r) => ({
    kind: r.type,
    ref: { type: r.type, id: r.id, at: r.at ?? null },
    show: [],
    scope: null,
  })),
  view: null,
  decline: null,
});
const answerJson = (lead: string, refs: { type: string; id: string; at?: string }[]) =>
  JSON.stringify(planOf(lead, refs));

beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  process.env.HOME_KEV_MONTHLY_CAP_NZD = '300';
  f = await buildKevFixture(db, admin.db);
  // Enough of Sam's tasks that get_tasks is cut to fit before it is sent.
  for (let i = 0; i < 60; i++)
    await createTask(
      f.h.sam,
      { title: `Synthetic wire task ${i} ${'z'.repeat(120)}`, visibility: 'private' },
      { db },
    );
  await createTickingClock(admin);
  await clockTo(admin, '2041-03-01T00:00:00Z');
  stub = await startStub();
});
afterAll(async () => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await stub.close();
  await clockedHandle.end();
  await dropTestClock(admin);
  await admin.db.execute(
    sql`update task set archived_at = now() where title like 'Synthetic wire task %'`,
  );
  await clearKevFixture(db, admin.db);
  await close();
  await admin.close();
});

describe('N15: the grow-only request, on the wire', () => {
  it('two tool rounds, thinking (one empty), a truncated result, the answer phase and a regeneration: each body extends the one before', async () => {
    const football = { type: 'event', id: f.id.football, at: `${SAT}T09:00:00+13:00` };
    stub.queue.push(
      sse(
        messageStart(FAST, usage) +
          thinking(0, '', 'sig-empty-1') +
          toolBlock(1, 'toolu_synthetic_1', 'get_agenda', { from: SAT, to: '2026-10-18' }) +
          messageEnd('tool_use', 120),
      ),
      sse(
        messageStart(FAST, usage) +
          thinking(0, 'Synthetic thinking.', 'sig-2') +
          toolBlock(1, 'toolu_synthetic_2', 'get_tasks', {}) +
          messageEnd('tool_use', 140),
      ),
      // The read phase ends in prose (ADR 0012 §54): never checked, shown or stored.
      sse(
        messageStart(FAST, usage) +
          thinking(0, '', 'sig-empty-3') +
          textBlock(1, `Synthetic read-phase prose ${PROSE_CANARY}.`) +
          messageEnd('end_turn', 30),
      ),
      sse(
        messageStart(FAST, usage) +
          textBlock(0, answerJson('Football on Saturday at 4.', [football])) +
          messageEnd('end_turn', 90),
      ),
      sse(
        messageStart(FAST, usage) +
          textBlock(0, answerJson('when', [football])) +
          messageEnd('end_turn', 60),
      ),
    );
    const provider = buildAnthropicProvider(
      KEY,
      createProviderFetchForTests(KEY, { stubPort: stub.port }),
    );
    const events: KevEvent[] = [];
    for await (const e of handle(
      {
        actor: f.kev.sam,
        channel: 'web',
        input: { text: 'What have we got this weekend?' },
        now: NOW,
      },
      { db: clocked, provider },
    ))
      events.push(e);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'answer' });
    expect(stub.seen).toHaveLength(5);
    expect(stub.counts).toHaveLength(5);

    const bodies = stub.seen.map((s) => JSON.parse(s.body) as Record<string, unknown>);
    const counted = stub.counts.map((s) => JSON.parse(s.body) as Record<string, unknown>);
    const bytes = (v: unknown) => JSON.stringify(v);
    for (let i = 0; i < bodies.length; i++) {
      // G22: each count is the body that followed it, less max_tokens, inference_geo and stream.
      const { max_tokens: _m, inference_geo: _g, stream: _s, ...rest } = bodies[i]!;
      void _m;
      void _g;
      void _s;
      expect(bytes(counted[i])).toBe(bytes(rest));
      if (i === 0) continue;
      const prev = bodies[i - 1]!;
      const next = bodies[i]!;
      expect(bytes(next.system)).toBe(bytes(prev.system));
      expect(bytes(next.tools)).toBe(bytes(prev.tools));
      const pm = prev.messages as unknown[];
      const nm = next.messages as unknown[];
      expect(nm.length).toBeGreaterThan(pm.length);
      for (let k = 0; k < pm.length; k++)
        expect(bytes(nm[k]), `request ${i}, message ${k}`).toBe(bytes(pm[k]));
      // And as raw bytes: the earlier messages' serialisation is a prefix of the later one's.
      const pText = bytes(pm);
      expect(bytes(nm).startsWith(pText.slice(0, -1))).toBe(true);
    }
    expect(bodies.map((b) => (b.tool_choice as { type: string }).type)).toEqual([
      'auto',
      'auto',
      'auto',
      'none',
      'none',
    ]);
    // The answer format only in the answer phase, never with `auto` (ADR 0012 §54).
    expect(
      bodies.map((b) => Boolean((b.output_config as { format?: unknown } | undefined)?.format)),
    ).toEqual([false, false, false, true, true]);
    for (const c of counted)
      expect(
        Boolean((c.output_config as { format?: unknown } | undefined)?.format) &&
          (c.tool_choice as { type: string }).type === 'auto',
      ).toBe(false);
    // The answer phase opens with HOME's fixed note, after the prose turn.
    const phase = (bodies[3]!.messages as { role: string; content: unknown }[]).at(-1)!;
    expect(phase).toEqual({
      role: 'user',
      content: [{ type: 'text', text: ANSWER_PHASE_NOTE }],
    });

    // Thinking blocks, the empty one included, replayed verbatim with their signatures.
    const last = bodies[4]!.messages as {
      role: string;
      content: { type: string; thinking?: string; signature?: string }[];
    }[];
    const assistant = last.filter((m) => m.role === 'assistant');
    expect(assistant[0]!.content[0]).toEqual({
      type: 'thinking',
      thinking: '',
      signature: 'sig-empty-1',
    });
    expect(assistant[1]!.content[0]).toEqual({
      type: 'thinking',
      thinking: 'Synthetic thinking.',
      signature: 'sig-2',
    });
    expect(assistant[2]!.content[0]).toEqual({
      type: 'thinking',
      thinking: '',
      signature: 'sig-empty-3',
    });

    // The get_tasks result was cut before it was first sent, and says so.
    const results = last
      .filter((m) => m.role === 'user')
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b) => b.type === 'tool_result') as unknown as { content: string }[];
    const tasks = JSON.parse(results[1]!.content) as {
      truncated: boolean;
      count: number;
      tasks: unknown[];
    };
    expect(tasks.truncated).toBe(true);
    expect(tasks.tasks.length).toBeLessThan(tasks.count);

    // The regeneration is appended as a labelled user-turn text block, last.
    const note = last.at(-1) as unknown as {
      role: string;
      content: { type: string; text: string }[];
    };
    expect(note.role).toBe('user');
    expect(note.content.at(-1)!.text).toContain('answer.schema in the answer');
    expect(note.content.at(-1)!.text).not.toContain('at 4');

    // Nothing provider-shaped was stored (N13).
    const stored = JSON.stringify(await messagesOf(admin, f.kev.sam.userId));
    for (const s of [
      'sig-empty-1',
      'sig-2',
      'toolu_synthetic',
      'thinking',
      'Synthetic thinking',
      PROSE_CANARY,
    ])
      expect(stored).not.toContain(s);
    // The read phase's prose is never shown either.
    expect(JSON.stringify(events)).not.toContain(PROSE_CANARY);
  });

  it('I-2 on the wire, the answer-tool path: after the last round and for the regeneration, tool_choice stays auto with the same tools, and the answer tool answers', async () => {
    const football = { type: 'event', id: f.id.football, at: `${SAT}T09:00:00+13:00` };
    const answerInput = (lead: string) => planOf(lead, [football]);
    stub.seen.length = 0;
    stub.counts.length = 0;
    stub.queue.push(
      sse(
        messageStart(FAST, usage) +
          toolBlock(0, 'toolu_late_1', 'get_agenda', { from: SAT, to: '2026-10-18' }) +
          messageEnd('tool_use', 50),
      ),
      sse(
        messageStart(FAST, usage) +
          toolBlock(0, 'toolu_late_2', 'get_people', {}) +
          messageEnd('tool_use', 50),
      ),
      sse(
        messageStart(FAST, usage) +
          toolBlock(0, 'toolu_late_3', 'get_projects', {}) +
          messageEnd('tool_use', 50),
      ),
      sse(
        messageStart(FAST, usage) +
          thinking(0, '', 'sig-late-4') +
          toolBlock(1, 'toolu_late_4', 'answer', answerInput('Football on Saturday at 4.')) +
          messageEnd('tool_use', 70),
      ),
      sse(
        messageStart(FAST, usage) +
          toolBlock(0, 'toolu_late_5', 'answer', answerInput('when')) +
          messageEnd('tool_use', 60),
      ),
    );
    const provider = buildAnthropicProvider(
      KEY,
      createProviderFetchForTests(KEY, { stubPort: stub.port }),
    );
    const events: KevEvent[] = [];
    for await (const e of handle(
      {
        actor: f.kev.alex,
        channel: 'web',
        input: { text: 'What have we got this weekend?' },
        now: NOW,
      },
      { db: clocked, provider, answerPath: { fast: 'tool' } },
    ))
      events.push(e);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'answer' });
    expect(events.find((e) => e.type === 'say')).toEqual({
      type: 'say',
      text: 'Here’s Saturday 17 October.',
    });
    expect(stub.seen).toHaveLength(5);
    expect(stub.counts).toHaveLength(5);
    const bodies = stub.seen.map((s) => JSON.parse(s.body) as Record<string, unknown>);
    const bytes = (v: unknown) => JSON.stringify(v);
    // Never `none` (it would forbid the answer tool) and never forced (the pinned models refuse it).
    expect(bodies.map((b) => bytes(b.tool_choice))).toEqual(Array(5).fill(bytes({ type: 'auto' })));
    for (const b of bodies) {
      expect(bytes(b.tools)).toBe(bytes(bodies[0]!.tools));
      expect((b.tools as { name: string }[]).map((t) => t.name)).toContain('answer');
    }
    for (let i = 1; i < bodies.length; i++) {
      const pm = bodies[i - 1]!.messages as unknown[];
      const nm = bodies[i]!.messages as unknown[];
      for (let k = 0; k < pm.length; k++) expect(bytes(nm[k])).toBe(bytes(pm[k]));
    }
    const lastUser = (b: Record<string, unknown>) => bytes((b.messages as unknown[]).at(-1));
    // After the third round, HOME asks for the answer tool; the regeneration says so again.
    expect(lastUser(bodies[3]!)).toContain('Give your answer now with the answer tool');
    expect(lastUser(bodies[4]!)).toContain('answer.schema in the answer');
    expect(lastUser(bodies[4]!)).toContain('Give your answer now with the answer tool');
  });
});
