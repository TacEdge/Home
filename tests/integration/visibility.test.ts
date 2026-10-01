import { sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemActor, type UserActor } from '@/trust/actor';
import { visibleTo } from '@/trust/visibility';
import { adminDb, testDb } from './db';

// Queries run as the runtime/app role, like the application. The scratch
// table is a fixture, so the migration/admin role creates and drops it; the
// app role reaches it through migration 0002's default privileges.
const { db, close } = testDb();
const admin = adminDb();

// A table that exists only inside this test: no domain tables in M1.
const notes = pgTable('vis_test_notes', {
  id: text('id').primaryKey(),
  createdBy: text('created_by').notNull(),
  visibility: text('visibility').notNull(),
});

const sam: UserActor = {
  kind: 'user',
  userId: 'u-sam',
  email: 'sam@example.test',
  via: 'ui',
  channel: 'web',
};
const alex: UserActor = {
  kind: 'user',
  userId: 'u-alex',
  email: 'alex@example.test',
  via: 'kev',
  channel: 'web',
};

beforeAll(async () => {
  await admin.db.execute(sql`drop table if exists vis_test_notes`);
  await admin.db.execute(
    sql`create table vis_test_notes (id text primary key, created_by text not null, visibility text not null)`,
  );
  await db.insert(notes).values([
    { id: 'shared', createdBy: 'u-sam', visibility: 'household' },
    { id: 'sam-private', createdBy: 'u-sam', visibility: 'private' },
    { id: 'alex-private', createdBy: 'u-alex', visibility: 'private' },
  ]);
});
afterAll(async () => {
  await admin.db.execute(sql`drop table if exists vis_test_notes`);
  await close();
  await admin.close();
});

const idsFor = async (actor: Parameters<typeof visibleTo>[0]) =>
  (
    await db.select({ id: notes.id }).from(notes).where(visibleTo(actor, notes)).orderBy(notes.id)
  ).map((r) => r.id);

describe('visibleTo', () => {
  it('shows a creator their private records and household records', async () => {
    expect(await idsFor(sam)).toEqual(['sam-private', 'shared']);
  });

  it("never shows another user's private records", async () => {
    expect(await idsFor(alex)).toEqual(['alex-private', 'shared']);
  });

  it('shows the system actor everything', async () => {
    expect(await idsFor(systemActor)).toEqual(['alex-private', 'sam-private', 'shared']);
  });
});
