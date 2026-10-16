import 'server-only';
import { z } from 'zod';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import { GapRangeError, GapScopeError } from '@/domain/engines/gaps';
import { log } from '@/lib/log';
import type { ProviderToolDefinition } from '../providers/types';
import { escalate } from './escalate';
import { getAgenda } from './get-agenda';
import { getCalendarHealth } from './get-calendar-health';
import { getConflicts } from './get-conflicts';
import { getContext } from './get-context';
import { getGaps } from './get-gaps';
import { getInsights } from './get-insights';
import { getPeople } from './get-people';
import { getProjects } from './get-projects';
import { getTasks } from './get-tasks';
import { getToday } from './get-today';
import { getWeather } from './get-weather';
import { search } from './search';
import {
  assertKevContext,
  MAX_ITEMS,
  MAX_RESULT_BYTES,
  refSchema,
  TOOL_NAMES,
  ToolRefusal,
  uniqueRefs,
  type ReadTool,
  type Ref,
  type ToolContext,
  type ToolErrorCode,
  type ToolName,
  type ToolResult,
  type TraceArgs,
} from './types';

// Kev's tool registry (M8 contract §4.3, §4.5, §6.1, §9.8; ADR 0012 §17,
// §28). A closed list: exactly the twelve read tools and `escalate`, in a
// fixed order. Every entry declares its authority class, its strict input
// and output schemas, its static JSON schema and its trace summary.
//
// Authority. The class is an enum that already names `propose` (M9's
// proposal tools). M8 permits `read` only: registering any other class,
// `propose` included, throws (matrix row T23), so nothing that writes can
// arrive by accident. `escalate` is a control entry of the read class: it
// reads nothing and the runner never runs it; the orchestrator handles it.
//
// Running a tool (`createToolRunner`): the server's actor, never the
// model's; the input parsed strictly before any domain call (`bad_input`);
// the read once; the output minimised, cut to fit 50 items and 12 KiB
// before it is first sent, and parsed with its output schema (a failure is
// `unavailable`, logged by code only). Nothing is thrown to the model, and
// no message, stack or query ever reaches it or the trace. An unknown tool
// name is refused and counted.

export const AUTHORITY_CLASSES = ['read', 'propose'] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];
/** The classes M8 permits: `read` only. `propose` is M9's, named and refused. */
export const PERMITTED_CLASSES: ReadonlySet<string> = new Set<AuthorityClass>(['read']);

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyReadTool = ReadTool<any, any, any>;
export type RegistryEntry = AnyReadTool | typeof escalate;
type Declared = { name: string; authority: string; kind: string; input: z.ZodType };

/**
 * The closed registry from its entries: every name one of `TOOL_NAMES` once,
 * every class permitted in M8, `escalate` the only control entry. Throws
 * otherwise; it never drops or rewrites an entry.
 */
export function defineRegistry<E extends Declared>(entries: readonly E[]): ReadonlyMap<string, E> {
  const out = new Map<string, E>();
  for (const e of entries) {
    if (!PERMITTED_CLASSES.has(e.authority))
      throw new RegistryError(`authority class '${e.authority}' is not permitted in M8`);
    if (!(TOOL_NAMES as readonly string[]).includes(e.name))
      throw new RegistryError(`'${e.name}' is not one of Kev's tools`);
    if (out.has(e.name)) throw new RegistryError(`'${e.name}' is registered twice`);
    if ((e.kind === 'control') !== (e.name === 'escalate'))
      throw new RegistryError(`'${e.name}' has the wrong kind`);
    out.set(e.name, e);
  }
  return out;
}

const ENTRIES: readonly RegistryEntry[] = [
  getToday,
  getAgenda,
  getConflicts,
  getInsights,
  getTasks,
  getProjects,
  getPeople,
  getContext,
  getCalendarHealth,
  getWeather,
  getGaps,
  search,
  escalate,
];

/** The registry: the twelve read tools and `escalate`, in the contract's order. */
export const REGISTRY: ReadonlyMap<string, RegistryEntry> = defineRegistry(ENTRIES);

// ---------------------------------------------------------------------------
// The JSON schemas sent to the provider (contract §6.1, T22).

/**
 * A tool's input as a static JSON schema: generated from its Zod schema, so
 * the two never disagree; no `$schema`; a string's `format` kept without
 * Zod's long equivalent `pattern` (the Zod schema still checks every call).
 * Byte-stable: the same bytes every build, for every adult, on every day.
 */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw' }) as Record<
    string,
    unknown
  >;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node === null || typeof node !== 'object') return node;
    const o = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === '$schema') continue;
      if (k === 'pattern' && typeof o.format === 'string') continue;
      out[k] = clean(v);
    }
    return out;
  };
  return clean(raw) as Record<string, unknown>;
}

/**
 * The tool definitions for an attempt, fixed when it starts (contract §4.2):
 * every read tool, and `escalate` only when the attempt offers it (fast,
 * the month under 80%: `offersEscalate`, T24).
 */
