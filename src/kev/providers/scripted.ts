import 'server-only';
import { deploymentEnv } from '@/lib/env';
import { exceedsInputCap, TurnBudget } from '../budget';
import { TIERS } from '../config';
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

export type ScriptedOptions = {
  /** Runs at the start of every call, while "the model" works (L20's probe). */
  onCall?: () => void | Promise<void>;
};

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
  script: readonly ScriptStep[],
  opts: ScriptedOptions = {},
  source: Record<string, string | undefined> = deploymentEnv(),
): KevProvider & { readonly requests: readonly ProviderRequest[] } {
  assertScriptedAllowed(source);
  const steps = [...script];
  const requests: ProviderRequest[] = [];
  return {
    kind: 'scripted',
    requests,
    async run(request: ProviderRequest, { budget, signal }: RunOptions): Promise<ProviderResult> {
      if (!(budget instanceof TurnBudget) || !budget.live)
        throw new Error('a call needs its attempt’s live TurnBudget');
      if (request.tier !== budget.tier) throw new Error('a request runs on its attempt’s tier');
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
      const step = steps.shift();
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
        });
      }
    },
  };
}
