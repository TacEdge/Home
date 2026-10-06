'use client';

import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle, shown } from '@/app/_forms/state';
import { Button } from '@/ui/button';
import { Choices, Field } from '@/ui/field';
import type { PersonColour } from '@/ui/person-dot';
import { PersonName } from '@/ui/person-dot';
import { KIND_OPTIONS, PASTE_AGAIN_COPY, VISIBILITY_OPTIONS } from './copy';

// The calendar form (M4 contract §5.1): connecting a Google calendar, or
// changing one's settings. One question per line, native controls. The
// secret address is asked for once, as a password-type field, and is never
// shown again: a refused connect keeps the other answers and asks for the
// address afresh. Who can see it and whose events these usually are read in
// the same words as everywhere else in HOME.

export type CalendarFormPerson = { id: string; name: string; colour: PersonColour | null };

export type CalendarFormValues = {
  name: string;
  visibility: 'household' | 'private';
  defaultKind: string | null;
  defaultPersonIds: readonly string[];
};

export function CalendarForm({
  action,
  mode,
  people,
  current,
  submitLabel,
}: {
  action: FormAction;
  mode: 'connect' | 'edit';
  /** The people this adult may name. */
  people: readonly CalendarFormPerson[];
  current?: CalendarFormValues;
  submitLabel: string;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  const v = (name: string, stored: string | null | undefined) => shown(state, name, stored);
  const refused = state.status === 'error';
  const checked = new Set(
    refused && state.values
      ? Object.keys(state.values)
          .filter((k) => k.startsWith('people_') && k !== 'people_present')
          .map((k) => k.slice(7))
      : (current?.defaultPersonIds ?? []),
  );

  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      <Field
        name="name"
        label="Name"
        required
        defaultValue={v('name', current?.name)}
        hint="How it reads in HOME. For example, Sam’s work."
        error={errors.name}
      />
      {mode === 'connect' ? (
        <>
          <Field
            name="address"
            label="Google Calendar address"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            hint={
              refused
                ? PASTE_AGAIN_COPY
                : 'HOME uses this private address to read your calendar. It never changes anything in Google Calendar.'
            }
            error={errors.address}
          />
          <details className="mt-3">
            <summary className="text-ink-2 inline-flex min-h-11 cursor-pointer items-center underline-offset-4 hover:underline">
              Where to find the address
            </summary>
            <ol className="text-ink-2 mt-2 list-decimal space-y-1 pl-6 text-[15px]">
              <li>In Google Calendar on a computer, open Settings.</li>
              <li>Choose the calendar on the left, then Integrate calendar.</li>
              <li>Copy the Secret address in iCal format and paste it here.</li>
            </ol>
          </details>
        </>
      ) : null}
      <Field
        name="visibility"
        label="Who can see it"
        type="select"
        required
        options={VISIBILITY_OPTIONS}
        defaultValue={v('visibility', current?.visibility ?? 'household')}
        hint="Just me keeps this calendar and its events out of the other adult’s HOME."
        error={errors.visibility}
      />
      <Field
        name="defaultKind"
        label="Usual kind"
        type="select"
        options={KIND_OPTIONS}
        defaultValue={v('defaultKind', current?.defaultKind ?? '')}
        hint="What its events usually are, so they read right in HOME."
        error={errors.defaultKind}
      />
      {people.length > 0 ? (
        <Choices
          name="people"
          legend="Usually about"
          options={people.map((p) => ({
            value: p.id,
            label: <PersonName name={p.name} colour={p.colour} />,
          }))}
          checked={checked}
          hint="Shown with its events when an event names nobody itself. For a calendar everyone at home can see, only people everyone can see."
          error={errors.defaultPersonIds}
        />
      ) : null}

      <FormMessage state={state} />
      <div className="mt-8">
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
