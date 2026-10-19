import 'server-only';
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { BudgetExhausted, exceedsInputCap, TurnBudget, type CallRecord } from '../budget';
import { deploymentEnv, PROVIDER_KEY_FORMAT } from '@/lib/env';
import { INFERENCE_GEO, LIMITS, MODELS, TIERS } from '../config';
import {
  ANTHROPIC_VERSION,
  createProviderFetch,
  createRunnerProviderFetch,
  isProviderFetch,
  observedFetch,
  PROVIDER_FETCH_LIMITS,
  PROVIDER_ORIGIN,
  ProviderNetError,
  THINKING_BINDING_BETA,
  type FetchObserver,
  type ProviderFetch,
} from './fetch';
import {
  ProviderError,
  seal,
  unseal,
  type CallUsage,
  type KevProvider,
  type ProbeEvidence,
  type ProbeOptions,
  type ProviderErrorCode,
  type ProviderMessage,
  type ProviderRequest,
  type ProviderResult,
  type RunOptions,
  type StopCode,
} from './types';
import {
  detailOfMessage,
  providerDiagnostic,
  providerMessageOf,
  schemaNamesOf,
  validRequestId,
  type ProbeErrorDetail,
  type ProviderDiagnostic,
} from './diagnostics';
import { preflightError, validCount } from './preflight';

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
    output_config: request.outputFormat
      ? {
          effort: tier.effort,
          format: { type: 'json_schema', schema: { ...request.outputFormat } },
        }
      : { effort: tier.effort },
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

/**
 * The preflight count's body for a request (G22; contract §2.2, §5.4): the
 * complete input the call will send, for the same model, with the same
 * system prompt (and its cache breakpoint), tools, `tool_choice`, thinking
 * configuration (none is sent: the tier's default) and `output_config`
 * (effort, and the answer's format); only what the counting endpoint does
 * not take is left out (`max_tokens`, `inference_geo`, `stream`). Exported
 * for its test.
 */
export function countParams(request: ProviderRequest): Anthropic.Messages.MessageCountTokensParams {
  return countParamsOf(messagesParams(request));
}

/** The count's body for a call's exact Messages API body (the probe path's too). */
function countParamsOf(params: Params): Anthropic.Messages.MessageCountTokensParams {
  const {
    max_tokens: _max,
    inference_geo: _geo,
    stream: _stream,
    ...rest
  } = params as Params & { stream?: unknown };
  void _max;
  void _geo;
  void _stream;
  return rest as Anthropic.Messages.MessageCountTokensParams;
}

// ---------------------------------------------------------------------------
// The live verification runner's probe path (M8 live-verification plan §5;
// owner decision 2, 2026-10-16). Not reachable from KevProvider: the
// production provider's `run` takes the request and its options only, and
// the probe gateway below refuses to exist on a deployed process.

/** Every model id HOME knows (config.ts): the only ids the Models API probe asks about. */
const KNOWN_MODEL_IDS: readonly string[] = Object.freeze(Object.values(MODELS).map((m) => m.id));

/** The longest mid-conversation system message a probe may send (G8): a synthetic sentence. */
const PROBE_SYSTEM_MAX_CHARS = 500;

/**
 * A probe's Messages API body: the production body for the request, with
 * only what `probe` names changed. Exported for its test.
 */
