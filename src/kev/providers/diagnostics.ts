import 'server-only';

// Provider error diagnostics (M8 live verification #2, 2026-10-17; ADR 0012
// §52). Run #2's four Messages API calls were refused with HTTP 400, and
// HOME kept only its closed code (`bad_response`): the provider's category
// and its explanation were dropped, so the next live failure could not be
// read without a paid repeat. Two tiers, by where the call ran:
//
// - Every call (production included): STRUCTURAL fields only. The HTTP
//   status, the provider's error category from a closed list, and the
//   provider's request id in its documented shape. No message, no body.
//   They ride on ProviderError's detail and the turn's one `kev_turn` line.
// - The live verification runner's probe path only (synthetic data, never a
//   deployed process): `detailOfMessage` reads the provider's message and
//   keeps what a closed vocabulary recognises, never the text: request
//   parameter paths whose every segment is a known API field, a JSON Schema
//   keyword or a name HOME itself sent in that request's schemas (anything
//   else becomes `*`), and phrase signals from a fixed table. A secret, a
//   prompt or any other free text in the message cannot come out, because
//   nothing the vocabulary does not already hold is ever copied.
//
// The provider's own error shape (its errors page, read 2026-10-17):
// `{"type":"error","error":{"type":…,"message":…},"request_id":"req_…"}`,
// and the same id in the `request-id` response header.

/** The provider's documented error categories (`error.type`). */
export const PROVIDER_ERROR_TYPES = [
  'invalid_request_error',
  'authentication_error',
  'billing_error',
  'permission_error',
  'not_found_error',
  'conflict_error',
  'request_too_large',
  'rate_limit_error',
  'api_error',
  'timeout_error',
  'overloaded_error',
] as const;

/** A documented category, or `unrecognised` for any other value the provider sent. */
export type ProviderErrorType = (typeof PROVIDER_ERROR_TYPES)[number] | 'unrecognised';

/** The structural diagnostic every failed provider call keeps: no text. */
export type ProviderDiagnostic = Readonly<{
  status: number | null;
  type: ProviderErrorType | null;
  requestId: string | null;
}>;

const TYPES: ReadonlySet<string> = new Set(PROVIDER_ERROR_TYPES);

/** The category, from the closed list; `unrecognised` for another string; null when absent. */
export function providerErrorType(raw: unknown): ProviderErrorType | null {
  if (typeof raw !== 'string') return null;
  return TYPES.has(raw) ? (raw as ProviderErrorType) : 'unrecognised';
}

/** The provider's request id shape: `req_` and 8 to 64 letters and digits. */
const REQUEST_ID = /^req_[A-Za-z0-9]{8,64}$/;

/** A request id in the provider's shape, or null: nothing else is kept. */
export function validRequestId(raw: unknown): string | null {
  return typeof raw === 'string' && REQUEST_ID.test(raw) ? raw : null;
}

/** An HTTP error status (400 to 599), or null. */
const errorStatus = (s: unknown): number | null =>
  typeof s === 'number' && Number.isInteger(s) && s >= 400 && s <= 599 ? s : null;

const isObject = (n: unknown): n is Record<string, unknown> =>
  n !== null && typeof n === 'object' && !Array.isArray(n);

/**
 * The structural diagnostic of a provider error: the status, the category
 * from the body (`error.type`, or a stream error's own `type`) and the first
 * request id in the provider's shape (the body's, then the header's). The
 * body's message is never read here.
 */
export function providerDiagnostic(input: {
  status: unknown;
  body: unknown;
  headerRequestId: unknown;
}): ProviderDiagnostic {
  const body = isObject(input.body) ? input.body : null;
  const inner = body && isObject(body.error) ? body.error : null;
  return Object.freeze({
    status: errorStatus(input.status),
    type: providerErrorType(inner?.type ?? null),
    requestId: validRequestId(body?.request_id) ?? validRequestId(input.headerRequestId),
  });
}

/** The provider's message, from its body; never anything else. Probe path only. */
export function providerMessageOf(body: unknown): unknown {
  const inner = isObject(body) && isObject(body.error) ? body.error : null;
  return inner?.message;
}

// ---------------------------------------------------------------------------
// The probe path's message detail: recognised paths and signals, never text.

/** What the runner keeps from a provider message. */
export type MessageDetail = Readonly<{
  /** Request parameter paths, every segment recognised or `*`; at most MAX_PATHS. */
  paths: readonly string[];
  /** Phrase signals from SIGNALS, in table order. */
  signals: readonly string[];
  /** The message's length in characters (capped), so "there was one" is visible. */
  chars: number;
}>;

/** How much of a message is read at all. */
export const MAX_MESSAGE_SCAN = 4_000;
/** At most this many paths are kept. */
export const MAX_PATHS = 6;
/** At most this many segments per path are kept. */
export const MAX_SEGMENTS = 12;
/** A segment longer than this is never kept, whatever it is. */
const MAX_SEGMENT_CHARS = 40;

/** The Messages API's top-level request fields: a path starts with one. */
export const PATH_ROOTS: ReadonlySet<string> = new Set([
  'tools',
  'messages',
  'system',
  'output_config',
  'tool_choice',
  'thinking',
  'max_tokens',
  'model',
  'metadata',
  'inference_geo',
  'stop_sequences',
  'temperature',
  'top_p',
  'top_k',
  'stream',
  'service_tier',
  'context_management',
  'container',
  'mcp_servers',
]);