export function toolDefinitions(opts: { escalate: boolean }): ProviderToolDefinition[] {
  const out: ProviderToolDefinition[] = [];
  for (const e of REGISTRY.values()) {
    if (e.kind === 'control' && !opts.escalate) continue;
    out.push(
      Object.freeze({
        name: e.name,
        description: e.description,
        inputSchema: Object.freeze(jsonSchemaOf(e.input)),
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Running tools.

/** One tool call, as the turn's trace records it (content v2's `TraceEntry`). */
export type TraceEntry = {
  tool: ToolName;
  ok: boolean;
  code?: ToolErrorCode;
  args: TraceArgs;
  resultCount: number;
  /** The first 50 of the result's refs, in order. */
  refs: Ref[];
  /** Present, and true, only when the result had more than 50 refs. */
  refsTruncated?: true;
  attemptId: string;
};

export type ToolCallOutcome =
  | {
      /** The tool ran (or was refused with a closed code): its result, its JSON and its trace entry. */
      kind: 'ran';
      result: ToolResult<unknown>;
      /** What the model is sent: the result's data as JSON, or `{"error": code}`. */
      content: string;
      trace: TraceEntry;
    }
  /** Not a tool in the registry: refused before anything ran, and counted. */
  | { kind: 'unknown_tool'; result: { ok: false; code: 'bad_input' }; content: string };

export type ToolRunner = {
  /**
   * Runs one tool call. `maxBytes` (at most 12 KiB) lets the orchestrator
   * cut a result further, before it is first sent, so the next request stays
   * under the input cap (contract §7.4): the result is presented again with
   * fewer items, and says so, exactly as at the 12 KiB bound.
   */
  run(name: string, input: unknown, opts?: { maxBytes?: number }): Promise<ToolCallOutcome>;
  /** Unknown tool names refused so far (S7: the orchestrator records the count). */
  readonly unknownRefused: number;
};

/** Limits tried, in order, until a result fits `MAX_RESULT_BYTES`. */
const LIMITS = [MAX_ITEMS, 40, 30, 20, 12, 8, 5, 3, 1, 0];

const errorContent = (code: ToolErrorCode) => JSON.stringify({ error: code });

function codeOf(e: unknown): ToolErrorCode {
  if (e instanceof ToolRefusal) return e.code;
  if (e instanceof NotFoundError || e instanceof GapScopeError) return 'not_found';
  if (e instanceof GapRangeError) return 'out_of_range';
  if (e instanceof z.ZodError) return 'bad_input';
  return 'unavailable';
}

/**
 * A runner for one attempt, bound to the requesting adult. The actor comes
 * from the server's session, never from model input; it must be a user
 * acting through Kev, in the home zone (`assertKevContext`): otherwise no
 * runner is made, and a `ContextRefusal` with its closed code is thrown.
 */
export function createToolRunner(ctx: ToolContext & { attemptId: string }): ToolRunner {
  assertKevContext(ctx);
  const bound: ToolContext = Object.freeze({
    actor: ctx.actor,
    now: ctx.now,
    timeZone: ctx.timeZone,
    ...(ctx.deps ? { deps: ctx.deps } : {}),
  });
  let unknownRefused = 0;

  const trace = (
    tool: ToolName,
    args: TraceArgs,
    result: ToolResult<unknown>,
    resultCount: number,
  ): TraceEntry => {
    const refs = result.ok ? result.refs : [];
    return {
      tool,
      ok: result.ok,
      ...(result.ok ? {} : { code: result.code }),
      args,
      resultCount,
      refs: refs.slice(0, MAX_ITEMS),
      ...(refs.length > MAX_ITEMS ? { refsTruncated: true as const } : {}),
      attemptId: ctx.attemptId,
    };
  };

  return {
    get unknownRefused() {
      return unknownRefused;
    },
    async run(name, raw, opts = {}) {
      const maxBytes = Math.max(0, Math.min(MAX_RESULT_BYTES, opts.maxBytes ?? MAX_RESULT_BYTES));
      const entry = REGISTRY.get(name);
      if (!entry) {
        unknownRefused++;
        return {
          kind: 'unknown_tool',
          result: { ok: false, code: 'bad_input' },
          content: errorContent('bad_input'),
        };
      }
      const tool = entry.name as ToolName;
      const refuse = (code: ToolErrorCode, args: TraceArgs = {}): ToolCallOutcome => {
        const result = { ok: false as const, code };
        return {
          kind: 'ran',
          result,
          content: errorContent(code),
          trace: trace(tool, args, result, 0),
        };
      };
      const parsed = entry.input.safeParse(raw);
      if (!parsed.success) return refuse('bad_input');
      // `escalate` is the orchestrator's: it is never run here.
      if (entry.kind === 'control') return refuse('unavailable', entry.summarise(parsed.data));
      const args = entry.summarise(parsed.data);
      let read: unknown;
      try {
        read = await entry.read(bound, parsed.data);
      } catch (e) {
        const code = codeOf(e);
        if (code === 'unavailable')
          log.error('kev_tool_failed', {
            tool,
            stage: 'read',
            kind: e instanceof NotPermittedError ? e.code : 'unexpected',
          });
        return refuse(code, args);
      }
      try {
        for (const limit of LIMITS) {
          const { data, refs } = entry.present(read, limit, bound);
          const out = entry.output.safeParse(data);
          const checked = z.array(refSchema).safeParse(refs);
          if (!out.success || !checked.success) {
            log.error('kev_tool_failed', { tool, stage: 'output', kind: 'schema' });
            return refuse('unavailable', args);
          }
          const content = JSON.stringify(out.data);
          if (Buffer.byteLength(content, 'utf8') > maxBytes) continue;
          const result: ToolResult<unknown> = {
            ok: true,
            data: out.data,
            refs: uniqueRefs(checked.data),
          };
          // A list's count, or search's `returned` (it never counts past 20).
          const d = out.data as { count?: unknown; returned?: unknown };
          const count = d.count ?? d.returned;
          return {
            kind: 'ran',
            result,
            content,
            trace: trace(tool, args, result, typeof count === 'number' ? count : 1),
          };
        }
        log.error('kev_tool_failed', { tool, stage: 'output', kind: 'too_large' });
        return refuse('unavailable', args);
      } catch {
        log.error('kev_tool_failed', { tool, stage: 'present', kind: 'unexpected' });
        return refuse('unavailable', args);
      }
    },
  };
}
