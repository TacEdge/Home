import { eq } from 'drizzle-orm';
import type { Db } from '@/db/create';
import { person, user } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { ALEX, SAM } from '../fixtures/users';

// The two fixture adults as database users and as actors. Domain rows
// reference `user.id`, so the rows must exist; the auth suite may already
// have created them with Better Auth ids, hence the lookup by email.

export type Household = {
  sam: UserActor;
  alex: UserActor;
  /** Sam acting through Kev: may read as Sam, may never write (rule 3). */
  samViaKev: UserActor;
};

/**
 * Removes every domain row so a suite may delete the fixture users. Domain
 * tables reference `user.id` with ON DELETE RESTRICT (M2 contract §4.1), so
 * this list grows by one line per entity, in the PR that adds it.
 */
export async function clearDomainRows(db: Db): Promise<void> {
  await db.delete(person);
}

export async function ensureFixtureUsers(db: Db): Promise<Household> {
  const actorFor = async (fixture: { name: string; email: string }, id: string) => {
    await db
      .insert(user)
      .values({ id, name: fixture.name, email: fixture.email })
      .onConflictDoNothing();
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, fixture.email));
    if (!row) throw new Error('fixture user missing');
    const actor: UserActor = {
      kind: 'user',
      userId: row.id,
      email: fixture.email,
      via: 'ui',
      channel: 'web',
    };
    return actor;
  };
  const sam = await actorFor(SAM, 'u-sam');
  const alex = await actorFor(ALEX, 'u-alex');
  return { sam, alex, samViaKev: { ...sam, via: 'kev' } };
}
