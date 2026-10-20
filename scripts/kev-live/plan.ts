import { createHash } from 'node:crypto';
import { ANSWER_JSON_SCHEMA } from '@/kev/answer/schema';
import { GEO_MULTIPLIER, INFERENCE_GEO, LIMITS, MODELS, TIERS } from '@/kev/config';
import { SYSTEM_PROMPT } from '@/kev/prompts/system';
import { THINKING_BINDING_BETA } from '@/kev/providers/fetch';
import type { ProbeOptions, ProviderToolDefinition } from '@/kev/providers/types';
import { attemptReservation, perCallMax } from '@/kev/router';
import { REVIEW_SET } from '@/kev/evals/review-set';
import { SCENARIOS } from '@/kev/evals/scenarios';
import type { Scenario, ScenarioClass } from '@/kev/evals/types';
import { toolDefinitions } from '@/kev/tools/registry';
import { TURNS_PER_DAY } from '@/domain/kev-bookkeeping/constants';
import type { KevTier } from '@/domain/kev-bookkeeping/schema';
import { EVALUATION_RUN_CEILING_USD_MICROS, SESSION_CEILING_USD_MICROS } from './guards.mts';

// The live verification plan, as code (M8 live-verification plan §7, §11;
// owner decisions 2 and 4, 2026-10-16): a fixed, versioned list of probes,
// each with its maximum cost computed from the gateway's own per-call
// maxima (src/trust/usage.ts through src/kev/router.ts), and a hash over
// the canonical plan, Kev's configuration (models, prices, tiers, limits)
// and digests of the system prompt, the tool definitions and the answer
// schema. The owner approves that hash; any change to the plan or to what
// it sends changes it, and the runner refuses a hash that does not match.
// Synthetic prompts only, about the fixture family (docs/concepts/README.md).

/**
 * Bumped with any change to the probes or how they run (2: named plans, live
 * verification #2; 3: tool selections, adaptive rules and per-probe request
 * digests, the tool-use diagnostic, ADR 0012 §53; 4: the turn probe's
 * two-phase checks and the two-phase acceptance plan, ADR 0012 §54; 5: plan
 * kinds, the scenario probe and the evaluation records, Package 5A, ADR 0012
 * §56; 6: the smoke scenario probe's checks and the deep smoke plan, Package
 * 5D, ADR 0012 §59). Not bumped for the G9 prefix-check plan (ADR 0012
 * §63): it adds a plan and an optional turn option without changing how
 * any existing plan runs, so the approved Stage 1 hash stands; the new
 * plan's own hash binds its option and the beta flag it enables.
 */
export const PLAN_VERSION = 6;

/** The fixture family's scenario instant (tests/integration/kev-fixture.ts's NOW): what the turn probe's tools read. */
export const TURN_NOW = '2026-10-13T18:03:00.000Z';

/**
 * A selection from Kev's tool definitions (no `escalate`), for the tool-use
 * diagnostic: only the named tools, all but the named ones, and optionally
 * every string `format` taken out of their schemas. HOME's own Zod schemas
 * are untouched: only the copy sent to the provider differs.
 */
export type ToolSelection = Readonly<{
  only?: readonly string[];
  omit?: readonly string[];
  dropFormats?: true;
}>;

/** One model request a probe sends, before any tool round. */
export type ProbeRequest = Readonly<{
  /** Kev's own system prompt, or a short synthetic one. */
  system: 'kev' | 'synthetic';
  /** Kev's tool definitions (no `escalate`), a selection of them, or none. */
  tools: 'kev' | 'none' | ToolSelection;
  toolChoice: 'auto' | 'none';
  /** Kev's answer schema as structured output, or none. */
  outputFormat: 'answer' | 'none';
  /** The synthetic question. */
  question: string;
}>;

export type ProbeSpec = Readonly<
  | {
      id: string;
      gates: readonly string[];
      kind: 'models';
      models: readonly string[];
      expect: string;
      stopOnFail: boolean;
    }
  | {
      id: string;
      gates: readonly string[];
      /**
       * `single`: one call. `tool_round`: a call, a synthetic result for
       * each tool it asks for, and the answer (G7). `cache_pair`: the same
       * request twice (G19).
       */
      kind: 'single' | 'tool_round' | 'cache_pair';
      tier: KevTier;
      request: ProbeRequest;
      probe: ProbeOptions;
      expect: string;
      stopOnFail: boolean;
      /** The diagnostic's request-shape identifier (matrix row), when it is one. */
      shape?: string;
      /** The hypothesis the probe tests and how each outcome reads (diagnostic only). */
      hypothesis?: string;
      /** Run only when each named probe ran and ended so; otherwise not run (`rule_skipped`). */
      runIf?: Readonly<{ failed?: readonly string[]; passed?: readonly string[] }>;
      /** Stop the session when this probe passes: the cause is isolated. */
      stopOnPass?: boolean;
      /** Stop the session when this probe fails with a recognised request path: the provider named the cause. */
      stopWhenNamed?: boolean;
    }
  | {
      id: string;
      gates: readonly string[];
      /** One turn through kev.handle() as the fixture adult Sam, on the runner's database. */
      kind: 'turn';
      question: string;
      /** Every call of the turn changed only as this names: G9's prefix check (ADR 0012 §63). */
      probe?: Readonly<Pick<ProbeOptions, 'prefixCheck'>>;
      expect: string;
      stopOnFail: boolean;
    }
  | {
      id: string;
      gates: readonly string[];
      /**
       * One run of a dataset scenario (src/kev/evals/scenarios.ts) through
       * kev.handle(), as its asker, in a fresh conversation, checked by the
       * scripted evals' own checker (src/kev/evals/judge.ts; Package 5A).
       */
      kind: 'scenario';
      scenario: string;
      tier: KevTier;
      /** Which repeat of the scenario on this tier (1-based, §12.3's × 3 and × 5). */
      repeat: number;
      /** The scenario's turns: each priced at the turn's maximum (§12.4 rule 4). */
      turns: number;
      /**
       * A smoke run (Package 5D): besides the scenario's own expectations,
       * every call on the tier's model, at least one tool round, the answer
       * phase (the format under `none`, never under `auto`), a grow-only
       * history, and an answer accepted by HOME's checker (first time or
       * after its one regeneration) with at least one citation.
       */
      smoke?: true;
      expect: string;
      stopOnFail: boolean;
    }
