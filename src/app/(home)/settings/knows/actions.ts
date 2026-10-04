'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { choiceOf, idOf } from '@/app/_forms/read';
import {
  archiveContext,
  confirmContext,
  createContext,
  listContext,
  reinstateContext,
  restoreContext,
  retireContext,
  updateContext,
} from '@/domain/context/service';
import { listPeople } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { requireActor } from '@/trust/session';
import { readContextPatch, readNewContext } from './context-form-data';
import type { RevealState } from './reveal-state';

// What Kev knows (M3 contract §3.9): every change is the person's own,
// through the context service. The subject a new item may be about is read
// here, never trusted from the form. "Show sensitive items" is the one
// screen where a person asks for sensitive context: it calls the service
// with the option set only by their press (the audited sensitive-read path,
// ADR 0006 §55), returns the items to this response alone, and remembers
// nothing.

const HERE = '/settings/knows';

async function offeredSubjects(actor: Parameters<typeof listPeople>[0]) {
  const [people, projects] = await Promise.all([listPeople(actor), listProjects(actor)]);
  return [
    'household',
    ...people.map((p) => `person:${p.id}`),
    ...projects.map((p) => `project:${p.id}`),
  ];
}

export async function createContextAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(
    async (actor) => {
      await createContext(actor, readNewContext(form, await offeredSubjects(actor)));
      redirect(HERE);
    },
    { form },
  );
}

export async function updateContextAction(
  id: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(
    async (actor) => {
      await updateContext(actor, id, readContextPatch(form));
      redirect(HERE);
    },
    { form },
  );
}

const simple =
  (fn: typeof confirmContext) =>
  async (_: FormState, form: FormData): Promise<FormState> =>
    formAction(async (actor) => {
      await fn(actor, idOf(form));
      redirect(HERE);
    });

export const confirmContextAction = simple(confirmContext);
export const retireContextAction = simple(retireContext);
export const reinstateContextAction = simple(reinstateContext);
export const archiveContextAction = simple(archiveContext);
export const restoreContextAction = simple(restoreContext);

/**
 * The person asks to see their sensitive items, for this response only.
 * The option is set by the form's own field, never by default; the service
 * audits each item returned (`context.sensitive_read`).
 */
export async function revealSensitiveAction(_: RevealState, form: FormData): Promise<RevealState> {
  const actor = await requireActor();
  const includeSensitive = choiceOf(form, 'show') === 'sensitive';
  if (!includeSensitive) return { status: 'idle' };
  try {
    const rows = [
      ...(await listContext(actor, { includeSensitive })),
      ...(await listContext(actor, { includeSensitive, status: 'retired' })),
    ].filter((r) => r.sensitivity === 'sensitive');
    return {
      status: 'shown',
      items: rows.map((r) => ({
        id: r.id,
        content: r.content,
        category: r.category,
        status: r.status,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        visibility: r.visibility,
        validUntil: r.validUntil,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch {
    return {
      status: 'error',
      message: 'Something went wrong, so nothing was shown. Try again in a moment.',
    };
  }
}
