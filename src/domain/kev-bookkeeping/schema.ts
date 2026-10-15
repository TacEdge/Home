import { z } from 'zod';
import { KEV_TIERS, type KevTier } from '@/db/schema/conversation';

export { KEV_TIERS, type KevTier };
import { recordId } from '../common/inputs';
import { INPUT_TEXT_MAX_CHARS, TURN_CEILING_USD_MICROS } from './constants';

// Message content v2 (M8 contract §7.6) and the bookkeeping path's inputs.
// Application schemas only: the database checks that content is an object
// with a numeric `v` (`message_content_check`), and v1 stays valid and
// readable (src/domain/conversations/schema.ts). Every object is strict and
// every set is closed, so nothing a provider sends can be represented here:
// no provider block types, no tool-use ids, no thinking, no signatures
// (matrix row N13, at the schema level). Text fields hold what HOME
// validated; codes are HOME's own.

/** What a citation can point at (contract §4.4). */
export const REF_TYPES = [
  'event',
  'task',
  'project',
  'note',
  'person',
  'conflict',
  'insight',
  'gap',
  'forecast',
  'calendar',
  'context',
] as const;

/** Kev's tools (contract §6.2): the twelve read tools and `escalate`. */
export const TOOL_NAMES = [
  'get_today',
  'get_agenda',
  'get_conflicts',
  'get_insights',
  'get_tasks',
  'get_projects',
  'get_people',
  'get_context',
  'get_calendar_health',
  'get_weather',
  'get_gaps',
  'search',
  'escalate',
] as const;

/** A tool's closed error codes (contract §6.1). */
export const TOOL_ERROR_CODES = ['bad_input', 'out_of_range', 'not_found', 'unavailable'] as const;

/** The sentences code adds (contract §8.4). */
export const LIMIT_CODES = [
  'gap_limit',
  'calendar_stale',
  'forecast_credit',
  'coverage_unknown',
] as const;

/**
 * The checker's codes (contract §8.3, as amended by the owner on
 * 2026-10-15, ADR 0012 §46: the model selects records and HOME renders
 * every fact, so the codes are about the plan's structure and the model's
 * fact-free words). Application schema only; no migration.
 */
export const VALIDATOR_CODES = [
  'answer.schema',
  'cite.unknown',
  'fact.kind',
  'fact.field',
  'absence.unsupported',
  'view.about',
  'text.unsafe',
  'markup',
  'prose.time',
  'prose.number',
  'prose.person',
  'prose.record',
  'prose.claim',
  'availability.claim',
  'conflict.unsupported',
  'authority.claim',
  'phrase.forbidden',
  'tone.filler',
  'sensitive.leak',
] as const;

/** The answer plan's closed sets (contract §4.4; held equal to src/kev/answer/schema.ts by a unit test). */
export const PLAN_FACT_KINDS = [...REF_TYPES, 'absence', 'count'] as const;
export const PLAN_SHOW_FIELDS = [
  'people',
  'status',
  'due',
  'scheduled',
  'estimate',
  'needs',
  'assignee',
  'project',
  'target',
  'open_tasks',
  'summary',
  'age',
  'birthday',
  'relationship',
  'regular_week',
  'stage_note',
  'neighbours',
  'forecast',
  'phrase',
  'temperature',
  'gust',
  'parts',
] as const;
export const PLAN_SCOPE_KINDS = ['agenda', 'conflicts', 'forecast', 'search'] as const;

/** Why a turn ended in the error state (contract §9.9, §11.3). */
export const KEV_ERROR_CODES = [
  'provider_unavailable',
  'timeout',
  'refused',
  'bad_response',
  'budget_exhausted',
  'cap_reached',
] as const;

/**
 * Why a provider call stopped: a closed code, never provider text
 * (src/kev/providers/types.ts). `partial`: the call ended without the
 * provider's final usage, so its tokens are what had been reported and its
 * cost the conservative charge (ADR 0012 §43, I2).
 */