>;

/** The matrix rows a scenario class evidences (contract §15.6), and E9 for every run. */
const CLASS_ROWS: Readonly<Record<ScenarioClass, readonly string[]>> = {
  realistic: ['E1'],
  injection: ['E3'],
  privacy: ['E5'],
  sensitive: ['E5'],
  availability: ['E6'],
  fabrication: ['E6'],
  out_of_scope: ['E7'],
  routing: ['E8'],
};

/**
 * Scenario probes for an evaluation plan (Package 5A): each named scenario,
 * on each tier it runs on, repeated. Escalation scenarios are fast's alone,
 * as in the scripted evals.
 */
export function scenarioProbes(opts: {
  scenarios: readonly string[];
  tiers: readonly KevTier[];
  repeats: number;
}): ProbeSpec[] {
  return opts.scenarios.flatMap((id) => {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario ${id}`);
    return opts.tiers
      .filter((t) => (s.tiers ?? ['fast', 'deep']).includes(t))
      .flatMap((tier) =>
        Array.from({ length: opts.repeats }, (_, i) => ({
          id: `${s.id}@${tier}#${i + 1}`,
          gates: [...CLASS_ROWS[s.class], 'E9'],
          kind: 'scenario' as const,
          scenario: s.id,
          tier,
          repeat: i + 1,
          turns: s.turns.length,
          expect: 'every expectation of the scenario holds (the scripted evals’ checker)',
          stopOnFail: false,
        })),
      );
  });
}

/** Each fixture adult's scenario turns in a set of probes (§9.6's day limit is per adult). */
export function turnsByAsker(probes: readonly ProbeSpec[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of probes) {
    if (p.kind !== 'scenario') continue;
    const asker = SCENARIOS.find((s) => s.id === p.scenario)?.asker ?? 'unknown';
    out.set(asker, (out.get(asker) ?? 0) + p.turns);
  }
  return out;
}

/**
 * What a scenario sends and is checked against, for the plan hash: its
 * asker, instant, questions and expectations. Not its script, which only
 * the scripted provider reads.
 */
export function scenarioDigest(s: Scenario): string {
  return sha256(
    canonicalJson({
      ...s,
      turns: s.turns.map((t) => ({ question: t.question })),
    }),
  );
}

const SYNTHETIC_SYSTEM = 'You are a test assistant for a software check. Answer in one short line.';
/** The synthetic tool result a tool-round probe returns for every tool call (no record of any household). */
export const SYNTHETIC_TOOL_RESULT = JSON.stringify({ items: [], note: 'synthetic probe result' });
const kevAnswer = (question: string, toolChoice: 'auto' | 'none' = 'auto'): ProbeRequest => ({
  system: 'kev',
  tools: 'kev',
  toolChoice,
  outputFormat: 'answer',
  question,
});
const plain = (question: string): ProbeRequest => ({
  system: 'synthetic',
  tools: 'none',
  toolChoice: 'auto',
  outputFormat: 'none',
  question,
});
const G7_QUESTION = 'What’s on for the family this Saturday?';
const G8_QUESTION = 'Reply with the single word READY.';
const G8_SYSTEM = 'Reply in lower case only.';

// The tool-use diagnostic (ADR 0012 §53): why the provider refused Kev's
// tool-carrying requests with HTTP 400 in live verification #2. One call
// each, on Sonnet 5.5 (the fast tier), with Kev's own system prompt and
// `tool_choice: auto`, bisecting the refused request (every strict read
// tool and the answer format) from the smallest tool-carrying request up.
// What run #2 already established is not repeated: a plain request (run
// #1's G8) and Kev's whole prompt with every strict tool and the answer
// format under `tool_choice: none` (G19, accepted twice), which holds the
// matrix's rows A (no tools, no format) and B (the format alone).
const DX_QUESTION = 'Which synthetic records are listed for this Saturday?';
const dx = (tools: ProbeRequest['tools'], outputFormat: 'answer' | 'none'): ProbeRequest => ({
  system: 'kev',
  tools,
  toolChoice: 'auto',
  outputFormat,
  question: DX_QUESTION,
});
/** Kev's read tools whose input schemas carry a union (`anyOf`): `get_tasks.assignee`, `get_gaps.scope`. */
const UNION_TOOLS = ['get_tasks', 'get_gaps'] as const;
/** Kev's read tools that take no input (`properties: {}`). */
const EMPTY_TOOLS = ['get_today', 'get_calendar_health'] as const;
const DX_PROBE: ProbeOptions = {};
const DX_GATES = ['DX', 'G22', 'G10'] as const;

