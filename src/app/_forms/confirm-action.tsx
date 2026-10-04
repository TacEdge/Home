'use client';

import { useActionState } from 'react';
import { ConfirmInline } from '@/ui/confirm-inline';
import { FormMessage, type FormAction } from './action-form';
import { idle } from './state';

// ConfirmInline wired to a FormState action: the second step happens in
// place, and a refusal (a rule the service enforces) is read under it.

export function ConfirmAction({
  action,
  hidden,
  ...props
}: {
  action: FormAction;
  label: string;
  question: string;
  confirmLabel: string;
  cancelLabel?: string;
  hidden?: Record<string, string>;
}) {
  const [state, dispatch] = useActionState(action, idle);
  return (
    <div>
      <ConfirmInline {...props} hidden={hidden} action={dispatch} />
      <FormMessage state={state} />
    </div>
  );
}