export function probeParams(request: ProviderRequest, probe: ProbeOptions): Params {
  const params = messagesParams(request);
  if (probe.probeModel !== undefined) {
    if (probe.probeModel !== 'haiku55') throw new Error('a probe model is Haiku 5.5 only');
    // On a fast budget only: its per-call maximum (Sonnet 5.5's prices, the
    // fast tier's max_tokens) bounds a Haiku call; a completed one is
    // recorded at Haiku's prices (kev/budget.ts, recordedPrices; tested).
    if (request.tier !== 'fast') throw new Error('a Haiku probe runs on a fast budget only');
    params.model = MODELS.haiku55.id;
  }
  if (probe.effort !== undefined) {
    if (probe.effort !== 'low') throw new Error('a probe effort is `low` only');
    params.output_config = { ...params.output_config, effort: 'low' };
  }
  if (probe.strictTools !== undefined) {
    if (probe.strictTools !== false) throw new Error('a probe’s strictTools is `false` only');
    if (!params.tools?.length) throw new Error('a probe without tools has no strictness to change');
    params.tools = params.tools.map((t) => {
      const { strict: _strict, ...rest } = t as Anthropic.Messages.Tool;
      void _strict;
      return rest;
    });
  }
  if (probe.prefixCheck !== undefined) {
    if (probe.prefixCheck !== 'error') throw new Error('a probe’s prefix check is `error` only');
    // Adaptive is every tier's default (none is sent in production), so the
    // model thinks as it does without it; the field opts this request into
    // the provider's prefix check (G9; ADR 0012 §63).
    // The SDK's types predate `block_binding`; the body carries it as sent.
    params.thinking = {
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'error' },
    } as unknown as NonNullable<Params['thinking']>;
  }
  if (probe.systemMessage !== undefined) {
    const t = probe.systemMessage;
    if (typeof t !== 'string' || t.trim() === '' || t.length > PROBE_SYSTEM_MAX_CHARS)
      throw new Error('a probe system message is one short synthetic sentence');
    const last = request.messages[request.messages.length - 1];
    if (!last || last.role !== 'user')
      throw new Error('a mid-conversation system message follows a user turn');
    params.messages = [...params.messages, { role: 'system', content: t }];
  }
  return params;
}

/** The request's beta flag: the thinking-binding controls when a probe opts into the prefix check (G9). */
function betaHeaders(probe: ProbeHooks | null): Record<string, string> | undefined {
  return probe?.options?.prefixCheck ? { 'anthropic-beta': THINKING_BINDING_BETA } : undefined;
}

/** `input_transformations` from `message_start`, counted by type (G9); null when absent. */
export function transformationsOf(
  message: unknown,
): Readonly<{ dropped: number; allowed: number; other: number }> | null {
  const list = (message as { input_transformations?: unknown } | null)?.input_transformations;
  if (!Array.isArray(list)) return null;
  const out = { dropped: 0, allowed: 0, other: 0 };
  for (const t of list) {
    const type = (t as { type?: unknown } | null)?.type;
    if (type === 'thinking_dropped') out.dropped += 1;
    else if (type === 'thinking_mismatch_allowed') out.allowed += 1;
    else out.other += 1;
  }
  return Object.freeze(out);
}

/** The probe path's hooks into one call: its options and where its evidence goes. */
type ProbeHooks = Readonly<{
  options: ProbeOptions | null;
  record: (e: ProbeEvidence) => void;
  /** G9: whether this body extends the attempt's previous one (system, tools, messages). */
  growOnly: (attemptId: string, params: Params) => boolean | null;
}>;

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
  /** The provider's structural diagnostic (status, category, request id): an API error's only. */
  provider: ProviderDiagnostic | null;
};

/** The provider's per-tier spend cap: a 429 that keeps failing until the month turns. */
function isSpendCap(err: InstanceType<typeof Anthropic.APIError>): boolean {
  const body = err.error as { error?: { details?: { error_code?: unknown } } } | undefined;
  return body?.error?.details?.error_code === 'enforced_spend_limit_reached';
}

/**
 * `retry-after` as HOME honours it: whole decimal seconds only, digits and
 * nothing else (no HTTP-date, sign, exponent, hex or zero padding); anything
 * else means no retry. (Surrounding whitespace never reaches here: HTTP
 * parsing and the Headers class strip it.) `retry-after-ms` is never read.
 */
export function retryAfterMs(headers: Headers | undefined): number | null {
  const raw = headers?.get('retry-after');
  if (raw === null || raw === undefined) return null;
  if (!/^(?:0|[1-9][0-9]{0,8})$/.test(raw)) return Number.POSITIVE_INFINITY;
  return Number(raw) * 1000;
}

/**
 * The probe path's error detail (the live verification runner only, on
 * synthetic data; never called for a production call): the structural
 * diagnostic, and the provider message's recognised paths and signals
 * (diagnostics.ts, detailOfMessage), never its text. Null for an error the
 * provider did not send (HOME's own refusals, the network, timeouts).
 */
