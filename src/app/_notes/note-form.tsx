'use client';

import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle, shown } from '@/app/_forms/state';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';

// A note's words and who can see them, in place. A refused save keeps what
// was typed (shown()) and focuses where to look. Several of these sit on one
// page, so each carries its own control ids (the Field default is by name).

export function NoteForm({
  action,
  /** Distinguishes this form's controls on a page with several note forms. */
  idPrefix,
  body,
  visibility,
  subjectPrivate,
  submitLabel,
  label,
}: {
  action: FormAction;
  idPrefix: string;
  body?: string;
  visibility?: string;
  /** A note on something private is private too; the choice is not offered. */
  subjectPrivate: boolean;
  submitLabel: string;
  label: string;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      <Field
        id={`${idPrefix}-body`}
        name="body"
        label={label}
        type="textarea"
        rows={3}
        required
        defaultValue={shown(state, 'body', body)}
        error={errors.body}
      />
      {subjectPrivate ? (
        <input type="hidden" name="visibility" value="private" />
      ) : (
        <Field
          id={`${idPrefix}-visibility`}
          name="visibility"
          label="Who can see this"
          type="select"
          required
          options={[
            { value: 'household', label: 'Everyone at home' },
            { value: 'private', label: 'Just me' },
          ]}
          defaultValue={shown(state, 'visibility', visibility ?? 'household')}
          error={errors.visibility}
        />
      )}
      <FormMessage state={state} />
      <div className="mt-4">
        <Button variant="quiet">{submitLabel}</Button>
      </div>
    </form>
  );
}