/** API field names and JSON Schema keywords a path segment may be. */
export const PATH_SEGMENTS: ReadonlySet<string> = new Set([
  // Request fields below the top level.
  'custom',
  'input_schema',
  'name',
  'description',
  'strict',
  'type',
  'cache_control',
  'ttl',
  'content',
  'role',
  'text',
  'tool_use_id',
  'id',
  'input',
  'is_error',
  'format',
  'schema',
  'json_schema',
  'effort',
  'budget_tokens',
  'display',
  'signature',
  'thinking',
  'disable_parallel_tool_use',
  'input_examples',
  // JSON Schema keywords.
  'properties',
  'items',
  'anyOf',
  'allOf',
  'oneOf',
  'not',
  'const',
  'enum',
  'required',
  'additionalProperties',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'patternProperties',
  'uniqueItems',
  'prefixItems',
  '$ref',
  '$defs',
  'definitions',
  'default',
  'title',
  'nullable',
]);

/**
 * Fixed phrase signals: a code is kept when its pattern matches the message.
 * Codes are HOME's own words; nothing of the message is copied.
 */
const SIGNALS: readonly (readonly [string, RegExp])[] = [
  ['schema_too_complex', /too complex/i],
  ['compilation', /compil/i],
  ['grammar', /grammar/i],
  ['not_supported', /not supported|unsupported|does not support/i],
  ['extra_input', /extra inputs? (?:are|is) not permitted/i],
  ['required_missing', /field required|is required|missing/i],
  ['invalid', /invalid/i],
  ['too_many', /too many|exceed/i],
  ['strict', /\bstrict\b/i],
  ['schema', /schema/i],
  ['optional_parameters', /optional param/i],
  ['union_types', /union/i],
  ['tool_choice', /tool_choice/i],
  ['output_format', /output_config|output format|structured output|json_schema/i],
  ['thinking', /thinking/i],
  ['effort', /\beffort\b/i],
  ['cache_control', /cache_control/i],
  ['inference_geo', /inference_geo/i],
  ['prefill', /prefill/i],
  ['spend_limit', /spend limit|credit balance/i],
  ['timeout', /time(?:d)? ?out/i],
  ...[
    'anyOf',
    'allOf',
    'oneOf',
    'const',
    'enum',
    'format',
    'pattern',
    'minItems',
    'maxItems',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'additionalProperties',
    'required',
    '$ref',
  ].map(
    (k) => [`keyword:${k}`, new RegExp(`(?<![\\w$])${k.replace('$', '\\$')}(?![\\w$])`)] as const,
  ),
];

/** Every signal code detailOfMessage can report. */
export const SIGNAL_CODES: readonly string[] = Object.freeze(SIGNALS.map(([code]) => code));

/** A dotted path candidate: an identifier, then one or more `.segment`s. */
const PATH = /(?<![\w$.])[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_$]+)+/g;

/** A segment as kept: an index, a recognised word, or `*`. */
function segmentOf(s: string, names: ReadonlySet<string>): string {
  if (/^(?:0|[1-9][0-9]{0,3})$/.test(s)) return s;
  if (s.length > MAX_SEGMENT_CHARS) return '*';
  return PATH_SEGMENTS.has(s) || names.has(s) ? s : '*';
}

/**
 * The message's recognised detail (probe path only), or null when there is
 * no message string. `names` is what HOME itself sent in the request's
 * schemas: tool names and property names, all HOME's own static words.
 */
export function detailOfMessage(
  message: unknown,
  names: ReadonlySet<string>,
): MessageDetail | null {
  if (typeof message !== 'string') return null;
  const scanned = message.slice(0, MAX_MESSAGE_SCAN);
  const paths: string[] = [];
  for (const m of scanned.matchAll(PATH)) {
    const parts = m[0].split('.');
    if (!PATH_ROOTS.has(parts[0]!)) continue;
    const kept = [parts[0]!, ...parts.slice(1, MAX_SEGMENTS).map((p) => segmentOf(p, names))];
    const path = kept.join('.');
    if (!paths.includes(path)) paths.push(path);
    if (paths.length >= MAX_PATHS) break;
  }
  const signals = SIGNALS.filter(([, re]) => re.test(scanned)).map(([code]) => code);
  return Object.freeze({
    paths: Object.freeze(paths),
    signals: Object.freeze(signals),
    chars: Math.min(message.length, 100_000),
  });
}

/**
 * The names HOME sent in a request's schemas (tool names, and every
 * property name under `properties` in the tools' input schemas and the
 * answer format): the only words besides the fixed lists a path may keep.
 */
export function schemaNamesOf(params: {
  tools?: readonly unknown[];
  output_config?: unknown;
}): ReadonlySet<string> {
  const names = new Set<string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isObject(n)) return;
    if (isObject(n.properties)) for (const k of Object.keys(n.properties)) names.add(k);
    for (const v of Object.values(n)) walk(v);
  };
  for (const t of params.tools ?? []) {
    if (!isObject(t)) continue;
    if (typeof t.name === 'string') names.add(t.name);
    walk(t.input_schema);
  }
  const oc = params.output_config;
  if (isObject(oc) && isObject(oc.format)) walk(oc.format.schema);
  return names;
}

/** One line for the runner's output: structural fields and recognised detail only. */
export function diagnosticLine(d: ProviderDiagnostic, detail: MessageDetail | null): string {
  const parts = [
    `status ${d.status ?? '—'}`,
    `type ${d.type ?? '—'}`,
    `request-id ${d.requestId ?? '—'}`,
  ];
  if (detail) {
    parts.push(`paths ${detail.paths.join(' ') || '—'}`);
    parts.push(`signals ${detail.signals.join(' ') || '—'}`);
    parts.push(`message ${detail.chars} chars (not kept)`);
  }
  return parts.join('; ');
}

/** A failed probe call's error detail (runner only): structural fields and recognised detail. */
export type ProbeErrorDetail = Readonly<ProviderDiagnostic & { message: MessageDetail | null }>;