function probeErrorOf(
  err: unknown,
  mapped: Mapped,
  params: Parameters<typeof schemaNamesOf>[0],
): ProbeErrorDetail | null {
  if (!mapped.provider) return null;
  const body = err instanceof Anthropic.APIError ? err.error : undefined;
  return Object.freeze({
    ...mapped.provider,
    message: detailOfMessage(providerMessageOf(body), schemaNamesOf(params)),
  });
}

export function mapProviderError(err: unknown): Mapped {
  const net = netErrorIn(err);
  if (net)
    return {
      code: net.code === 'auth' ? 'auth' : net.code,
      retryable: net.retryable,
      notSent: !net.sent,
      retryAfterMs: null,
      provider: null,
    };
  if (err instanceof Anthropic.APIUserAbortError)
    return {
      code: 'timeout',
      retryable: false,
      notSent: false,
      retryAfterMs: null,
      provider: null,
    };
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return {
      code: 'timeout',
      retryable: false,
      notSent: false,
      retryAfterMs: null,
      provider: null,
    };
  if (err instanceof Anthropic.APIConnectionError)
    return {
      code: 'unreachable',
      retryable: true,
      notSent: false,
      retryAfterMs: null,
      provider: null,
    };
  if (err instanceof Anthropic.APIError) {
    const status = err.status as number | undefined;
    const after = retryAfterMs(err.headers as Headers | undefined);
    // Typed fields only: the body's category and request id, never its message.
    const provider = providerDiagnostic({
      status,
      body: err.error,
      headerRequestId: err.requestID,
    });
    const r = (code: ProviderErrorCode, retryable: boolean): Mapped => ({
      code,
      retryable,
      notSent: false,
      retryAfterMs: after,
      provider,
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
  return {
    code: 'bad_response',
    retryable: false,
    notSent: false,
    retryAfterMs: null,
    provider: null,
  };
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

/** One call of the provider core: the request, its options, and the probe path's hooks (null in production). */
type Core = {
  run(
    request: ProviderRequest,
    options: RunOptions,
    probe: ProbeHooks | null,
  ): Promise<ProviderResult>;
};

/** Content block types in a final message, counted (never their content). */
function blockCounts(content: readonly { type: string }[]): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const b of content) out[b.type] = (out[b.type] ?? 0) + 1;
  return Object.freeze(out);
}

/**
 * The provider's one implementation (production and the probe path share
 * it): the count (G22), the call, HOME's one retry, the budget, the US
 * inference check. With `probe` null, exactly the production behaviour.
 */
function buildCore(apiKey: string, fetch: ProviderFetch): Core {
  if (!isProviderFetch(fetch)) throw new Error('the SDK only ever gets HOME’s provider fetch');
  if (typeof apiKey !== 'string' || !PROVIDER_KEY_FORMAT.test(apiKey))
    throw new Error('a well-formed provider key is required');

  /**
   * The preflight token count (G22; owner decision, 2026-10-15): the
   * request's complete input, counted through HOME's fetch on POST
   * /v1/messages/count_tokens before the call, under its own short bound
   * (TurnBudget.countTimeoutMs: at most 5 s, and never past the point where
   * the call could still start) and the turn's signal. Any failure (an error status, a timeout,
   * a refusal by HOME's network policy, a malformed or missing count) fails
   * closed: a ProviderError marked `preflight: 'failed'`, and no model call.
   * Never retried. Not a model call: it is not counted among the attempt's
   * five, and it is free (the provider's pricing page, 2026-10-15; config's
   * COUNT_TOKENS_COST_USD_MICROS), so nothing is charged or settled for it.
   */
  async function preflight(
    params: Params,
    budget: TurnBudget,
    signal: AbortSignal | undefined,
    probe: ProbeHooks | null,
  ): Promise<number> {
    const started = Date.now();
    // Its own short bound, never the call's (I-3): a slow count cannot use up the call's time.
    const check = budget.countTimeoutMs(started);
    if (!check.ok) throw new BudgetExhausted(check.reason);
    const call = new AbortController();
    const timer = setTimeout(() => call.abort(), check.timeoutMs);
    const onOuter = () => call.abort();
    if (signal?.aborted) onOuter();
    else signal?.addEventListener('abort', onOuter, { once: true });
    const observer: FetchObserver = { requests: 0, responseBytes: 0, status: null };
    const failed = (code: ProviderErrorCode, provider: ProviderDiagnostic | null = null) =>
      preflightError(code, budget.attemptId, Date.now() - started, 'failed', provider);
    let counted: number | null = null;
    let errorDetail: ProbeErrorDetail | null = null;
    try {
      const client = new Anthropic(anthropicClientOptions(apiKey, observedFetch(fetch, observer)));
      counted = validCount(
        await client.messages.countTokens(countParamsOf(params), {
          signal: call.signal,
          headers: betaHeaders(probe),
        }),
      );
      if (counted === null) throw failed('bad_response');
      return counted;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (call.signal.aborted) throw failed('timeout');
      const mapped = mapProviderError(err);
      if (probe) errorDetail = probeErrorOf(err, mapped, params);
      throw failed(mapped.code, mapped.provider);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuter);
      probe?.record(
        Object.freeze({
          kind: 'count' as const,
          attemptId: budget.attemptId,
          model: params.model,
          status: observer.status,
          requestId: validRequestId(observer.requestId),
          counted,
          error: errorDetail,
          ms: Date.now() - started,
        }),
      );
    }
  }

  async function once(
    request: ProviderRequest,
    params: Params,
    budget: TurnBudget,
    signal: AbortSignal | undefined,
    retried: boolean,
    counted: number,
    probe: ProbeHooks | null,
  ): Promise<
    | { ok: true; result: ProviderResult }
    | { ok: false; error: ProviderError; mapped: Mapped; noResponseBytes: boolean }
  > {
    // The model actually called: the tier's, or (probe path only) Haiku 5.5.
    const model = params.model;
    const started = Date.now();
    const { ticket, timeoutMs } = budget.beginCall(started);
    const call = new AbortController();
    let timedOut = false;
    let outerAborted = false;
    // G20 (probe path only): the stream aborted on purpose after its first event.
    let probeAborted = false;
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
    const observer: FetchObserver = { requests: 0, responseBytes: 0, status: null };
    let usage: Usage | null = null;
    // The provider's final usage: set only once the stream completed.
    let finalUsage: CallUsage | null = null;
    let geoRefused = false;
    let overInput = false;
    // For the probe path's evidence only.
    let record: CallRecord | null = null;
    let outcome: 'ok' | ProviderErrorCode = 'ok';
    let blocks: Readonly<Record<string, number>> = Object.freeze({});
    let transformations: Readonly<{ dropped: number; allowed: number; other: number }> | null =
      null;
    // The probe path's error detail (synthetic runner only; never production).
    let errorDetail: ProbeErrorDetail | null = null;
    const growOnly = probe ? probe.growOnly(budget.attemptId, params) : null;
    try {
      const client = new Anthropic(anthropicClientOptions(apiKey, observedFetch(fetch, observer)));
      const stream = client.messages.stream(params, {
        signal: call.signal,
        headers: betaHeaders(probe),
      });
      for await (const event of stream) {
        if (event.type === 'message_start') {
          if (probe) transformations = transformationsOf(event.message);
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
          // The 32,000-token input cap, on the provider's own count (I4):
          // more ends the call now, and the budget halts the attempt.
          if (exceedsInputCap(usage)) {
            overInput = true;
            call.abort();
            break;
          }
          if (probe?.options?.abortAfterFirstEvent) {
            probeAborted = true;
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
      if (overInput) throw new InputOverCap();
      if (probeAborted) throw new ProbeAborted();
      const final = await stream.finalMessage();
      const u = final.usage;
      const known: CallUsage = Object.freeze({
        inputTokens: n(u.input_tokens),
        outputTokens: n(u.output_tokens),
        cacheReadTokens: n(u.cache_read_input_tokens),
        cacheWriteTokens: n(u.cache_creation_input_tokens),
        inferenceGeo: usage?.inferenceGeo ?? u.inference_geo ?? null,
      });
      finalUsage = known;
      const ms = Date.now() - started;
      if (known.inferenceGeo !== INFERENCE_GEO) throw new GeoRefused();
      if (exceedsInputCap(known)) throw new InputOverCap();
      if (probe) blocks = blockCounts(final.content);
      if (final.stop_reason === 'refusal') {
        // Recorded with its reported usage (a refusal may still bill input).
        record = budget.endCall(ticket, {
          model,
          usage: known,
          ms,
          stop: 'refusal',
          errorCode: 'refusal',
        });
        outcome = 'refusal';
        const error = new ProviderError('refusal', {
          attemptId: budget.attemptId,
          ms,
          partialUsage: known,
          retried,
        });
        return {
          ok: false,
          error,
          mapped: {
            code: 'refusal',
            retryable: false,
            notSent: false,
            retryAfterMs: null,
            provider: null,
          },
          noResponseBytes: false,
        };
      }
      const stop = STOPS[final.stop_reason ?? ''] ?? 'other';
      record = budget.endCall(ticket, { model, usage: known, ms, stop });
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
          countedInputTokens: counted,
        }),
      };
    } catch (err) {
      const ms = Date.now() - started;
      // Nothing of the call left HOME if it never entered HOME's fetch (the
      // SDK threw, or the call was aborted, before making the request): our
      // own observer says so, never an error's text (M-2).
      const neverSent = observer.requests === 0;
      const base: Mapped =
        err instanceof InputOverCap || overInput
          ? {
              code: 'too_large',
              retryable: false,
              notSent: false,
              retryAfterMs: null,
              provider: null,
            }
          : err instanceof GeoRefused || geoRefused
            ? {
                code: 'bad_response',
                retryable: false,
                notSent: false,
                retryAfterMs: null,
                provider: null,
              }
            : timedOut || outerAborted || probeAborted
              ? {
                  code: 'timeout',
                  retryable: false,
                  notSent: false,
                  retryAfterMs: null,
                  provider: null,
                }
              : mapProviderError(err);
      const mapped: Mapped = neverSent ? { ...base, notSent: true } : base;
      outcome = mapped.code;
      if (probe) errorDetail = probeErrorOf(err, mapped, params);
      // Final usage when the stream completed (a geo or cap refusal after
      // it); otherwise what message_start and the deltas reported, which is
      // partial and charged conservatively (I2).
      const reported: CallUsage | null =
        finalUsage ?? (usage ? Object.freeze({ ...(usage as Usage) }) : null);
      record = budget.endCall(ticket, {
        model,
        usage: reported,
        ms,
        stop: 'error',
        errorCode: mapped.code,
        notSent: mapped.notSent,
        partial: finalUsage === null && reported !== null,
      });
      const error = new ProviderError(mapped.code, {
        attemptId: budget.attemptId,
        ms,
        partialUsage: reported,
        retried,
        ...(mapped.provider ? { provider: mapped.provider } : {}),
      });
      const streamStarted =
        observer.status !== null && observer.status < 300 && observer.responseBytes > 0;
      return { ok: false, error, mapped, noResponseBytes: !streamStarted && usage === null };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuter);
      probe?.record(
        Object.freeze({
          kind: 'message' as const,
          attemptId: budget.attemptId,
          model,
          status: observer.status,
          requestId: validRequestId(observer.requestId),
          outcome,
          error: errorDetail,
          stop: record ? record.stop : null,
          usage: record ? record.usage : null,
          costUsdMicros: record ? record.costUsdMicros : null,
          toolChoice: params.tool_choice?.type ?? null,
          answerFormat: Boolean(params.output_config?.format),
          blocks,
          growOnly,
          transformations,
          retried,
          ms: Date.now() - started,
        }),
      );
    }
  }

  return {
    async run(
      request: ProviderRequest,
      options: RunOptions,
      probe: ProbeHooks | null,
    ): Promise<ProviderResult> {
      const { budget, signal } = options;
      // Only the attempt's own TurnBudget, on a live reservation, may carry a
      // call: a look-alike object is refused before anything is built.
      if (!(budget instanceof TurnBudget) || !budget.live)
        throw new Error('a call needs its attempt’s live TurnBudget');
      if (request.tier !== budget.tier) throw new Error('a request runs on its attempt’s tier');
      // The call's exact body, built afresh for each send (the probe path
      // changes only what its options name).
      const build = (): Params =>
        probe?.options ? probeParams(request, probe.options) : messagesParams(request);
      // G22: no model call without a count of its complete input, within the cap.
      const counted = await preflight(build(), budget, signal, probe);
      if (counted > LIMITS.inputTokensPerCall)
        throw preflightError('too_large', budget.attemptId, 0, 'over_cap');
      const first = await once(request, build(), budget, signal, false, counted, probe);
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
      // The retry re-sends the same bytes the count covered: not counted again.
      const second = await once(request, build(), budget, signal, true, counted, probe);
      if (second.ok) return second.result;
      throw second.error;
    },
  };
}