export const DIAGNOSTIC_PROBES = [
  {
    id: 'dx-c-one-tool',
    gates: DX_GATES,
    kind: 'single',
    tier: 'fast',
    shape: 'C: one strict tool (search), auto, no answer format',
    hypothesis:
      'A strict tool with one required string, nothing else. Refused: strict tool use under tool_choice auto is refused with this request’s settings whatever the schema (stop; the recognised path and signals say which setting). Accepted: the cause is in Kev’s tool set or the answer format.',
    request: dx({ only: ['search'] }, 'none'),
    probe: DX_PROBE,
    expect: 'accepted (HTTP 200); counted first; US inference',
    stopOnFail: true,
  },
  {
    id: 'dx-d-all-tools',
    gates: DX_GATES,
    kind: 'single',
    tier: 'fast',
    shape: 'D: every strict read tool, auto, no answer format',
    hypothesis:
      'Kev’s 12 strict read tools, no format. Refused: the cause is in the tool set (the F rows narrow it, unless the provider names the path). Accepted: the tools alone compile; E tests them with the format.',
    request: dx('kev', 'none'),
    probe: DX_PROBE,
    expect: 'accepted (HTTP 200); counted first; US inference',
    stopOnFail: false,
    runIf: { passed: ['dx-c-one-tool'] },
    stopWhenNamed: true,
  },
  {
    id: 'dx-e-tools-format',
    gates: DX_GATES,
    kind: 'single',
    tier: 'fast',
    shape: 'E: every strict read tool and the answer format, auto (run #2’s refused first call)',
    hypothesis:
      'Run only when D was accepted. Refused: the combination of strict tools and the answer format under tool_choice auto is the cause. Accepted: run #2’s first-call refusal does not reproduce in one call; the difference is elsewhere (stop and report).',
    request: dx('kev', 'answer'),
    probe: DX_PROBE,
    expect: 'accepted (HTTP 200); counted first; US inference',
    stopOnFail: true,
    runIf: { passed: ['dx-d-all-tools'] },
    stopOnPass: true,
  },
  {
    id: 'dx-f1-no-unions',
    gates: DX_GATES,
    kind: 'single',
    tier: 'fast',
    shape:
      'F1: every strict read tool but the two with unions (get_tasks, get_gaps), auto, no format',
    hypothesis:
      'Run only when D was refused. Accepted: a union (anyOf with a const branch beside a uuid format) is the cause (stop). Refused: not the unions alone.',
    request: dx({ omit: UNION_TOOLS }, 'none'),
    probe: DX_PROBE,
    expect: 'accepted (HTTP 200) isolates the cause',
    stopOnFail: false,
    runIf: { failed: ['dx-d-all-tools'] },
    stopOnPass: true,
    stopWhenNamed: true,
  },
  {
    id: 'dx-f2-no-formats',
    gates: DX_GATES,
    kind: 'single',
    tier: 'fast',
    shape:
      'F2: every strict read tool with every string format (date, uuid) removed, auto, no format',
    hypothesis:
      'Run only when D and F1 were refused. Accepted: a string format is the cause (stop). Refused: not the formats alone.',
    request: dx({ dropFormats: true }, 'none'),
    probe: DX_PROBE,
    expect: 'accepted (HTTP 200) isolates the cause',
    stopOnFail: false,
    runIf: { failed: ['dx-d-all-tools', 'dx-f1-no-unions'] },
    stopOnPass: true,
    stopWhenNamed: true,
  },
  {
    id: 'dx-f3-no-empty',
    gates: DX_GATES,
    kind: 'single',
    tier: 'fast',
    shape:
      'F3: every strict read tool but the two with no input (get_today, get_calendar_health), auto, no format',
    hypothesis:
      'Run only when D, F1 and F2 were refused. Accepted: a tool with an empty input schema is the cause (stop). Refused: not those alone.',
    request: dx({ omit: EMPTY_TOOLS }, 'none'),
    probe: DX_PROBE,
    expect: 'accepted (HTTP 200) isolates the cause',
    stopOnFail: false,
    runIf: { failed: ['dx-d-all-tools', 'dx-f1-no-unions', 'dx-f2-no-formats'] },
    stopOnPass: true,
    stopWhenNamed: true,
  },
  {
    id: 'dx-f4-not-strict',
    gates: DX_GATES,
    kind: 'single',
    tier: 'fast',
    shape: 'F4: every read tool, not strict, auto, no format',
    hypothesis:
      'Run only when D, F1, F2 and F3 were refused. Accepted: strict compilation of the whole set is refused (its combined complexity), not one feature. Refused: the tool definitions are refused even unstrict (names, descriptions, size).',
    request: dx('kev', 'none'),
    probe: { strictTools: false },
    expect: 'accepted (HTTP 200) isolates the cause',
    stopOnFail: true,
    runIf: { failed: ['dx-d-all-tools', 'dx-f1-no-unions', 'dx-f2-no-formats', 'dx-f3-no-empty'] },
    stopOnPass: true,
  },
] satisfies ProbeSpec[];

/** A string `format` taken out of a JSON Schema, at keyword positions only (never a property named `format`). */
export function withoutFormats(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutFormats);
  if (schema === null || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'format' && typeof v === 'string') continue;
    if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([n, sub]) => [n, withoutFormats(sub)]),
      );
      continue;
    }
    out[k] = withoutFormats(v);
  }
  return out;
}

/**
 * The tool definitions a probe request sends: none, Kev's read tools (no
 * `escalate`), or a selection of them. A selection naming a tool Kev does
 * not have, or leaving none, is refused: the plan never sends what it
 * does not describe.
 */
