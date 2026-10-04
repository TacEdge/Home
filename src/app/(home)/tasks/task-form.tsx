'use client';

import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle, shown } from '@/app/_forms/state';
import type { Task } from '@/domain/tasks/service';
import { Button } from '@/ui/button';
import { Choices, Field, More } from '@/ui/field';
import type { PersonColour } from '@/ui/person-dot';
import { NEED_LABEL } from './copy';

// The task form (M3 contract §3.5): the title, then everything else under
// More (folded until asked for, on a new and an existing task alike): notes, project, who's doing it, who it's about, due date, how long,
// what it needs, a window, visibility. A refused save shows what was typed
// (shown()) and focuses where to look.

export type FormChoice = { id: string; name: string; colour?: PersonColour | null };
export type TaskFormDefaults = {
  projectId: string;
  windowDate: string;
  windowFrom: string;
  windowTo: string;
};

const NEEDS = Object.keys(NEED_LABEL) as (keyof typeof NEED_LABEL)[];
const VISIBILITY = [
  { value: 'household', label: 'Everyone at home' },
  { value: 'private', label: 'Just me' },
];
const MORE_FIELDS = [
  'notes',
  'projectId',
  'assigneePersonId',
  'aboutPersonId',
  'dueDate',
  'estimateMinutes',
  'needs',
  'windowDate',
  'windowFrom',
  'windowTo',
  'visibility',
];

export function TaskForm({
  action,
  task,
  projects,
  people,
  defaults,
  submitLabel,
}: {
  action: FormAction;
  task?: Task;
  projects: FormChoice[];
  people: FormChoice[];
  defaults: TaskFormDefaults;
  submitLabel: string;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  const v = (name: string, stored: string | null | undefined) => shown(state, name, stored);
  // Fold More open when a field inside was refused or changed, so nothing
  // the person typed is hidden behind it; otherwise it starts folded.
  const stored: Record<string, string> = {
    notes: task?.notes ?? '',
    projectId: task?.projectId ?? defaults.projectId,
    assigneePersonId: task?.assigneePersonId ?? '',
    aboutPersonId: task?.aboutPersonId ?? '',
    dueDate: task?.dueDate ?? '',
    estimateMinutes: task?.estimateMinutes ? String(task.estimateMinutes) : '',
    windowDate: defaults.windowDate,
    windowFrom: defaults.windowFrom,
    windowTo: defaults.windowTo,
    visibility: task?.visibility ?? 'household',
  };
  const moreTouched =
    state.status === 'error' &&
    (MORE_FIELDS.some((k) => Object.keys(errors).some((e) => e.startsWith(k))) ||
      Object.entries(stored).some(([k, v]) => (state.values?.[k] ?? v) !== v) ||
      NEEDS.some(
        (n) => (state.values?.[`needs_${n}`] === 'on') !== (task?.needs ?? []).includes(n),
      ));
  const needs = new Set(
    NEEDS.filter((n) =>
      state.status === 'error' && state.values
        ? state.values[`needs_${n}`] === 'on'
        : (task?.needs ?? []).includes(n),
    ),
  );
  const personOptions = [
    { value: '', label: 'Nobody in particular' },
    ...people.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      <Field
        name="title"
        label="What"
        required
        defaultValue={v('title', task?.title)}
        error={errors.title}
      />
      <More open={moreTouched}>
        <Field
          name="notes"
          label="Notes"
          type="textarea"
          rows={3}
          defaultValue={v('notes', task?.notes)}
          error={errors.notes}
        />
        <Field
          name="projectId"
          label="Part of"
          type="select"
          options={[
            { value: '', label: 'No project' },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
          defaultValue={v('projectId', task?.projectId ?? defaults.projectId)}
          error={errors.projectId}
        />
        <Field
          name="assigneePersonId"
          label="Who’s doing it"
          type="select"
          options={personOptions}
          defaultValue={v('assigneePersonId', task?.assigneePersonId ?? '')}
          error={errors.assigneePersonId}
        />
        <Field
          name="aboutPersonId"
          label="Who it’s about"
          type="select"
          options={personOptions}
          defaultValue={v('aboutPersonId', task?.aboutPersonId ?? '')}
          hint="For example, a form for Milo’s school."
          error={errors.aboutPersonId}
        />
        <Field
          name="dueDate"
          label="Due"
          type="date"
          defaultValue={v('dueDate', task?.dueDate)}
          error={errors.dueDate}
        />
        <Field
          name="estimateMinutes"
          label="How long, in minutes"
          type="number"
          inputMode="numeric"
          min="1"
          max="10080"
          defaultValue={v(
            'estimateMinutes',
            task?.estimateMinutes === null || task?.estimateMinutes === undefined
              ? ''
              : String(task.estimateMinutes),
          )}
          error={errors.estimateMinutes}
        />
        <Choices
          name="needs"
          legend="Needs"
          options={NEEDS.map((n) => ({ value: n, label: NEED_LABEL[n] }))}
          checked={needs}
          hint="So HOME can tell when it can happen, later."
          error={errors.needs}
        />
        <Field
          name="windowDate"
          label="A window to do it"
          type="date"
          defaultValue={v('windowDate', defaults.windowDate)}
          hint="A date and times set aside for it, if you like. Leave blank for none."
          error={errors.windowDate}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field
            name="windowFrom"
            label="From"
            type="time"
            defaultValue={v('windowFrom', defaults.windowFrom)}
            error={errors.windowFrom}
          />
          <Field
            name="windowTo"
            label="To"
            type="time"
            defaultValue={v('windowTo', defaults.windowTo)}
            error={errors.windowTo}
          />
        </div>
        <Field
          name="visibility"
          label="Who can see this"
          type="select"
          required
          options={VISIBILITY}
          defaultValue={v('visibility', task?.visibility ?? 'household')}
          hint="Just me keeps this out of the other adult’s HOME. Something private can only point at private things."
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
