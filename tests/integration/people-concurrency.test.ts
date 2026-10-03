import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { person } from '@/db/schema';
import type { NotPermittedError } from '@/domain/common/errors';
import { NotFoundError } from '@/domain/common/errors';
import { archivePerson, createPerson, linkSelf, updatePerson } from '@/domain/people/service';
import type { UserActor } from '@/trust/actor';
import { testDb } from './db';

// Races the service must win (PR #17 review, contract §2.3): a write checks
// visibility in the same locked row it updates, so a concurrent change of
// visibility can never let the other adult write into a now-private record.
// Real concurrency: one connection holds a transaction open while the
// service runs on others.

const { db, pool, close } = testDb();
const deps = { db };
afterAll(close);

let sam: UserActor;
let alex: UserActor;
beforeAll(async () => {
  const mk = async (id: string, email: string): Promise<UserActor> => {
    await pool.query(
      'insert into "user" (id, name, email) values ($1, $1, $2) on conflict do nothing',
      [id, email],
    );
    return { kind: 'user', userId: id, email, via: 'ui', channel: 'web' };
  };
  sam = await mk('u-race-sam', 'race-sam@example.test');
  alex = await mk('u-race-alex', 'race-alex@example.test');
});

const settle = (p: Promise<unknown>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts `write`, while another transaction (Sam's, on its own connection)
 * has made the record private but not yet committed. Proves `write` waited
 * for it, then returns how `write` ended.
 */
async function raceAgainstGoingPrivate(id: string, write: () => Promise<unknown>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("update person set visibility = 'private' where id = $1", [id]);
    let done = false;
    const outcome = settle(write()).finally(() => (done = true));
    await sleep(300);
    expect(done, 'the write must wait for the lock').toBe(false);
    await client.query('commit');
    return await outcome;
  } finally {
    client.release();
  }
}

describe('a concurrent change to private wins over the other adult', () => {
  it('update: Alex cannot edit a record that became Sam-private while Alex was writing', async () => {
    const p = await createPerson(sam, { name: 'Race Update', role: 'other' }, deps);
    const r = await raceAgainstGoingPrivate(p.id, () =>
      updatePerson(alex, p.id, { stageNote: 'alex-wrote-this' }, deps),
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.e).toBeInstanceOf(NotFoundError);
    const [row] = await db.select().from(person).where(eq(person.id, p.id));
    expect(row).toMatchObject({ visibility: 'private', stageNote: null });
  });

  it('archive: Alex cannot archive a record that became Sam-private meanwhile', async () => {
    const p = await createPerson(sam, { name: 'Race Archive', role: 'other' }, deps);
    const r = await raceAgainstGoingPrivate(p.id, () => archivePerson(alex, p.id, deps));
    expect(r.ok ? null : r.e).toBeInstanceOf(NotFoundError);
    const [row] = await db.select().from(person).where(eq(person.id, p.id));
    expect(row?.archivedAt).toBeNull();
  });

  it('linkSelf: Alex cannot link to a parent that became private meanwhile', async () => {
    const p = await createPerson(sam, { name: 'Race Link', role: 'parent' }, deps);
    const r = await raceAgainstGoingPrivate(p.id, () => linkSelf(alex, p.id, deps));
    expect(r.ok ? null : r.e).toBeInstanceOf(NotFoundError);
    const [row] = await db.select().from(person).where(eq(person.id, p.id));
    expect(row?.userId).toBeNull();
  });

  it('the creator, by contrast, still sees and edits the now-private record', async () => {
    const p = await createPerson(sam, { name: 'Race Owner', role: 'other' }, deps);
    const r = await raceAgainstGoingPrivate(p.id, () =>
      updatePerson(sam, p.id, { stageNote: 'sam-wrote-this' }, deps),
    );
    expect(r.ok).toBe(true);
  });
});

describe('linkSelf races settle on one link', () => {
  it('two people claimed at once by the same user: exactly one link', async () => {
    const user = 'u-race-link';
    await pool.query(
      'insert into "user" (id, name, email) values ($1, $1, $2) on conflict do nothing',
      [user, 'race-link@example.test'],
    );
    const me: UserActor = {
      kind: 'user',
      userId: user,
      email: 'race-link@example.test',
      via: 'ui',
      channel: 'web',
    };
    const a = await createPerson(me, { name: 'Claim A', role: 'parent' }, deps);
    const b = await createPerson(me, { name: 'Claim B', role: 'parent' }, deps);
    const results = await Promise.all([
      settle(linkSelf(me, a.id, deps)),
      settle(linkSelf(me, b.id, deps)),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok && (failed.e as NotPermittedError).code).toBe('already_linked');
    const linked = await db.select({ id: person.id }).from(person).where(eq(person.userId, user));
    expect(linked).toHaveLength(1);
  });

  it('one person claimed at once by two users: exactly one link', async () => {
    const users = ['u-race-c1', 'u-race-c2'];
    for (const u of users)
      await pool.query(
        'insert into "user" (id, name, email) values ($1, $1, $2) on conflict do nothing',
        [u, `${u}@example.test`],
      );
    const actors = users.map((u): UserActor => ({
      kind: 'user',
      userId: u,
      email: `${u}@example.test`,
      via: 'ui',
      channel: 'web',
    }));
    const [first, second] = actors as [UserActor, UserActor];
    const p = await createPerson(first, { name: 'Contested', role: 'parent' }, deps);
    const results = await Promise.all([
      settle(linkSelf(first, p.id, deps)),
      settle(linkSelf(second, p.id, deps)),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const [row] = await db.select().from(person).where(eq(person.id, p.id));
    expect(users).toContain(row?.userId);
  });
});
