'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { idOf, requiredTextOf } from '@/app/_forms/read';
import { skipOccurrence } from '@/domain/engines/recurrence';
import {
  archiveEvent,
  createEventWithPeople,
  getEvent,
  restoreEvent,
  setEventPeople,
  updateEvent,
} from '@/domain/events/service';
import type { CreateEventInput, UpdateEventInput } from '@/domain/events/schema';
import { listPeople } from '@/domain/people/service';
import { env } from '@/lib/env';
import { readEventForm } from './event-form-data';

// Event server actions (M3 contract §3.6, §4.1). The actor comes from the
// session inside formAction; the people a form may name are the people the
// actor can see, read here rather than trusted from the form; the services
// validate and enforce every rule. Edits apply to the whole series.

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
      await updateEvent(actor, id, read.input as UpdateEventInput);
      await setEventPeople(actor, id, read.people);
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

/** "Skip this one": one more exdate, by the occurrence's own date (ADR 0006 §37). */
export async function skipOccurrenceAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const id = idOf(form);
    const current = await getEvent(actor, id);
    await updateEvent(actor, id, {
      exdates: skipOccurrence(current.exdates, requiredTextOf(form, 'date').trim()),
    });
    redirect(`/events/${id}`);
  });
}

/** Undoes a skip: the date is removed from the exdates; nothing else changes. */
export async function putBackOccurrenceAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const id = idOf(form);
    const date = requiredTextOf(form, 'date').trim();
    const current = await getEvent(actor, id);
    const remaining = (current.exdates ?? []).filter((x) => x !== date);
    await updateEvent(actor, id, { exdates: remaining.length ? remaining : null });
    redirect(`/events/${id}`);
  });
}
