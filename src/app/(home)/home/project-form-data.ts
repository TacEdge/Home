import type { CreateProjectInput, UpdateProjectInput } from '@/domain/projects/schema';
import { choiceOf, requiredTextOf, textOf } from '@/app/_forms/read';

// The project form, read into the shared Zod schema's shape (M3 contract
// §3.5, §4.1). Pure: the service validates. Domain is always home in V0.1.

export function readNewProject(form: FormData): CreateProjectInput {
  return {
    title: requiredTextOf(form, 'title'),
    summary: textOf(form, 'summary'),
    status: choiceOf(form, 'status') as CreateProjectInput['status'],
    targetDate: textOf(form, 'targetDate'),
    visibility: (choiceOf(form, 'visibility') ?? 'household') as CreateProjectInput['visibility'],
  };
}

/** A patch: only the fields the form sent; a sent but empty optional field clears. */
export function readProjectPatch(form: FormData): UpdateProjectInput {
  const patch: UpdateProjectInput = {
    title: form.has('title') ? requiredTextOf(form, 'title') : undefined,
    summary: textOf(form, 'summary'),
    status: choiceOf(form, 'status') as UpdateProjectInput['status'],
    targetDate: textOf(form, 'targetDate'),
    visibility: choiceOf(form, 'visibility') as UpdateProjectInput['visibility'],
  };
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as UpdateProjectInput;
}