export function probeTools(r: ProbeRequest): readonly ProviderToolDefinition[] {
  if (r.tools === 'none') return [];
  const all = toolDefinitions({ escalate: false });
  if (r.tools === 'kev') return all;
  const sel = r.tools;
  const names = new Set(all.map((t) => t.name));
  for (const n of [...(sel.only ?? []), ...(sel.omit ?? [])])
    if (!names.has(n)) throw new Error(`a tool selection names ${n}, which Kev does not have`);
  let picked = all;
  if (sel.only) picked = picked.filter((t) => sel.only!.includes(t.name));
  if (sel.omit) picked = picked.filter((t) => !sel.omit!.includes(t.name));
  if (picked.length === 0) throw new Error('a tool selection leaves no tool');
  if (sel.dropFormats)
    picked = picked.map((t) =>
      Object.freeze({
        ...t,
        inputSchema: Object.freeze(withoutFormats(t.inputSchema) as Record<string, unknown>),
      }),
    );
  return Object.freeze(picked);
}

/** The probes, in the plan's order (§11 step 6): G1 → G22 → G7, G10, G19 → G20 → G8 → Haiku → G9/G21. */
export const PROBES: readonly ProbeSpec[] = Object.freeze([
  {
    id: 'g1-models',
    gates: ['G1'],
    kind: 'models',
    models: [MODELS.opus55.id, MODELS.sonnet55.id, MODELS.haiku55.id],
    expect:
      'each id resolves (200, the same id); context window ≥ 32,000 and output limit ≥ the tier’s max_tokens',
    stopOnFail: true,
  },
  {
    id: 'g7-fast',
    gates: ['G7', 'G22', 'G10'],
    kind: 'tool_round',
    tier: 'fast',
    request: kevAnswer(G7_QUESTION),
    probe: {},
    expect:
      'a tool round, then an answer that parses as Kev’s answer plan; counted first; US inference',
    stopOnFail: false,
  },
  {
    id: 'g7-deep',
    gates: ['G7', 'G22', 'G10'],
    kind: 'tool_round',
    tier: 'deep',
    request: kevAnswer(G7_QUESTION),
    probe: {},
    expect:
      'a tool round, then an answer that parses as Kev’s answer plan; counted first; US inference',
    stopOnFail: false,
  },
  {
    id: 'g19-cache-fast',
    gates: ['G19', 'G22', 'G10'],
    kind: 'cache_pair',
    tier: 'fast',
    request: kevAnswer('Say hello.', 'none'),
    probe: {},
    expect: 'the second call reports cache_read_input_tokens > 0 (recorded)',
    stopOnFail: false,
  },
  {
    id: 'g20-abort-fast',
    gates: ['G20', 'G22', 'G10'],
    kind: 'single',
    tier: 'fast',
    request: plain('Count from one to twenty, one number per line.'),
    probe: { abortAfterFirstEvent: true },
    expect:
      'aborted after message_start; HOME records partial usage and charges at least the per-call maximum',
    stopOnFail: false,
  },
  {
    id: 'g8-fast',
    gates: ['G8', 'G22', 'G10'],
    kind: 'single',
    tier: 'fast',
    request: plain(G8_QUESTION),
    probe: { systemMessage: G8_SYSTEM },
    expect:
      'a mid-conversation system message is accepted (recorded; followed when the reply is lower case)',
    stopOnFail: false,
  },
  {
    id: 'g8-deep',
    gates: ['G8', 'G22', 'G10'],
    kind: 'single',
    tier: 'deep',
    request: plain(G8_QUESTION),
    probe: { systemMessage: G8_SYSTEM },
    expect:
      'a mid-conversation system message is accepted (recorded; followed when the reply is lower case)',
    stopOnFail: false,
  },
  {
    id: 'haiku-g7',
    gates: ['G7', 'G22', 'G10'],
    kind: 'tool_round',
    tier: 'fast',
    request: kevAnswer(G7_QUESTION),
    probe: { probeModel: 'haiku55' },
    expect:
      'Haiku 5.5: a tool round, then an answer that parses as Kev’s answer plan (evaluation evidence only)',
    stopOnFail: false,
  },
  {
    id: 'haiku-g8',
    gates: ['G8', 'G22', 'G10'],
    kind: 'single',
    tier: 'fast',
    request: plain(G8_QUESTION),
    probe: { probeModel: 'haiku55', systemMessage: G8_SYSTEM },
    expect: 'Haiku 5.5: a mid-conversation system message is accepted (recorded)',
    stopOnFail: false,
  },
  {
    id: 'g1-effort-low-fast',
    gates: ['G1', 'G22', 'G10'],
    kind: 'single',
    tier: 'fast',
    request: plain('Say hello.'),
    probe: { effort: 'low' },
    expect: 'effort low is accepted',
    stopOnFail: false,
  },
  {
    id: 'g1-effort-low-deep',
    gates: ['G1', 'G22', 'G10'],
    kind: 'single',
    tier: 'deep',
    request: plain('Say hello.'),
    probe: { effort: 'low' },
    expect: 'effort low is accepted',
    stopOnFail: false,
  },
  {
    id: 'g1-effort-low-haiku',
    gates: ['G1', 'G22', 'G10'],
    kind: 'single',
    tier: 'fast',
    request: plain('Say hello.'),
    probe: { probeModel: 'haiku55', effort: 'low' },
    expect: 'effort low is accepted on Haiku 5.5',
    stopOnFail: false,
  },
  {
    id: 'g9-g21-turn',
    // G7 as revised (ADR 0012 §54): the structured answer after a tool round, in the answer phase.
    gates: ['G7', 'G9', 'G21', 'G22', 'G10'],
    kind: 'turn',
    question: 'What’s on this Saturday, and what’s left to do on the back fence?',
    expect:
      'HOME’s checked answer, citing what it read, after at least one tool round; the answer phase sends the format under none, and no call sends it under auto; every request body extends the one before; thinking blocks replayed',
    stopOnFail: false,
  },
  ...DIAGNOSTIC_PROBES,
] satisfies ProbeSpec[]);

