import type { Deps } from '@/domain/common/write';
import { reserveAttempt, settleAttempt } from '@/domain/kev-bookkeeping/service';
import type { KevTier } from '@/domain/kev-bookkeeping/schema';
import { parsePlan } from '@/kev/answer/schema';
import { BudgetExhausted, TurnBudget } from '@/kev/budget';
import { ANSWER_JSON_SCHEMA } from '@/kev/answer/schema';
import { INFERENCE_GEO, LIMITS, TIERS } from '@/kev/config';
import { SCENARIOS } from '@/kev/evals/scenarios';
import type { EvalRecord } from '@/kev/evals/summary';
import { handle, type KevEvent } from '@/kev/orchestrator';
import type { ProbeGateway } from '@/kev/providers/anthropic';
import { diagnosticLine, type ProbeErrorDetail } from '@/kev/providers/diagnostics';
import {
  ProviderError,
  type NeutralToolResult,
  type ProbeEvidence,
  type ProviderMessage,
  type ProviderRequest,
  type ProviderResult,
} from '@/kev/providers/types';
import { attemptReservation, perCallMax } from '@/kev/router';
import type { UserActor } from '@/trust/actor';
import {
  probeTools,
  ruleHolds,
  SYNTHETIC_TOOL_RESULT,
  systemFor,
  TURN_NOW,
  type Plan,
  type ProbeRequest,
  type ProbeSpec,
} from './plan';
import { runScenario, type ScenarioContext } from './eval';

// Runs the plan's probes, one after another (M8 live-verification plan §7,
// §11): each model probe on its own attempt, reserved through HOME's
// bookkeeping path (reserveAttempt, under the runner's own cap), held to
// its TurnBudget, and settled (settleAttempt) in a `finally`; the turn probe
// through kev.handle() itself. The gateway is the probe gateway (src/kev/
// providers/anthropic.ts): every model call is counted first (G22), checked
// for US inference (G10) and recorded as evidence without any body. What
// comes back here is pass/fail against each probe's expectation, closed
// reason codes and the evidence: never a prompt, an answer or a tool input.

export type ProbeOutcome = 'pass' | 'fail' | 'not_run';

export type ProbeResult = Readonly<{
  id: string;
  gates: readonly string[];
  kind: ProbeSpec['kind'];
  tier: KevTier | null;
  outcome: ProbeOutcome;
  /** Closed codes: why it failed or was not run (never provider text). */
  reasons: readonly string[];
  /** Named checks with boolean or numeric results. */
  checks: Readonly<Record<string, boolean | number | string | null>>;
  maxUsdMicros: bigint;
  attemptIds: readonly string[];
  evidence: readonly ProbeEvidence[];
  /** A scenario probe's record (Package 5A): closed check names, codes and counts only. */
  evaluation?: EvalRecord;
}>;

export type RunContext = Readonly<{
  gateway: ProbeGateway;
  /** The fixture adult the probes run as, via Kev. */
  actor: UserActor;
  deps: Deps;
  /** The approved budget (µ$): no probe starts whose maximum would pass it. */
  budgetMicros: bigint;
  /** Progress lines (ids, outcomes, counts only). */
  log?: (line: string) => void;
  /**
   * What scenario probes need (Package 5A): the fixture adults, the
   * evaluation fixture's ids, the markers never to show, and the database.
   * Absent, a scenario probe is not run. Live, each turn's provider is the
   * gateway's; a test may give its own (`providerFor`).
   */
  evaluation?: Omit<ScenarioContext, 'providerFor'> & Partial<Pick<ScenarioContext, 'providerFor'>>;
}>;

export type RunOutcome = Readonly<{
  results: readonly ProbeResult[];
  /** Why the run stopped early, or null. */
  stopped: string | null;
  /** Σ of the maxima of the probes that ran. */
  committedMaxUsdMicros: bigint;
}>;

const text = (t: string) => Object.freeze({ type: 'text' as const, text: t });
const userTurn = (t: string): ProviderMessage =>
  Object.freeze({ role: 'user' as const, content: Object.freeze([text(t)]) });

function requestFor(
  p: Extract<ProbeSpec, { request: ProbeRequest }>,
  messages: ProviderMessage[],
): ProviderRequest {
  const r = p.request;
  return Object.freeze({
    tier: p.tier,
    system: systemFor(r),
    tools: probeTools(r),
    toolChoice: r.toolChoice,
    messages: Object.freeze([...messages]),
    ...(r.outputFormat === 'answer' ? { outputFormat: ANSWER_JSON_SCHEMA } : {}),
  });
}

