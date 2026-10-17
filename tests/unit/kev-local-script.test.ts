import { describe, expect, it } from 'vitest';
import { localScript, weekendOf } from '@/kev/evals/local';
import type { ScriptEntry, ScriptStep } from '@/kev/providers/scripted';
import type { ProviderRequest } from '@/kev/providers/types';

// The local scripted model's dates and absences (src/kev/evals/local.ts), on
// every day of the seeded week, Monday 12 to Sunday 18 October 2026, and
// across the week's boundaries. The browser suite asks Kev on whatever day
// it runs; a Sunday once made "this weekend" Sunday alone and "today" an
// answer HOME's checker refused (an absence "else" over nothing shown).

const ZONE = 'Pacific/Auckland';
const at = (date: string) => new Date(`${date}T07:03:00+13:00`);
const WEEK = [
  ['2026-10-12', 'Monday'],
  ['2026-10-13', 'Tuesday'],
  ['2026-10-14', 'Wednesday'],
  ['2026-10-15', 'Thursday'],
  ['2026-10-16', 'Friday'],
  ['2026-10-17', 'Saturday'],
  ['2026-10-18', 'Sunday'],
] as const;

/** The tool calls a script's first step asks for, as [name, input]. */
function toolsOf(entry: ScriptEntry | undefined): [string, unknown][] {
  const step = entry as ScriptStep;
  if (!step || typeof step === 'function' || step.kind !== 'answer') return [];
  return (step.toolUses ?? []).map((u) => [u.name, u.input]);
}

/** A request whose one tool result is `result`, as the orchestrator would send it. */
function withResult(result: unknown): ProviderRequest {
  return {
    tier: 'fast',
    system: 'synthetic',
    tools: [],
    toolChoice: 'auto',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'synthetic question' }] },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUse: { id: 'toolu_1' },
            content: JSON.stringify(result),
          },
        ],
      },
    ],
  } as unknown as ProviderRequest;
}

/** The plan a script's answer step returns for a request, parsed. */
function planOf(entry: ScriptEntry | undefined, req: ProviderRequest) {
  const step = typeof entry === 'function' ? entry(req) : entry;
  if (!step || step.kind !== 'answer') throw new Error('not an answer step');
  return JSON.parse(step.text![0]!) as {
    lead: string;
    facts: {
      kind: string;
      scope: { of: string; from: string; to: string; else: boolean } | null;
    }[];
  };
}

const event = (id: string) => ({ ref: { type: 'event', id, at: null }, title: 'synthetic' });

describe('weekendOf: this weekend, from each day of the week', () => {
  it('a weekday looks ahead to the coming Saturday and Sunday', () => {
    for (const [date] of WEEK.slice(0, 5))
      expect(weekendOf(date), date).toEqual({
        sat: '2026-10-17',
        sun: '2026-10-18',
        ahead: '2026-10-17',
      });
  });

  it('Saturday is today and tomorrow', () => {
    expect(weekendOf('2026-10-17')).toEqual({
      sat: '2026-10-17',
      sun: '2026-10-18',
      ahead: '2026-10-17',
    });
  });

  it('Sunday is Sunday: the weekend is yesterday and today, and the day ahead is today', () => {
    expect(weekendOf('2026-10-18')).toEqual({
      sat: '2026-10-17',
      sun: '2026-10-18',
      ahead: '2026-10-18',
    });
  });

  it('the next Monday starts the next weekend; month and year boundaries hold', () => {
    expect(weekendOf('2026-10-19')).toEqual({
      sat: '2026-10-24',
      sun: '2026-10-25',
      ahead: '2026-10-24',
    });
    // Thursday 29 October: the weekend crosses into November.
    expect(weekendOf('2026-10-29')).toMatchObject({ sat: '2026-10-31', sun: '2026-11-01' });
    // Sunday 3 January 2027: Saturday is the 2nd.
    expect(weekendOf('2027-01-03')).toEqual({
      sat: '2027-01-02',
      sun: '2027-01-03',
      ahead: '2027-01-03',
    });
    // Thursday 31 December 2026: the weekend is in the new year.
    expect(weekendOf('2026-12-31')).toMatchObject({ sat: '2027-01-02', sun: '2027-01-03' });
  });
});

