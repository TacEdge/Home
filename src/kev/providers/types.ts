import 'server-only';
import type { KevTier } from '@/domain/kev-bookkeeping/schema';
import type { TurnBudget } from '../budget';

// The provider seam (M8 contract §4.3, §4.5, §5.1, §5.4; ADR 0012 §12).
// Provider-neutral: nothing here names a provider, a model or an SDK type.
// One `run` is one model call, plus at most HOME's one retry (§5.1); the
// tool loop is the orchestrator's (Package 3), never a provider's.
//
// What may never reach storage (N13): the provider's own blocks (thinking
// and its signature, tool-use ids, the assistant turn as the wire sent it)
// are needed only to replay this attempt's history verbatim. They travel as
// `Sealed` values: frozen, empty objects whose contents live in a module
// WeakMap, which refuse to serialise (`toJSON` throws) and which message
// content v2's strict schema cannot represent. They never leave the attempt.

/** The closed set of ways a call can fail (contract §5.4). Never carries a key, header or body. */
export const PROVIDER_ERROR_CODES = [
  'unreachable',
  'timeout',
  'too_large',
  'refused_destination',
  'rate_limited',
  'overloaded',
  'bad_response',
  'refusal',
  'auth',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/** Why a successful call stopped: a closed code, never provider text (contract §7.6). */
export const STOP_CODES = [
  'end_turn',
  'tool_use',
  'max_tokens',
  'stop_sequence',
  'pause_turn',
  'other',
] as const;
export type StopCode = (typeof STOP_CODES)[number];

/** A call's usage as the provider reported it (contract §5.1). */
export type CallUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Where inference ran, as reported (`usage.inference_geo`); null when not reported. */
  inferenceGeo: string | null;
}>;

// ---------------------------------------------------------------------------
// Sealed, in-memory-only provider values.

const vault = new WeakMap<object, { kind: SealedKind; value: unknown }>();
type SealedKind = 'tool_use' | 'assistant_turn';

export type Sealed<K extends SealedKind> = Readonly<{ readonly __sealed: K }>;

function refuseToSerialise(): never {
  throw new TypeError('a provider value never leaves its attempt and is never stored');
}

/** For provider adapters only: wrap a provider value so nothing can store it. */
export function seal<K extends SealedKind>(kind: K, value: unknown): Sealed<K> {
  const token = Object.freeze(
    Object.create(null, {
      toJSON: { value: refuseToSerialise, enumerable: false },
      [Symbol.for('nodejs.util.inspect.custom')]: {
        value: () => `[sealed ${kind}]`,
        enumerable: false,
      },
    }) as object,
  );
  vault.set(token, { kind, value });
  return token as Sealed<K>;
}

/** For provider adapters only: the value behind a sealed token, or null if it is not one. */
export function unseal<K extends SealedKind>(kind: K, token: unknown): unknown {
  if (typeof token !== 'object' || token === null) return null;
  const entry = vault.get(token);
  return entry && entry.kind === kind ? entry.value : null;
}

/** Points at one tool call of this attempt, so its result can answer it. */
export type ToolUseRef = Sealed<'tool_use'>;
/** The model's own turn, kept to be replayed verbatim later in this attempt. */
export type AssistantReplay = Sealed<'assistant_turn'>;

// ---------------------------------------------------------------------------
// The request.

export type NeutralText = Readonly<{ type: 'text'; text: string }>;
export type NeutralToolResult = Readonly<{
  type: 'tool_result';
  toolUse: ToolUseRef;
  /** The tool's result as JSON text; untrusted strings already labelled (Package 2). */
  content: string;
  isError?: boolean;
}>;

export type ProviderMessage =
  | Readonly<{ role: 'user'; content: readonly (NeutralText | NeutralToolResult)[] }>
  /** An earlier turn's validated answer, as HOME stored it (text only). */
  | Readonly<{ role: 'assistant'; content: readonly NeutralText[] }>
  /** This attempt's own earlier model output, replayed exactly as received. */
  | Readonly<{ role: 'assistant'; replay: AssistantReplay }>;

export type ProviderToolDefinition = Readonly<{
  name: string;
  description: string;
  /** A static JSON schema with no personal data (contract §5.1); strict. */
  inputSchema: Readonly<Record<string, unknown>>;
}>;

export type ProviderRequest = Readonly<{
  tier: KevTier;
  /** The stable system prompt (no personal data); cached with the tools. */
  system: string;
  tools: readonly ProviderToolDefinition[];
  /** Never a forced tool: `auto`, or `none` to ask for an answer with what it has. */
  toolChoice: 'auto' | 'none';
  messages: readonly ProviderMessage[];
  /**
   * The final answer's JSON schema (structured output, contract §5.1): static,
   * no personal data. Absent on a tier whose answer comes through the strict
   * `answer` tool instead (G7's fallback).
   */
  outputFormat?: Readonly<Record<string, unknown>>;
}>;

export type ProviderToolUse = Readonly<{ ref: ToolUseRef; name: string; input: unknown }>;

/** A successful call. */
export type ProviderResult = Readonly<{
  attemptId: string;
  tier: KevTier;
  stop: StopCode;
  text: readonly string[];
  toolUses: readonly ProviderToolUse[];
  replay: AssistantReplay;
  usage: CallUsage;
  ms: number;
  /** Whether HOME's one retry was used to get this result. */
  retried: boolean;
  /**
   * The preflight count of this request's complete input (G22), made before
   * the call. The provider's own count at `message_start` (`usage`) stays
   * the authoritative one: the count is the provider's estimate.
   */
  countedInputTokens: number;
}>;

/** A failed call (after any retry), with what is known of its usage (contract §5.1). */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly detail: Readonly<{
      attemptId: string;
      ms: number;
      /** Input from `message_start` and output so far; null when the provider reported nothing. */
      partialUsage: CallUsage | null;
      retried: boolean;
      /**
       * Set when the preflight token count (G22) stopped the call before it
       * was made: `failed` (the count errored, timed out, was refused or
       * malformed: fail closed) or `over_cap` (counted above 32,000 tokens).
       * No model call was made, nothing was charged.
       */
      preflight?: 'failed' | 'over_cap';
    }>,
  ) {
    super(code);
    this.name = 'ProviderError';
  }
}

export type RunOptions = Readonly<{
  /** The attempt's budget, opened on a live reservation; every call is checked and recorded there. */
  budget: TurnBudget;
  /** Ends the call (the turn's deadline); the call then fails `timeout`. */
  signal?: AbortSignal;
}>;

export interface KevProvider {
  readonly kind: 'anthropic' | 'scripted';
  run(request: ProviderRequest, options: RunOptions): Promise<ProviderResult>;
}
