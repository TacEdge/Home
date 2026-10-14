import 'server-only';
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import type { TurnBudget } from '../budget';
import { INFERENCE_GEO, LIMITS, TIERS } from '../config';
import {
  ANTHROPIC_VERSION,
  createProviderFetch,
  isProviderFetch,
  observedFetch,
  PROVIDER_FETCH_LIMITS,
  PROVIDER_ORIGIN,
  ProviderNetError,
  type FetchObserver,
  type ProviderFetch,
} from './fetch';
import {
  ProviderError,
  seal,
  unseal,
  type CallUsage,
  type KevProvider,
  type ProviderErrorCode,
  type ProviderMessage,
  type ProviderRequest,
  type ProviderResult,
  type RunOptions,
  type StopCode,
} from './types';

// The Anthropic adapter (M8 contract §5.1, §5.3, §5.4; ADR 0012 §13, §14):
// the only file in HOME that imports an LLM SDK (ESLint and
// tests/unit/kev-sdk-import.test.ts, matrix row N1). One `run` is one model
// call, streamed, plus at most HOME's one retry; the tool loop is the
// orchestrator's (Package 3).
//
// The SDK (@anthropic-ai/sdk 0.129.0, pinned) is constructed with every
// implicit source neutralised (ADR 0012's Package 1b note lists the source
// lines): the key from HOME_KEV_PROVIDER_KEY only, passed explicitly, so
// ANTHROPIC_API_KEY is never read; `authToken: null`, so neither is
// ANTHROPIC_AUTH_TOKEN, and with a key no profile, config file or workload
// identity is ever resolved; an explicit `baseURL`, so ANTHROPIC_BASE_URL is
// never read (S14); `webhookKey: null`; `logLevel: 'off'` and a silent
// logger, so ANTHROPIC_LOG is never read and nothing (headers, bodies) is
// ever logged; `maxRetries: 0` (HOME retries once, below); `fetch` is HOME's
// (§5.4), so every request passes HOME's network policy. The SDK still reads
// ANTHROPIC_CUSTOM_HEADERS unconditionally and merges it into its default
// headers: HOME's explicit `defaultHeaders` win over it for the key and the
// version, and HOME's fetch sends only its allow-list, so nothing from it
// reaches the wire (tested). The SDK's `timeout` covers only the wait for
// response headers, never the stream, so HOME bounds the whole call with its
// own per-call AbortSignal and the fetch's idle and backstop timers.

const SILENT = Object.freeze({
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
});

/** The SDK's options, every implicit source neutralised. Exported for its test (N8). */
export function anthropicClientOptions(apiKey: string, fetch: ProviderFetch): ClientOptions {
  if (!isProviderFetch(fetch)) throw new Error('the SDK only ever gets HOME’s provider fetch');
  return {
    apiKey,
    authToken: null,
    baseURL: PROVIDER_ORIGIN,
    webhookKey: null,
    maxRetries: 0,
    timeout: PROVIDER_FETCH_LIMITS.maxCallMs,
    fetch: fetch as unknown as ClientOptions['fetch'],
    logLevel: 'off',
    logger: SILENT,
    dangerouslyAllowBrowser: false,
    defaultHeaders: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      authorization: null,
      'anthropic-beta': null,
    },
  };
}

// ---------------------------------------------------------------------------
// The request, provider-neutral → the Messages API.

type Params = Anthropic.Messages.MessageStreamParams;

function toParam(m: ProviderMessage): Anthropic.Messages.MessageParam {
  if (m.role === 'user')
    return {
      role: 'user',
      content: m.content.map((b) => {
        if (b.type === 'text') return { type: 'text' as const, text: b.text };
        const id = unseal('tool_use', b.toolUse);
        if (typeof id !== 'string')
          throw new Error('a tool result must answer this attempt’s tool call');
        return {
          type: 'tool_result' as const,
          tool_use_id: id,
          content: b.content,
          ...(b.isError ? { is_error: true } : {}),
        };
      }),
    };
  if ('replay' in m) {
    const content = unseal('assistant_turn', m.replay);
    if (!Array.isArray(content))
      throw new Error('an assistant turn is replayed only within its attempt');
    return { role: 'assistant', content: content as Anthropic.Messages.ContentBlockParam[] };
  }
  return {
    role: 'assistant',
    content: m.content.map((b) => ({ type: 'text' as const, text: b.text })),
  };
}