describe('the scripts read the right days', () => {
  it('today and tomorrow: today’s own read, and the next day’s agenda, across the weekend', () => {
    for (const [date] of WEEK) {
      const today = localScript('What’s happening today?', { now: at(date), timeZone: ZONE });
      expect(toolsOf(today.script[0]), date).toEqual([['get_today', {}]]);
    }
    const tomorrow = (date: string) =>
      toolsOf(localScript('What’s on tomorrow?', { now: at(date), timeZone: ZONE }).script[0]);
    expect(tomorrow('2026-10-16')).toEqual([
      ['get_agenda', { from: '2026-10-17', to: '2026-10-17' }],
    ]);
    expect(tomorrow('2026-10-17')).toEqual([
      ['get_agenda', { from: '2026-10-18', to: '2026-10-18' }],
    ]);
    expect(tomorrow('2026-10-18')).toEqual([
      ['get_agenda', { from: '2026-10-19', to: '2026-10-19' }],
    ]);
  });

  it('this weekend: Saturday to Sunday of this week on every day, Sunday included', () => {
    for (const [date] of WEEK) {
      const s = localScript('What have we got this weekend?', { now: at(date), timeZone: ZONE });
      expect(toolsOf(s.script[0]), date).toEqual([
        ['get_agenda', { from: '2026-10-17', to: '2026-10-18' }],
        ['get_weather', { from: '2026-10-17', to: '2026-10-18' }],
      ]);
    }
  });

  it('one weekend day (the weather, thinking the weekend through): Saturday, or Sunday on a Sunday', () => {
    const day = (date: string, q: string) =>
      toolsOf(localScript(q, { now: at(date), timeZone: ZONE }).script[0]).find(
        ([n]) => n === 'get_weather',
      )?.[1];
    for (const q of ['What’s the weather doing?', 'Help me think through our weekend.']) {
      expect(day('2026-10-14', q), q).toEqual({ from: '2026-10-17', to: '2026-10-17' });
      expect(day('2026-10-17', q), q).toEqual({ from: '2026-10-17', to: '2026-10-17' });
      expect(day('2026-10-18', q), q).toEqual({ from: '2026-10-18', to: '2026-10-18' });
    }
  });

  it('each approved scenario is one read, then the answer (and its one retry)', () => {
    for (const q of [
      'What’s happening today?',
      'What’s on tomorrow?',
      'What have we got this weekend?',
      'Help me think through our weekend.',
      'What’s the weather doing?',
    ])
      for (const [date] of WEEK) {
        const s = localScript(q, { now: at(date), timeZone: ZONE }).script;
        expect(s, `${q} ${date}`).toHaveLength(3);
        expect(toolsOf(s[0]).length, `${q} ${date}`).toBeGreaterThan(0);
        expect(typeof s[1], `${q} ${date}`).toBe('function');
      }
  });
});

describe('an agenda absence says "else" only beside a shown record', () => {
  it('nothing read: a plain absence; something read: the records, then "anything else"', () => {
    for (const q of [
      'What’s happening today?',
      'What’s on tomorrow?',
      'What have we got this weekend?',
    ]) {
      const s = localScript(q, { now: at('2026-10-18'), timeZone: ZONE }).script;
      const empty = planOf(s[1], withResult({ days: [{ items: [] }] }));
      expect(empty.facts, q).toHaveLength(1);
      expect(empty.facts[0]!.scope, q).toMatchObject({ of: 'agenda', else: false });

      const busy = planOf(s[1], withResult({ days: [{ items: [event('e1'), event('e2')] }] }));
      expect(
        busy.facts.filter((f) => f.kind === 'event'),
        q,
      ).toHaveLength(2);
      expect(busy.facts.at(-1)!.scope, q).toMatchObject({ of: 'agenda', else: true });
    }
  });

  it('thinking the weekend through without a stretch: no dated fact, so not the "when" lead', () => {
    const s = localScript('Help me think through our weekend.', {
      now: at('2026-10-18'),
      timeZone: ZONE,
    }).script;
    const task = { ref: { type: 'task', id: 't1' }, title: 'Paint the back fence' };
    expect(planOf(s[1], withResult({ tasks: [task] })).lead).toBe('here_you_go');
    const gap = { ref: { type: 'gap', id: 'g1', at: null } };
    expect(planOf(s[1], withResult({ gaps: [gap], tasks: [task] })).lead).toBe('when');
  });
});