/**
 * The Anthropic provider over a HOME fetch (production: createAnthropicProvider;
 * tests: a fetch from createProviderFetchForTests, which refuses to exist
 * when deployed). The SDK client is built per call, so nothing is constructed
 * until a call is made. Its `run` takes the request and its options and
 * nothing else: the probe path is not reachable through it.
 */
export function buildAnthropicProvider(apiKey: string, fetch: ProviderFetch): KevProvider {
  const core = buildCore(apiKey, fetch);
  return Object.freeze({
    kind: 'anthropic' as const,
    run: (request: ProviderRequest, options: RunOptions): Promise<ProviderResult> =>
      core.run(request, options, null),
  });
}

// ---------------------------------------------------------------------------
// The probe gateway: the live verification runner's only way to the provider.

/**
 * The live verification runner's gateway (M8 live-verification plan §5, §7;
 * owner decision 2, 2026-10-16): the same core as the production provider,
 * so every model call is counted first (G22), goes through HOME's fetch
 * (allow-list, TLS, size and time limits), is checked for US inference and
 * is held to its attempt's TurnBudget; plus what the plan's probes need and
 * KevProvider deliberately cannot express: G1's Models API read, Haiku 5.5
 * on a fast budget, G1's `low` effort, G8's one system message, G20's
 * abort, and per-call evidence (status, `request-id`, usage, US inference,
 * HOME's charge, block types; never a body). Refused on any deployed
 * process: nothing in src/ but this file names it, and kev.handle() and the
 * turn route never reach it (tests/unit/kev-probe-gateway.test.ts).
 */
