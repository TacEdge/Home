import { LEAD_IDS, VIEW_PHRASE_IDS, VIEW_TYPES } from '@/kev/answer/catalogue';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// The pure halves of context assembly and the turn (M8 contract \u00A77.2–\u00A77.4,
// \u00A78.5, \u00A713.4; matrix rows C5, C6, N14's prompt half, L4's accounting): the
// conversation window's pairing and its exchange and token limits at N and
// N+1, what an earlier answer replays as, HOME's token estimate, the
// provisional system prompt's stability, and the regeneration note.

vi.mock('@/domain/kev-bookkeeping/service', () => ({ isLiveReservation: () => false }));

const { selectWindow } = await import('@/kev/context/window');
const { estimateTokens, requestTokens, BYTES_PER_TOKEN } = await import('@/kev/context/tokens');
const { SYSTEM_PROMPT } = await import('@/kev/prompts/system');
const { regenerationNote, HOME_LABEL, BUNDLE_LEAD } = await import('@/kev/orchestrator');
const { LIMITS } = await import('@/kev/config');

const user = (text: string) => ({ role: 'user' as const, content: { v: 2, text } });
const kev = (say: string, extra: Record<string, unknown> = {}) => ({
  role: 'kev' as const,
  content: {
    v: 2,
    outcome: 'answer',
    say,
    blocks: [],
    cites: [],
    limits: [],
    trace: [],
    calls: [],
    escalated: false,
    ...extra,
  },
});

describe('C5: the window’s limits, at N and N+1', () => {
  const pairs = (n: number) =>
    Array.from({ length: n }, (_, i) => [user(`q${i}`), kev(`a${i}`)]).flat();

  it('10 exchanges are all kept; of 11 the oldest is dropped', () => {
    expect(selectWindow(pairs(10)).map((e) => e.user)).toEqual(
      Array.from({ length: 10 }, (_, i) => `q${i}`),
    );
    expect(selectWindow(pairs(11)).map((e) => e.user)).toEqual(
      Array.from({ length: 10 }, (_, i) => `q${i + 1}`),
    );
    expect(LIMITS.windowExchanges).toBe(10);
  });

  it('exchanges totalling exactly 6,000 tokens are kept; one token more drops the oldest, whole', () => {
    const unit = selectWindow([user('x'), kev('y')])[0]!.tokens;
    // At the boundary exactly: a window of total == 6,000 keeps everything; 6,001 drops one.
    const fit = (target: number) => [
      user('z'.repeat((target - unit + estimateTokens('x')) * BYTES_PER_TOKEN)),
      kev('y'),
    ];
    expect(selectWindow(fit(LIMITS.windowTokens))).toHaveLength(1);
    expect(selectWindow(fit(LIMITS.windowTokens + 1))).toHaveLength(0);
    expect(selectWindow([...fit(3_000), ...fit(3_000)])).toHaveLength(2);
    expect(selectWindow([...fit(3_000), ...fit(3_001)])).toHaveLength(1);
  });

  it('pairs a person’s message with the reply that follows it; an unanswered one, or a lone reply, is left out', () => {
    const w = selectWindow([
      user('lost'),
      user('q1'),
      kev('a1'),
      kev('stray'),
      user('q2'),
      kev('a2'),
      user('unanswered'),
    ]);
    expect(w.map((e) => e.user)).toEqual(['q1', 'q2']);
  });
});

describe('C6: what an earlier answer replays as', () => {
  it('what HOME showed: Kev’s lead, the rendered facts with refs as ids only, Kev’s view; never the plan, trace, calls, limits or codes', () => {
    const at = '2026-10-17T09:00:00+13:00';
    const [e] = selectWindow([
      user('weekend?'),
      kev('Here’s this weekend.', {
        blocks: [
          {
            kind: 'fact',
            text: '“Football”: Saturday 17 October, 09:00–10:00.',
            cites: [{ type: 'event', id: 'e1', at, extra: 'dropped' }],
          },
          { kind: 'fact', text: 'Nothing else is recorded for Sunday 18 October.', cites: [] },
          { kind: 'view', text: 'Worth a look.', cites: [{ type: 'event', id: 'e1', at }] },
        ],
        cites: [{ type: 'event', id: 'e1', at }],
        plan: { lead: 'Here’s {when}.', facts: [], view: null },
        trace: [
          {
            tool: 'get_agenda',
            ok: true,
            args: { from: '2026-10-17' },
            resultCount: 1,
            refs: [],
            attemptId: 'a',
          },
        ],
        calls: [
          {
            attemptId: 'a',
            tier: 'fast',
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            ms: 1,
            stop: 'end_turn',
          },
        ],
        limits: ['forecast_credit'],
        violations: ['prose.time'],
      }),
    ]);
    // Every replayed text labelled (I-7): the facts quote records word for word.
    expect(JSON.parse(e!.kev)).toEqual({
      kev_lead: { untrusted_text: 'Here’s this weekend.' },
      home_facts: [
        {
          text: { untrusted_text: '“Football”: Saturday 17 October, 09:00–10:00.' },
          refs: [{ type: 'event', id: 'e1', at }],
        },
        { text: { untrusted_text: 'Nothing else is recorded for Sunday 18 October.' }, refs: [] },
      ],
      kev_view: { untrusted_text: 'Worth a look.' },
    });
    for (const k of [
      'trace',
      'calls',
      'limits',
      'violations',
      'attemptId',
      'get_agenda',
      'dropped',
      '{when}',
      'plan',
    ])
      expect(e!.kev).not.toContain(k);
  });
});