/** A failure as a closed code: a provider error's code, a budget refusal, or `error`. */
function codeOf(e: unknown): string {
  if (e instanceof ProviderError)
    return e.detail.preflight ? `preflight_${e.detail.preflight}_${e.code}` : e.code;
  if (e instanceof BudgetExhausted) return `budget_${e.reason}`;
  return 'error';
}

/** Codes that end the session: the key, the provider's limits, the cap. */
const STOPPING = new Set(['auth', 'rate_limited', 'cap_reached']);

/**
 * G22 and G10 over a probe's evidence: every model call was preceded, in
 * its attempt, by a successful count (or is the retry of a call that was),
 * and every reported usage ran in the US. Also G22's comparison (recorded,
 * not a pass condition): the largest difference, in tokens, between a
 * count and the input its call then reported (uncached, cache read and
 * cache write together); null when no counted call reported usage.
 */
export function evidenceChecks(evidence: readonly ProbeEvidence[]): {
  calls: number;
  countedFirst: boolean;
  usInference: boolean;
  maxCountDelta: number | null;
} {
  let calls = 0;
  let countedFirst = true;
  let usInference = true;
  let maxCountDelta: number | null = null;
  const last = new Map<string, ProbeEvidence>();
  for (const e of evidence) {
    if (e.kind === 'models') continue;
    if (e.kind === 'message') {
      calls += 1;
      const before = last.get(e.attemptId);
      const ok =
        (before?.kind === 'count' && before.counted !== null) ||
        (before?.kind === 'message' && e.retried);
      if (!ok) countedFirst = false;
      if (e.usage && e.usage.inferenceGeo !== INFERENCE_GEO) usInference = false;
      if (before?.kind === 'count' && before.counted !== null && e.usage) {
        const reported = e.usage.inputTokens + e.usage.cacheReadTokens + e.usage.cacheWriteTokens;
        const delta = Math.abs(reported - before.counted);
        maxCountDelta = maxCountDelta === null ? delta : Math.max(maxCountDelta, delta);
      }
    }
    last.set(e.attemptId, e);
  }
  return { calls, countedFirst, usInference, maxCountDelta };
}

async function settle(
  ctx: RunContext,
  attemptId: string,
  budget: TurnBudget | null,
  tier: KevTier,
) {
  const records = budget ? [...budget.calls] : [];
  const inFlight = budget ? budget.callsInFlight : 0;
  const calls = [
    ...records.map((c) => ({
      tier: c.tier,
      model: c.model,
      inputTokens: c.usage?.inputTokens ?? 0,
      outputTokens: c.usage?.outputTokens ?? 0,
      cacheReadTokens: c.usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: c.usage?.cacheWriteTokens ?? 0,
      costUsdMicros: c.costUsdMicros,
      escalated: false,
    })),
    ...Array.from({ length: inFlight }, () => ({
      tier,
      model: TIERS[tier].model.id,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsdMicros: perCallMax(tier),
      escalated: false,
    })),
  ].slice(0, LIMITS.modelCallsPerAttempt);
  return settleAttempt(ctx.actor, { attemptId, conversationId: null, calls }, ctx.deps);
}

type Attempted = {
  outcome: ProbeOutcome;
  reasons: string[];
  checks: Record<string, boolean | number | string | null>;
  stop: string | null;
};

