import 'server-only';
import { z } from 'zod';
import { REF_TYPES, refSchema, type Ref } from '../tools/types';
import { DECLINE_CODES, type DeclineCode } from './language';

// The structured answer (M8 contract §4.4, §8.1; T22's answer half). What
// the model must return at the end of an attempt: either an answer (one
// speakable `say` sentence with its citations, and at most six blocks, each
// a `fact` or Kev's `view`, each with its citations) or a closed decline
// code, which code renders from §3.2's templates.
//
// Two shapes of one thing:
// - `kevAnswerSchema` (Zod) is the contract's `KevAnswer`, with every limit,
//   checked on every answer before the validator runs (rule 1, `answer.schema`);
// - `ANSWER_JSON_SCHEMA` is what the provider is given (structured output,
//   §5.1, or the strict `answer` tool, G7's fallback): one flat object whose
//   every field is required, the union expressed by nulls, because strict
//   schemas need `required` and `additionalProperties: false` throughout.
//   Static, byte-stable, with no record value in it (T22): only HOME's closed
//   sets (ref types, decline codes, block kinds). Lengths and counts are
//   left to the Zod schema (structured-output schemas do not take them all).

/** `say`: one sentence, at most 160 characters (§8.1). */
export const SAY_MAX_CHARS = 160;
/** A block: at most 400 characters; at most six blocks (§8.1). */
export const BLOCK_MAX_CHARS = 400;
export const MAX_BLOCKS = 6;
/** Citations per sentence or block; the answer's union is at most 50 (content v2). */
export const MAX_CITES_PER_PART = 20;
export const MAX_CITES = 50;

const cites = z.array(refSchema).max(MAX_CITES_PER_PART);

export const answerBlockSchema = z
  .object({
    kind: z.enum(['fact', 'view']),
    text: z.string().min(1).max(BLOCK_MAX_CHARS),
    cites,
  })
  .strict();
export type AnswerBlock = z.output<typeof answerBlockSchema>;

export const kevAnswerSchema = z.union([
  z
    .object({
      say: z.object({ text: z.string().min(1).max(SAY_MAX_CHARS), cites }).strict(),
      blocks: z.array(answerBlockSchema).max(MAX_BLOCKS),
    })
    .strict(),
  z.object({ decline: z.enum(DECLINE_CODES) }).strict(),
]);
export type KevAnswer = z.output<typeof kevAnswerSchema>;
export type AnswerOf = Extract<KevAnswer, { say: unknown }>;

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
const citesJson = { type: 'array', items: refJson };

/** The provider's view of the answer (structured output or the `answer` tool's input). */
export const ANSWER_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: 'object',
  properties: {
    say: nullable({
      type: 'object',
      properties: { text: { type: 'string' }, cites: citesJson },
      required: ['text', 'cites'],
      additionalProperties: false,
    }),
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['fact', 'view'] },
          text: { type: 'string' },
          cites: citesJson,
        },
        required: ['kind', 'text', 'cites'],
        additionalProperties: false,
      },
    },
    decline: nullable({ type: 'string', enum: [...DECLINE_CODES] }),
  },
  required: ['say', 'blocks', 'decline'],
  additionalProperties: false,
});

/** The strict `answer` tool (G7's documented fallback, §5.1): a control entry, never a read. */
export const ANSWER_TOOL = Object.freeze({
  name: 'answer',
  description:
    'Give your final answer to the adult, in HOME’s answer format. Call it once, after any reads, and on its own.',
  inputSchema: ANSWER_JSON_SCHEMA,
});

/** Drops a wire ref's `at: null`, keeping HOME's ref shape. */
function normaliseRef(r: unknown): unknown {
  if (typeof r !== 'object' || r === null) return r;
  const { at, ...rest } = r as Record<string, unknown>;
  return at === null || at === undefined ? rest : { ...rest, at };
}

/**
 * The model's final output as a `KevAnswer`, or null (rule 1). Accepts the
 * provider's flat shape (nulls for the side not taken) and the contract's
 * union; a JSON string or an already-parsed object (the `answer` tool's
 * input). Anything else, extra keys included, is null.
 */
export function parseAnswer(raw: unknown): KevAnswer | null {
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
  let shaped: unknown;
  if ('decline' in v && v.decline !== null && v.decline !== undefined) {
    // A decline carries nothing else (the flat shape's other fields empty).
    const sayEmpty = v.say === null || v.say === undefined;
    const blocksEmpty =
      v.blocks === undefined || (Array.isArray(v.blocks) && v.blocks.length === 0);
    if (!sayEmpty || !blocksEmpty) return null;
    shaped = { decline: v.decline };
  } else {
    if (typeof v.say !== 'object' || v.say === null) return null;
    const extra = Object.keys(v).filter((k) => !['say', 'blocks', 'decline'].includes(k));
    if (extra.length > 0) return null;
    const say = v.say as Record<string, unknown>;
    shaped = {
      say: { ...say, cites: Array.isArray(say.cites) ? say.cites.map(normaliseRef) : say.cites },
      blocks: Array.isArray(v.blocks)
        ? v.blocks.map((b) =>
            typeof b === 'object' && b !== null && Array.isArray((b as { cites?: unknown }).cites)
              ? { ...b, cites: (b as { cites: unknown[] }).cites.map(normaliseRef) }
              : b,
          )
        : v.blocks,
    };
  }
  const parsed = kevAnswerSchema.safeParse(shaped);
  if (!parsed.success) return null;
  if ('say' in parsed.data && uniqueCites(parsed.data).length > MAX_CITES) return null;
  return parsed.data;
}

const refKey = (r: Ref) => `${r.type}|${r.id}|${r.at ?? ''}`;

/** Every citation of an answer, each once, in order (say first). */
export function uniqueCites(answer: AnswerOf): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const r of [...answer.say.cites, ...answer.blocks.flatMap((b) => b.cites)]) {
    const k = refKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(
      r.at === undefined ? { type: r.type, id: r.id } : { type: r.type, id: r.id, at: r.at },
    );
  }
  return out;
}

export type { DeclineCode };
