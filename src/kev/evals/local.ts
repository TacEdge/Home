import 'server-only';
import { addDays, isoDateInZone, weekdayOf } from '@/lib/dates';
import { BUNDLE_LEAD } from '../orchestrator';
import type { ScriptEntry, ScriptStep, ScriptedOptions } from '../providers/scripted';
import type { NeutralToolResult, ProviderRequest } from '../providers/types';

// The scripted model for local and CI runs of the Kev screen (M8 contract
// §14, §15.4; Package 4): what the scripted provider "answers" when an adult
// asks Kev something on a local or CI server (`HOME_TEST_KEV=scripted`, which
// every deployed environment refuses, N3). It reads the turn's own bundle
// and tool results, never the database, and picks records from them exactly
// as a model would: by selection, with every word still HOME's (§8.1), and
// every plan still checked by the answer checker. Synthetic data only.
//
// A small book of questions (the screen's suggestions and the §3.1 rows),
// matched loosely; anything else gets HOME's fixed "not sure". A test may
// also ask, by the `x-home-test-kev` header the turn route accepts only in
// this mode, for a failure: the provider down, a timeout, a refusal, an
// answer that never passes the check (the safe fallback, via escalation), or
// a slow model (for the working line). Never used with a real provider.

export type LocalMode = 'down' | 'timeout' | 'refusal' | 'invalid' | 'slow';
export const LOCAL_MODES: readonly LocalMode[] = ['down', 'timeout', 'refusal', 'invalid', 'slow'];

export type LocalScript = {
  script: ScriptEntry[];
  opts?: ScriptedOptions;
  /** A shorter user-facing deadline (the timeout state, in seconds rather than 55). */
  turnDeadlineMs?: number;
};

type Ref = { type: string; id: string; at?: string | null };
type Fact =
  | {
      kind: string;
      ref: { type: string; id: string; at: string | null };
      show: string[];
      scope: null;
    }
  | { kind: 'absence' | 'count'; ref: null; show: []; scope: Scope };
type Scope = {
  of: 'agenda' | 'conflicts' | 'forecast';
  from: string | null;
  to: string | null;
  people: string[];
  part: null;
  else: boolean;
};

const wire = (r: Ref) => ({ type: r.type, id: r.id, at: r.at ?? null });

/** The turn's bundle (the volatile context), parsed from the last message HOME labelled as its own. */
function bundleOf(req: ProviderRequest): unknown {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role !== 'user' || !('content' in m)) continue;
    for (const b of m.content)
      if (b.type === 'text' && b.text.startsWith(BUNDLE_LEAD)) {
        try {
          return JSON.parse(b.text.slice(BUNDLE_LEAD.length)) as unknown;
        } catch {
          return null;
        }
      }
  }
  return null;
}

/** Every tool result of the attempt so far, parsed, in order. */
function resultsOf(req: ProviderRequest): unknown[] {
  const out: unknown[] = [];
  for (const m of req.messages)
    if (m.role === 'user' && 'content' in m)
      for (const b of m.content)
        if (b.type === 'tool_result') {
          try {
            out.push(JSON.parse((b as NeutralToolResult).content));
          } catch {
            // not a result this book reads
          }
        }
  return out;
}

