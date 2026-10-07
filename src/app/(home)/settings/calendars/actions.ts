'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { FormRefusal } from '@/app/_forms/errors';
import { idOf } from '@/app/_forms/read';
import { CalendarCanReconnectError } from '@/domain/calendar/errors';
import {
  connectCalendar,
  disconnectCalendar,
  getCalendar,
  reconnectCalendar,
  updateCalendar,
} from '@/domain/calendar/service';
import { NotPermittedError } from '@/domain/common/errors';
import { refreshCalendarNow } from '@/integrations/calendar/entry';
import { readAddress, readCalendarPatch, readNewCalendar } from './calendar-form-data';
import { CAN_RECONNECT_COPY, REFRESH_BUSY_COPY } from './copy';

// Settings › Calendars server actions (M4 contract §5.1, ADR 0007 §43). The
// actor comes from the session inside formAction; the Package 4b services
// validate and enforce every rule (ownership, the gate, references, the
// address). The secret address is never handed back to the form: a refused
// connect or reconnect returns the other fields only, and the page asks for
// the address again (safer than echoing a password-type value into HTML).

const HERE = '/settings/calendars';

/** The submitted fields minus the secret address, for a refused form. */
function withoutAddress(form: FormData): FormData {
  const copy = new FormData();
  for (const [k, v] of form.entries()) if (k !== 'address') copy.append(k, v);
  return copy;
}

export async function connectCalendarAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(
    async (actor) => {
      let calendarId: string;
      try {
        ({ calendarId } = await connectCalendar(actor, readNewCalendar(form)));
      } catch (e) {
        // The address is one of this adult's own disconnected calendars: say
        // so and point at it (ADR 0007 §40); reconnecting stays their own,
        // separate act. The name comes from the ordinary read, as the actor.
        if (e instanceof CalendarCanReconnectError) {
          const mine = await getCalendar(actor, e.calendarId, { includeArchived: true });
          throw new FormRefusal(CAN_RECONNECT_COPY, {
            href: `${HERE}/${mine.id}`,
            label: `Go to ${mine.name}`,
          });
        }
        throw e;
      }
      redirect(`${HERE}/${calendarId}?connected=1`);
    },
    { form: withoutAddress(form) },
  );
}

export async function updateCalendarAction(
  id: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(
    async (actor) => {
      await updateCalendar(actor, id, readCalendarPatch(form));
      redirect(`${HERE}/${id}`);
    },
    { form },
  );
}

export async function disconnectCalendarAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const id = idOf(form);
    await disconnectCalendar(actor, id);
    redirect(`${HERE}/${id}`);
  });
}

export async function reconnectCalendarAction(
  id: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return formAction(async (actor) => {
    await reconnectCalendar(actor, id, readAddress(form));
    redirect(`${HERE}/${id}?reconnected=1`);
  });
}

/**
 * Refresh now: one refresh of this calendar, through the composition root
 * (the real provider, or synthetic feeds in a local run). A refresh another
 * request is already making answers in place; anything else lands back on
 * the calendar's page, which shows the outcome in words.
 */
export async function refreshCalendarAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const id = idOf(form);
    let outcome: Awaited<ReturnType<typeof refreshCalendarNow>>;
    try {
      outcome = await refreshCalendarNow(actor, id);
    } catch (e) {
      // A disconnected calendar is refreshed from its page's Reconnect, not here.
      if (e instanceof NotPermittedError && e.code === 'calendar_disconnected')
        redirect(`${HERE}/${id}`);
      throw e;
    }
    if (outcome.status === 'busy') return { message: REFRESH_BUSY_COPY };
    redirect(`${HERE}/${id}`);
  });
}
