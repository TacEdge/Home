import { z } from 'zod';
import { VISIBILITY } from '@/db/schema/common';
import { PERSON_COLOURS, PERSON_ROLES } from '@/db/schema/person';
import { isValidIsoDate } from '@/lib/dates';

// One Zod schema per input, shared by forms, services and Kev tools
// (CLAUDE.md conventions). Limits per M2 contract §4.1: names 100, titles
// 200, notes 10,000 characters. A person is a lightweight profile: nothing
// here is a measurement, assessment or observation (rule 11).

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine(isValidIsoDate, 'must be a real calendar date');

const text = (max: number) => z.string().trim().max(max);

const fields = {
  name: text(100).min(1),
  shortName: text(100).min(1).nullable(),
  role: z.enum(PERSON_ROLES),
  relationship: text(200).nullable(),
  inHousehold: z.boolean(),
  dateOfBirth: isoDate.nullable(),
  stageNote: text(10_000).nullable(),
  colour: z.enum(PERSON_COLOURS).nullable(),
  visibility: z.enum(VISIBILITY),
};

export const createPersonInput = z.object({
  ...fields,
  shortName: fields.shortName.optional(),
  relationship: fields.relationship.optional(),
  inHousehold: fields.inHousehold.default(true),
  dateOfBirth: fields.dateOfBirth.optional(),
  stageNote: fields.stageNote.optional(),
  colour: fields.colour.optional(),
  visibility: fields.visibility.default('household'),
});
export type CreatePersonInput = z.input<typeof createPersonInput>;

/** A patch: only the keys given are changed. */
export const updatePersonInput = z.object(fields).partial();
export type UpdatePersonInput = z.input<typeof updatePersonInput>;

export { PERSON_COLOURS, PERSON_ROLES };
