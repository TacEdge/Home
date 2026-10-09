'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { requestNow } from '@/app/_agenda/now';
import { dismissInsight } from '@/domain/insights/today';
import { env } from '@/lib/env';

// Dismiss on Worth knowing (M5 Package 4, ADR 0008 §23, §33): the signed-in
// adult's own, through the insights service. The key is checked there
// against the adult's own insights as they are now, so a crafted key, one
// for a record the adult cannot see, or another adult's, is refused. The
// gate refuses it in Production while it is closed. A form post without
// JavaScript lands back on Today with the insight gone.

export async function dismissAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    const key = form.get('key');
    await dismissInsight(
      actor,
      typeof key === 'string' ? key : '',
      await requestNow(),
      env.HOME_TIMEZONE,
    );
    redirect('/today');
  });
}