/**
 * The deep-tier smoke run (Package 5D, ADR 0012 §59): one live Opus turn on
 * one catalogue scenario, the owner's own "What does our weekend look
 * like?", asked by the synthetic adult Sam on the evaluation world. It
 * needs a read (the weekend is not in the turn's bundle), cites a record
 * (Saturday's football) and carries the forecast's credit, so a pass shows
 * the two-phase loop, grounding and HOME's checks on deep. It is in the
 * owner's review set, so the run writes the deep review page.
 */
/**
 * G9's verification on this (pre-cutoff) organisation (ADR 0012 §63): one
 * orchestrated fast turn through kev.handle(), the production path, with
 * every call opted into the provider's prefix check (`block_binding`
 * `prefix_mismatch_behavior: "error"` under the thinking-binding beta flag),
 * so a request that does not extend its conversation's history is refused
 * rather than silently stripped. The question is live verification #4's,
 * which gave two tool rounds and a regeneration on fast; neither can be
 * forced, so the probe passes only when one attempt shows both.
 */
export const G9_BINDING_PROBES: readonly ProbeSpec[] = Object.freeze([
  {
    id: 'g9-binding-turn',
    gates: ['G9', 'G21', 'G7', 'G22', 'G10'],
    kind: 'turn',
    question: 'What’s on this Saturday, and what’s left to do on the back fence?',
    probe: Object.freeze({ prefixCheck: 'error' as const }),
    expect:
      'HOME’s checked answer, citing what it read; one attempt with at least two tool rounds and a regeneration, thinking replayed; every call accepted with the prefix check on, its input_transformations present and empty',
    stopOnFail: true,
  },
] satisfies ProbeSpec[]);

export const DEEP_SMOKE_PROBES: readonly ProbeSpec[] = Object.freeze([
  {
    id: 'realistic.weekend_look@deep#1',
    gates: ['G7', 'G9', 'G21', 'G22', 'G10', 'E1', 'E9'],
    kind: 'scenario',
    scenario: 'realistic.weekend_look',
    tier: 'deep',
    repeat: 1,
    turns: 1,
    smoke: true,
    expect:
      'every expectation of the scenario holds; every call on Opus 5.5, counted first and in the US; at least one tool round, then the answer phase (the format under none, never under auto); a grow-only history; HOME’s checked answer with at least one citation',
    stopOnFail: true,
  },
] satisfies ProbeSpec[]);

/**
 * Package 5E's Stage 1 (ADR 0012 §62): the owner's review set (5C), in its
 * own order, once each on the fast tier as configured (Sonnet 5.5,
 * `medium`). Plain scenario probes: the catalogue's checker, no extra
 * smoke check, and no stop on a failed scenario (a run of evidence).
 */
export const REVIEW_FAST_PROBES: readonly ProbeSpec[] = Object.freeze(
  scenarioProbes({
    scenarios: REVIEW_SET.map((e) => e.scenario),
    tiers: ['fast'],
    repeats: 1,
  }),
);

/**
 * Package 5E's review set on deep (the owner's direction after Stage 1,
 * ADR 0012 §68): the same review set, in its order, once each on the deep
 * tier as configured (Opus 5.5). The fast-only routing scenario is not run
 * on deep, so 19 scenarios and 20 turns. Plain scenario probes, as Stage 1.
 */
export const REVIEW_DEEP_PROBES: readonly ProbeSpec[] = Object.freeze(
  scenarioProbes({
    scenarios: REVIEW_SET.map((e) => e.scenario),
    tiers: ['deep'],
    repeats: 1,
  }),
);

/**
 * The named plans (live verification #2, 2026-10-17; ADR 0012 §51): which
 * probes from the list above a session runs, and its own session cap,
 * never above the US$10 ceiling (owner decision 4). `full` is run #1's
 * plan, kept for its tests and its record. `verification-2` re-runs only
 * what run #1 could not reach after the strict-schema correction (§50):
 * G1 first (it stops the session if a model id fails), G7 on the three
 * models, G19, and the orchestrated turn (G9, G21); G22 and G10 are
 * checked on every model call. The probes that passed in run #1 (G8, G20,
 * `low` effort) are not repeated.
 */
