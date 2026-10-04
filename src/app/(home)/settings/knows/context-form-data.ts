import type { CreateContextInput, UpdateContextInput } from '@/domain/context/schema';
import { choiceOf, requiredTextOf, textOf } from '@/app/_forms/read';
import { FormFieldError } from '@/app/_forms/errors';

// The What Kev knows forms, read into the shared Zod schemas' shape (M3
// contract §3.9, §4.1). Pure; the service validates. A subject is one the
// form offered (read in the action), never trusted from the form. The
// sensitivity choice is a person's own, made directly here (ADR 0005 §37).

export function readNewContext(form: FormData, subjects: readonly string[]): CreateContextInput {
  const v = choiceOf(form, 'subject') ?? '';
  if (!subjects.includes(v))
    throw new FormFieldError({ subject: 'Choose who or what it’s about.' });
  const subject: CreateContextInput['subject'] =
    v === 'household'
      ? { type: 'household' }
      : { type: v.split(':')[0] as 'person' | 'project', id: v.split(':')[1]! };
  return {
    subject,
    content: requiredTextOf(form, 'content'),
    category: (choiceOf(form, 'category') ?? 'other') as CreateContextInput['category'],
    validUntil: textOf(form, 'validUntil') ?? null,
    visibility: (choiceOf(form, 'visibility') ?? 'household') as CreateContextInput['visibility'],
    sensitivity: (choiceOf(form, 'sensitivity') ?? 'normal') as CreateContextInput['sensitivity'],
  };
}

/** A patch: only what the form sent. Sensitivity is never changed here. */
export function readContextPatch(form: FormData): UpdateContextInput {
  const patch: UpdateContextInput = {
    content: form.has('content') ? requiredTextOf(form, 'content') : undefined,
    category: choiceOf(form, 'category') as UpdateContextInput['category'],
    validUntil: textOf(form, 'validUntil'),
    visibility: choiceOf(form, 'visibility') as UpdateContextInput['visibility'],
  };
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as UpdateContextInput;
}
