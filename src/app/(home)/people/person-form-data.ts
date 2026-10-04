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

/**
 * A patch: only the fields the form sent. A field it did not send is left
 * out (undefined) and so left unchanged: an absent colour is not cleared,
 * an absent "lives at home" box is not ticked. A sent but empty optional
 * field clears (null).
 */
export function readPersonPatch(form: FormData): UpdatePersonInput {
  const patch: UpdatePersonInput = {
    name: form.has('name') ? requiredTextOf(form, 'name') : undefined,
    role: choiceOf(form, 'role') as UpdatePersonInput['role'],
    shortName: textOf(form, 'shortName'),
    relationship: textOf(form, 'relationship'),
    inHousehold: checkboxOf(form, 'inHousehold'),
    dateOfBirth: textOf(form, 'dateOfBirth'),
    stageNote: textOf(form, 'stageNote'),
    colour: textOf(form, 'colour') as UpdatePersonInput['colour'],
    visibility: choiceOf(form, 'visibility') as UpdatePersonInput['visibility'],
  };
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as UpdatePersonInput;
}
