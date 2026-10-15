import 'server-only';
import { deploymentEnv } from '@/lib/env';
import { BudgetExhausted, exceedsInputCap, TurnBudget } from '../budget';
import { LIMITS, TIERS } from '../config';
import { preflightError, validCount } from './preflight';
import {
  ProviderError,
  seal,
  type CallUsage,
  type KevProvider,
  type ProviderErrorCode,
  type ProviderRequest,
  type ProviderResult,
  type RunOptions,
  type StopCode,
} from './types';

// The scripted provider (M8 contract §4.3, §14, §15): deterministic
// transcripts for tests, CI and local runs, with no network and no key.
// Each call takes the next step of its script: an answer (text and tool
// calls, a stop code, usage, the reported inference geo), a failure with or
// without partial usage, a refusal, or a stall. It is held to the same
// budget as the real adapter (every call begins and ends on the attempt's
// TurnBudget), charged as the real adapter charges (a failure with partial
// usage conservatively, I2; usage over the input cap ends the call
// `too_large` and halts the attempt, I4), and is refused anywhere deployed
// (N3), like the fake weather provider: the process's own environment is
// checked whatever `source` says.

export type ScriptStep =
  | {
      kind: 'answer';
      text?: string[];
      toolUses?: { name: string; input: unknown }[];
      stop?: StopCode;
      usage?: Partial<CallUsage>;
    }
  | { kind: 'error'; code: ProviderErrorCode; partialUsage?: Partial<CallUsage> | null }
  | { kind: 'refusal'; usage?: Partial<CallUsage> }
  /** Waits for `ms` (or until the call's signal ends it: `timeout`). */
  | { kind: 'stall'; ms: number };

/** A step, or a function of the request that makes one (a scenario reading its tool results). */
export type ScriptEntry = ScriptStep | ((request: ProviderRequest) => ScriptStep);

/**
 * The preflight count's scripted response (G22): a count, or a failure as
 * the adapter would see it: an error code, a stall past the call's timeout,
 * or a malformed body.
 */
export type ScriptedCount =
  number | { fail: ProviderErrorCode } | { stall: true } | { malformed: unknown };

export type ScriptedOptions = {
  /** Runs at the start of every call, while "the model" works (L20's probe). */
  onCall?: () => void | Promise<void>;
  /**
   * The preflight count of each request (G22), by the call's index from 0.
   * Default: a deterministic estimate of the request's size, well within the
   * cap for ordinary requests (scriptedCount).
   */
  count?: (request: ProviderRequest, index: number) => ScriptedCount;
};

/**
 * The scripted stand-in for the provider's count: a quarter of the UTF-8
 * bytes of the request's text (system prompt, tool definitions, messages'
 * text and tool results). Deterministic; never a claim about any tokenizer.
 */
export function scriptedCount(request: ProviderRequest): number {
  let bytes = Buffer.byteLength(request.system, 'utf8');
  bytes += Buffer.byteLength(JSON.stringify(request.tools), 'utf8');
  if (request.outputFormat)
    bytes += Buffer.byteLength(JSON.stringify(request.outputFormat), 'utf8');
  for (const m of request.messages) {
    if ('replay' in m) continue;
    for (const b of m.content)
      bytes += Buffer.byteLength(b.type === 'text' ? b.text : b.content, 'utf8');
  }
  return Math.ceil(bytes / 4);
}

const DEFAULT_USAGE: CallUsage = Object.freeze({
  inputTokens: 1_000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  inferenceGeo: 'us',
});

const usageOf = (u: Partial<CallUsage> | undefined): CallUsage =>
  Object.freeze({ ...DEFAULT_USAGE, ...u });

/** Resolves true if the signal ended the wait. */
function wait(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve(true)), { once: true });
  });
}

const deployed = (source: Record<string, string | undefined>) =>
  Boolean(source.VERCEL_ENV || source.VERCEL || source.NODE_ENV === 'production');

/** Refuses anywhere deployed (N3): `source` and the process's own environment both. */
export function assertScriptedAllowed(source: Record<string, string | undefined>): void {
  if (deployed(source) || deployed(deploymentEnv()))
    throw new Error('the scripted Kev provider is for local and CI runs only');
}

