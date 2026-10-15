import { describe, expect, it } from 'vitest';
import { messageContentV1 } from '@/domain/conversations/schema';
import { kevContentV2, userContentV2 } from '@/domain/kev-bookkeeping/schema';

// Message content v2 (M8 contract §7.6; matrix row N13 at the schema level):
// strict, closed, and unable to represent any provider block, tool-use id,
// thinking or signature. v1 stays valid.

const attemptId = '00000000-0000-4000-8000-000000000001';
const answer = {
  v: 2,
  outcome: 'answer',
  say: 'Swimming at 3:30 with Milo.',
  blocks: [{ kind: 'fact', text: 'Nothing else is recorded for today.', cites: [] }],
  cites: [{ type: 'event', id: 'e1', at: '2026-10-14T15:30:00+13:00' }],
  limits: [],
  trace: [
    {
      tool: 'get_today',
      ok: true,
      args: { from: '2026-10-14', count: 1 },
      resultCount: 1,
      refs: [{ type: 'event', id: 'e1' }],
      attemptId,
    },
  ],
  calls: [
    {
      attemptId,
      tier: 'fast',
      inputTokens: 4_100,
      outputTokens: 450,
      cacheReadTokens: 0,
      cacheWriteTokens: 5_000,
      ms: 1_200,
      stop: 'end_turn',
    },
  ],
  escalated: false,
};

describe('content v2', () => {
  it('accepts a person’s words and a validated Kev answer', () => {
    expect(userContentV2.parse({ v: 2, text: 'What’s on today?', focus: 'today' })).toBeTruthy();
    expect(kevContentV2.parse(answer)).toBeTruthy();
  });

  it('N13: no provider block types, tool-use ids, thinking or signatures can be represented', () => {
    const bad = [
      { ...answer, content: [{ type: 'thinking', thinking: '', signature: 'sig' }] },
      { ...answer, blocks: [{ kind: 'thinking', text: 'x', cites: [] }] },
      { ...answer, blocks: [{ type: 'tool_use', id: 'toolu_1', name: 'get_today', input: {} }] },
      { ...answer, trace: [{ ...answer.trace[0], toolUseId: 'toolu_1' }] },
      { ...answer, trace: [{ ...answer.trace[0], tool: 'web_search' }] },
      { ...answer, trace: [{ ...answer.trace[0], args: { query: 'free text with spaces' } }] },
      { ...answer, calls: [{ ...answer.calls[0], stop: 'whatever the provider said' }] },
      { ...answer, calls: [{ ...answer.calls[0], model: 'm' }] },
      { ...answer, calls: [{ ...answer.calls[0], costUsdMicros: 1 }] },
      { ...answer, signature: 'sig' },
      { ...answer, cites: [{ type: 'tool_use', id: 'toolu_1' }] },
      { ...answer, say: 'x'.repeat(401) },
      { ...answer, blocks: Array(7).fill(answer.blocks[0]) },
    ];
    for (const b of bad) expect(kevContentV2.safeParse(b).success, JSON.stringify(b)).toBe(false);
    expect(userContentV2.safeParse({ v: 2, text: 'x', thinking: 'y' }).success).toBe(false);
    expect(userContentV2.safeParse({ v: 2, text: 'x'.repeat(2_001) }).success).toBe(false);
  });

  it('v1 stays valid and is not v2', () => {
    expect(messageContentV1.safeParse({ v: 1, text: 'hello' }).success).toBe(true);
    expect(kevContentV2.safeParse({ v: 1, text: 'hello' }).success).toBe(false);
  });
});
