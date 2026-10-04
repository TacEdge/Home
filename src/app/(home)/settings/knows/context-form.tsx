'use client';

import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle, shown } from '@/app/_forms/state';
import { Button } from '@/ui/button';
import { Field, More } from '@/ui/field';
import { CATEGORY_OPTIONS, SENSITIVITY_HINT, SENSITIVITY_OPTIONS } from './copy';

// Something to know: new (who or what it's about, the words, a kind; under
// More a date it holds until, who can see it, and whether it is sensitive,
// explained) or changed (the words, kind, until, visibility; sensitivity is
// decided once, when it is made). Several of these sit on one page, so each
// carries its own control ids. A refused save keeps what was typed.

type Option = { value: string; label: string };
const VISIBILITY = [
  { value: 'household', label: 'Everyone at home' },
  { value: 'private', label: 'Just me' },
];

export type ContextFormValues = {
  content: string;
  category: string;
  validUntil: string;
  visibility: string;
};

export function ContextForm({
  action,
  idPrefix,
  subjects,
  current,
  submitLabel,
}: {
  action: FormAction;
  idPrefix: string;
  /** Offered only for a new item. */
  subjects?: Option[];
  current?: ContextFormValues;
  submitLabel: string;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  const v = (name: string, stored: string | undefined) => shown(state, name, stored);
  const moreTouched =
    state.status === 'error' &&
    (['validUntil', 'visibility', 'sensitivity'].some((k) => errors[k]) ||
      (state.values?.validUntil ?? current?.validUntil ?? '') !== (current?.validUntil ?? '') ||
      (state.values?.visibility ?? current?.visibility ?? 'household') !==
        (current?.visibility ?? 'household') ||
      (state.values?.sensitivity ?? 'normal') !== 'normal');
  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      {subjects ? (
        <Field
          id={`${idPrefix}-subject`}
          name="subject"
          label="Who or what it’s about"
          type="select"
          required
          options={[{ value: 'household', label: 'Everyone at home' }, ...subjects]}
          defaultValue={v('subject', 'household')}
          error={errors.subject}
        />
      ) : null}
      <Field
        id={`${idPrefix}-content`}
        name="content"
        label="What to know"
        type="textarea"
        rows={3}
        required
        defaultValue={v('content', current?.content)}
        hint="In your words. HOME keeps it dated, and asks now and then whether it still holds."
        error={errors.content}
      />
      <Field
        id={`${idPrefix}-category`}
        name="category"
        label="Kind"
        type="select"
        required
        options={CATEGORY_OPTIONS}
        defaultValue={v('category', current?.category ?? 'other')}
        error={errors.category}
      />
      <More open={moreTouched}>
        <Field
          id={`${idPrefix}-validUntil`}
          name="validUntil"
          label="Holds until"
          type="date"
          defaultValue={v('validUntil', current?.validUntil ?? '')}
          hint="For something that is only true for a while."
          error={errors.validUntil}
        />
        <Field
          id={`${idPrefix}-visibility`}
          name="visibility"
          label="Who can see this"
          type="select"
          required
          options={VISIBILITY}
          defaultValue={v('visibility', current?.visibility ?? 'household')}
          hint="Just me keeps this out of the other adult’s HOME."
          error={errors.visibility}
        />
        {subjects ? (
          <Field
            id={`${idPrefix}-sensitivity`}
            name="sensitivity"
            label="How private"
            type="select"
            required
            options={SENSITIVITY_OPTIONS}
            defaultValue={v('sensitivity', 'normal')}
            hint={SENSITIVITY_HINT}
            error={errors.sensitivity}
          />
        ) : null}
      </More>
      <FormMessage state={state} />
      <div className="mt-6">
        <Button variant={subjects ? 'primary' : 'quiet'}>{submitLabel}</Button>
      </div>
    </form>
  );
}
