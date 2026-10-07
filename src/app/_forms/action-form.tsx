'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useRefusalFocus } from './focus';
import { idle, type FormState } from './state';

// A form whose outcome is shown in place (M3 contract §4.1): the server
// action returns FormState, and the message appears under the controls.
// Works without JavaScript: the action still runs and the page re-renders.

export type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

export function ActionForm({
  action,
  children,
  className,
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const ref = useRefusalFocus<HTMLFormElement>(state);
  return (
    <form ref={ref} action={dispatch} className={className}>
      {children}
      <FormMessage state={state} />
    </form>
  );
}

/** The form's own message: a calm sentence marked with the Sun, or nothing. */
export function FormMessage({ state }: { state: FormState }) {
  if (state.status === 'error')
    return (
      <>
        <p
          role="alert"
          tabIndex={-1}
          data-form-message
          className="text-ink mt-4 flex items-baseline gap-2"
        >
          <span
            aria-hidden="true"
            className="bg-accent inline-block h-2 w-2 shrink-0 rounded-full"
          />
          {state.message}
        </p>
        {state.link ? (
          <p className="mt-1 pl-4">
            <Link
              href={state.link.href}
              className="text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4"
            >
              {state.link.label} ›
            </Link>
          </p>
        ) : null}
      </>
    );
  if (state.status === 'ok' && state.message)
    return (
      <p role="status" className="text-ink-2 mt-4">
        {state.message}
      </p>
    );
  return null;
}
