'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { choiceOf, idOf } from '@/app/_forms/read';
import { restoreCapture, undismissCapture } from '@/domain/captures/service';
import { NotPermittedError } from '@/domain/common/errors';
import { restoreContext } from '@/domain/context/service';
import { restoreConversation } from '@/domain/conversations/service';
import { restoreEvent } from '@/domain/events/service';
import { restoreNote } from '@/domain/notes/service';
import { restorePerson } from '@/domain/people/service';
import { restoreProject } from '@/domain/projects/service';
import { restoreTask } from '@/domain/tasks/service';
import type { UserActor } from '@/trust/actor';

// Archived (M3 contract §3.10): one action, Restore (or Back to To sort for
// a set-aside capture), through the record's own service, which checks the
// record is the person's to see and is in fact archived.

const RESTORE: Record<string, (actor: UserActor, id: string) => Promise<unknown>> = {
  person: restorePerson,
  event: restoreEvent,
  project: restoreProject,
  task: restoreTask,
  note: restoreNote,
  context: restoreContext,
  capture: restoreCapture,
  conversation: restoreConversation,
  dismissed_capture: undismissCapture,
};

export async function restoreArchivedAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const type = choiceOf(form, 'type') ?? '';
    const fn = RESTORE[type];
    if (!fn) throw new NotPermittedError('not_eligible');
    await fn(actor, idOf(form));
    redirect('/settings/archived');
  });
}
