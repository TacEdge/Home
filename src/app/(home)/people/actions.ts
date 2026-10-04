'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { idOf } from '@/app/_forms/read';
import { archivePerson, createPerson, restorePerson, updatePerson } from '@/domain/people/service';
import { readNewPerson, readPersonPatch } from './person-form-data';

// People server actions (M3 contract §3.4, §4.1). The actor comes from the
// session inside formAction; the services validate and enforce every rule.

export async function createPersonAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const p = await createPerson(actor, readNewPerson(form));
    redirect(`/people/${p.id}`);
  });
}

export async function updatePersonAction(
  id: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(async (actor) => {
    const p = await updatePerson(actor, id, readPersonPatch(form));
    redirect(`/people/${p.id}`);
  });
}

export async function archivePersonAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    await archivePerson(actor, idOf(form));
    redirect('/people');
  });
}

export async function restorePersonAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const p = await restorePerson(actor, idOf(form));
    redirect(`/people/${p.id}`);
  });
}
