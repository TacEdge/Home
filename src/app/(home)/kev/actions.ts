'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formAction, type FormState } from '@/app/_forms/action';
import { FormRefusal } from '@/app/_forms/errors';
import { env } from '@/lib/env';
import { captureVerbatim } from '@/domain/captures/service';
import { listConversations, listMessages } from '@/domain/conversations/service';
import { clearConversation, getTurnInFlight } from '@/domain/kev-bookkeeping/service';
import { ERROR_TEXT } from '@/kev/answer/language';
import { toTurns } from './turns';

// The Kev screen's two writes, both the adult's own (M8 contract §7.2, §11.2;
// D6, D13). Each is a plain form, so it works without JavaScript.
//
// Keep in To sort: the person's own message, word for word, kept privately
// for them through the capture service, as the person (`via: 'ui'`), never
// as Kev. The server checks again that the message is theirs, in their
// conversation now, not expired, and one Keep in To sort applies to (the
// screen offering it is not trusted); the words are copied from the stored
// message, never taken from the form. Keeping it twice keeps it once.
//
// Clear: the bookkeeping path's clearConversation, as the adult (its own
// lock refuses while a turn is in flight: "Kev's still answering.").

const NOT_KEEPABLE = 'That message isn’t one to keep from here.';

export async function keepMessageAction(_: FormState, form: FormData): Promise<FormState> {
  const raw = form.get('messageId');
  const messageId = typeof raw === 'string' ? raw : '';
  return formAction(async (actor) => {
    const [conv] = (await listConversations(actor)).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
    );
    if (!conv) throw new FormRefusal(NOT_KEEPABLE);
    const rows = await listMessages(actor, conv.id);
    const turns = toTurns(rows, await getTurnInFlight(actor), env.HOME_TIMEZONE);
    const turn = turns.find((t) => t.user?.id === messageId);
    if (!turn || !turn.user || !turn.keepable) throw new FormRefusal(NOT_KEEPABLE);
    await captureVerbatim(actor, { text: turn.user.text, messageId: turn.user.id, channel: 'web' });
    revalidatePath('/kev');
    revalidatePath('/sort');
    return { message: 'kept' };
  });
}

export async function clearConversationAction(_: FormState, form: FormData): Promise<FormState> {
  void form;
  const state = await formAction(async (actor) => {
    const out = await clearConversation({ ...actor, via: 'kev' });
    if (!out.ok) throw new FormRefusal(ERROR_TEXT.turn_in_flight);
    revalidatePath('/kev');
  });
  if (state.status === 'ok') redirect('/kev?cleared=1');
  return state;
}
