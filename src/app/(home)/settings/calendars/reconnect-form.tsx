'use client';

import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle } from '@/app/_forms/state';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { PASTE_AGAIN_COPY } from './copy';

// Reconnecting asks for the Google Calendar address and nothing else (ADR
// 0007 §40, §42): the calendar comes back with its own settings. The address
// is never shown again, refused or not.

export function ReconnectForm({ action }: { action: FormAction }) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      <Field
        name="address"
        label="Google Calendar address"
        type="password"
        required
        autoComplete="off"
        spellCheck={false}
        hint={
          state.status === 'error'
            ? PASTE_AGAIN_COPY
            : 'The same secret address this calendar was connected with.'
        }
        error={errors.address}
      />
      <FormMessage state={state} />
      <div className="mt-8">
        <Button>Reconnect</Button>
      </div>
    </form>
  );
}