/** Every distinct ref of a type in a parsed result, in order of appearance. */
function refsIn(node: unknown, type: string, needle?: string): Ref[] {
  const out: Ref[] = [];
  const seen = new Set<string>();
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n !== 'object' || n === null) return;
    const o = n as Record<string, unknown>;
    const ref = o.ref as Ref | undefined;
    if (
      ref &&
      typeof ref === 'object' &&
      ref.type === type &&
      typeof ref.id === 'string' &&
      (needle === undefined || JSON.stringify(o).includes(needle))
    ) {
      const key = `${ref.type}:${ref.id}:${ref.at ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(ref);
      }
    }
    for (const [k, v] of Object.entries(o)) if (k !== 'ref') walk(v);
  };
  walk(node);
  return out;
}

const record = (r: Ref, show: string[] = []): Fact => ({
  kind: r.type,
  ref: wire(r),
  show,
  scope: null,
});
const absence = (of: Scope['of'], from: string, to: string, otherwise = true): Fact => ({
  kind: 'absence',
  ref: null,
  show: [],
  scope: { of, from, to, people: [], part: null, else: otherwise },
});

const plan = (lead: string, facts: Fact[], view: unknown = null): ScriptStep => ({
  kind: 'answer',
  text: [JSON.stringify({ lead, facts, view, decline: null })],
});
const decline = (code: string): ScriptStep => ({
  kind: 'answer',
  text: [JSON.stringify({ lead: null, facts: [], view: null, decline: code })],
});
const tools = (...uses: [string, Record<string, unknown>][]): ScriptStep => ({
  kind: 'answer',
  toolUses: uses.map(([name, input]) => ({ name, input })),
});
/** The same plan for the attempt and its regeneration, so a refused plan is refused twice. */
const twice = (entry: ScriptEntry): ScriptEntry[] => [entry, entry];

/** Lower case, one kind of apostrophe, no trailing punctuation. */
export function normaliseQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?.!\s]+$/, '');
}

/** The book: a question's script, from the turn's own reads. */
export function localScript(
  question: string,
  ctx: { now: Date; timeZone: string; mode?: string | null },
): LocalScript {
  const mode = LOCAL_MODES.includes(ctx.mode as LocalMode) ? (ctx.mode as LocalMode) : null;
  if (mode === 'down') return { script: [{ kind: 'error', code: 'unreachable' }] };
  if (mode === 'refusal') return { script: [{ kind: 'refusal' }] };
  if (mode === 'timeout')
    return { script: [{ kind: 'stall', ms: 60_000 }], turnDeadlineMs: 10_000 };
  const today = isoDateInZone(ctx.now, ctx.timeZone);
  if (mode === 'invalid') {
    // Reads, then an answer that is not a plan, twice, on each tier: the
    // fast attempt escalates ("Give me a moment…"), the deep one ends in the
    // safe fallback over what it read.
    const read = tools(['get_agenda', { from: today, to: today }]);
    const bad: ScriptStep = { kind: 'answer', text: ['Scripted reply.'] };
    return { script: [read, bad, bad, read, bad, bad] };
  }
  const book = scriptFor(normaliseQuestion(question), today);
  if (mode === 'slow')
    return {
      ...book,
      opts: { onCall: () => new Promise<void>((r) => setTimeout(r, 1_500)) },
    };
  return book;
}

function scriptFor(q: string, today: string): LocalScript {
  const wd = weekdayOf(today); // 0 Monday … 6 Sunday
  const sat = wd === 6 ? today : addDays(today, (5 - wd + 7) % 7);
  const sun = wd === 6 ? today : addDays(sat, 1);
  const tomorrow = addDays(today, 1);
  const nextMonday = addDays(today, 7 - wd);
  const nextSunday = addDays(nextMonday, 6);

  // Declines (§3.2): closed codes, rendered by HOME from fixed templates.
  if (/^(remember|don't forget)\b/.test(q)) return { script: twice(decline('memory')) };
  if (/^(add|put|create|make|move|cancel|change)\b/.test(q))
    return { script: twice(decline('write')) };
  if (/^(book|text|send|pay|email|ring|call|buy)\b/.test(q))
    return { script: twice(decline('external_action')) };
  if (/\bremind\b/.test(q)) return { script: twice(decline('reminder')) };
  if (/^(thanks|thank you|cheers|ta)( kev)?$/.test(q))
    return { script: twice(plan('welcome', [])) };

  if (/\btoday\b/.test(q) && /\b(happening|on|know)\b/.test(q))
    return {
      script: [
        tools(['get_today', {}]),
        ...twice((req: ProviderRequest) => {
          const read = resultsOf(req);
          const events = refsIn(read, 'event');
          return plan('when', [
            ...events.slice(0, 8).map((r) => record(r, ['people'])),
            absence('agenda', today, today),
          ]);
        }),
      ],
    };

  if (/\btomorrow\b/.test(q))
    return {
      script: [
        tools(['get_agenda', { from: tomorrow, to: tomorrow }]),
        ...twice((req: ProviderRequest) =>
          plan('when', [
            ...refsIn(resultsOf(req), 'event')
              .slice(0, 8)
              .map((r) => record(r, ['people'])),
            absence('agenda', tomorrow, tomorrow),
          ]),
        ),
      ],
    };

  if (/\bthink\b/.test(q) && /\bweekend\b/.test(q))
    return {
      script: [
        tools(
          [
            'get_gaps',
            {
              from: sat,
              to: sat,
              scope: 'household',
              min_minutes: 180,
              needs: ['dry_weather', 'daylight'],
            },
          ],
          ['get_tasks', { assignee: 'me' }],
          ['get_weather', { from: sat, to: sat }],
        ),
        ...twice((req: ProviderRequest) => {
          const read = resultsOf(req);
          const gap = refsIn(read, 'gap')[0];
          const fence = refsIn(read, 'task', 'Paint the back fence')[0] ?? refsIn(read, 'task')[0];
          const forecast = refsIn(read, 'forecast').length > 0;
          const facts: Fact[] = [];
          if (gap) facts.push(record(gap, forecast ? ['neighbours', 'forecast'] : ['neighbours']));
          if (fence) facts.push(record(fence, ['estimate', 'needs']));
          if (facts.length === 0) return plan('unsure', []);
          const view =
            gap && fence ? { type: 'suggestion', phrase: 'stretch_estimate', about: [0, 1] } : null;
          return plan('when', facts, view);
        }),
      ],
    };

  if (/\bweekend\b/.test(q))
    return {
      script: [
        tools(['get_agenda', { from: sat, to: sun }], ['get_weather', { from: sat, to: sun }]),
        ...twice((req: ProviderRequest) => {
          const read = resultsOf(req);
          return plan('righto_when', [
            ...refsIn(read, 'event')
              .slice(0, 6)
              .map((r) => record(r, ['people'])),
            ...refsIn(read, 'forecast').map((r) => record(r, ['phrase'])),
            absence('agenda', sat, sun),
          ]);
        }),
      ],
    };

  if (/\b(tasks?|to do|outstanding)\b/.test(q))
    return {
      script: [
        tools(['get_tasks', { assignee: 'me' }]),
        ...twice((req: ProviderRequest) => {
          const tasks = refsIn(resultsOf(req), 'task').slice(0, 8);
          return tasks.length > 0
            ? plan(
                'here_you_go',
                tasks.map((r) => record(r, ['status', 'estimate', 'needs', 'project'])),
              )
            : plan('unsure', []);
        }),
      ],
    };

  if (/\b(coordinate|next week)\b/.test(q))
    return {
      script: [
        tools(
          ['get_insights', { surface: 'forward_week' }],
          ['get_conflicts', { from: nextMonday, to: nextSunday }],
        ),
        ...twice((req: ProviderRequest) => {
          const read = resultsOf(req);
          const insights = refsIn(read, 'insight').slice(0, 4);
          const conflicts = refsIn(read, 'conflict').slice(0, 4);
          const flagged = [...insights, ...conflicts].map((r) => record(r));
          return plan(flagged.length > 0 ? 'flagged' : 'here_you_go', [
            ...flagged,
            ...(conflicts.length === 0
              ? [absence('conflicts', nextMonday, nextSunday, false)]
              : []),
          ]);
        }),
      ],
    };

  if (/\bweather\b/.test(q))
    return {
      script: [
        tools(['get_weather', { from: sat, to: sat }]),
        ...twice((req: ProviderRequest) => {
          const days = refsIn(resultsOf(req), 'forecast');
          return days.length > 0
            ? plan(
                'when',
                days.map((r) => record(r, ['phrase', 'temperature'])),
              )
            : plan('here_you_go', [absence('forecast', sat, sat, false)]);
        }),
      ],
    };

  return { script: twice(plan('unsure', [])) };
}

/** For tests: the bundle and results helpers, as the book reads them. */
export const _read = { bundleOf, resultsOf, refsIn };
