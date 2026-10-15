import 'server-only';
import { z } from 'zod';
import { REF_TYPES, refSchema, type Ref, type RefType } from '../tools/types';
import { DECLINE_CODES, type DeclineCode } from './language';

// The answer plan (M8 contract §4.4, §8.1; owner amendment of 2026-10-15,
// ADR 0012 §46): what the model must return at the end of an attempt. The
// model no longer writes facts. It selects records and organises them:
// - `lead`: one short conversational sentence, fact-free (checked in
//   ./prose.ts); it may hold `{when}` once, which code fills;
// - `facts`: at most ten typed selections, never display text: a record
//   (its type, its ref exactly as a read returned it, and which of its own
//   fields to show), or an `absence` or `count` over a mandatory scope;
// - `view`: Kev's view, fact-free, about some of the blocks (by index);
// or a closed decline code, which code renders from §3.2's templates.
// HOME's renderer (./render.ts) writes every fact from the cited record.
//
// Two shapes of one thing:
// - `answerPlanSchema` (Zod) is the contract's `AnswerPlan`, strict, with
//   every limit, checked on every plan before anything else (`answer.schema`);
// - `ANSWER_JSON_SCHEMA` is what the provider is given (structured output,
//   §5.1, or the strict `answer` tool, G7's fallback): one flat object whose
//   every field is required, unions expressed by nulls, because strict
//   schemas need `required` and `additionalProperties: false` throughout.
//   Static, byte-stable, with no record value in it (T22): only HOME's
//   closed sets. Lengths and counts are the Zod schema's alone.

/** The lead: one sentence, at most 120 characters. */
export const LEAD_MAX_CHARS = 120;
/** Kev's view: at most 300 characters. */
export const VIEW_MAX_CHARS = 300;
/** At most ten fact blocks. */
export const MAX_FACTS = 10;
/** The answer's citations, all blocks together (content v2). */
export const MAX_CITES = 50;
/** The one placeholder a lead may hold: the days the plan's blocks are on, filled by code. */
export const WHEN = '{when}';

/** The fields a record block may ask for, by the record's type (contract §8.1). */
export const FIELDS_BY_KIND = Object.freeze({
  event: ['people'],
  task: ['status', 'due', 'scheduled', 'estimate', 'needs', 'assignee', 'project'],
  project: ['status', 'target', 'open_tasks', 'summary'],
  note: [],
  person: ['age', 'birthday', 'relationship', 'regular_week', 'stage_note'],
  conflict: [],
  insight: [],
  gap: ['neighbours', 'forecast'],
  forecast: ['phrase', 'temperature', 'gust', 'parts'],
  calendar: [],
  context: [],
} as const satisfies Record<RefType, readonly string[]>);

/** Every field, once, in a fixed order (the provider's enum). */
export const SHOW_FIELDS = [
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
export type ShowField = (typeof SHOW_FIELDS)[number];

/** What a record block shows when `show` is empty. */
export const DEFAULT_SHOW: Readonly<Record<RefType, readonly ShowField[]>> = Object.freeze({
  event: ['people'],
  task: ['status', 'due'],
  project: ['status', 'target'],
  note: [],
  person: ['age'],
  conflict: [],
  insight: [],
  gap: ['neighbours'],
  forecast: ['phrase', 'temperature', 'gust'],
  calendar: [],
  context: [],
});

export const SCOPE_KINDS = ['agenda', 'conflicts', 'forecast', 'search'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export const DAY_PARTS = ['morning', 'afternoon', 'evening'] as const;
export const SUMMARY_KINDS = ['absence', 'count'] as const;
export const FACT_KINDS = [...REF_TYPES, ...SUMMARY_KINDS] as const;

const isoDate = z.iso.date();

export const scopeSchema = z
  .object({
    of: z.enum(SCOPE_KINDS),
    from: isoDate.nullable(),
    to: isoDate.nullable(),
    /** Person ids the reader can see; none means everyone the reader can see. */
    people: z.array(z.string().min(1).max(200)).max(6),
    part: z.enum(DAY_PARTS).nullable(),
    /** "Nothing else": every record in scope must be shown in the plan's other blocks. */
    else: z.boolean(),
  })
  .strict();
export type Scope = z.output<typeof scopeSchema>;

export const recordBlockSchema = z
  .object({
    kind: z.enum(REF_TYPES),
    ref: refSchema,
    show: z.array(z.enum(SHOW_FIELDS)).max(SHOW_FIELDS.length),
  })
  .strict()
  .refine(
    (b) => b.show.every((f) => (FIELDS_BY_KIND[b.kind] as readonly string[]).includes(f)),
    'a field its kind does not offer',
  );
export type RecordBlock = z.output<typeof recordBlockSchema>;

export const summaryBlockSchema = z
  .object({ kind: z.enum(SUMMARY_KINDS), scope: scopeSchema })
  .strict();
export type SummaryBlock = z.output<typeof summaryBlockSchema>;

export type FactBlock = RecordBlock | SummaryBlock;
export const isSummary = (b: FactBlock): b is SummaryBlock =>
  b.kind === 'absence' || b.kind === 'count';

export const viewSchema = z
  .object({
    text: z.string().min(1).max(VIEW_MAX_CHARS),
    about: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(MAX_FACTS - 1),
      )
      .min(1)
      .max(MAX_FACTS),
  })
  .strict();

export const answerPlanSchema = z.union([
  z
    .object({
      lead: z.string().min(1).max(LEAD_MAX_CHARS),
      facts: z.array(z.union([recordBlockSchema, summaryBlockSchema])).max(MAX_FACTS),
      view: viewSchema.nullable(),
    })
    .strict(),
  z.object({ decline: z.enum(DECLINE_CODES) }).strict(),
]);
export type AnswerPlan = z.output<typeof answerPlanSchema>;
export type PlanOf = Extract<AnswerPlan, { lead: unknown }>;

/** What HOME rendered for the adult (content v2's blocks; the `detail` event). */
export type AnswerBlock = { kind: 'fact' | 'view'; text: string; cites: Ref[] };

// ---------------------------------------------------------------------------
// The provider's view.

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const refJson = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: [...REF_TYPES] },
    id: { type: 'string' },
    at: nullable({ type: 'string' }),
  },
  required: ['type', 'id', 'at'],
  additionalProperties: false,
};
const scopeJson = {
  type: 'object',
  properties: {
    of: { type: 'string', enum: [...SCOPE_KINDS] },
    from: nullable({ type: 'string' }),
    to: nullable({ type: 'string' }),
    people: { type: 'array', items: { type: 'string' } },
    part: nullable({ type: 'string', enum: [...DAY_PARTS] }),
    else: { type: 'boolean' },
  },
  required: ['of', 'from', 'to', 'people', 'part', 'else'],
  additionalProperties: false,
};