/** One model probe on its own attempt: reserve, open the budget, call, settle. */
async function modelProbe(
  ctx: RunContext,
  p: Extract<ProbeSpec, { request: ProbeRequest }>,
  attemptId: string,
): Promise<Attempted> {
  const reasons: string[] = [];
  const checks: Record<string, boolean | number | string | null> = {};
  const reserved = await reserveAttempt(
    ctx.actor,
    { attemptId, tier: p.tier, reservedUsdMicros: attemptReservation(p.tier) },
    ctx.deps,
  );
  if (!reserved.ok)
    return { outcome: 'not_run', reasons: [reserved.code], checks, stop: reserved.code };
  let budget: TurnBudget | null = null;
  let stop: string | null = null;
  try {
    budget = TurnBudget.open(reserved.reservation, {
      deadline: Date.now() + LIMITS.turnDeadlineMs - 1_000,
    });
    const options = { budget };
    const run = (r: ProviderRequest) => ctx.gateway.run(r, options, p.probe);
    const q = userTurn(p.request.question);
    try {
      if (p.kind === 'single') {
        const r = await run(requestFor(p, [q]));
        checks.accepted = true;
        checks.stop = r.stop;
        if (p.probe.systemMessage !== undefined)
          checks.followed = r.text.join('').trim() === r.text.join('').trim().toLowerCase();
        if (p.probe.abortAfterFirstEvent) reasons.push('not_aborted');
      } else if (p.kind === 'cache_pair') {
        const first = await run(requestFor(p, [q]));
        const second = await run(requestFor(p, [q]));
        checks.firstCacheWrite = first.usage.cacheWriteTokens;
        checks.secondCacheRead = second.usage.cacheReadTokens;
        if (second.usage.cacheReadTokens <= 0) reasons.push('no_cache_read');
      } else if (p.kind === 'tool_round') {
        const first = await run(requestFor(p, [q]));
        checks.toolRound = first.toolUses.length > 0;
        let answer: ProviderResult = first;
        if (first.toolUses.length > 0) {
          const results: NeutralToolResult[] = first.toolUses.map((u) =>
            Object.freeze({
              type: 'tool_result' as const,
              toolUse: u.ref,
              content: SYNTHETIC_TOOL_RESULT,
            }),
          );
          answer = await run(
            requestFor(p, [
              q,
              Object.freeze({ role: 'assistant' as const, replay: first.replay }),
              Object.freeze({ role: 'user' as const, content: Object.freeze(results) }),
            ]),
          );
        } else reasons.push('no_tool_round');
        checks.answerStop = answer.stop;
        checks.answerParses = parsePlan(answer.text.join('')) !== null;
        if (!checks.answerParses) reasons.push('answer_not_a_plan');
      }
    } catch (e) {
      const code = codeOf(e);
      if (p.kind === 'single' && p.probe.abortAfterFirstEvent && code === 'timeout') {
        const record = budget.calls[0];
        checks.aborted = true;
        checks.partial = record?.stop === 'partial';
        checks.chargedAtLeastMax =
          record !== undefined && record.costUsdMicros >= perCallMax(p.tier);
        if (!checks.partial) reasons.push('not_partial');
        if (!checks.chargedAtLeastMax) reasons.push('charged_below_max');
      } else {
        reasons.push(code);
        // The key refused, the provider's limits or spend cap: stop the session.
        const base = e instanceof ProviderError ? e.code : code;
        if (STOPPING.has(base)) stop = base;
      }
    }
  } finally {
    const out = await settle(ctx, attemptId, budget, p.tier);
    checks.settled = out.ok;
    if (!out.ok) reasons.push('settle_failed');
  }
  return { outcome: reasons.length === 0 ? 'pass' : 'fail', reasons, checks, stop };
}

/** G9 and G21: one turn through kev.handle() as the fixture adult, on the runner's database. */
async function turnProbe(
  ctx: RunContext,
  p: Extract<ProbeSpec, { kind: 'turn' }>,
): Promise<Attempted> {
  const reasons: string[] = [];
  const checks: Record<string, boolean | number | string | null> = {};
  const events: KevEvent[] = [];
  for await (const e of handle(
    { actor: ctx.actor, channel: 'web', input: { text: p.question }, now: new Date(TURN_NOW) },
    { db: ctx.deps.db, provider: ctx.gateway.provider() },
  ))
    events.push(e);
  const done = events.at(-1);
  checks.outcome = done?.type === 'done' ? done.outcome : null;
  checks.escalated = done?.type === 'done' ? done.escalated : null;
  // HOME's checked answer, citing what it read: never the fallback, a
  // salvage or a decline (event types and counts only; never their text).
  checks.cites = events.filter((e) => e.type === 'cite').length;
  const error = events.find((e) => e.type === 'error');
  if (error?.type === 'error') {
    checks.error = error.code;
    reasons.push(`turn_${error.code}`);
  } else if (checks.outcome !== 'answer') reasons.push(`turn_${String(checks.outcome)}`);
  else if (checks.cites === 0) reasons.push('no_citation');
  return { outcome: reasons.length === 0 ? 'pass' : 'fail', reasons, checks, stop: null };
}