export function createScriptedProvider(
  script: readonly ScriptEntry[],
  opts: ScriptedOptions = {},
  source: Record<string, string | undefined> = deploymentEnv(),
): KevProvider & {
  /** Every request a model call was made for (after its count passed). */
  readonly requests: readonly ProviderRequest[];
  /** Every request counted (G22), whether or not its call was then made. */
  readonly counted: readonly ProviderRequest[];
} {
  assertScriptedAllowed(source);
  const steps = [...script];
  const requests: ProviderRequest[] = [];
  const counted: ProviderRequest[] = [];

  /** As the adapter: count first, under the call's timeout; fail closed; refuse over the cap. */
  async function preflight(
    request: ProviderRequest,
    budget: TurnBudget,
    signal: AbortSignal | undefined,
  ): Promise<number> {
    const started = Date.now();
    const check = budget.canCall(started);
    if (!check.ok) throw new BudgetExhausted(check.reason);
    const index = counted.length;
    counted.push(request);
    const scripted = opts.count ? opts.count(request, index) : scriptedCount(request);
    const failed = (code: ProviderErrorCode) =>
      preflightError(code, budget.attemptId, Date.now() - started, 'failed');
    if (typeof scripted === 'object' && 'fail' in scripted) throw failed(scripted.fail);
    if (typeof scripted === 'object' && 'stall' in scripted) {
      await wait(check.timeoutMs, signal);
      throw failed('timeout');
    }
    const n = validCount(
      typeof scripted === 'number' ? { input_tokens: scripted } : scripted.malformed,
    );
    if (n === null) throw failed('bad_response');
    if (n > LIMITS.inputTokensPerCall)
      throw preflightError('too_large', budget.attemptId, Date.now() - started, 'over_cap');
    return n;
  }

  return {
    kind: 'scripted',
    requests,
    counted,
    async run(request: ProviderRequest, { budget, signal }: RunOptions): Promise<ProviderResult> {
      if (!(budget instanceof TurnBudget) || !budget.live)
        throw new Error('a call needs its attempt’s live TurnBudget');
      if (request.tier !== budget.tier) throw new Error('a request runs on its attempt’s tier');
      const countedInputTokens = await preflight(request, budget, signal);
      requests.push(request);
      const model = TIERS[request.tier].model.id;
      const started = Date.now();
      const { ticket, timeoutMs } = budget.beginCall(started);
      // `stop: 'error'` with usage: the call ended before the provider's final
      // usage (partial, as the adapter charges it); a refusal's usage is final.
      const fail = (
        code: ProviderErrorCode,
        partial: CallUsage | null,
        stop: 'refusal' | 'error',
      ) => {
        const ms = Date.now() - started;
        budget.endCall(ticket, {
          model,
          usage: partial,
          ms,
          stop,
          errorCode: code,
          partial: stop === 'error' && partial !== null,
        });
        return new ProviderError(code, {
          attemptId: budget.attemptId,
          ms,
          partialUsage: partial,
          retried: false,
        });
      };
      await opts.onCall?.();
      const entry = steps.shift();
      const step = typeof entry === 'function' ? entry(request) : entry;
      if (!step) throw fail('bad_response', null, 'error');
      if (step.kind === 'stall') {
        const aborted = await wait(Math.min(step.ms, timeoutMs), signal);
        if (aborted || step.ms >= timeoutMs) throw fail('timeout', null, 'error');
        // A stall shorter than the call's timeout is a slow answer.
        steps.unshift({ kind: 'answer', text: ['Scripted reply.'] });
        return finish(steps.shift() as Extract<ScriptStep, { kind: 'answer' }>);
      }
      if (step.kind === 'error')
        throw fail(step.code, step.partialUsage ? usageOf(step.partialUsage) : null, 'error');
      if (step.kind === 'refusal') throw fail('refusal', usageOf(step.usage), 'refusal');
      return finish(step);
      function finish(answer: Extract<ScriptStep, { kind: 'answer' }>): ProviderResult {
        const usage = usageOf(answer.usage);
        // As the adapter: both are found at message_start, which ends the call.
        if (usage.inferenceGeo !== 'us') throw fail('bad_response', usage, 'error');
        if (exceedsInputCap(usage)) throw fail('too_large', usage, 'error');
        const ms = Date.now() - started;
        const stop = answer.stop ?? (answer.toolUses?.length ? 'tool_use' : 'end_turn');
        budget.endCall(ticket, { model, usage, ms, stop });
        const toolUses = (answer.toolUses ?? []).map((t, i) =>
          Object.freeze({
            ref: seal('tool_use', `scripted_${budget.modelCalls}_${i}`),
            name: t.name,
            input: t.input,
          }),
        );
        return Object.freeze({
          attemptId: budget.attemptId,
          tier: request.tier,
          stop,
          text: Object.freeze([...(answer.text ?? [])]),
          toolUses: Object.freeze(toolUses),
          replay: seal('assistant_turn', { text: answer.text ?? [], toolUses: toolUses.length }),
          usage,
          ms,
          retried: false,
          countedInputTokens,
        });
      }
    },
  };
}