/** The provider's view of the plan (structured output or the `answer` tool's input). */
export const ANSWER_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: 'object',
  properties: {
    lead: nullable({ type: 'string' }),
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...FACT_KINDS] },
          ref: nullable(refJson),
          show: { type: 'array', items: { type: 'string', enum: [...SHOW_FIELDS] } },
          scope: nullable(scopeJson),
        },
        required: ['kind', 'ref', 'show', 'scope'],
        additionalProperties: false,
      },
    },
    view: nullable({
      type: 'object',
      properties: {
        text: { type: 'string' },
        about: { type: 'array', items: { type: 'integer' } },
      },
      required: ['text', 'about'],
      additionalProperties: false,
    }),
    decline: nullable({ type: 'string', enum: [...DECLINE_CODES] }),
  },
  required: ['lead', 'facts', 'view', 'decline'],
  additionalProperties: false,
});

/** The strict `answer` tool (G7's documented fallback, §5.1): a control entry, never a read. */
export const ANSWER_TOOL = Object.freeze({
  name: 'answer',
  description:
    'Give your final answer to the adult as HOME’s answer plan. Call it once, after any reads, and on its own.',
  inputSchema: ANSWER_JSON_SCHEMA,
});

/** Drops a wire ref's `at: null`, keeping HOME's ref shape. */
function normaliseRef(r: unknown): unknown {
  if (typeof r !== 'object' || r === null) return r;
  const { at, ...rest } = r as Record<string, unknown>;
  return at === null || at === undefined ? rest : { ...rest, at };
}

/** A wire fact block (every field present, nulls for the side not taken) in the contract's shape. */
function shapeFact(b: unknown): unknown {
  if (typeof b !== 'object' || b === null || Array.isArray(b)) return b;
  const o = b as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !['kind', 'ref', 'show', 'scope'].includes(k));
  if (extra.length > 0) return { ...o, __extra: true };
  if (o.kind === 'absence' || o.kind === 'count') {
    // A summary carries no ref and shows no field.
    if (o.ref !== null && o.ref !== undefined) return { ...o, __extra: true };
    if (Array.isArray(o.show) && o.show.length > 0) return { ...o, __extra: true };
    return { kind: o.kind, scope: o.scope };
  }
  if (o.scope !== null && o.scope !== undefined) return { ...o, __extra: true };
  return { kind: o.kind, ref: normaliseRef(o.ref), show: o.show ?? [] };
}

/**
 * The model's final output as an `AnswerPlan`, or null (`answer.schema`).
 * Accepts the provider's flat shape (nulls for the side not taken) and the
 * contract's union; a JSON string or an already-parsed object (the `answer`
 * tool's input). Anything else, extra keys included, is null.
 */
export function parsePlan(raw: unknown): AnswerPlan | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw.trim());
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !['lead', 'facts', 'view', 'decline'].includes(k))) return null;
  let shaped: unknown;
  if (v.decline !== null && v.decline !== undefined) {
    // A decline carries nothing else.
    const empty =
      (v.lead === null || v.lead === undefined) &&
      (v.view === null || v.view === undefined) &&
      (v.facts === undefined || (Array.isArray(v.facts) && v.facts.length === 0));
    if (!empty) return null;
    shaped = { decline: v.decline };
  } else {
    if (typeof v.lead !== 'string') return null;
    shaped = {
      lead: v.lead,
      facts: Array.isArray(v.facts) ? v.facts.map(shapeFact) : v.facts,
      view: v.view ?? null,
    };
  }
  const parsed = answerPlanSchema.safeParse(shaped);
  return parsed.success ? parsed.data : null;
}

export type { DeclineCode };
