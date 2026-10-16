import { createHash } from 'node:crypto';
import { ANSWER_JSON_SCHEMA } from '@/kev/answer/schema';
import { GEO_MULTIPLIER, INFERENCE_GEO, LIMITS, MODELS, TIERS } from '@/kev/config';
import { SYSTEM_PROMPT } from '@/kev/prompts/system';
import type { ProbeOptions } from '@/kev/providers/types';
import { attemptReservation, perCallMax } from '@/kev/router';
import { toolDefinitions } from '@/kev/tools/registry';
import type { KevTier } from '@/domain/kev-bookkeeping/schema';
import { SESSION_CEILING_USD_MICROS } from './guards.mts';

// The live verification plan, as code (M8 live-verification plan §7, §11;
// owner decisions 2 and 4, 2026-10-16): a fixed, versioned list of probes,
// each with its maximum cost computed from the gateway's own per-call
// maxima (src/trust/usage.ts through src/kev/router.ts), and a hash over
// the canonical plan, Kev's configuration (models, prices, tiers, limits)
// and digests of the system prompt, the tool definitions and the answer
// schema. The owner approves that hash; any change to the plan or to what
// it sends changes it, and the runner refuses a hash that does not match.
// Synthetic prompts only, about the fixture family (docs/concepts/README.md).

/** Bumped with any change to the probes or how they run. */
export const PLAN_VERSION = 1;

/** The fixture family's scenario instant (tests/integration/kev-fixture.ts's NOW): what the turn probe's tools read. */
export const TURN_NOW = '2026-10-13T18:03:00.000Z';

/** One model request a probe sends, before any tool round. */
export type ProbeRequest = Readonly<{
  /** Kev's own system prompt, or a short synthetic one. */
  system: 'kev' | 'synthetic';
  /** Kev's tool definitions (no `escalate`), or none. */
  tools: 'kev' | 'none';
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
    }
  | {
      id: string;
      gates: readonly string[];
      /** One turn through kev.handle() as the fixture adult Sam, on the runner's database. */
      kind: 'turn';
      question: string;
      expect: string;
      stopOnFail: boolean;
    }
>;

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
    gates: ['G9', 'G21', 'G22', 'G10'],
    kind: 'turn',
    question: 'What’s on this Saturday, and what’s left to do on the back fence?',
    expect:
      'a turn with at least one tool round and no provider error; every request body extends the one before; thinking blocks replayed',
    stopOnFail: false,
  },
] satisfies ProbeSpec[]);

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
  }
}

/**
 * A probe's maximum cost (µ$), from the gateway's own figures: each planned
 * call twice (HOME's one retry) at its tier's per-call maximum, never above
 * the attempt's reservation, which the budget enforces; a turn at the turn
 * ceiling (US$1.50), which bounds a fast attempt and an escalation together.
 * A Haiku probe runs on a fast budget and is charged at its prices.
 */
export function probeMaxUsdMicros(p: ProbeSpec): bigint {
  if (p.kind === 'models') return 0n;
  if (p.kind === 'turn') return LIMITS.turnCeilingUsdMicros;
  const withRetry = BigInt(plannedCalls(p) * 2) * perCallMax(p.tier);
  const reservation = attemptReservation(p.tier);
  return withRetry < reservation ? withRetry : reservation;
}

/** The same, without HOME's one retry: the figure if every call succeeds first time. */
export function probeMaxNoRetryUsdMicros(p: ProbeSpec): bigint {
  if (p.kind === 'models') return 0n;
  if (p.kind === 'turn') return LIMITS.turnCeilingUsdMicros;
  return BigInt(plannedCalls(p)) * perCallMax(p.tier);
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
  probes: readonly (ProbeSpec & { maxUsdMicros: bigint; maxNoRetryUsdMicros: bigint })[];
  totalMaxUsdMicros: bigint;
  totalNoRetryUsdMicros: bigint;
}>;

/** The plan: its probes with their maxima, the total, and the hash the owner approves. */
export function buildPlan(probes: readonly ProbeSpec[] = PROBES): Plan {
  const priced = probes.map((p) =>
    Object.freeze({
      ...p,
      maxUsdMicros: probeMaxUsdMicros(p),
      maxNoRetryUsdMicros: probeMaxNoRetryUsdMicros(p),
    }),
  );
  const totalMaxUsdMicros = priced.reduce((a, p) => a + p.maxUsdMicros, 0n);
  const totalNoRetryUsdMicros = priced.reduce((a, p) => a + p.maxNoRetryUsdMicros, 0n);
  const canonical = {
    format: 'home-kev-live-plan',
    version: PLAN_VERSION,
    sessionCeilingUsdMicros: SESSION_CEILING_USD_MICROS,
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
  };
  return Object.freeze({
    canonical,
    hash: sha256(canonicalJson(canonical)),
    probes: Object.freeze(priced),
    totalMaxUsdMicros,
    totalNoRetryUsdMicros,
  });
}

/** The system prompt a probe request sends. */
export function systemFor(r: ProbeRequest): string {
  return r.system === 'kev' ? SYSTEM_PROMPT : SYNTHETIC_SYSTEM;
}
