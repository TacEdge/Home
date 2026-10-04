'use client';

import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { idle } from '@/app/_forms/state';
import type { Person } from '@/domain/people/service';
import { Button } from '@/ui/button';
import { Checkbox, Field, More } from '@/ui/field';
import { Quiet } from '@/ui/page';

// The person form (M3 contract §3.4, §4.4): one question per line, native
// inputs, sensible defaults, the less-used fields under More. Private and
// the linked-person rules are explained at the point of choice, in words.

const ROLES = [
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'other', label: 'Family or friend' },
];
const COLOURS = [
  { value: '', label: 'No colour' },
  { value: 'moss', label: 'Moss' },
  { value: 'sky', label: 'Sky' },
  { value: 'sun-soft', label: 'Sun' },
  { value: 'plum', label: 'Plum' },
  { value: 'sage', label: 'Sage' },
  { value: 'mist', label: 'Mist' },
];
const VISIBILITY = [
  { value: 'household', label: 'Everyone at home' },
  { value: 'private', label: 'Just me' },
];

export function PersonForm({
  action,
  person,
  submitLabel,
}: {
  action: FormAction;
  person?: Person;
  submitLabel: string;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const linked = person?.userId != null;

  return (
    <form action={dispatch}>
      <Field name="name" label="Name" required defaultValue={person?.name} error={errors.name} />
      {linked ? (
        <div className="mt-5">
          <p className="text-ink-2 text-[15px] font-medium">Role</p>
          <p className="text-ink">Parent</p>
          <Quiet>
            This is someone&rsquo;s own record, so it stays a parent everyone at home can see.
          </Quiet>
        </div>
      ) : (
        <Field
          name="role"
          label="Role"
          type="select"
          required
          options={ROLES}
          defaultValue={person?.role ?? 'child'}
          error={errors.role}
        />
      )}
      <Field
        name="dateOfBirth"
        label="Date of birth"
        type="date"
        defaultValue={person?.dateOfBirth ?? undefined}
        hint="HOME works out their age and next birthday from this."
        error={errors.dateOfBirth}
      />
      <Field
        name="stageNote"
        label="Right now"
        type="textarea"
        rows={2}
        defaultValue={person?.stageNote ?? undefined}
        hint="A line or two about where they're at, in your words. Not a record."
        error={errors.stageNote}
      />
      <input type="hidden" name="inHousehold_present" value="1" />
      <Checkbox
        name="inHousehold"
        label="Lives at home"
        defaultChecked={person?.inHousehold ?? true}
      />

      <More>
        <Field
          name="shortName"
          label="Short name"
          defaultValue={person?.shortName ?? undefined}
          hint="What they're called day to day, if that's different."
          error={errors.shortName}
        />
        <Field
          name="relationship"
          label="Relationship"
          defaultValue={person?.relationship ?? undefined}
          hint="For example, Sam's mum."
          error={errors.relationship}
        />
        <Field
          name="colour"
          label="Colour"
          type="select"
          options={COLOURS}
          defaultValue={person?.colour ?? ''}
          hint="A soft dot beside their name."
          error={errors.colour}
        />
        {linked ? (
          <div className="mt-5">
            <p className="text-ink-2 text-[15px] font-medium">Who can see this</p>
            <p className="text-ink">Everyone at home</p>
            <Quiet>Someone&rsquo;s own record is always visible to the household.</Quiet>
          </div>
        ) : (
          <Field
            name="visibility"
            label="Who can see this"
            type="select"
            required
            options={VISIBILITY}
            defaultValue={person?.visibility ?? 'household'}
            hint="Just me keeps this person out of the other adult's HOME. Only the person who added them can change this, and not while things everyone can see point to them."
            error={errors.visibility}
          />
        )}
      </More>

      <FormMessage state={state} />
      <div className="mt-8">
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