export const PLANS = Object.freeze({
  // Run #1's plan: every verification probe, the diagnostic's excepted.
  full: Object.freeze({
    probes: Object.freeze(
      PROBES.map((p) => p.id).filter((id) => !DIAGNOSTIC_PROBES.some((d) => d.id === id)),
    ),
    sessionCapUsdMicros: SESSION_CEILING_USD_MICROS,
  }),
  'verification-2': Object.freeze({
    probes: Object.freeze([
      'g1-models',
      'g7-fast',
      'g7-deep',
      'haiku-g7',
      'g19-cache-fast',
      'g9-g21-turn',
    ]),
    // The owner's planning limit for session 2 (2026-10-17): US$6.
    sessionCapUsdMicros: 6_000_000n,
  }),
  'tool-diagnostic': Object.freeze({
    probes: Object.freeze(DIAGNOSTIC_PROBES.map((p) => p.id)),
    // At most six probes run on any path (C, D, F1–F4): US$1.596672 at
    // most. A US$2.50 budget is NZ$4 in HOME's whole-NZ$ reservation cap
    // (US$2.222222), which holds the peak (five probes settled at their
    // maxima and the sixth's US$0.665280 reservation, US$1.995840); a
    // budget below US$2.23 is NZ$3 and cannot (ADR 0012 §53; tested).
    sessionCapUsdMicros: 2_500_000n,
  }),
  // The two-phase answer's live acceptance (ADR 0012 §54): one orchestrated
  // turn on the fast tier through kev.handle(), the production path.
  'two-phase-acceptance': Object.freeze({
    probes: Object.freeze(['g9-g21-turn']),
    // The turn's maximum is the US$1.50 turn ceiling (a fast attempt and any
    // escalation together). A US$2 budget is NZ$3 in HOME's whole-NZ$
    // reservation cap (US$1.666667), which holds it; a budget below US$1.67
    // is NZ$2 and cannot (ADR 0012 §54; tested).
    sessionCapUsdMicros: 2_000_000n,
  }),
  // Package 5D's deep smoke run (ADR 0012 §59): one deep scenario turn. Its
  // maximum is the US$1.50 turn ceiling (the deep attempt's reservation:
  // five calls at US$0.356224 is US$1.781120, held to the ceiling). A
  // US$1.67 budget is NZ$3 in HOME's whole-NZ$ reservation cap
  // (US$1.666667), which holds it; a budget below US$1.67 is NZ$2 and cannot
  // (tested). The smallest practical cap, then.
  'deep-smoke': Object.freeze({
    kind: 'evaluation',
    probes: Object.freeze(DEEP_SMOKE_PROBES.map((p) => p.id)),
    specs: DEEP_SMOKE_PROBES,
    sessionCapUsdMicros: 1_670_000n,
  }),
  // Package 5E's Stage 1 (M8-PACKAGE-5E-READINESS.md §8; ADR 0012 §62): the
  // owner's review set (5C's twenty scenarios, 21 turns) once each on the
  // fast tier, Sonnet 5.5 `medium`, unchanged. Its maximum is 21 turns at
  // the US$1.50 turn ceiling, US$31.50. HOME's whole-NZ$ cap must hold that
  // whole sum (each earlier turn assumed settled at its maximum): US$31.67
  // is NZ$57 (US$31.666667), which holds it; US$31.66 is NZ$56 (US$31.11)
  // and cannot (tested). The smallest practical cap, then.
  'review-fast': Object.freeze({
    kind: 'evaluation',
    probes: Object.freeze(REVIEW_FAST_PROBES.map((p) => p.id)),
    specs: REVIEW_FAST_PROBES,
    sessionCapUsdMicros: 31_670_000n,
  }),
  // The review set on deep (ADR 0012 §68): 20 turns at the US$1.50 turn
  // ceiling, US$30.00. US$30.00 is NZ$54 in HOME's whole-NZ$ cap
  // (US$30.000000), which holds it; US$29.99 is NZ$53 (US$29.44) and cannot
  // (tested). The smallest practical cap, then.
  'review-deep': Object.freeze({
    kind: 'evaluation',
    probes: Object.freeze(REVIEW_DEEP_PROBES.map((p) => p.id)),
    specs: REVIEW_DEEP_PROBES,
    sessionCapUsdMicros: 30_000_000n,
  }),
  // G9's verification (ADR 0012 §63): one fast turn with the prefix check
  // on. Its maximum is the US$1.50 turn ceiling (a fast attempt and any
  // escalation together). A US$1.67 budget is NZ$3 in HOME's whole-NZ$
  // reservation cap (US$1.666667), which holds it; a budget below US$1.67 is
  // NZ$2 and cannot (tested). The smallest practical cap, then.
  'g9-binding': Object.freeze({
    probes: Object.freeze(G9_BINDING_PROBES.map((p) => p.id)),
    specs: G9_BINDING_PROBES,
    sessionCapUsdMicros: 1_670_000n,
  }),
} satisfies Record<string, PlanDef>);

/**
 * A named plan: its probes and its cap. `verification` (the default) is
 * held to the US$10 session ceiling; `evaluation` (Package 5's scenario
 * runs, §12.4) to the US$175 run ceiling, and holds scenario probes only.
 */
export type PlanDef = Readonly<{
  kind?: 'verification' | 'evaluation';
  probes: readonly string[];
  /** An evaluation plan's own probes (scenario probes are not in the list above). */
  specs?: readonly ProbeSpec[];
  sessionCapUsdMicros: bigint;
}>;

export type PlanName = keyof typeof PLANS;

/**
 * The plan the runner runs now: the review set on deep (ADR 0012 §68), for
 * the owner's approval. Stage 1, the review set on fast, ran as live
 * verification #8 (§67) and stays, with its hash, for its tests and record.
 */
export const SESSION_PLAN: PlanName = 'review-deep';

/** A named plan's probes, in the order of the list above. */
export function planProbes(name: PlanName): readonly ProbeSpec[] {
  const def: PlanDef = PLANS[name];
  const ids = new Set<string>(def.probes);
  const probes = (def.specs ?? PROBES).filter((p) => ids.has(p.id));
  if (probes.length !== ids.size) throw new Error(`plan ${name} names a probe that does not exist`);
  return probes;
}

/** Planned model calls per probe (before HOME's one retry). */
export function plannedCalls(p: ProbeSpec): number {
  switch (p.kind) {
    case 'models':
      return 0;
    case 'single':
      return 1;
    case 'tool_round':
    case 'cache_pair':
      return 2;
    case 'turn':
      return LIMITS.modelCallsPerAttempt;
    case 'scenario':
      // Each turn: a fast attempt and, where escalation is possible, a deep one.
      return p.turns * LIMITS.modelCallsPerAttempt * (p.tier === 'fast' ? 2 : 1);
  }
}

/**
 * A scenario turn's maximum (§12.4 rule 4): the attempt's reservation on
 * its tier plus, where escalation is possible (a turn started on fast), the
 * deep attempt's, never above the US$1.50 turn ceiling.
 */