export type ProbeGateway = Readonly<{
  /** G1: GET /v1/models/{id}, for a model id config.ts knows. No model input, no count, no charge. */
  models(id: string): Promise<Extract<ProbeEvidence, { kind: 'models' }>>;
  /** One probe call: the production path, changed only as `probe` names. */
  run(request: ProviderRequest, options: RunOptions, probe?: ProbeOptions): Promise<ProviderResult>;
  /**
   * A KevProvider for kev.handle() (G9, G21): production requests, with
   * evidence recorded; with `probe`, every call changed only as it names
   * (G9's prefix check).
   */
  provider(probe?: ProbeOptions): KevProvider;
  /** Every exchange so far, in order (no body, no key, no header but the request id). */
  evidence(): readonly ProbeEvidence[];
}>;

/** The Models API probe's own bound: no model runs, so a short one. */
const MODELS_TIMEOUT_MS = 10_000;

const deployedSource = (s: Record<string, string | undefined>) =>
  Boolean(s.VERCEL_ENV || s.VERCEL || s.NODE_ENV === 'production');

/**
 * The probe gateway over a HOME fetch (tests: a stub fetch; the runner:
 * createProbeGateway). Refused when VERCEL_ENV, VERCEL or NODE_ENV=production
 * is set, in `source` or in the process's own environment.
 */
