'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { requestNow } from '@/app/_agenda/now';
import { respondToInsight } from '@/domain/insights/today';
import { env } from '@/lib/env';

// Dismiss and Not useful on Today (M5 Package 4, ADR 0008 §23; M6 Package 3,
// ADR 0009 §17): the signed-in adult's own, through the insights service.
// The key is checked there against the adult's own insights and conflicts as
// they are now, so a crafted key, one for a record the adult cannot see, or
// another adult's, is refused. The gate refuses both in Production while it
// is closed. A form post without JavaScript lands back on Today with the
// insight gone.

async function respondFrom(form: FormData, response: 'dismissed' | 'not_useful') {
  return formAction(async (actor) => {
    const key = form.get('key');
    await respondToInsight(
      actor,
      typeof key === 'string' ? key : '',
      response,
      'today',
      await requestNow(),
      env.HOME_TIMEZONE,
    );
    redirect('/today');
  });
}

export async function dismissAction(_: FormState, form: FormData): Promise<FormState> {
  return respondFrom(form, 'dismissed');
}

export async function notUsefulAction(_: FormState, form: FormData): Promise<FormState> {
  return respondFrom(form, 'not_useful');
}
