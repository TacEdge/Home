import { z } from 'zod';
import { SENSITIVITY } from '@/db/schema/common';
import { CONTEXT_CATEGORIES, CONTEXT_STATUSES } from '@/db/schema/context';
import { isoDate, longText, recordId, visibility } from '../common/inputs';

// Context inputs (FAMILY-DATA-MODEL §3, Context). A subject is the household
// (no id) or a person or project (with an id), as context_subject_check
// requires. Source and confirmation are never inputs: the service sets them
// from who is writing and how.

export const contextSubject = z.discriminatedUnion('type', [
  z.object({ type: z.literal('household') }).strict(),
  z.object({ type: z.literal('person'), id: recordId }).strict(),
  z.object({ type: z.literal('project'), id: recordId }).strict(),
]);
export type ContextSubject = z.output<typeof contextSubject>;

const fields = {
  content: longText,
  category: z.enum(CONTEXT_CATEGORIES),
  /** The last day it is meant to hold, for time-bound context ("this month"). */
  validUntil: isoDate.nullable(),
  sensitivity: z.enum(SENSITIVITY),
  visibility,
};

export const createContextInput = z
  .object({
    subject: contextSubject,
    ...fields,
    validUntil: fields.validUntil.optional(),
    sensitivity: fields.sensitivity.default('normal'),
    visibility: fields.visibility.default('household'),
  })
  .strict();
export type CreateContextInput = z.input<typeof createContextInput>;

export const updateContextInput = z.object(fields).partial().strict();
export type UpdateContextInput = z.input<typeof updateContextInput>;

export const contextStatus = z.enum(CONTEXT_STATUSES);

// What Kev may propose (FAMILY-DATA-MODEL §3 rules): never sensitive context.
const normalOnly = z.literal('normal');

export const proposedContextInput = createContextInput.extend({
  sensitivity: normalOnly.optional(),
});
export const proposedContextPatch = updateContextInput.extend({
  sensitivity: normalOnly.optional(),
});
