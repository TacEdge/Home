import type { ConnectCalendarInput, UpdateCalendarInput } from '@/domain/calendar/inputs';
import { choiceOf, requiredTextOf } from '@/app/_forms/read';

// The calendar forms, read into the shared Zod schemas' shapes (M4 contract
// §5.1). Pure: the service validates and enforces every rule. Default people
// come as one checkbox per person (`people_<id>`), like other choices; the
// `people_present` marker says the question was shown, so an edit that did
// not show it leaves the people alone.

const peopleOf = (form: FormData): string[] | undefined => {
  if (!form.has('people_present')) return undefined;
  const ids: string[] = [];
  for (const [k, v] of form.entries())
    if (k.startsWith('people_') && k !== 'people_present' && v === 'on') ids.push(k.slice(7));
  return ids;
};

const kindOf = (form: FormData) => {
  const k = choiceOf(form, 'defaultKind');
  return k === undefined ? undefined : k === '' ? null : k;
};

export function readNewCalendar(form: FormData): ConnectCalendarInput {
  return {
    address: requiredTextOf(form, 'address'),
    name: requiredTextOf(form, 'name'),
    visibility: (choiceOf(form, 'visibility') ?? 'household') as ConnectCalendarInput['visibility'],
    defaultKind: (kindOf(form) ?? null) as ConnectCalendarInput['defaultKind'],
    defaultPersonIds: peopleOf(form) ?? [],
  };
}

export function readCalendarPatch(form: FormData): UpdateCalendarInput {
  const patch: UpdateCalendarInput = {
    name: form.has('name') ? requiredTextOf(form, 'name') : undefined,
    visibility: choiceOf(form, 'visibility') as UpdateCalendarInput['visibility'],
    defaultKind: kindOf(form) as UpdateCalendarInput['defaultKind'],
    defaultPersonIds: peopleOf(form),
  };
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as UpdateCalendarInput;
}

export const readAddress = (form: FormData) => ({ address: requiredTextOf(form, 'address') });
