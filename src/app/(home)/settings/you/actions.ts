'use server';

import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { idOf, requiredTextOf } from '@/app/_forms/read';
import { createAndLinkSelf, linkSelf, unlinkSelf } from '@/domain/people/service';

// Settings › You (M3 contract §3.4). Only ever the acting user's own link:
// linkSelf and unlinkSelf cannot name another adult.

export async function linkSelfAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(async (actor) => {
    await linkSelf(actor, idOf(form));
    redirect('/settings/you');
  });
}

export async function addMeAction(_: FormState, form: FormData): Promise<FormState> {
  return formAction(
    async (actor) => {
      await createAndLinkSelf(actor, { name: requiredTextOf(form, 'name') });
      redirect('/settings/you');
    },
    { form },
  );
}

export async function unlinkSelfAction(): Promise<FormState> {
  return formAction(async (actor) => {
    await unlinkSelf(actor);
    redirect('/settings/you');
  });
}
