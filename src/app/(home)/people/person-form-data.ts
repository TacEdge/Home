import type { CreatePersonInput, UpdatePersonInput } from '@/domain/people/schema';
import { checkboxOf, choiceOf, requiredTextOf, textOf } from '@/app/_forms/read';

// The person form, read into the shared Zod schema's shape (M3 contract
// §4.1). Pure: the service validates. Role and visibility are left out
// when the form did not send them (a linked person's form fixes them).

export function readNewPerson(form: FormData): CreatePersonInput {
  return {
    name: requiredTextOf(form, 'name'),
    role: choiceOf(form, 'role') as CreatePersonInput['role'],
    shortName: textOf(form, 'shortName'),
    relationship: textOf(form, 'relationship'),
    inHousehold: checkboxOf(form, 'inHousehold') ?? true,
    dateOfBirth: textOf(form, 'dateOfBirth'),
    stageNote: textOf(form, 'stageNote'),
    colour: (textOf(form, 'colour') ?? null) as CreatePersonInput['colour'],
    visibility: (choiceOf(form, 'visibility') ?? 'household') as CreatePersonInput['visibility'],
  };
}

export function readPersonPatch(form: FormData): UpdatePersonInput {
  const role = choiceOf(form, 'role');
  const visibility = choiceOf(form, 'visibility');
  return {
    name: requiredTextOf(form, 'name'),
    ...(role !== undefined ? { role: role as UpdatePersonInput['role'] } : {}),
    shortName: textOf(form, 'shortName'),
    relationship: textOf(form, 'relationship'),
    inHousehold: checkboxOf(form, 'inHousehold') ?? true,
    dateOfBirth: textOf(form, 'dateOfBirth'),
    stageNote: textOf(form, 'stageNote'),
    colour: (textOf(form, 'colour') ?? null) as UpdatePersonInput['colour'],
    ...(visibility !== undefined
      ? { visibility: visibility as UpdatePersonInput['visibility'] }
      : {}),
  };
}
