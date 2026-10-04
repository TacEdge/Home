'use client';

import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle, shown } from '@/app/_forms/state';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

// "Add me" (M3 contract §3.4). A refused save keeps the typed name.
export function AddMeForm({ action }: { action: FormAction }) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      <Field
        name="name"
        label="Your name"
        required
        autoComplete="given-name"
        defaultValue={shown(state, 'name', undefined)}
        error={errors.name}
      />
      <FormMessage state={state} />
      <div className="mt-5">
        <Button>Add me</Button>
      </div>
    </form>
  );
}