/** The Messages API body for one call (exported for its test). Never a forced tool, never sampling knobs. */
export function messagesParams(request: ProviderRequest): Params {
  const tier = TIERS[request.tier];
  const params: Params = {
    model: tier.model.id,
    max_tokens: tier.maxTokens,
    // The stable prefix: tools, then the system prompt, cached at its end (§5.1).
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    messages: request.messages.map(toParam),
    inference_geo: INFERENCE_GEO,
    output_config: { effort: tier.effort },
  };
  if (request.tools.length > 0) {
    params.tools = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
      strict: true,
    }));
    params.tool_choice = { type: request.toolChoice };
  }
  return params;
}

// ---------------------------------------------------------------------------
// Errors: typed classes and typed fields only, never message text.

const STOPS: Readonly<Record<string, StopCode>> = {
  end_turn: 'end_turn',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  pause_turn: 'pause_turn',
};

function netErrorIn(err: unknown): ProviderNetError | null {
  for (let x: unknown = err, i = 0; x && typeof x === 'object' && i < 5; i++) {
    if (x instanceof ProviderNetError) return x;
    x = (x as { cause?: unknown }).cause;
  }
  return null;
}

export type Mapped = {
  code: ProviderErrorCode;
  retryable: boolean;
  notSent: boolean;
  retryAfterMs: number | null;
};

/** The provider's per-tier spend cap: a 429 that keeps failing until the month turns. */
function isSpendCap(err: InstanceType<typeof Anthropic.APIError>): boolean {
  const body = err.error as { error?: { details?: { error_code?: unknown } } } | undefined;
  return body?.error?.details?.error_code === 'enforced_spend_limit_reached';
}

function retryAfterMs(headers: Headers | undefined): number | null {
  const raw = headers?.get('retry-after');
  if (raw === null || raw === undefined) return null;
  const s = Number(raw);
  return Number.isFinite(s) && s >= 0 ? s * 1000 : Number.POSITIVE_INFINITY;
}

export function mapProviderError(err: unknown): Mapped {
  const net = netErrorIn(err);
  if (net)
    return {
      code: net.code === 'auth' ? 'auth' : net.code,
      retryable: net.retryable,
      notSent: !net.sent,
      retryAfterMs: null,
    };
  if (err instanceof Anthropic.APIUserAbortError)
    return { code: 'timeout', retryable: false, notSent: false, retryAfterMs: null };
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return { code: 'timeout', retryable: false, notSent: false, retryAfterMs: null };
  if (err instanceof Anthropic.APIConnectionError)
    return { code: 'unreachable', retryable: true, notSent: false, retryAfterMs: null };
  if (err instanceof Anthropic.APIError) {
    const status = err.status as number | undefined;
    const after = retryAfterMs(err.headers as Headers | undefined);
    const r = (code: ProviderErrorCode, retryable: boolean): Mapped => ({
      code,
      retryable,
      notSent: false,
      retryAfterMs: after,
    });
    if (status === undefined) {
      // An error event inside a stream that had begun: never retried.
      if (err.type === 'overloaded_error') return r('overloaded', false);
      if (err.type === 'rate_limit_error') return r('rate_limited', false);
      return r('bad_response', false);
    }
    if (status === 401 || status === 403) return r('auth', false);
    if (status === 429) return r('rate_limited', !isSpendCap(err));
    if (status === 529) return r('overloaded', true);
    if (status === 408) return r('timeout', true);
    if (status === 409) return r('overloaded', true);
    if (status === 413) return r('too_large', false);
    if (status >= 500) return r('unreachable', true);
    // 400 (a workspace spend limit is one, `invalid_request_error`), 404, 422.
    return r('bad_response', false);
  }
  return { code: 'bad_response', retryable: false, notSent: false, retryAfterMs: null };
}

