'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { choiceOf, idOf } from '@/app/_forms/read';
import { localPath } from '@/app/_forms/return-to';
import { NotPermittedError } from '@/domain/common/errors';
import { TASK_STATUSES, type TaskStatus } from '@/domain/tasks/schema';
import { listPeople } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { archiveTask, createTask, getTask, restoreTask, updateTask } from '@/domain/tasks/service';
import { env } from '@/lib/env';
import { readNewTask, readTaskPatch } from './task-form-data';

// Task server actions (M3 contract §3.5, §4.1). The actor comes from the
// session inside formAction; the project and people a form may name are the
// ones the actor can see, read here rather than trusted from the form; the
// service validates and enforces every rule. Status has its own action so
// done and dropped are one tap, with undo. An edit sends a reference
// (project, people) only when it changed, so an archived one it still
// holds is kept rather than cleared.

async function offered(actor: Parameters<typeof listPeople>[0]) {
  const [projects, people] = await Promise.all([listProjects(actor), listPeople(actor)]);
  return { projectIds: projects.map((p) => p.id), peopleIds: people.map((p) => p.id) };
}

export async function createTaskAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(
    async (actor) => {
      const t = await createTask(actor, readNewTask(form, await offered(actor), env.HOME_TIMEZONE));
      redirect(`/tasks/${t.id}`);
    },
    { form },
  );
}

export async function updateTaskAction(
  id: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(
    async (actor) => {
      const current = await getTask(actor, id);
      await updateTask(
        actor,
        id,
        readTaskPatch(form, await offered(actor), env.HOME_TIMEZONE, current),
      );
      redirect(`/tasks/${id}`);
    },
    { form },
  );
}

/**
 * Done, dropped or back to open, in one tap. Returns to where it was
 * pressed; a task just finished or dropped carries `?undo=` so the page can
 * offer to put it back.
 */
export async function setTaskStatusAction(
  returnTo: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(async (actor) => {
    const id = idOf(form);
    const status = choiceOf(form, 'status') as TaskStatus;
    if (!TASK_STATUSES.includes(status)) throw new NotPermittedError('not_eligible');
    await updateTask(actor, id, { status });
    const to = localPath(returnTo, '/tasks');
    redirect(status === 'open' ? to : `${to}${to.includes('?') ? '&' : '?'}undo=${id}`);
  });
}

export async function archiveTaskAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    await archiveTask(actor, idOf(form));
    redirect('/tasks');
  });
}

export async function restoreTaskAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const t = await restoreTask(actor, idOf(form));
    redirect(`/tasks/${t.id}`);
  });
}
