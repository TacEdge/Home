'use client';

import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle, shown } from '@/app/_forms/state';
import type { Project } from '@/domain/projects/service';
import { Button } from '@/ui/button';
import { Field, More } from '@/ui/field';
import { PROJECT_STATUS_LABEL } from './copy';

// The project form (M3 contract §3.5, §4.4): what it is, a line about it,
// where it's at, a target date; visibility under More. A refused save shows
// what was typed (shown()) and focuses where to look.

const STATUSES = Object.entries(PROJECT_STATUS_LABEL).map(([value, label]) => ({ value, label }));
const VISIBILITY = [
  { value: 'household', label: 'Everyone at home' },
  { value: 'private', label: 'Just me' },
];

export function ProjectForm({
  action,
  project,
  submitLabel,
}: {
  action: FormAction;
  project?: Project;
  submitLabel: string;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  const v = (name: string, stored: string | null | undefined) => shown(state, name, stored);
  const moreTouched =
    state.status === 'error' &&
    (Boolean(errors.visibility) ||
      (state.values?.visibility ?? project?.visibility ?? 'household') !==
        (project?.visibility ?? 'household'));

  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      <Field
        name="title"
        label="What"
        required
        defaultValue={v('title', project?.title)}
        error={errors.title}
      />
      <Field
        name="summary"
        label="In a line"
        type="textarea"
        rows={2}
        defaultValue={v('summary', project?.summary)}
        hint="What it is and why, in your words."
        error={errors.summary}
      />
      <Field
        name="status"
        label="Where it’s at"
        type="select"
        required
        options={STATUSES}
        defaultValue={v('status', project?.status ?? 'idea')}
        error={errors.status}
      />
      <Field
        name="targetDate"
        label="Aiming for"
        type="date"
        defaultValue={v('targetDate', project?.targetDate)}
        hint="A date to aim for, if there is one. It shows on Forward."
        error={errors.targetDate}
      />
      <More open={moreTouched}>
        <Field
          name="visibility"
          label="Who can see this"
          type="select"
          required
          options={VISIBILITY}
          defaultValue={v('visibility', project?.visibility ?? 'household')}
          hint="Just me keeps this out of the other adult’s HOME. Only the person who added it can change this, and not while things everyone can see point to it."
          error={errors.visibility}
        />
      </More>
      <FormMessage state={state} />
      <div className="mt-8">
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