export const CALL_STOP_CODES = [
  'end_turn',
  'tool_use',
  'max_tokens',
  'stop_sequence',
  'pause_turn',
  'other',
  'refusal',
  'error',
  'partial',
] as const;

const isoInstant = z.iso.datetime({ offset: true });

export const refSchema = z
  .object({ type: z.enum(REF_TYPES), id: z.string().min(1).max(200), at: isoInstant.optional() })
  .strict();

/** A block as HOME rendered it: a fact written by the renderer, or Kev's view. */
export const answerBlockSchema = z
  .object({
    kind: z.enum(['fact', 'view']),
    text: z.string().min(1).max(1500),
    cites: z.array(refSchema).max(50),
  })
  .strict();

/**
 * The validated answer plan, as stored beside what was rendered (contract
 * §7.6, as amended): the model's selections and its lead and view, never a
 * rendered fact (those are `blocks`). Bounded like the plan itself.
 */
export const storedPlanSchema = z
  .object({
    lead: z.string().min(1).max(120),
    facts: z
      .array(
        z.union([
          z
            .object({
              kind: z.enum(REF_TYPES),
              ref: refSchema,
              show: z.array(z.enum(PLAN_SHOW_FIELDS)).max(PLAN_SHOW_FIELDS.length),
            })
            .strict(),
          z
            .object({
              kind: z.enum(['absence', 'count']),
              scope: z
                .object({
                  of: z.enum(PLAN_SCOPE_KINDS),
                  from: z.iso.date().nullable(),
                  to: z.iso.date().nullable(),
                  people: z.array(z.string().min(1).max(200)).max(6),
                  part: z.enum(['morning', 'afternoon', 'evening']).nullable(),
                  else: z.boolean(),
                })
                .strict(),
            })
            .strict(),
        ]),
      )
      .max(10),
    view: z
      .object({
        text: z.string().min(1).max(300),
        about: z.array(z.number().int().min(0).max(9)).min(1).max(10),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type StoredPlan = z.output<typeof storedPlanSchema>;

/** A structural summary of a tool's arguments: dates, scopes, ids, counts; never free text. */
const traceArg = z.union([
  z
    .string()
    .max(60)
    .regex(/^[A-Za-z0-9_:.+-]*$/, 'structural values only'),
  z.number().finite(),
  z.boolean(),
]);

/**
 * What a trace entry's `tool` may name: Kev's tools, or `unknown` for a
 * name the model asked for that is not in the registry (S7: refused,
 * counted, and recorded with `code: 'bad_input'` and no arguments; the
 * name itself is model text and is never stored). Application schema only.
 */
export const TRACE_TOOLS = [...TOOL_NAMES, 'unknown'] as const;

export const traceEntrySchema = z
  .object({
    tool: z.enum(TRACE_TOOLS),
    ok: z.boolean(),
    code: z.enum(TOOL_ERROR_CODES).optional(),
    args: z.record(z.string().regex(/^[a-z_]{1,40}$/), traceArg),
    resultCount: z.number().int().nonnegative().max(1_000),
    refs: z.array(refSchema).max(50),
    /** Only when the result had more than 50 refs: `refs` holds the first 50. */
    refsTruncated: z.literal(true).optional(),
    attemptId: z.uuid(),
  })
  .strict();

const tokens = z.number().int().nonnegative().max(2_000_000_000);

export const callUsageSchema = z
  .object({
    attemptId: z.uuid(),
    tier: z.enum(KEV_TIERS),
    inputTokens: tokens,
    outputTokens: tokens,
    cacheReadTokens: tokens,
    cacheWriteTokens: tokens,
    ms: z.number().int().nonnegative().max(600_000),
    stop: z.enum(CALL_STOP_CODES),
  })
  .strict();

/** The person's words (contract §7.6). */
export const userContentV2 = z
  .object({
    v: z.literal(2),
    text: z.string().min(1).max(INPUT_TEXT_MAX_CHARS),
    focus: z.literal('today').optional(),
  })
  .strict();
export type UserContentV2 = z.output<typeof userContentV2>;

/** Kev's answer, as validated, with its trace and per-call usage (contract §7.6). */
export const kevContentV2 = z
  .object({
    v: z.literal(2),
    outcome: z.enum(['answer', 'fallback', 'declined', 'refused', 'error']),
    say: z.string().max(400),
    // At most ten rendered facts and Kev's view (contract §8.1, as amended).
    blocks: z.array(answerBlockSchema).max(11),
    /** The validated plan the blocks were rendered from (an answer only). */
    plan: storedPlanSchema.optional(),
    /** The plan's lead or view failed the check; its validated facts are shown with HOME's lead (§8.5). */
    salvaged: z.literal(true).optional(),
    cites: z.array(refSchema).max(50),
    limits: z.array(z.enum(LIMIT_CODES)).max(LIMIT_CODES.length),
    trace: z.array(traceEntrySchema).max(16),
    calls: z.array(callUsageSchema).max(12),
    escalated: z.boolean(),
    violations: z.array(z.enum(VALIDATOR_CODES)).max(VALIDATOR_CODES.length).optional(),
    errorCode: z.enum(KEV_ERROR_CODES).optional(),
  })
  .strict();
export type KevContentV2 = z.output<typeof kevContentV2>;

// ---------------------------------------------------------------------------
// The bookkeeping path's inputs.

/** The person's words, stored verbatim (D6): never trimmed or rewritten; never blank. */
export const recordUserMessageInput = z
  .object({
    text: z
      .string()
      .min(1)
      .max(INPUT_TEXT_MAX_CHARS)
      .refine((t) => t.trim().length > 0, 'must not be blank'),
    focus: z.literal('today').optional(),
  })
  .strict();
export type RecordUserMessageInput = z.input<typeof recordUserMessageInput>;

export const recordKevMessageInput = z
  .object({
    content: kevContentV2,
    tier: z.enum(KEV_TIERS),
    model: z.string().trim().min(1).max(100),
  })
  .strict();
export type RecordKevMessageInput = z.input<typeof recordKevMessageInput>;

/** Whole micro-US-dollars, as a bigint. */
const micros = z.bigint().nonnegative().max(9_000_000_000_000_000_000n);

export const reserveAttemptInput = z
  .object({
    attemptId: z.uuid(),
    tier: z.enum(KEV_TIERS),
    /**
     * The attempt's maximum permitted exposure (src/trust/usage.ts): above
     * zero and never above the turn's US$1.50 ceiling. The household's cap
     * is not an input: the bookkeeping path derives it from the server's
     * configuration (HOME_KEV_MONTHLY_CAP_NZD).
     */
    reservedUsdMicros: micros
      .refine((v) => v > 0n, 'must be positive')
      .refine((v) => v <= TURN_CEILING_USD_MICROS, 'must not pass the turn ceiling'),
  })
  .strict();
export type ReserveAttemptInput = z.input<typeof reserveAttemptInput>;

const count = z.number().int().nonnegative().max(2_000_000_000);

/** One provider call of the attempt, as settled (contract §13.6). */
export const settledCallInput = z
  .object({
    tier: z.enum(KEV_TIERS),
    model: z.string().trim().min(1).max(100),
    inputTokens: count,
    outputTokens: count,
    cacheReadTokens: count,
    cacheWriteTokens: count,
    /** What the call cost; a call of unknown usage at the per-call maximum. */
    costUsdMicros: micros,
    escalated: z.boolean(),
  })
  .strict();

export const settleAttemptInput = z
  .object({
    attemptId: z.uuid(),
    conversationId: recordId.nullable(),
    // At most the attempt's five model calls (a retry counts as one).
    calls: z.array(settledCallInput).max(5),
  })
  .strict();
export type SettleAttemptInput = z.input<typeof settleAttemptInput>;
