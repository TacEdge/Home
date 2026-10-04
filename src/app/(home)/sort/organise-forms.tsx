'use client';

import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle, shown } from '@/app/_forms/state';
import { Button } from '@/ui/button';
import { Field, More } from '@/ui/field';

// The two forms only To sort needs (M3 contract §3.8): a note on a
// subject, and something to know. The words arrive prefilled and stay
// editable; what it's about is chosen from what the actor can see. A
// refused save keeps what was typed and focuses where to look.

type Option = { value: string; label: string };
const VISIBILITY = [
  { value: 'household', label: 'Everyone at home' },
  { value: 'private', label: 'Just me' },
];

export function NoteOrganiseForm({
  action,
  words,
  subjects,
}: {
  action: FormAction;
  words: string;
  subjects: Option[];
}) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      <Field
        name="subject"
        label="What it’s about"
        type="select"
        required
        options={[{ value: '', label: 'Choose…' }, ...subjects]}
        defaultValue={shown(state, 'subject', '')}
        hint="A note lives on a person, a project or an event."
        error={errors.subject}
      />
      <Field
        name="body"
        label="The note"
        type="textarea"
        rows={4}
        required
        defaultValue={shown(state, 'body', words)}
        error={errors.body}
      />
      <Field
        name="visibility"
        label="Who can see this"
        type="select"
        required
        options={VISIBILITY}
        defaultValue={shown(state, 'visibility', 'household')}
        hint="Just me keeps this out of the other adult’s HOME. A note on something private is private too."
        error={errors.visibility}
      />
      <FormMessage state={state} />
      <div className="mt-8">
        <Button>Make it a note</Button>
      </div>
    </form>
  );
}

export function ContextOrganiseForm({
  action,
  words,
  subjects,
  categories,
}: {
  action: FormAction;
  words: string;
  subjects: Option[];
  categories: Option[];
}) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  const moreTouched =
    state.status === 'error' &&
    (Boolean(errors.validUntil || errors.visibility) ||
      (state.values?.validUntil ?? '') !== '' ||
      (state.values?.visibility ?? 'household') !== 'household');
  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      <Field
        name="subject"
        label="Who or what it’s about"
        type="select"
        required
        options={[{ value: 'household', label: 'Everyone at home' }, ...subjects]}
        defaultValue={shown(state, 'subject', 'household')}
        error={errors.subject}
      />
      <Field
        name="content"
        label="What to know"
        type="textarea"
        rows={3}
        required
        defaultValue={shown(state, 'content', words)}
        hint="In your words. HOME keeps it dated, and it can go stale."
        error={errors.content}
      />
      <Field
        name="category"
        label="Kind"
        type="select"
        required
        options={categories}
        defaultValue={shown(state, 'category', 'other')}
        error={errors.category}
      />
      <More open={moreTouched}>
        <Field
          name="validUntil"
          label="Holds until"
          type="date"
          defaultValue={shown(state, 'validUntil', '')}
          hint="For something that is only true for a while."
          error={errors.validUntil}
        />
        <Field
          name="visibility"
          label="Who can see this"
          type="select"
          required
          options={VISIBILITY}
          defaultValue={shown(state, 'visibility', 'household')}
          hint="Just me keeps this out of the other adult’s HOME. Something sensitive isn’t made here."
          error={errors.visibility}
        />
      </More>
      <FormMessage state={state} />
      <div className="mt-8">
        <Button>Keep it</Button>
      </div>
    </form>
  );
}
