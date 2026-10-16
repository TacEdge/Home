import { sql } from 'drizzle-orm';
import type { Db } from '@/db/create';
import type { UserActor } from '@/trust/actor';
import { LiveRefusal, RUNNER_DATABASE } from './guards.mts';
import { nonFixtureEmails, nonFixturePeople } from './fixture-names.mts';
import { SAM } from '../../tests/fixtures/users';

// The runner's database checks, before any key is used (owner decisions 3
// and 6): it is the runner's own database, it holds the fixture family and
// nothing else (people by name, accounts by their .test address), and no
// calendar connection exists. Counts only are printed.

export type FixtureCheck = Readonly<{
  people: number;
  users: number;
  calendarConnections: number;
}>;

export async function assertFixtureDatabase(db: Db): Promise<FixtureCheck> {
  const [name] = (await db.execute<{ db: string }>(sql`select current_database() as db`)).rows;
  if (name?.db !== RUNNER_DATABASE)
    throw new LiveRefusal(
      'database',
      `The connection is not the runner’s database (${RUNNER_DATABASE}).`,
    );
  const people = (await db.execute<{ name: string }>(sql`select name from person`)).rows.map(
    (r) => r.name,
  );
  const emails = (await db.execute<{ email: string }>(sql`select email from "user"`)).rows.map(
    (r) => r.email,
  );
  const [cal] = (
    await db.execute<{ n: number }>(sql`select count(*)::int as n from calendar_connection`)
  ).rows;
  const calendarConnections = Number(cal?.n ?? 0);
  if (people.length === 0)
    throw new LiveRefusal(
      'fixtures',
      'The runner’s database holds no people: seed the fixture family first.',
    );
  const strangers = nonFixturePeople(people);
  if (strangers > 0)
    throw new LiveRefusal(
      'fixtures',
      `${strangers} person record(s) are not the fixture family’s.`,
    );
  const accounts = nonFixtureEmails(emails);
  if (accounts > 0)
    throw new LiveRefusal(
      'fixtures',
      `${accounts} account(s) are not the fixture adults’ (.test) accounts.`,
    );
  if (calendarConnections > 0)
    throw new LiveRefusal(
      'fixtures',
      'The runner’s database holds a calendar connection; it must hold none.',
    );
  return Object.freeze({ people: people.length, users: emails.length, calendarConnections });
}

/** The fixture adult the probes run as (Sam), as Kev acts: a user actor `via: 'kev'`. */
export async function fixtureAdult(db: Db): Promise<UserActor> {
  const [row] = (
    await db.execute<{ id: string; email: string }>(
      sql`select id, email from "user" where email = ${SAM.email} limit 1`,
    )
  ).rows;
  if (!row)
    throw new LiveRefusal(
      'fixtures',
      'The fixture adult is missing: seed the fixture family first.',
    );
  return Object.freeze({
    kind: 'user',
    userId: row.id,
    email: row.email,
    via: 'kev',
    channel: 'web',
  });
}