export function scenarioTurnMaxUsdMicros(tier: KevTier): bigint {
  const most =
    tier === 'fast'
      ? attemptReservation('fast') + attemptReservation('deep')
      : attemptReservation('deep');
  return most < LIMITS.turnCeilingUsdMicros ? most : LIMITS.turnCeilingUsdMicros;
}

/**
 * A probe's maximum cost (µ$), from the gateway's own figures: each planned
 * call twice (HOME's one retry) at its tier's per-call maximum, never above
 * the attempt's reservation, which the budget enforces; a turn at the turn
 * ceiling (US$1.50), which bounds a fast attempt and an escalation together.
 * A Haiku probe runs on a fast budget, so it is reserved and bounded at the
 * fast tier's (Sonnet 5.5's) per-call maximum; its recorded cost is at
 * Haiku's own prices, which are lower in every category.
 */
export function probeMaxUsdMicros(p: ProbeSpec): bigint {
  if (p.kind === 'models') return 0n;
  if (p.kind === 'turn') return LIMITS.turnCeilingUsdMicros;
  if (p.kind === 'scenario') return BigInt(p.turns) * scenarioTurnMaxUsdMicros(p.tier);
  const withRetry = BigInt(plannedCalls(p) * 2) * perCallMax(p.tier);
  const reservation = attemptReservation(p.tier);
  return withRetry < reservation ? withRetry : reservation;
}

/** The same, without HOME's one retry: the figure if every call succeeds first time. */
export function probeMaxNoRetryUsdMicros(p: ProbeSpec): bigint {
  if (p.kind === 'models') return 0n;
  if (p.kind === 'turn') return LIMITS.turnCeilingUsdMicros;
  if (p.kind === 'scenario') return probeMaxUsdMicros(p);
  return BigInt(plannedCalls(p)) * perCallMax(p.tier);
}

/** A probe's run rule (ADR 0012 §53): every named probe failed, and every other passed. */
export function ruleHolds(
  rule: Readonly<{ failed?: readonly string[]; passed?: readonly string[] }>,
  outcomeOf: (id: string) => string | undefined,
): boolean {
  return (
    (rule.failed ?? []).every((id) => outcomeOf(id) === 'fail') &&
    (rule.passed ?? []).every((id) => outcomeOf(id) === 'pass')
  );
}

/** The largest hold a probe takes at once: an attempt's reservation; a turn's ceiling. */
export function probeHoldUsdMicros(p: ProbeSpec): bigint {
  if (p.kind === 'models') return 0n;
  if (p.kind === 'turn') return LIMITS.turnCeilingUsdMicros;
  // One turn at a time: its attempts, settled before the next turn reserves.
  if (p.kind === 'scenario') return scenarioTurnMaxUsdMicros(p.tier);
  return attemptReservation(p.tier);
}

/**
 * Every sequence of probes the plan's rules can run, each probe passing or
 * failing (executePlan's own rules: a run rule, then stop on a pass or a
 * failure as the probe says; stopping when the provider names a path only
 * ever shortens a sequence, and a probe that does not run costs nothing).
 */
