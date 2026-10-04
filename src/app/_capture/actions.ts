'use server';

import { revalidatePath } from 'next/cache';
import { formAction, type FormState } from '@/app/_forms/action';
import { captureVerbatim } from '@/domain/captures/service';

// The capture bar's one action (M3 contract §3.8): the words, exactly as
// typed, kept privately for the person who typed them. Nothing is trimmed,
// parsed or classified. "Kept" is said only once the service has stored it;
// a refusal hands the words back to the box.

export async function captureAction(_: FormState, form: FormData): Promise<FormState> {
  const raw = form.get('text');
  const text = typeof raw === 'string' ? raw : '';
  if (!/\S/.test(text))
    return {
      status: 'error',
      message: 'There’s nothing to keep yet.',
      fields: {},
      values: { text },
    };
  const state = await formAction(
    async (actor) => {
      await captureVerbatim(actor, { text, channel: 'web' });
      revalidatePath('/', 'layout');
      return { message: 'kept' };
    },
    { form },
  );
  return state;
}