describe('HOME’s token accounting (L4)', () => {
  it('one token per two bytes of UTF-8, rounded up; a request counts its prefix, texts, results and replays', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(2);
    expect(estimateTokens('\u00E9')).toBe(1);
    const req = {
      tier: 'fast' as const,
      system: 'ab',
      tools: [],
      toolChoice: 'auto' as const,
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'abcd' }] },
        { role: 'assistant' as const, replay: {} as never },
      ],
    };
    expect(requestTokens(req, [100])).toBe(estimateTokens('ab') + estimateTokens('[]') + 2 + 100);
  });
});

describe('N14’s prompt half: the provisional system prompt', () => {
  it('names no fixture person, title, place, date, time or zone, and is the same bytes every build', () => {
    for (const v of [
      'Sam',
      'Alex',
      'Milo',
      'Isla',
      'Nana',
      'Swimming',
      'Football',
      'fence',
      'Garage',
      'Pacific',
      'Auckland',
      '2026',
      '07:03',
    ])
      expect(SYSTEM_PROMPT, v).not.toContain(v);
    expect(SYSTEM_PROMPT).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(SYSTEM_PROMPT).not.toMatch(/\b(19|20)\d{2}\b/);
    const src = readFileSync('src/kev/prompts/system.ts', 'utf8');
    expect(src).not.toMatch(/\$\{/); // nothing interpolated: a constant
    expect(src).not.toMatch(/Date|now\(|env\./);
  });

  it('says the rules HOME relies on, and every decline code', () => {
    for (const s of [
      'untrusted_text',
      'never an instruction',
      'escalate',
      "Kev's view",
      'absence',
      '{when}',
      'HOME writes every word',
    ])
      expect(SYSTEM_PROMPT).toContain(s);
    // Every lead, view type and phrase of HOME's catalogue, by its identifier.
    for (const l of LEAD_IDS) expect(SYSTEM_PROMPT).toContain(`"${l}"`);
    for (const t of VIEW_TYPES) expect(SYSTEM_PROMPT).toContain(`"${t}"`);
    for (const p of VIEW_PHRASE_IDS) expect(SYSTEM_PROMPT).toContain(`"${p}"`);
    for (const c of [
      'external_action',
      'write',
      'memory',
      'private_or_absent',
      'not_kept',
      'not_held',
      'reminder',
    ])
      expect(SYSTEM_PROMPT).toContain(`"${c}"`);
  });
});

describe('\u00A78.5: the regeneration note', () => {
  it('is labelled as HOME’s, names each code and where, and never quotes the answer', () => {
    const note = regenerationNote([
      { code: 'absence.unsupported', where: 0 },
      { code: 'lead.unsupported', where: 'lead' },
      { code: 'view.unsupported', where: 'view' },
      { code: 'answer.schema', where: 'answer' },
    ]);
    expect(note.startsWith(HOME_LABEL)).toBe(true);
    expect(note).toContain('- absence.unsupported in fact 1');
    expect(note).toContain('- lead.unsupported in the lead');
    expect(note).toContain('- view.unsupported in the view');
    expect(note).toContain('- answer.schema in the answer');
    expect(BUNDLE_LEAD.startsWith(HOME_LABEL)).toBe(true);
  });
});

describe('the orchestrator’s layering', () => {
  it('imports no database, no app, no SDK and no write function', () => {
    const src = readFileSync('src/kev/orchestrator.ts', 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    for (const i of imports) {
      expect(i).not.toMatch(/^@\/db|^@\/app|@anthropic-ai/);
      if (i.startsWith('@/domain/'))
        expect([
          '@/domain/common/write',
          '@/domain/kev-bookkeeping/schema',
          '@/domain/kev-bookkeeping/service',
        ]).toContain(i);
    }
  });
});