/** One run of a dataset scenario, judged by the scripted evals' checker (Package 5A). */
async function scenarioProbe(
  ctx: RunContext,
  p: Extract<ProbeSpec, { kind: 'scenario' }>,
): Promise<Attempted & { evaluation?: EvalRecord }> {
  const s = SCENARIOS.find((x) => x.id === p.scenario);
  if (!ctx.evaluation || !s)
    return {
      outcome: 'not_run',
      reasons: [s ? 'no_evaluation_fixture' : 'no_scenario'],
      checks: {},
      stop: null,
    };
  const run = await runScenario(s, p.tier, p.repeat, {
    providerFor: () => ctx.gateway.provider(),
    ...ctx.evaluation,
  });
  const last = run.record.turns.at(-1);
  const checks: Record<string, boolean | number | string | null> = {
    passed: run.verdict.pass,
    turns: run.record.turns.length,
    outcome: last?.outcome ?? null,
    answerResult: last?.result ?? null,
    firstPass: last && last.answers.length > 0 ? last.answers[0] === 'pass' : null,
    escalated: last?.escalated ?? null,
  };
  return {
    outcome: run.verdict.pass ? 'pass' : 'fail',
    reasons: run.verdict.failed.map((f) => `scenario_${f}`),
    checks,
    stop: null,
    evaluation: run.record,
  };
}

/**
 * A turn's two phases (ADR 0012 §54), from its Messages calls' evidence:
 * its tool rounds (at least one), whether one call sent the answer format
 * under `none` (the answer phase, required), and whether any sent it under
 * `auto` (never allowed); with the reasons a failure names.
 */
export function phaseChecks(evidence: readonly ProbeEvidence[]): {
  toolRounds: number;
  answerPhase: boolean;
  formatWithAuto: boolean;
  reasons: string[];
} {
  const calls = evidence.filter((e) => e.kind === 'message');
  const toolRounds = calls.filter((e) => e.stop === 'tool_use').length;
  const answerPhase = calls.some((e) => e.answerFormat && e.toolChoice === 'none');
  const formatWithAuto = calls.some((e) => e.answerFormat && e.toolChoice === 'auto');
  const reasons: string[] = [];
  if (toolRounds < 1) reasons.push('no_tool_round');
  if (!answerPhase) reasons.push('no_answer_phase');
  if (formatWithAuto) reasons.push('format_with_auto');
  return { toolRounds, answerPhase, formatWithAuto, reasons };
}

/**
 * Whether a refusal's recognised detail names a request parameter below the
 * top level (`tools.3.custom.input_schema…`, `output_config.format…`): the
 * provider said which part it refused, so the diagnostic has its cause.
 */
export function namesRequestPath(error: ProbeErrorDetail | null): boolean {
  return (error?.message?.paths ?? []).some((p) => p.split('.').length >= 2);
}

