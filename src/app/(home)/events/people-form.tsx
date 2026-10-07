'use client';

import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle } from '@/app/_forms/state';
import { Button } from '@/ui/button';
import { Choices } from '@/ui/field';
import { PersonName } from '@/ui/person-dot';
import type { FormPerson } from './event-form';

// Who's going and who's responsible, as the event form asks it (M3 contract
// §3.6), on their own: for a synced event, whose other details belong to its
// calendar (M4 Package 6). Works without JavaScript.

export function PeopleForm({
  action,
  people,
  attending,
  responsible,
}: {
  action: FormAction;
  people: FormPerson[];
  attending: ReadonlySet<string>;
  responsible: ReadonlySet<string>;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  const chosen = (name: string, stored: ReadonlySet<string>) =>
    new Set(
      people
        .map((p) => p.id)
        .filter((k) =>
          state.status === 'error' && state.values
            ? state.values[`${name}_${k}`] === 'on'
            : stored.has(k),
        ),
    );
  const options = people.map((p) => ({
    value: p.id,
    label: <PersonName name={p.name} colour={p.colour} />,
  }));
  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      <Choices
        name="attending"
        legend="Who’s going"
        options={options}
        checked={chosen('attending', attending)}
        error={errors.attending}
      />
      <Choices
        name="responsible"
        legend="Who’s responsible"
        hint="Doing the drop-off or pickup, or making it happen."
        options={options}
        checked={chosen('responsible', responsible)}
        error={errors.responsible}
      />
      <FormMessage state={state} />
      <div className="mt-8">
        <Button>Save</Button>
      </div>
    </form>
  );
}
