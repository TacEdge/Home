import { boolean, check, date, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { commonColumns, CREATED_VIA, oneOf, VISIBILITY } from './common';

// A member of the family or the wider circle (FAMILY-DATA-MODEL §3, Person).
// A lightweight profile, never a development record: no measurements,
// assessments or observations (CLAUDE.md rule 11). `user_id` links the person
// to their login (ADR 0005, D-M2-2); Better Auth's own tables are untouched.

export const PERSON_ROLES = ['parent', 'child', 'other'] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

/** Soft person hues (docs/BRAND.md §03). M3 maps the keys to tokens. */
export const PERSON_COLOURS = ['moss', 'sky', 'sun-soft', 'plum', 'sage', 'mist'] as const;
export type PersonColour = (typeof PERSON_COLOURS)[number];

export const person = pgTable(
  'person',
  {
    ...commonColumns(user.id),
    name: text('name').notNull(),
    shortName: text('short_name'),
    role: text('role').notNull(),
    relationship: text('relationship'),
    inHousehold: boolean('in_household').notNull().default(true),
    dateOfBirth: date('date_of_birth'),
    stageNote: text('stage_note'),
    colour: text('colour'),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('person_created_via_check', oneOf(t.createdVia, CREATED_VIA)),
    check('person_visibility_check', oneOf(t.visibility, VISIBILITY)),
    check('person_role_check', oneOf(t.role, PERSON_ROLES)),
    check('person_colour_check', oneOf(t.colour, PERSON_COLOURS)),
    uniqueIndex('person_user_id_unique').on(t.userId),
    index('person_created_by_idx').on(t.createdBy),
    index('person_visibility_created_by_idx').on(t.visibility, t.createdBy),
    index('person_archived_at_idx').on(t.archivedAt),
  ],
);

export type PersonRow = typeof person.$inferSelect;
export type NewPersonRow = typeof person.$inferInsert;
