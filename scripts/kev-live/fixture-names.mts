// The synthetic fixture family's names and addresses (docs/concepts/README.md;
// tests/fixtures/family.ts, users.ts), for the runner's and the isolation
// check's "fixture data only" tests. Counts are printed, never a name.

import {
  ARCHIVED_MARK,
  CANARY,
  CANARY_MARK,
  FAMILY_PEOPLE,
  SENSITIVE_MARK,
} from '../../tests/fixtures/family.ts';

/** Every person name the fixture seed writes. */
export const FIXTURE_PERSON_NAMES: ReadonlySet<string> = new Set([
  ...Object.values(FAMILY_PEOPLE).map((p) => p.name),
  ...Object.values(CANARY).map((p) => p.name),
]);

/** The synthetic marks the seed's canary and archived records start with. */
export const FIXTURE_PREFIXES: readonly string[] = [
  ARCHIVED_MARK,
  CANARY_MARK.sam,
  CANARY_MARK.alex,
  SENSITIVE_MARK,
];

/** The fixture adults' addresses use the reserved .test domain. */
export const FIXTURE_EMAIL_DOMAIN = '@example.test';

export function isFixturePersonName(name: string): boolean {
  return FIXTURE_PERSON_NAMES.has(name) || FIXTURE_PREFIXES.some((p) => name.startsWith(p));
}

/** How many names are not the fixture family's (the count only, never which). */
export function nonFixturePeople(names: readonly string[]): number {
  return names.filter((n) => !isFixturePersonName(n)).length;
}

export function nonFixtureEmails(emails: readonly string[]): number {
  return emails.filter((e) => !e.toLowerCase().endsWith(FIXTURE_EMAIL_DOMAIN)).length;
}
