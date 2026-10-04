'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { choiceOf, idOf, requiredTextOf } from '@/app/_forms/read';
import { localPath } from '@/app/_forms/return-to';
import type { NOTE_SUBJECT_TYPES } from '@/domain/notes/schema';
import { archiveNote, createNote, restoreNote, updateNote } from '@/domain/notes/service';

// Notes on a subject (M3 contract §3.7): written, changed, archived and
// restored in place on a project, person or event page. The subject is
// bound by the server-rendered page (and so readable in the browser, like
// any field); the service re-checks it is visible, not archived, and that a
// household note never points at something private.

const safe = (to: string) => localPath(to, '/today');
type SubjectType = (typeof NOTE_SUBJECT_TYPES)[number];

export async function createNoteAction(
  subjectType: SubjectType,
  subjectId: string,
  returnTo: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(
    async (actor) => {
      await createNote(actor, {
        body: requiredTextOf(form, 'body'),
        subject: { type: subjectType, id: subjectId },
        visibility: (choiceOf(form, 'visibility') ?? 'household') as 'household' | 'private',
      });
      redirect(safe(returnTo));
    },
    { form },
  );
}

export async function updateNoteAction(
  id: string,
  returnTo: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(
    async (actor) => {
      const visibility = choiceOf(form, 'visibility') as 'household' | 'private' | undefined;
      await updateNote(actor, id, {
        body: requiredTextOf(form, 'body'),
        ...(visibility ? { visibility } : {}),
      });
      redirect(safe(returnTo));
    },
    { form },
  );
}

export async function archiveNoteAction(
  returnTo: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(async (actor) => {
    await archiveNote(actor, idOf(form));
    redirect(safe(returnTo));
  });
}

export async function restoreNoteAction(
  returnTo: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(async (actor) => {
    await restoreNote(actor, idOf(form));
    redirect(safe(returnTo));
  });
}
