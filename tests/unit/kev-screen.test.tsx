import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { basedOnLabel, screenCopy, suggestions, dayHeading } from '@/app/(home)/kev/copy';
import { usageCopy, monthLine, ownLine, pausedLine } from '@/app/(home)/settings/usage/copy';
import { DECLINE_TEXT, forbiddenIn, FALLBACK_WITH_ROWS, ERROR_TEXT } from '@/kev/answer/language';
import { outcomeEvent, sse } from '@/app/(home)/kev/turn/handle';
import { normaliseQuestion, localScript } from '@/kev/evals/local';
import { Conversation } from '@/app/(home)/kev/conversation';
import { byDay, toTurns } from '@/app/(home)/kev/turns';

// The Kev screen's pure parts (M8 Package 4; contract §8.6, §11.2–§11.4;
// matrix rows U3, U6, U7, U11, S15): its fixed copy against the screen
// lists and Kev's own, the static suggestions, "What's this based on?" in
// plain words, Keep in To sort's rule, the event stream's outcome event,
// and the answer rendered as text nodes. Synthetic only.

vi.mock('@/app/(home)/kev/actions', () => ({
  keepMessageAction: async () => ({ status: 'idle' }),
  clearConversationAction: async () => ({ status: 'idle' }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

/**
 * Contract-verbatim words the lists would otherwise catch on this screen:
 * §11.2 names the control "Clear conversation" (M6's "clear" is about a
 * day), and §11.2's disclosure says "what your question needs" (M5's
 * "needs" is about people). Exempt by name, nothing else.
 */
const VERBATIM: Record<string, string[]> = {
  'Clear conversation': ['clear'],
  Clear: ['clear'],
  'Cleared.': ['clear'],
};

describe('the screen’s fixed copy (§8.6)', () => {
  // Also the copy-test exemptions: "Clear conversation" (§11.2 names it).
  it('no string on the Kev screen or Settings › Usage carries a forbidden phrase', () => {
    for (const s of [...screenCopy(), ...usageCopy()]) {
      const hits = forbiddenIn(s).filter((h) => !(VERBATIM[s] ?? []).includes(h));
      // §11.2 verbatim: the disclosure's "what your question needs" and Usage's
      // "(both of you)", which is about the household's spend, never availability.
      const disclosure = s.startsWith('To answer, Kev sends what your question needs');
      const month = s.startsWith('This month: about NZ$');
      expect(
        hits.filter((h) => !(disclosure && h === 'needs') && !(month && h === 'both of you')),
        s,
      ).toEqual([]);
    }
  });
  it('the privacy line, the introduction and the disclosure are the contract’s', () => {
    const copy = screenCopy();
    expect(copy).toContain('Only you can see this conversation.');
    expect(copy).toContain('I’m Kev. Ask me about what’s recorded in HOME.');
    expect(copy).toContain(
      'To answer, Kev sends what your question needs to Anthropic, HOME’s AI provider, which doesn’t train on it.',
    );
  });
  it('Usage says the recorded month, never a reservation, a tier or the provider’s bill as known', () => {
    expect(monthLine(12n, 100n)).toBe('This month: about NZ$12 of NZ$100 (both of you).');
    expect(ownLine(3)).toBe('You’ve asked Kev 3 questions this month.');
    expect(pausedLine('2026-10-16')).toBe(
      'Kev has reached this month’s limit and will be back on Sunday 1 November.',
    );
    expect(pausedLine('2026-12-31')).toContain('Friday 1 January');
    const all = usageCopy().join(' ').toLowerCase();
    for (const w of [
      'reserv',
      'unreconciled',
      'counted in full',
      'tier',
      'deep',
      'opus',
      'sonnet',
      'haiku',
    ])
      expect(all).not.toContain(w);
    expect(all).toContain('90 days');
    expect(all).toContain('united states');
  });
});

describe('U7: suggestions are static, chosen by code', () => {
  it('Wednesday 07:03: "What’s happening today?" first', () => {
    expect(suggestions('2026-10-14', 7)[0]).toBe('What’s happening today?');
    expect(suggestions('2026-10-14', 7)).not.toContain('What have we got this weekend?');
  });
  it('Thursday 07:03: the weekend is included', () => {
    expect(suggestions('2026-10-15', 7)).toContain('What have we got this weekend?');
  });
  it('19:30: tomorrow is included; never more than three', () => {
    expect(suggestions('2026-10-14', 19)).toContain('What’s on tomorrow?');
    for (const d of ['2026-10-12', '2026-10-15', '2026-10-17', '2026-10-18'])
      for (const h of [0, 7, 12, 17, 23]) expect(suggestions(d, h).length).toBeLessThanOrEqual(3);
  });
  it('day headings', () => {
    expect(dayHeading('2026-10-14', '2026-10-14')).toBe('Today');
    expect(dayHeading('2026-10-13', '2026-10-14')).toBe('Yesterday');
    expect(dayHeading('2026-10-10', '2026-10-14')).toBe('Saturday 10 October');
  });
});

describe('U6: "What’s this based on?" in plain words', () => {
  it('names what was read, never a tool, model or token', () => {
    const tools = [
      'get_today',
      'get_agenda',
      'get_conflicts',
      'get_insights',
      'get_tasks',
      'get_projects',
      'get_people',
      'get_context',
      'get_calendar_health',
      'get_weather',
      'get_gaps',
      'search',
    ];
    for (const t of tools) {
      const label = basedOnLabel(t, { from: '2026-10-17', to: '2026-10-18', surface: 'today' });
      expect(label, t).toBeTruthy();
      expect(label!).not.toMatch(/get_|_|claude|token|model|tool/i);
    }
    expect(basedOnLabel('get_agenda', { from: '2026-10-17', to: '2026-10-18' })).toBe(
      'The calendar, Saturday 17 October to Sunday 18 October',
    );
    expect(basedOnLabel('escalate', {})).toBeNull();
    expect(basedOnLabel('unknown', {})).toBeNull();
  });
});

describe('U3: the outcome event is the only one that carries an answer', () => {
  it('an answer: the stored lead and the rendered blocks, nothing else', () => {
    const ev = outcomeEvent({
      say: 'Here’s today.',
      blocks: [{ kind: 'fact', text: '“Swimming”: today, 15:30–16:15.' }],
      done: {
        type: 'done',
        outcome: 'answer',
        limits: ['gap_limit'],
        escalated: false,
        keepable: false,
        kevMessageId: 'm1',
      },
    });
    expect(ev).toBe(
      sse('answer', {
        say: 'Here’s today.',
        blocks: [{ kind: 'fact', text: '“Swimming”: today, 15:30–16:15.' }],
        keepable: false,
      }),
    );
    expect(ev).not.toContain('m1');
  });
  it('an error, or a turn that never said done: HOME’s line only', () => {
    expect(outcomeEvent({ blocks: [] })).toBe(
      sse('error', {
        code: 'provider_unavailable',
        message: ERROR_TEXT.provider_unavailable,
        keepable: false,
      }),
    );
  });
});

describe('the local scripted model (local and CI only)', () => {
  it('reads questions loosely, and asks for failure states only by name', () => {
    expect(normaliseQuestion('  What’s happening   TODAY?? ')).toBe("what's happening today");
    const now = new Date('2026-10-13T18:03:00Z');
    const timeZone = 'Pacific/Auckland';
    expect(localScript('anything', { now, timeZone, mode: 'down' }).script).toEqual([
      { kind: 'error', code: 'unreachable' },
    ]);
    expect(
      localScript('anything', { now, timeZone, mode: 'nonsense' }).turnDeadlineMs,
    ).toBeUndefined();
    expect(localScript('anything', { now, timeZone, mode: 'timeout' }).turnDeadlineMs).toBe(10_000);
  });
  it('is loaded only when the scripted provider is on, from the route, never on a deployed path', () => {
    const route = readFileSync('src/app/(home)/kev/turn/handle.ts', 'utf8');
    expect(route).toMatch(/status === 'scripted'/);
    expect(route).toMatch(/\bimport\('@\/kev\/evals\/local'\)/);
    expect(route).not.toMatch(/^import .*evals\/local/m);
    expect(route).not.toMatch(/^import .*providers\/scripted/m);
  });
});

describe('S15, U5, U11: the answer renders as text, its parts in order', () => {
  const at = (iso: string) => new Date(iso);
  const kev = (over: Record<string, unknown>) => ({
    v: 2,
    outcome: 'answer',
    say: 'Here’s this weekend.',
    blocks: [],
    cites: [],
    limits: [],
    trace: [],
    calls: [],
    escalated: false,
    ...over,
  });
  const EVENT = '11111111-1111-4111-8111-111111111111';
  const GONE = '22222222-2222-4222-8222-222222222222';
  const hostile = '<script>alert(1)</script> **bold** [x](https://evil.example)';
  const rows = [
    {
      id: 'u1',
      role: 'user',
      content: { v: 2, text: `<img src=x onerror=alert(1)>` },
      createdAt: at('2026-10-13T18:00:00Z'),
    },
    {
      id: 'k1',
      role: 'kev',
      createdAt: at('2026-10-13T18:00:05Z'),
      content: kev({
        blocks: [
          { kind: 'fact', text: `“${hostile}”: Saturday 17 October, 09:00–10:00.`, cites: [] },
          { kind: 'view', text: 'Might be worth having a plan B.', cites: [] },
        ],
        cites: [
          { type: 'event', id: EVENT, at: '2026-10-17T09:00:00+13:00' },
          { type: 'event', id: GONE },
          { type: 'forecast', id: 'forecast:2026-10-17' },
        ],
        limits: ['gap_limit', 'forecast_credit'],
        forecastAt: '2026-10-14T06:55:00+13:00',
        trace: [
          {
            tool: 'get_agenda',
            ok: true,
            args: { from: '2026-10-17', to: '2026-10-18' },
            resultCount: 1,
            refs: [],
            attemptId: '33333333-3333-4333-8333-333333333333',
          },
        ],
      }),
    },
    {
      id: 'u2',
      role: 'user',
      content: { v: 2, text: 'Remember the shed key.' },
      createdAt: at('2026-10-13T18:01:00Z'),
    },
    {
      id: 'k2',
      role: 'kev',
      createdAt: at('2026-10-13T18:01:05Z'),
      content: kev({ outcome: 'declined', say: DECLINE_TEXT.memory }),
    },
    {
      id: 'u3',
      role: 'user',
      content: { v: 2, text: 'Book swimming.' },
      createdAt: at('2026-10-13T18:02:00Z'),
    },
    {
      id: 'k3',
      role: 'kev',
      createdAt: at('2026-10-13T18:02:05Z'),
      content: kev({ outcome: 'declined', say: DECLINE_TEXT.external_action }),
    },
    {
      id: 'u4',
      role: 'user',
      content: { v: 2, text: 'And the fallback?' },
      createdAt: at('2026-10-13T18:03:00Z'),
    },
    {
      id: 'k4',
      role: 'kev',
      createdAt: at('2026-10-13T18:03:05Z'),
      content: kev({ outcome: 'fallback', say: FALLBACK_WITH_ROWS }),
    },
    {
      id: 'u5',
      role: 'user',
      content: { v: 2, text: 'No answer stored for this one.' },
      createdAt: at('2026-10-13T18:04:00Z'),
    },
  ];

  it('U11: Keep in To sort follows only the write and memory declines, the fallback, and no answer', () => {
    const turns = toTurns(rows, false, 'Pacific/Auckland');
    expect(turns.map((t) => [t.user?.id, t.keepable])).toEqual([
      ['u1', false],
      ['u2', true],
      ['u3', false],
      ['u4', true],
      ['u5', true],
    ]);
    // While the guard holds the last one, it is being answered, not keepable.
    expect(toTurns(rows, true, 'Pacific/Auckland').at(-1)).toMatchObject({
      answering: true,
      keepable: false,
    });
  });

  it('S15: markup in a person’s words or a recorded title is text; the only links are HOME’s own, from cites', () => {
    const turns = toTurns(rows, false, 'Pacific/Auckland');
    const rendered = renderToStaticMarkup(
      <Conversation
        days={byDay(turns)}
        today="2026-10-14"
        ctx={{
          timeZone: 'Pacific/Auckland',
          now: at('2026-10-13T18:05:00Z'),
          cited: new Map([[`event:${EVENT}`, { type: 'event', id: EVENT, title: 'Football' }]]),
          kept: new Set(['u2']),
          calendars: [
            { id: 'c1', name: 'Family calendar', lastSyncedAt: at('2026-10-13T17:58:00Z') },
          ],
        }}
      />,
    );
    // React's own form-replay script (for forms submitted before hydration) is the only script.
    const html = rendered.replace(/<script>addEventListener\("submit",[\s\S]*?<\/script>$/, '');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.filter((h) => !h!.startsWith('/'))).toEqual(['https://open-meteo.com/']);
    expect(hrefs).toContain(`/events/${EVENT}`);
    expect(hrefs).not.toContain('https://evil.example');
    // U5: lead, fact, Kev's view under its label, the row, the gone line, the code's sentences.
    const order = [
      'Here’s this weekend.',
      'Saturday 17 October, 09:00–10:00.',
      'Kev’s view',
      'Might be worth having a plan B.',
      'Football',
      'One record this answer rested on is gone from your view of HOME.',
      'It isn’t a check of anyone’s plans.',
      'Forecast as of ',
      'What’s this based on?',
      'The calendar, Saturday 17 October to Sunday 18 October',
      'Family calendar, updated',
    ];
    let last = -1;
    for (const s of order) {
      const i = html.indexOf(s.replace(/’/g, '’'));
      expect(i, s).toBeGreaterThan(last);
      last = i;
    }
    // Kept once: the kept message says so, the others offer it.
    expect(html.match(/data-testid="kev-kept"/g)).toHaveLength(1);
    expect(html.match(/data-testid="kev-keep"/g)).toHaveLength(2);
  });
});

describe('S13: the screen’s client code carries nothing of Kev’s', () => {
  it('the client components import only the screen’s copy, forms, UI and the framework', () => {
    for (const file of [
      'src/app/(home)/kev/composer.tsx',
      'src/app/(home)/kev/keep-form.tsx',
      'src/app/_capture/capture-bar.tsx',
    ]) {
      const text = readFileSync(file, 'utf8');
      expect(text.startsWith("'use client';"), file).toBe(true);
      const imports = [...text.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]!);
      for (const i of imports)
        expect(
          /^(react|react-dom|next\/link|next\/navigation|\.\/copy|@\/app\/_forms\/[a-z-]+|@\/ui\/[a-z-]+)$/.test(
            i,
          ),
          `${file}: ${i}`,
        ).toBe(true);
    }
  });
});