/** Runs the plan, in order, stopping early at a stopping failure or the budget. */
export async function executePlan(plan: Plan, ctx: RunContext): Promise<RunOutcome> {
  const results: ProbeResult[] = [];
  let stopped: string | null = null;
  let committed = 0n;
  for (const p of plan.probes) {
    const base = {
      id: p.id,
      gates: p.gates,
      kind: p.kind,
      tier: 'tier' in p ? p.tier : null,
      maxUsdMicros: p.maxUsdMicros,
    };
    // The diagnostic's adaptive rules: a probe whose condition does not hold
    // is not run, and costs nothing; the session goes on.
    const rule = 'runIf' in p ? p.runIf : undefined;
    if (!stopped && rule && !ruleHolds(rule, (id) => results.find((r) => r.id === id)?.outcome)) {
      results.push(
        Object.freeze({
          ...base,
          outcome: 'not_run',
          reasons: ['rule_skipped'],
          checks: {},
          attemptIds: [],
          evidence: [],
        }),
      );
      ctx.log?.(`${p.id}: not run (rule_skipped)`);
      continue;
    }
    if (stopped || committed + p.maxUsdMicros > ctx.budgetMicros) {
      stopped ??= 'budget';
      results.push(
        Object.freeze({
          ...base,
          outcome: 'not_run',
          reasons: [stopped],
          checks: {},
          attemptIds: [],
          evidence: [],
        }),
      );
      continue;
    }
    committed += p.maxUsdMicros;
    const before = ctx.gateway.evidence().length;
    let attempted: Attempted;
    const attemptIds: string[] = [];
    if (p.kind === 'models') {
      const reasons: string[] = [];
      const checks: Record<string, boolean | number | string | null> = {};
      const maxTokens = Math.max(TIERS.fast.maxTokens, TIERS.deep.maxTokens);
      for (const id of p.models) {
        const e = await ctx.gateway.models(id);
        const ok =
          e.outcome === 'ok' &&
          e.id === id &&
          (e.maxInputTokens === null || e.maxInputTokens >= LIMITS.inputTokensPerCall) &&
          (e.maxTokens === null || e.maxTokens >= maxTokens);
        checks[id] = ok;
        if (!ok) reasons.push(`${id}_${e.outcome === 'ok' ? 'mismatch' : e.outcome}`);
      }
      attempted = { outcome: reasons.length ? 'fail' : 'pass', reasons, checks, stop: null };
    } else if (p.kind === 'turn') {
      attempted = await turnProbe(ctx, p);
    } else if (p.kind === 'scenario') {
      attempted = await scenarioProbe(ctx, p);
    } else {
      const attemptId = crypto.randomUUID();
      attemptIds.push(attemptId);
      attempted = await modelProbe(ctx, p, attemptId);
    }
    const evidence = ctx.gateway.evidence().slice(before);
    for (const e of evidence)
      if (e.kind !== 'models' && !attemptIds.includes(e.attemptId)) attemptIds.push(e.attemptId);
    if (p.kind !== 'models') {
      const ev = evidenceChecks(evidence);
      attempted.checks.modelCalls = ev.calls;
      attempted.checks.countedFirst = ev.countedFirst;
      attempted.checks.usInference = ev.usInference;
      attempted.checks.maxCountDelta = ev.maxCountDelta;
      if (!ev.countedFirst) attempted.reasons.push('call_not_counted_first');
      if (!ev.usInference) attempted.reasons.push('not_us_inference');
      if (p.kind === 'turn') {
        const msgs = evidence.filter((e) => e.kind === 'message');
        attempted.checks.growOnly = msgs.every((e) => e.kind !== 'message' || e.growOnly !== false);
        attempted.checks.thinkingBlocks = msgs.reduce(
          (a, e) =>
            a +
            (e.kind === 'message'
              ? (e.blocks.thinking ?? 0) + (e.blocks.redacted_thinking ?? 0)
              : 0),
          0,
        );
        if (attempted.checks.growOnly === false) attempted.reasons.push('history_not_grow_only');
        // The two phases (ADR 0012 §54).
        const phases = phaseChecks(msgs);
        attempted.checks.toolRounds = phases.toolRounds;
        attempted.checks.answerPhase = phases.answerPhase;
        attempted.checks.formatWithAuto = phases.formatWithAuto;
        attempted.reasons.push(...phases.reasons);
      }
      if (attempted.reasons.length > 0)
        attempted.outcome = attempted.outcome === 'not_run' ? 'not_run' : 'fail';
    }
    const { evaluation, ...rest } = attempted as Attempted & { evaluation?: EvalRecord };
    results.push(
      Object.freeze({
        ...base,
        ...rest,
        attemptIds,
        evidence,
        ...(evaluation ? { evaluation } : {}),
      }),
    );
    ctx.log?.(
      `${p.id}: ${attempted.outcome}${attempted.reasons.length ? ` (${attempted.reasons.join(', ')})` : ''}`,
    );
    // The provider's refusals, one line each, so the job log alone says what
    // was refused (no artifact download): structural fields and recognised
    // detail only, never the provider's message (diagnostics.ts).
    for (const e of evidence)
      if (e.error) ctx.log?.(`  ${e.kind} ${e.model}: ${diagnosticLine(e.error, e.error.message)}`);
    if (attempted.stop) stopped = attempted.stop;
    else if (attempted.outcome === 'pass' && 'stopOnPass' in p && p.stopOnPass)
      stopped = `${p.id}_passed`;
    else if (
      attempted.outcome === 'fail' &&
      'stopWhenNamed' in p &&
      p.stopWhenNamed &&
      evidence.some((e) => namesRequestPath(e.error))
    )
      stopped = `${p.id}_named`;
    else if (attempted.outcome === 'fail' && p.stopOnFail) stopped = `${p.id}_failed`;
  }
  return Object.freeze({
    results: Object.freeze(results),
    stopped,
    committedMaxUsdMicros: committed,
  });
}
