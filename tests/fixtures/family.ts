import type { CreatePersonInput } from '@/domain/people/schema';

// The synthetic fixture family (docs/concepts/README.md, D18, D-M2-8) as
// domain inputs, never display strings. Scenario date: Wednesday 14 October
// 2026, Pacific/Auckland. Milo is 9 and Isla 6 on that date; Nana Jo's
// birthday is 20 October. No real person, place or date appears here.

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

// Canary private records (M2 contract §7): one per adult per user-facing
// type, each with a distinctive synthetic string the privacy suite searches
// for. If a canary string ever appears in the other adult's results, or in
// any audit row, a leak exists.
export const CANARY = {
  sam: {
    person: {
      name: 'canary-sam-person-7f3a',
      role: 'other',
      inHousehold: false,
      relationship: 'canary-sam-relationship-7f3a',
      stageNote: 'canary-sam-note-7f3a',
      visibility: 'private',
    },
  },
  alex: {
    person: {
      name: 'canary-alex-person-2b9c',
      role: 'other',
      inHousehold: false,
      relationship: 'canary-alex-relationship-2b9c',
      stageNote: 'canary-alex-note-2b9c',
      visibility: 'private',
    },
  },
} as const satisfies Record<'sam' | 'alex', { person: CreatePersonInput }>;

export const CANARY_STRINGS = {
  sam: ['canary-sam-person-7f3a', 'canary-sam-relationship-7f3a', 'canary-sam-note-7f3a'],
  alex: ['canary-alex-person-2b9c', 'canary-alex-relationship-2b9c', 'canary-alex-note-2b9c'],
} as const;
