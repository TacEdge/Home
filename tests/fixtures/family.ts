import type { CreateEventInput } from '@/domain/events/schema';
import type { CreateNoteInput } from '@/domain/notes/schema';
import type { CreatePersonInput } from '@/domain/people/schema';
import type { CreateProjectInput } from '@/domain/projects/schema';
import type { CreateTaskInput } from '@/domain/tasks/schema';

// The synthetic fixture family (docs/concepts/README.md, D18, D-M2-8) as
// domain inputs. Scenario date: Wednesday 14 October 2026, Pacific/Auckland:
// Milo is 9 and Isla 6 that day, and Nana Jo's birthday is 20 October. No
// real person, place or date appears here.

export const SCENARIO_TODAY = '2026-10-14';

export const FAMILY_PEOPLE = {
  sam: { name: 'Sam', role: 'parent', dateOfBirth: '1988-06-12', colour: 'moss' },
  alex: { name: 'Alex', role: 'parent', dateOfBirth: '1989-03-25', colour: 'sky' },
  milo: { name: 'Milo', role: 'child', dateOfBirth: '2017-05-03', colour: 'sun-soft' },
  isla: { name: 'Isla', role: 'child', dateOfBirth: '2020-03-11', colour: 'plum' },
  nanaJo: {
    name: 'Nana Jo',
    shortName: 'Nana',
    role: 'other',
    relationship: "Sam's mum",
    inHousehold: false,
    dateOfBirth: '1958-10-20',
  },
} as const satisfies Record<string, CreatePersonInput>;

// Canary private records (M2 contract §7): each carries distinctive synthetic
// strings, so a test can search any output for them. If one ever appears in
// the other adult's results or in any audit row, something leaks.
export const CANARY = {
  sam: {
    name: 'canary-sam-person-7f3a',
    role: 'other',
    inHousehold: false,
    relationship: 'canary-sam-relationship-7f3a',
    stageNote: 'canary-sam-note-7f3a',
    visibility: 'private',
  },
  alex: {
    name: 'canary-alex-person-2b9c',
    role: 'other',
    inHousehold: false,
    relationship: 'canary-alex-relationship-2b9c',
    stageNote: 'canary-alex-note-2b9c',
    visibility: 'private',
  },
} as const satisfies Record<'sam' | 'alex', CreatePersonInput>;

/** Every canary string for one adult, including variants tests derive with a suffix. */
export const CANARY_MARK = { sam: 'canary-sam-', alex: 'canary-alex-' } as const;

// The fixture week around the scenario date (times are NZDT, UTC+13 from
// 27 September 2026). Domain inputs only; tests attach people themselves.
export const FAMILY_EVENTS = {
  swimming: {
    title: 'Swimming',
    kind: 'activity',
    domain: 'family',
    time: {
      allDay: false,
      startsAt: '2026-10-14T15:30:00+13:00',
      endsAt: '2026-10-14T16:15:00+13:00',
      timeZone: 'Pacific/Auckland',
    },
    rrule: 'FREQ=WEEKLY;BYDAY=WE',
  },
  football: {
    title: 'Football',
    kind: 'activity',
    domain: 'family',
    time: {
      allDay: false,
      startsAt: '2026-10-17T09:00:00+13:00',
      endsAt: '2026-10-17T10:00:00+13:00',
      timeZone: 'Pacific/Auckland',
    },
    rrule: 'FREQ=WEEKLY;BYDAY=SA',
  },
  nanaJoBirthday: {
    title: "Nana Jo's birthday",
    kind: 'birthday',
    domain: 'family',
    time: { allDay: true, startDate: '2026-10-20', endDate: '2026-10-21' },
  },
} as const satisfies Record<string, CreateEventInput>;

export const FAMILY_PROJECTS = {
  backFence: { title: 'Back fence', summary: 'Paint it before summer.', status: 'active' },
  garage: { title: 'Garage', summary: 'The light needs sorting.', status: 'idea' },
} as const satisfies Record<string, CreateProjectInput>;

export const FAMILY_TASKS = {
  paintFence: {
    title: 'Paint the back fence',
    estimateMinutes: 180,
    needs: ['dry_weather', 'daylight'],
  },
  garageLight: { title: 'Sort the garage light', estimateMinutes: 30 },
} as const satisfies Record<string, CreateTaskInput>;

export const FAMILY_NOTES = {
  fenceColour: { body: 'Same green as the shed.' },
} as const satisfies Record<string, CreateNoteInput>;
