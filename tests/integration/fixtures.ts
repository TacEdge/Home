import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/create';
import {
  calendarConnection,
  calendarSource,
  capture,
  context,
  conversation,
  event,
  eventPerson,
  insightResponse,
  note,
  person,
  project,
  proposal,
  task,
  user,
} from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { ALEX, SAM } from '../fixtures/users';

// The two fixture adults as users and actors. Domain rows reference user.id,
// so the users must exist; another suite may already have created them with
// Better Auth ids, hence the lookup by email.

export type Household = {
  sam: UserActor;
  alex: UserActor;
  /** Sam acting through Kev: reads as Sam, may never write (rule 3). */
  samViaKev: UserActor;
};

export async function ensureFixtureUsers(db: Db): Promise<Household> {
  const actorFor = async (
    fixture: { name: string; email: string },
    id: string,
  ): Promise<UserActor> => {
    await db
      .insert(user)
      .values({ id, name: fixture.name, email: fixture.email })
      .onConflictDoNothing();
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, fixture.email));
    if (!row) throw new Error('fixture user missing');
    return { kind: 'user', userId: row.id, email: fixture.email, via: 'ui', channel: 'web' };
  };
  const sam = await actorFor(SAM, 'u-sam');
  const alex = await actorFor(ALEX, 'u-alex');
  return { sam, alex, samViaKev: { ...sam, via: 'kev' } };
}

/**
 * Deletes every domain row so a suite may delete users: domain tables
 * reference user.id with ON DELETE RESTRICT (M2 contract §4.1). One line per
 * domain table, added in the package that adds the table.
 */
export async function clearDomainRows(db: Db): Promise<void> {
  // Children before the rows they reference. kev_usage is append-only and
  // references no user, so it never blocks a user delete and is left alone.
  await db.delete(insightResponse);
  await db.delete(conversation); // messages go with their conversation
  await db.delete(proposal);
  await db.delete(context);
  await db.delete(eventPerson);
  await db.delete(note);
  await db.delete(task);
  await db.delete(event);
  if (await hasCalendarTables(db)) {
    await db.delete(calendarSource);
    await db.delete(calendarConnection);
  }
  await db.delete(project);
  await db.delete(person);
  await db.delete(capture);
}

/**
 * Whether migration 0007's calendar tables exist. The previous-schema check
 * (scripts/check-previous-schema.mts) runs these suites on main's schema too,
 * which may predate them.
 */
async function hasCalendarTables(db: Db): Promise<boolean> {
  const r = await db.execute(sql`select to_regclass('public.calendar_source') is not null as ok`);
  return r.rows[0]?.ok === true;
}

/**
 * A synthetic calendar source owned by `ownerUserId`, for tests that need a
 * synced event (event.calendar_source_id references calendar_source since
 * migration 0007). The credential and fingerprint have Package 2's shapes and
 * seal nothing; `n` keeps fingerprints distinct, as one live connection may
 * hold an address. On a schema before 0007 there is no source to reference,
 * so it returns an unreferenced id, as synced events were stored then.
 */
export async function syntheticCalendarSource(
  db: Db,
  ownerUserId: string,
  n = Math.floor(Math.random() * 1e9),
): Promise<string> {
  if (!(await hasCalendarTables(db))) return crypto.randomUUID();
  const sealed = `hc1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`;
  const fingerprint = `fp1.${String(n).padStart(43, '0')}`;
  const c = await db.execute(sql`
    insert into calendar_connection (owner_user_id, provider, credentials_encrypted, credentials_key_id, address_fingerprint)
    values (${ownerUserId}, 'ics', ${sealed}, '0123456789abcdef', ${fingerprint}) returning id`);
  const s = await db.execute(sql`
    insert into calendar_source (created_by, created_via, visibility, connection_id, external_calendar_id, name)
    values (${ownerUserId}, 'ui', 'household', ${c.rows[0]?.id as string}::uuid, 'primary', 'Work')
    returning id`);
  return s.rows[0]?.id as string;
}
