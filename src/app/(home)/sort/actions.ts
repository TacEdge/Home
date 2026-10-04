'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { NOT_PERMITTED_COPY } from '@/app/_forms/error-copy';
import { idOf } from '@/app/_forms/read';
import { localPath } from '@/app/_forms/return-to';
import { dismissCapture, undismissCapture } from '@/domain/captures/service';
import { NotFoundError, NotPermittedError, type NotPermittedCode } from '@/domain/common/errors';
import { listPeople } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { organiseCapture } from '@/domain/proposals/service';
import { env } from '@/lib/env';
import { readEventForm } from '../events/event-form-data';
import { readNewProject } from '../home/project-form-data';
import { readNewTask } from '../tasks/task-form-data';
import { kindOf } from './copy';
import { readContext, readNote } from './organise-form-data';
import { subjectsFor } from './subjects';

// To sort's actions (M3 contract §3.8). Organising goes through
// `organiseCapture` only: the person proposes and approves in one
// transaction, and the executor makes the record (no second path). The
// capture is bound by the page; the service checks it is the actor's own.
// Not needed sets a capture aside (nothing is deleted) with Undo.

/** A stored failure code, as the error formAction turns into calm copy. */
function refusal(reason: string): Error {
  if (reason === 'not_found') return new NotFoundError('organise');
  if (reason in NOT_PERMITTED_COPY) return new NotPermittedError(reason as NotPermittedCode);
  return new Error('organise_failed');
}

export async function organiseAction(
  captureId: string,
  as: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(
    async (actor) => {
      const kind = kindOf(as);
      if (!kind) throw new NotPermittedError('not_eligible');
      let payload: Record<string, unknown>;
      let title: string;
      switch (kind.as) {
        case 'task': {
          const [projects, people] = await Promise.all([listProjects(actor), listPeople(actor)]);
          const input = readNewTask(
            form,
            { projectIds: projects.map((p) => p.id), peopleIds: people.map((p) => p.id) },
            env.HOME_TIMEZONE,
          );
          payload = input;
          title = input.title;
          break;
        }
        case 'event': {
          const read = readEventForm(form, { timeZone: env.HOME_TIMEZONE, peopleIds: [] });
          payload = read.input as Record<string, unknown>;
          title = String(read.input.title ?? '');
          break;
        }
        case 'project': {
          const input = readNewProject(form);
          payload = input;
          title = input.title;
          break;
        }
        case 'note': {
          const s = await subjectsFor(actor, true);
          const input = readNote(form, [
            ...s.people.map((p) => `person:${p.id}`),
            ...s.projects.map((p) => `project:${p.id}`),
            ...s.events.map((e) => `event:${e.id}`),
          ]);
          payload = input;
          title = input.body;
          break;
        }
        case 'know': {
          const s = await subjectsFor(actor, false);
          const input = readContext(form, [
            'household',
            ...s.people.map((p) => `person:${p.id}`),
            ...s.projects.map((p) => `project:${p.id}`),
          ]);
          payload = input;
          title = input.content;
          break;
        }
      }
      const decision = await organiseCapture(actor, captureId, {
        action: kind.action,
        payload,
        summary: `${kind.noun}: ${title}`,
      });
      if (decision.outcome !== 'approved')
        throw refusal(decision.outcome === 'failed' ? decision.reason : 'not_eligible');
      redirect(`/sort/${captureId}?made=${kind.as}`);
    },
    { form },
  );
}

export async function setAsideAction(
  returnTo: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(async (actor) => {
    const c = await dismissCapture(actor, idOf(form));
    const to = localPath(returnTo, '/sort');
    redirect(`${to}${to.includes('?') ? '&' : '?'}aside=${c.id}`);
  });
}

export async function bringBackAction(
  returnTo: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(async (actor) => {
    await undismissCapture(actor, idOf(form));
    redirect(localPath(returnTo, '/sort'));
  });
}
