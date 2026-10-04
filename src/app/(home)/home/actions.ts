'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { idOf } from '@/app/_forms/read';
import {
  archiveProject,
  createProject,
  restoreProject,
  updateProject,
} from '@/domain/projects/service';
import { readNewProject, readProjectPatch } from './project-form-data';

// Home project server actions (M3 contract §3.5, §4.1). The actor comes
// from the session inside formAction; the service validates and enforces
// every rule.

export async function createProjectAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(
    async (actor) => {
      const p = await createProject(actor, readNewProject(form));
      redirect(`/home/projects/${p.id}`);
    },
    { form },
  );
}

export async function updateProjectAction(
  id: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(
    async (actor) => {
      const p = await updateProject(actor, id, readProjectPatch(form));
      redirect(`/home/projects/${p.id}`);
    },
    { form },
  );
}

export async function archiveProjectAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    await archiveProject(actor, idOf(form));
    redirect('/home');
  });
}

export async function restoreProjectAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const p = await restoreProject(actor, idOf(form));
    redirect(`/home/projects/${p.id}`);
  });
}
