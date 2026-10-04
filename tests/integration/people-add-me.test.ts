import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { auditLog, person, user } from '@/db/schema';
import { NotPermittedError } from '@/domain/common/errors';
import { createAndLinkSelf, linkSelf, createPerson } from '@/domain/people/service';
import type { UserActor } from '@/trust/actor';
import { testDb } from './db';

// "Add me" (M3 contract §3.4, ADR 0006 §28): one transaction that creates a
// household parent and links the acting user to it. Fresh users, so the
// link state other suites leave behind cannot matter here.

const { db, close } = testDb();
const deps = { db };

async function freshUser(id: string): Promise<UserActor> {
  const email = `${id}@example.test`;
  await db.insert(user).values({ id, name: id, email }).onConflictDoNothing();
  return { kind: 'user', userId: id, email, via: 'ui', channel: 'web' };
}

let one: UserActor;
let two: UserActor;
beforeAll(async () => {
  one = await freshUser('u-addme-one');
  two = await freshUser('u-addme-two');
});
afterAll(close);

const countNamed = async (name: string) =>
  Number(
    (await db.execute(sql`select count(*)::int as n from person where name = ${name}`)).rows[0]?.n,
  );

describe('createAndLinkSelf', () => {
  it('creates a household parent with the name and links the acting user, audited', async () => {
    const p = await createAndLinkSelf(one, { name: 'Add Me One' }, deps);
    expect(p).toMatchObject({
      name: 'Add Me One',
      role: 'parent',
      visibility: 'household',
      inHousehold: true,
      userId: one.userId,
      createdBy: one.userId,
      createdVia: 'ui',
    });
    const rows = await db
      .select({ event: auditLog.event })
      .from(auditLog)
      .where(eq(auditLog.subjectId, p.id))
      .orderBy(auditLog.at);
    expect(rows.map((r) => r.event)).toEqual(['person.create', 'person.link_self']);
  });

  it('is one transaction: a refused link leaves no person behind', async () => {
    // `two` is linked first, so the create-and-link must be refused whole.
    const existing = await createPerson(two, { name: 'Two Existing', role: 'parent' }, deps);
    await linkSelf(two, existing.id, deps);
    await expect(createAndLinkSelf(two, { name: 'Add Me Two' }, deps)).rejects.toMatchObject({
      code: 'already_linked',
    });
    expect(await countNamed('Add Me Two')).toBe(0);
    const [still] = await db.select().from(person).where(eq(person.userId, two.userId));
    expect(still?.id).toBe(existing.id);
  });

  it('validates the name with the shared schema and creates nothing on failure', async () => {
    await expect(createAndLinkSelf(one, { name: '   ' }, deps)).rejects.toBeInstanceOf(ZodError);
    await expect(createAndLinkSelf(one, { name: 'x'.repeat(101) }, deps)).rejects.toBeInstanceOf(
      ZodError,
    );
  });

  it('refuses Kev before touching anything', async () => {
    await expect(
      createAndLinkSelf({ ...two, via: 'kev' }, { name: 'Kev Parent' }, deps),
    ).rejects.toMatchObject(new NotPermittedError('kev_cannot_write'));
    expect(await countNamed('Kev Parent')).toBe(0);
  });
});