/**
 * HOME's one retry (§5.1, N7), as a rule: the delay before retrying, or null
 * for no retry. Only a retryable failure (a connection error, 408, 409, 429
 * but never the provider's spend cap, 5xx, 529), only before any byte of the
 * response stream, after 1 s or a `retry-after` of at most 2 s.
 */
export function retryDelayMs(mapped: Mapped, responseStarted: boolean): number | null {
  if (!mapped.retryable || responseStarted) return null;
  const delay = mapped.retryAfterMs ?? LIMITS.retryDelayMs;
  return delay > LIMITS.retryAfterMaxMs ? null : delay;
}

// ---------------------------------------------------------------------------
// The provider.

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inferenceGeo: string | null;
};

const n = (v: number | null | undefined) => (typeof v === 'number' && v >= 0 ? Math.floor(v) : 0);

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve(true);
    }, ms);
    function stop() {
      clearTimeout(t);
      resolve(false);
    }
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/**
 * The Anthropic provider over a HOME fetch (production: createAnthropicProvider;
 * tests: a fetch from createProviderFetchForTests, which refuses to exist
 * when deployed). The SDK client is built per call, so nothing is constructed
 * until a call is made.
 */
export function buildAnthropicProvider(apiKey: string, fetch: ProviderFetch): KevProvider {
  if (!isProviderFetch(fetch)) throw new Error('the SDK only ever gets HOME’s provider fetch');
  if (typeof apiKey !== 'string' || apiKey.length === 0)
    throw new Error('a provider key is required');

  async function once(
    request: ProviderRequest,
    budget: TurnBudget,
    signal: AbortSignal | undefined,
    retried: boolean,
  ): Promise<
    | { ok: true; result: ProviderResult }
    | { ok: false; error: ProviderError; mapped: Mapped; noResponseBytes: boolean }
  > {
    const tier = TIERS[request.tier];
    const started = Date.now();
    const { ticket, timeoutMs } = budget.beginCall(started);
    const call = new AbortController();
    let timedOut = false;
    let outerAborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      call.abort();
    }, timeoutMs);
    const onOuter = () => {
      outerAborted = true;
      call.abort();
    };
    if (signal?.aborted) onOuter();
    else signal?.addEventListener('abort', onOuter, { once: true });
    const observer: FetchObserver = { responseBytes: 0, status: null };
    let usage: Usage | null = null;
    let geoRefused = false;
    try {
      const client = new Anthropic(anthropicClientOptions(apiKey, observedFetch(fetch, observer)));
      const stream = client.messages.stream(messagesParams(request), { signal: call.signal });
      for await (const event of stream) {
        if (event.type === 'message_start') {
          const u = event.message.usage;
          usage = {
            inputTokens: n(u.input_tokens),
            outputTokens: n(u.output_tokens),
            cacheReadTokens: n(u.cache_read_input_tokens),
            cacheWriteTokens: n(u.cache_creation_input_tokens),
            inferenceGeo: u.inference_geo ?? null,
          };
          // US inference, checked on every response (D3, N16).
          if (usage.inferenceGeo !== INFERENCE_GEO) {
            geoRefused = true;
            call.abort();
            break;
          }
        } else if (event.type === 'message_delta' && usage) {
          const u = event.usage;
          usage.outputTokens = Math.max(usage.outputTokens, n(u.output_tokens));
          if (u.input_tokens != null) usage.inputTokens = n(u.input_tokens);
          if (u.cache_read_input_tokens != null)
            usage.cacheReadTokens = n(u.cache_read_input_tokens);
          if (u.cache_creation_input_tokens != null)
            usage.cacheWriteTokens = n(u.cache_creation_input_tokens);
        }
      }
      if (geoRefused) throw new GeoRefused();
      const final = await stream.finalMessage();
      const u = final.usage;
      const known: CallUsage = Object.freeze({
        inputTokens: n(u.input_tokens),
        outputTokens: n(u.output_tokens),
        cacheReadTokens: n(u.cache_read_input_tokens),
        cacheWriteTokens: n(u.cache_creation_input_tokens),
        inferenceGeo: usage?.inferenceGeo ?? u.inference_geo ?? null,
      });
      const ms = Date.now() - started;
      if (known.inferenceGeo !== INFERENCE_GEO) throw new GeoRefused();
      if (final.stop_reason === 'refusal') {
        // Recorded with its reported usage (a refusal may still bill input).
        budget.endCall(ticket, {
          model: tier.model.id,
          usage: known,
          ms,
          stop: 'refusal',
          errorCode: 'refusal',
        });
        const error = new ProviderError('refusal', {
          attemptId: budget.attemptId,
          ms,
          partialUsage: known,
          retried,
        });
        return {
          ok: false,
          error,
          mapped: { code: 'refusal', retryable: false, notSent: false, retryAfterMs: null },
          noResponseBytes: false,
        };
      }
      const stop = STOPS[final.stop_reason ?? ''] ?? 'other';
      budget.endCall(ticket, { model: tier.model.id, usage: known, ms, stop });
      const text: string[] = [];
      const toolUses: ProviderResult['toolUses'][number][] = [];
      for (const b of final.content) {
        if (b.type === 'text') text.push(b.text);
        else if (b.type === 'tool_use')
          toolUses.push(
            Object.freeze({ ref: seal('tool_use', b.id), name: b.name, input: b.input }),
          );
      }
      return {
        ok: true,
        result: Object.freeze({
          attemptId: budget.attemptId,
          tier: request.tier,
          stop,
          text: Object.freeze(text),
          toolUses: Object.freeze(toolUses),
          replay: seal('assistant_turn', final.content),
          usage: known,
          ms,
          retried,
        }),
      };
    } catch (err) {
      const ms = Date.now() - started;
      const mapped: Mapped =
        err instanceof GeoRefused || geoRefused
          ? { code: 'bad_response', retryable: false, notSent: false, retryAfterMs: null }
          : timedOut || outerAborted
            ? { code: 'timeout', retryable: false, notSent: false, retryAfterMs: null }
            : mapProviderError(err);
      const partial: CallUsage | null = usage ? Object.freeze({ ...(usage as Usage) }) : null;
      budget.endCall(ticket, {
        model: tier.model.id,
        usage: partial,
        ms,
        stop: 'error',
        errorCode: mapped.code,
        notSent: mapped.notSent,
      });
      const error = new ProviderError(mapped.code, {
        attemptId: budget.attemptId,
        ms,
        partialUsage: partial,
        retried,
      });
      const streamStarted =
        observer.status !== null && observer.status < 300 && observer.responseBytes > 0;
      return { ok: false, error, mapped, noResponseBytes: !streamStarted && usage === null };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuter);
    }
  }

  return Object.freeze({
    kind: 'anthropic' as const,
    async run(request: ProviderRequest, options: RunOptions): Promise<ProviderResult> {
      const { budget, signal } = options;
      if (request.tier !== budget.tier) throw new Error('a request runs on its attempt’s tier');
      const first = await once(request, budget, signal, false);
      if (first.ok) return first.result;
      // HOME's one retry (§5.1, N7): only for a connection error, 408, 409,
      // 429 (never the provider's spend cap), 5xx or 529; only before any
      // byte of the response stream; after 1 s, or `retry-after` if at most
      // 2 s (a longer one: no retry); only if the budget still allows the
      // whole call. It counts as one of the attempt's five calls.
      const delay = retryDelayMs(first.mapped, !first.noResponseBytes);
      if (delay === null) throw first.error;
      if (!(await sleep(delay, signal))) throw first.error;
      if (!budget.canCall(Date.now()).ok) throw first.error;
      const second = await once(request, budget, signal, true);
      if (second.ok) return second.result;
      throw second.error;
    },
  });
}

class GeoRefused extends Error {
  constructor() {
    super('inference_geo');
    this.name = 'GeoRefused';
  }
}

/**
 * The production provider: HOME's fetch with its frozen policy, and the key.
 * It takes exactly `{ apiKey }`: no fetch, base URL, retry count or any other
 * override can be passed (a test proves it).
 */
export function createAnthropicProvider(config: { apiKey: string }): KevProvider {
  const keys = Object.keys(config ?? {});
  if (keys.length !== 1 || keys[0] !== 'apiKey')
    throw new Error('the production provider takes the key and nothing else');
  return buildAnthropicProvider(config.apiKey, createProviderFetch(config.apiKey));
}
