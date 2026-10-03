import { eq } from 'drizzle-orm';
import type { Db } from '@/db/create';
import { event, eventPerson, note, person, project, task, user } from '@/db/schema';
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
  // Children before the rows they reference.
  await db.delete(eventPerson);
  await db.delete(note);
  await db.delete(task);
  await db.delete(event);
  await db.delete(project);
  await db.delete(person);
}
