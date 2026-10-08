'use client';

import { useActionState, useState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle, shown, shownChecked } from '@/app/_forms/state';
import type { Event } from '@/domain/events/service';
import { Button } from '@/ui/button';
import { Checkbox, Choices, Field, More } from '@/ui/field';
import { Quiet } from '@/ui/page';
import { PersonName, type PersonColour } from '@/ui/person-dot';
import { KIND_LABEL, WEEKDAY_SHORT } from './copy';

// The event form (M3 contract §3.6, §4.4): one question per line, native
// inputs, the less-used fields under More. Times are entered in the home
// zone (an existing event keeps its own zone). Recurrence is the approved
// model only; a custom rule from elsewhere is shown, kept and never
// rewritten. A refused save shows what was typed (shown()) and focuses
// where to look. In `occurrence` mode (M4 contract §5.3, "Change this one")
// the form is one time of a repeating event: its words, kind, place and
// time; nothing about repeating, who, part of or who can see it, which
// stay the series'.

export type FormPerson = { id: string; name: string; colour: PersonColour | null };

export type EventFormDefaults = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  repeat: string;
  weekdays: ReadonlySet<string>;
  ends: string;
  endsOn: string;
  endsAfter: string;
  attending: ReadonlySet<string>;
  responsible: ReadonlySet<string>;
};