export function buildProbeGateway(
  apiKey: string,
  fetch: ProviderFetch,
  source: Record<string, string | undefined> = deploymentEnv(),
): ProbeGateway {
  if (deployedSource(source) || deployedSource(deploymentEnv()))
    throw new Error('the probe gateway is for the live verification runner only, never deployed');
  const core = buildCore(apiKey, fetch);
  const log: ProbeEvidence[] = [];
  const record = (e: ProbeEvidence) => {
    log.push(e);
  };
  // G9: the attempt's previous body, in memory only, never reported.
  const previous = new Map<string, { system: string; tools: string; messages: string[] }>();
  const growOnly = (attemptId: string, params: Params): boolean | null => {
    const cur = {
      system: JSON.stringify(params.system ?? null),
      tools: JSON.stringify(params.tools ?? null),
      messages: params.messages.map((m) => JSON.stringify(m)),
    };
    const prev = previous.get(attemptId);
    previous.set(attemptId, cur);
    if (!prev) return null;
    return (
      prev.system === cur.system &&
      prev.tools === cur.tools &&
      prev.messages.length <= cur.messages.length &&
      prev.messages.every((m, i) => cur.messages[i] === m)
    );
  };
  const hooks = (options: ProbeOptions | null): ProbeHooks =>
    Object.freeze({ options, record, growOnly });

  return Object.freeze({
    async models(id: string) {
      if (!KNOWN_MODEL_IDS.includes(id))
        throw new Error('the Models API probe asks only about config.ts’s ids');
      const started = Date.now();
      const observer: FetchObserver = { requests: 0, responseBytes: 0, status: null };
      const call = new AbortController();
      const timer = setTimeout(() => call.abort(), MODELS_TIMEOUT_MS);
      let entry: Extract<ProbeEvidence, { kind: 'models' }>;
      try {
        const client = new Anthropic(
          anthropicClientOptions(apiKey, observedFetch(fetch, observer)),
        );
        const info = await client.models.retrieve(id, {}, { signal: call.signal });
        entry = Object.freeze({
          kind: 'models' as const,
          model: id,
          status: observer.status,
          requestId: validRequestId(observer.requestId),
          outcome: 'ok' as const,
          error: null,
          id: typeof info.id === 'string' ? info.id : null,
          maxInputTokens: typeof info.max_input_tokens === 'number' ? info.max_input_tokens : null,
          maxTokens: typeof info.max_tokens === 'number' ? info.max_tokens : null,
          ms: Date.now() - started,
        });
      } catch (err) {
        const mapped = call.signal.aborted ? null : mapProviderError(err);
        entry = Object.freeze({
          kind: 'models' as const,
          model: id,
          status: observer.status,
          requestId: validRequestId(observer.requestId),
          outcome: mapped ? mapped.code : ('timeout' as const),
          error: mapped ? probeErrorOf(err, mapped, {}) : null,
          id: null,
          maxInputTokens: null,
          maxTokens: null,
          ms: Date.now() - started,
        });
      } finally {
        clearTimeout(timer);
      }
      record(entry);
      return entry;
    },
    run: (request: ProviderRequest, options: RunOptions, probe?: ProbeOptions) =>
      core.run(request, options, hooks(probe ?? null)),
    provider: (probe?: ProbeOptions): KevProvider =>
      Object.freeze({
        kind: 'anthropic' as const,
        run: (request: ProviderRequest, options: RunOptions) =>
          core.run(request, options, hooks(probe ?? null)),
      }),
    evidence: () => Object.freeze([...log]),
  });
}

/**
 * The runner's probe gateway: HOME's production fetch (TLS to
 * api.anthropic.com's public addresses, the frozen policy) and the key, and
 * nothing else. Refused on any deployed process.
 */
export function createProbeGateway(
  config: { apiKey: string },
  source: Record<string, string | undefined> = deploymentEnv(),
): ProbeGateway {
  const keys = Object.keys(config ?? {});
  if (keys.length !== 1 || keys[0] !== 'apiKey')
    throw new Error('the probe gateway takes the key and nothing else');
  if (deployedSource(source) || deployedSource(deploymentEnv()))
    throw new Error('the probe gateway is for the live verification runner only, never deployed');
  // The runner's fetch: production's rules, with the thinking-binding beta
  // flag enabled (G9; sent only when a probe opts into the prefix check).
  return buildProbeGateway(config.apiKey, createRunnerProviderFetch(config.apiKey, source), source);
}

class ProbeAborted extends Error {
  constructor() {
    super('probe_abort');
    this.name = 'ProbeAborted';
  }
}

class GeoRefused extends Error {
  constructor() {
    super('inference_geo');
    this.name = 'GeoRefused';
  }
}

class InputOverCap extends Error {
  constructor() {
    super('input_tokens');
    this.name = 'InputOverCap';
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