export function reachablePaths<P extends ProbeSpec>(probes: readonly P[]): P[][] {
  const paths: P[][] = [];
  const walk = (i: number, ran: P[], outcomes: ReadonlyMap<string, string>) => {
    const p = probes[i];
    if (!p) return void paths.push(ran);
    if ('runIf' in p && p.runIf && !ruleHolds(p.runIf, (id) => outcomes.get(id)))
      return walk(i + 1, ran, outcomes);
    // A scenario probe has no run rule, never stops the run and no rule names
    // it, so its outcome never changes the sequence: one branch, not two
    // (an evaluation's hundred-odd probes would otherwise be 2^n paths).
    const branches = p.kind === 'scenario' ? (['pass'] as const) : (['pass', 'fail'] as const);
    for (const outcome of branches) {
      const next = [...ran, p];
      const stops =
        outcome === 'pass' ? 'stopOnPass' in p && p.stopOnPass === true : p.stopOnFail === true;
      if (stops) paths.push(next);
      else walk(i + 1, next, new Map(outcomes).set(p.id, outcome));
    }
  };
  walk(0, [], new Map());
  return paths;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** JSON with sorted keys and bigints as strings: one text for one plan. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === 'bigint') return v.toString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort())
        out[k] = norm((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export type Plan = Readonly<{
  canonical: Record<string, unknown>;
  hash: string;
  name: string;
  kind: 'verification' | 'evaluation';
  probes: readonly (ProbeSpec & {
    maxUsdMicros: bigint;
    maxNoRetryUsdMicros: bigint;
    requestDigest?: string;
    scenarioDigest?: string;
  })[];
  /** The most any sequence the rules can run may cost: the run's maximum exposure. */
  totalMaxUsdMicros: bigint;
  totalNoRetryUsdMicros: bigint;
  /** Every listed probe at its maximum, as if no rule skipped one (never run as such). */
  listedMaxUsdMicros: bigint;
  /**
   * The most HOME's reservation cap must hold at once on any sequence: what
   * earlier probes settled at their maxima, plus the next probe's hold.
   */
  peakHoldUsdMicros: bigint;
  /** This plan's session cap: the budget may not exceed it (never above its kind's ceiling). */
  sessionCapUsdMicros: bigint;
  /** The ceiling for its kind: US$10 for verification, US$175 for an evaluation run. */
  ceilingUsdMicros: bigint;
}>;

/** The plan: its probes with their maxima, the total, and the hash the owner approves. */
export function buildPlan(
  name: string = SESSION_PLAN,
  probes: readonly ProbeSpec[] = planProbes(name as PlanName),
  def: PlanDef = PLANS[name as PlanName],
): Plan {
  const { sessionCapUsdMicros } = def;
  const kind = def.kind ?? 'verification';
  const ceilingUsdMicros =
    kind === 'evaluation' ? EVALUATION_RUN_CEILING_USD_MICROS : SESSION_CEILING_USD_MICROS;
  if (kind === 'verification' && sessionCapUsdMicros > SESSION_CEILING_USD_MICROS)
    throw new Error('a plan’s session cap is never above the US$10 ceiling');
  if (kind === 'evaluation' && sessionCapUsdMicros > EVALUATION_RUN_CEILING_USD_MICROS)
    throw new Error('an evaluation run’s cap is never above the US$175 run ceiling');
  // An evaluation runs scenarios only, so its maximum is §12.4 rule 4's; a
  // verification plan runs none.
  if (probes.some((p) => (p.kind === 'scenario') !== (kind === 'evaluation')))
    throw new Error('an evaluation plan holds scenario probes only, and a verification plan none');
  for (const p of probes)
    if (
      p.kind === 'scenario' &&
      SCENARIOS.find((s) => s.id === p.scenario)?.turns.length !== p.turns
    )
      throw new Error(`scenario probe ${p.id} does not match its scenario’s turns`);
  // HOME's own per-adult day limit (§9.6) is never worked around: no
  // evaluation gives one adult more turns than it allows in a day.
  for (const [asker, turns] of turnsByAsker(probes))
    if (turns > TURNS_PER_DAY)
      throw new Error(
        `an evaluation gives ${asker} ${turns} turns; HOME allows ${TURNS_PER_DAY} a day`,
      );
  const priced = probes.map((p) =>
    Object.freeze({
      ...p,
      maxUsdMicros: probeMaxUsdMicros(p),
      maxNoRetryUsdMicros: probeMaxNoRetryUsdMicros(p),
      ...('request' in p ? { requestDigest: requestDigest(p.request, p.probe) } : {}),
      ...(p.kind === 'scenario'
        ? { scenarioDigest: scenarioDigest(SCENARIOS.find((s) => s.id === p.scenario)!) }
        : {}),
    }),
  );
  const paths = reachablePaths(priced);
  const most = (f: (path: (typeof priced)[number][]) => bigint) =>
    paths.reduce((a, path) => (f(path) > a ? f(path) : a), 0n);
  const sum = (path: readonly { maxUsdMicros: bigint }[]) =>
    path.reduce((a, p) => a + p.maxUsdMicros, 0n);
  const totalMaxUsdMicros = most(sum);
  const totalNoRetryUsdMicros = most((path) =>
    path.reduce((a, p) => a + p.maxNoRetryUsdMicros, 0n),
  );
  const listedMaxUsdMicros = sum(priced);
  const peakHoldUsdMicros = most((path) =>
    path.reduce((a, p, i) => {
      const hold = sum(path.slice(0, i)) + probeHoldUsdMicros(p);
      return hold > a ? hold : a;
    }, 0n),
  );
  const canonical = {
    format: 'home-kev-live-plan',
    version: PLAN_VERSION,
    plan: name,
    kind,
    sessionCeilingUsdMicros: ceilingUsdMicros,
    sessionCapUsdMicros,
    inferenceGeo: INFERENCE_GEO,
    geoMultiplier: GEO_MULTIPLIER,
    models: MODELS,
    tiers: TIERS,
    limits: {
      inputTokensPerCall: LIMITS.inputTokensPerCall,
      modelCallsPerAttempt: LIMITS.modelCallsPerAttempt,
      turnCeilingUsdMicros: LIMITS.turnCeilingUsdMicros,
    },
    perCallMaxUsdMicros: { fast: perCallMax('fast'), deep: perCallMax('deep') },
    digests: {
      systemPrompt: sha256(SYSTEM_PROMPT),
      syntheticSystem: sha256(SYNTHETIC_SYSTEM),
      tools: sha256(canonicalJson(toolDefinitions({ escalate: false }))),
      answerSchema: sha256(canonicalJson(ANSWER_JSON_SCHEMA)),
      toolResult: sha256(SYNTHETIC_TOOL_RESULT),
    },
    turnNow: TURN_NOW,
    probes: priced,
    totalMaxUsdMicros,
    peakHoldUsdMicros,
    // The beta flag a plan's prefix check enables (G9), bound into its hash;
    // absent from every other plan, whose hashes it leaves as they were.
    ...(probes.some((p) => p.kind === 'turn' && p.probe?.prefixCheck)
      ? { betas: [THINKING_BINDING_BETA] }
      : {}),
  };
  return Object.freeze({
    canonical,
    hash: sha256(canonicalJson(canonical)),
    name,
    kind,
    probes: Object.freeze(priced),
    totalMaxUsdMicros,
    totalNoRetryUsdMicros,
    listedMaxUsdMicros,
    peakHoldUsdMicros,
    sessionCapUsdMicros,
    ceilingUsdMicros,
  });
}

/**
 * A digest of the request shape a probe sends (its system prompt, the exact
 * tool definitions with their strictness, tool_choice and the answer
 * format), so the hash binds what each probe sends, not only how it is
 * described.
 */
export function requestDigest(r: ProbeRequest, probe: ProbeOptions): string {
  return sha256(
    canonicalJson({
      system: sha256(systemFor(r)),
      tools: probeTools(r),
      strictTools: probe.strictTools !== false,
      toolChoice: r.toolChoice,
      outputFormat: r.outputFormat === 'answer' ? ANSWER_JSON_SCHEMA : null,
    }),
  );
}

/** The system prompt a probe request sends. */
export function systemFor(r: ProbeRequest): string {
  return r.system === 'kev' ? SYSTEM_PROMPT : SYNTHETIC_SYSTEM;
}
