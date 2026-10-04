import type { CreateContextInput } from '@/domain/context/schema';
import type { CreateNoteInput } from '@/domain/notes/schema';
import { choiceOf, requiredTextOf, textOf } from '@/app/_forms/read';
import { FormFieldError } from '@/app/_forms/errors';

// The two forms that exist only for organising a capture: a note on a
// subject, and something to know. Pure; the payload schema validates. A
// subject is one the form offered (read in the action), never trusted from
// the form. Something to know made this way is never sensitive: a proposal
// cannot write sensitive context (ADR 0005 D15).

export type SubjectChoice = `${'person' | 'project' | 'event'}:${string}`;

function offered(form: FormData, allowed: readonly string[]) {
  const v = choiceOf(form, 'subject') ?? '';
  if (!allowed.includes(v)) throw new FormFieldError({ subject: 'Choose what it’s about.' });
  return v;
}

export function readNote(form: FormData, subjects: readonly string[]): CreateNoteInput {
  const [type, id] = offered(form, subjects).split(':') as ['person' | 'project' | 'event', string];
  return {
    body: requiredTextOf(form, 'body'),
    subject: { type, id },
    visibility: (choiceOf(form, 'visibility') ?? 'household') as CreateNoteInput['visibility'],
  };
}

export function readContext(form: FormData, subjects: readonly string[]): CreateContextInput {
  const v = offered(form, subjects);
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
  };
}
