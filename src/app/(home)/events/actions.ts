'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { idOf, requiredTextOf } from '@/app/_forms/read';
import { NotPermittedError } from '@/domain/common/errors';
import { isOccurrenceChange } from '@/domain/events/occurrences';
import {
  archiveEvent,
  changeEventOccurrence,
  createEventWithPeople,
  editEventWithPeople,
  getEvent,
  putBackEventOccurrence,
  restoreEvent,
  returnOccurrenceToSeries,
  setEventPeople,
  skipEventOccurrence,
} from '@/domain/events/service';
import type { CreateEventInput, UpdateEventInput } from '@/domain/events/schema';
import { listPeople } from '@/domain/people/service';
import { env } from '@/lib/env';
import { readEventForm, readOccurrenceForm, readPeople } from './event-form-data';

// Event server actions (M3 contract §3.6, §4.1). The actor comes from the
// session inside formAction; the people a form may name are the people the
// actor can see, read here rather than trusted from the form; the services
// validate and enforce every rule. Edits apply to the whole series, and an
// edit's fields and people are one change (ADR 0006 §40).

export async function createEventAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(
    async (actor) => {
      const people = await listPeople(actor);
      const read = readEventForm(form, {
        timeZone: env.HOME_TIMEZONE,
        peopleIds: people.map((p) => p.id),
      });
      const e = await createEventWithPeople(actor, read.input as CreateEventInput, read.people);
      redirect(`/events/${e.id}`);
    },
    { form },
  );
}

export async function updateEventAction(
  id: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(
    async (actor) => {
      const [current, people] = await Promise.all([getEvent(actor, id), listPeople(actor)]);
      const read = readEventForm(form, {
        timeZone: env.HOME_TIMEZONE,
        peopleIds: people.map((p) => p.id),
        current,
      });
      await editEventWithPeople(actor, id, read.input as UpdateEventInput, read.people);
      redirect(`/events/${id}`);
    },
    { form },
  );
}

export async function archiveEventAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    await archiveEvent(actor, idOf(form));
    redirect('/forward');
  });
}

export async function restoreEventAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const e = await restoreEvent(actor, idOf(form));
    redirect(`/events/${e.id}`);
  });
}

/** "Skip this one" (ADR 0006 §37, §42): the service checks the date against the rule. */
export async function skipOccurrenceAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const id = idOf(form);
    await skipEventOccurrence(actor, id, requiredTextOf(form, 'date').trim());
    redirect(`/events/${id}`);
  });
}

/** Undoes a skip: the service checks the date was skipped. */
export async function putBackOccurrenceAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const id = idOf(form);
    await putBackEventOccurrence(actor, id, requiredTextOf(form, 'date').trim());
    redirect(`/events/${id}`);
  });
}

/**
 * Who's going and who's responsible, on their own (M4 Package 6): the one
 * thing about a synced event HOME owns besides its notes. The same people
 * service as an edit, so the same rules and audit rows.
 */
export async function setEventPeopleAction(
  id: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(
    async (actor) => {
      const people = await listPeople(actor);
      await setEventPeople(
        actor,
        id,
        readPeople(
          form,
          people.map((p) => p.id),
        ),
      );
      redirect(`/events/${id}`);
    },
    { form },
  );
}

/**
 * "Change this one" (M4 contract §5.3, ADR 0007 §46). The series and the
 * occurrence are bound by the page that offered the form, from what the
 * server itself read and proved; the form carries only the new details.
 * The service proves the occurrence again against the rule, and updates
 * the one live change of it or makes it. Lands on the changed time's page.
 */
export async function changeOccurrenceAction(
  seriesId: string,
  original: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(
    async (actor) => {
      const series = await getEvent(actor, seriesId);
      const changed = await changeEventOccurrence(
        actor,
        series.id,
        original,
        readOccurrenceForm(form, { timeZone: series.timeZone ?? env.HOME_TIMEZONE }),
      );
      redirect(`/events/${changed.id}`);
    },
    { form },
  );
}

/**
 * "Back to the series": the one-off change named by the form's id is put
 * away (archived, never deleted) and the usual time returns. Which series
 * and which time come from the change's own row, as the actor may read it,
 * never from the form.
 */
export async function returnToSeriesAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const change = await getEvent(actor, idOf(form));
    if (!isOccurrenceChange(change) || !change.recurrenceParentId)
      throw new NotPermittedError('not_changed');
    await returnOccurrenceToSeries(actor, change.recurrenceParentId, change.recurrenceOriginal!);
    redirect(`/events/${change.recurrenceParentId}`);
  });
}
