'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { idOf, requiredTextOf } from '@/app/_forms/read';
import {
  archiveEvent,
  createEventWithPeople,
  editEventWithPeople,
  getEvent,
  putBackEventOccurrence,
  restoreEvent,
  skipEventOccurrence,
} from '@/domain/events/service';
import type { CreateEventInput, UpdateEventInput } from '@/domain/events/schema';
import { listPeople } from '@/domain/people/service';
import { env } from '@/lib/env';
import { readEventForm } from './event-form-data';

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
