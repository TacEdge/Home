import 'server-only';
import { redirect, unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import { log } from '@/lib/log';
import { NotSignedInError, type UserActor } from '@/trust/actor';
import { requireActor } from '@/trust/session';
import {
  fieldCopy,
  INVALID_COPY,
  NOT_FOUND_COPY,
  NOT_PERMITTED_COPY,
  UNEXPECTED_COPY,
} from './error-copy';

// The server-action pattern for M3 forms (M3 contract §4.1, §4.3):
//
//   'use server';
//   export async function saveThing(_: FormState, form: FormData): Promise<FormState> {
//     return formAction(async (actor) => {
//       const thing = await createThing(actor, readForm(form));   // domain service, Zod inside
//       redirect(`/things/${thing.id}`);                           // success leaves the page
//     });
//   }
//
// The actor always comes from the session on the server; the domain service
// validates with its own Zod schema and enforces every rule. Whatever goes
// wrong becomes calm copy here: field errors by name, one message for the
// form. Navigation (redirect, notFound) passes straight through.

export type FormState =
  | { status: 'idle' }
  | { status: 'ok'; message?: string }
  | { status: 'error'; message: string; fields: Record<string, string> };

export const idle: FormState = { status: 'idle' };

/** Turns any error from a write into what the form shows. Pure; never echoes input. */
export function toFormState(e: unknown): FormState & { status: 'error' } {
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of e.issues) {
      const key = issue.path.map(String).join('.') || '_form';
      fields[key] ??= fieldCopy(issue as Parameters<typeof fieldCopy>[0]);
    }
    return { status: 'error', message: INVALID_COPY, fields };
  }
  if (e instanceof NotFoundError) return { status: 'error', message: NOT_FOUND_COPY, fields: {} };
  if (e instanceof NotPermittedError)
    return { status: 'error', message: NOT_PERMITTED_COPY[e.code], fields: {} };
  return { status: 'error', message: UNEXPECTED_COPY, fields: {} };
}

/** Runs a write as the signed-in person and reports the outcome as form state. */
export async function formAction(
  run: (actor: UserActor) => Promise<void | { message?: string }>,
  deps: { requireActor?: () => Promise<UserActor> } = {},
): Promise<FormState> {
  try {
    const actor = await (deps.requireActor ?? requireActor)();
    const r = await run(actor);
    return { status: 'ok', message: r ? r.message : undefined };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof NotSignedInError) redirect('/sign-in');
    const state = toFormState(e);
    // Only the error's class name is logged: never its message, input or actor.
    if (state.message === UNEXPECTED_COPY)
      log.error('form_action_failed', { error: e instanceof Error ? e.name : typeof e });
    return state;
  }
}