const KINDS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
const REPEATS = [
  { value: 'none', label: 'Doesn’t repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'fortnightly', label: 'Every fortnight' },
  { value: 'monthly', label: 'Every month, same date' },
  { value: 'yearly', label: 'Every year' },
];
const ENDS = [
  { value: 'never', label: 'Never' },
  { value: 'on', label: 'On a date' },
  { value: 'after', label: 'After a number of times' },
];
const DOMAINS = [
  { value: '', label: 'Not sorted' },
  { value: 'family', label: 'Family' },
  { value: 'home', label: 'Home' },
  { value: 'us', label: 'Us' },
  { value: 'admin', label: 'Life admin' },
];
const VISIBILITY = [
  { value: 'household', label: 'Everyone at home' },
  { value: 'private', label: 'Just me' },
];

export function EventForm({
  action,
  event,
  people,
  defaults,
  submitLabel,
  initialTitle,
  occurrence = false,
}: {
  action: FormAction;
  event?: Event;
  /** One occurrence of a repeating event: no repeat, people, part-of or visibility fields. */
  occurrence?: boolean;
  /** A new event's title before anyone types (from a capture's words). */
  initialTitle?: string;
  people: FormPerson[];
  defaults: EventFormDefaults;
  submitLabel: string;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const errors = state.status === 'error' ? state.fields : {};
  const ref = useRefusalFocus<HTMLFormElement>(state);
  const v = (name: string, stored: string | null | undefined) => shown(state, name, stored);
  const custom = defaults.repeat === 'custom';
  const [allDay, setAllDay] = useState(shownChecked(state, 'allDay', defaults.allDay));
  const [repeat, setRepeat] = useState(v('repeat', defaults.repeat) ?? 'none');
  const [ends, setEnds] = useState(v('ends', defaults.ends) ?? 'never');
  const chosen = (name: string, stored: ReadonlySet<string>, keys: readonly string[]) =>
    new Set(
      keys.filter((k) =>
        state.status === 'error' && state.values
          ? state.values[`${name}_${k}`] === 'on'
          : stored.has(k),
      ),
    );
  const fieldError = (...keys: string[]) => keys.map((k) => errors[k]).find(Boolean);
  const moreTouched =
    state.status === 'error' &&
    ['location', 'description', 'domain', 'visibility'].some((k) => errors[k]);

  return (
    <form key={formKey(state)} ref={ref} action={dispatch}>
      <Field
        name="title"
        label="What"
        required
        defaultValue={v('title', event?.title ?? initialTitle)}
        error={errors.title}
      />
      <Field
        name="kind"
        label="Kind"
        type="select"
        required
        options={KINDS}
        defaultValue={v('kind', event?.kind ?? 'activity')}
        error={errors.kind}
      />

      <input type="hidden" name="allDay_present" value="1" />
      <Checkbox name="allDay" label="All day" defaultChecked={allDay} onChange={setAllDay} />
      <Field
        name="startDate"
        label={allDay ? 'First day' : 'Date'}
        type="date"
        required
        defaultValue={v('startDate', defaults.startDate)}
        error={fieldError('startDate', 'time.startDate', 'time.startsAt')}
      />
      {allDay ? null : (
        <div className="grid grid-cols-2 gap-4">
          <Field
            name="startTime"
            label="From"
            type="time"
            required
            defaultValue={v('startTime', defaults.startTime)}
            error={fieldError('startTime')}
          />
          <Field
            name="endTime"
            label="To"
            type="time"
            required
            defaultValue={v('endTime', defaults.endTime)}
            error={fieldError('endTime', 'time.endsAt')}
          />
        </div>
      )}
      <Field
        name="endDate"
        label={allDay ? 'Last day' : 'Ends on a different day'}
        type="date"
        defaultValue={v('endDate', defaults.endDate)}
        hint={
          allDay ? 'Leave blank for a single day.' : 'Only for something that runs past midnight.'
        }
        error={fieldError('endDate', 'time.endDate')}
      />

      {occurrence ? null : custom ? (
        <div className="mt-5">
          <p className="text-ink-2 text-[15px] font-medium">Repeats</p>
          <p className="text-ink">Repeats (custom)</p>
          <Quiet>
            This repeat rule came from elsewhere, so HOME keeps it as it is. Saving changes
            everything else and leaves the rule alone.
          </Quiet>
        </div>
      ) : (
        <>
          <Field
            name="repeat"
            label="Repeats"
            type="select"
            required
            options={REPEATS}
            defaultValue={repeat}
            onChange={setRepeat}
            error={errors.repeat}
          />
          {repeat === 'weekly' || repeat === 'fortnightly' ? (
            <Choices
              name="weekdays"
              legend="On"
              options={WEEKDAY_SHORT.map((label, i) => ({ value: String(i), label }))}
              checked={chosen(
                'weekdays',
                defaults.weekdays,
                WEEKDAY_SHORT.map((_, i) => String(i)),
              )}
              error={errors.weekdays}
            />
          ) : null}
          {repeat === 'monthly' ? (
            <Quiet>On the same date each month. A 29th, 30th or 31st skips shorter months.</Quiet>
          ) : null}
          {repeat !== 'none' ? (
            <>
              <Field
                name="ends"
                label="Ends"
                type="select"
                required
                options={ENDS}
                defaultValue={ends}
                onChange={setEnds}
                error={errors.ends}
              />
              {ends === 'on' ? (
                <Field
                  name="endsOn"
                  label="Last day it can happen"
                  type="date"
                  required
                  defaultValue={v('endsOn', defaults.endsOn)}
                  error={errors.endsOn}
                />
              ) : null}
              {ends === 'after' ? (
                <Field
                  name="endsAfter"
                  label="How many times"
                  type="number"
                  required
                  inputMode="numeric"
                  min="1"
                  max="1000"
                  defaultValue={v('endsAfter', defaults.endsAfter)}
                  error={errors.endsAfter}
                />
              ) : null}
              {event?.rrule ? <Quiet>Changes here apply to every time this happens.</Quiet> : null}
            </>
          ) : null}
        </>
      )}

      {people.length > 0 && !occurrence ? (
        <>
          <Choices
            name="attending"
            legend="Who’s going"
            options={people.map((p) => ({
              value: p.id,
              label: <PersonName name={p.name} colour={p.colour} />,
            }))}
            checked={chosen(
              'attending',
              defaults.attending,
              people.map((p) => p.id),
            )}
            error={errors.attending}
          />
          <Choices
            name="responsible"
            legend="Who’s responsible"
            hint="Doing the drop-off or pickup, or making it happen."
            options={people.map((p) => ({
              value: p.id,
              label: <PersonName name={p.name} colour={p.colour} />,
            }))}
            checked={chosen(
              'responsible',
              defaults.responsible,
              people.map((p) => p.id),
            )}
            error={errors.responsible}
          />
        </>
      ) : null}

      <More open={moreTouched}>
        <Field
          name="location"
          label="Where"
          defaultValue={v('location', event?.location)}
          error={errors.location}
        />
        <Field
          name="description"
          label="Details"
          type="textarea"
          rows={3}
          defaultValue={v('description', event?.description)}
          hint="Anything worth knowing about it. Notes on it live on its page."
          error={errors.description}
        />
        {occurrence ? null : (
          <>
            <Field
              name="domain"
              label="Part of"
              type="select"
              options={DOMAINS}
              defaultValue={v('domain', event?.domain ?? '')}
              error={errors.domain}
            />
            <Field
              name="visibility"
              label="Who can see this"
              type="select"
              required
              options={VISIBILITY}
              defaultValue={v('visibility', event?.visibility ?? 'household')}
              hint="Just me keeps this out of the other adult's HOME. Someone private can only be on a private event."
              error={errors.visibility}
            />
          </>
        )}
      </More>

      <FormMessage state={state} />
      <div className="mt-8">
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
