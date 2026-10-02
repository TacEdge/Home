import { sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemActor, type UserActor } from '@/trust/actor';
import { readableBy, sensitivityFilter } from '@/trust/visibility';
import { adminDb, testDb } from './db';

// Sensitivity (D15) composes with visibility in the query layer: a sensitive
// record is excluded by default, and even when explicitly included it is
// still only visible to whoever may see the record at all.

const { db, close } = testDb();
const admin = adminDb();

const ctx = pgTable('sens_test_ctx', {
  id: text('id').primaryKey(),
  createdBy: text('created_by').notNull(),
  visibility: text('visibility').notNull(),
  sensitivity: text('sensitivity').notNull(),
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
  await admin.db.execute(sql`drop table if exists sens_test_ctx`);
  await admin.db.execute(
    sql`create table sens_test_ctx (id text primary key, created_by text not null, visibility text not null, sensitivity text not null)`,
  );
  await db.insert(ctx).values([
    { id: 'shared-normal', createdBy: 'u-sam', visibility: 'household', sensitivity: 'normal' },
    {
      id: 'shared-sensitive',
      createdBy: 'u-sam',
      visibility: 'household',
      sensitivity: 'sensitive',
    },
    {
      id: 'sam-private-sensitive',
      createdBy: 'u-sam',
      visibility: 'private',
      sensitivity: 'sensitive',
    },
    {
      id: 'alex-private-normal',
      createdBy: 'u-alex',
      visibility: 'private',
      sensitivity: 'normal',
    },
  ]);
});
afterAll(async () => {
  await admin.db.execute(sql`drop table if exists sens_test_ctx`);
  await close();
  await admin.close();
});

const idsFor = async (actor: UserActor | typeof systemActor, includeSensitive?: boolean) =>
  (
    await db
      .select({ id: ctx.id })
      .from(ctx)
      .where(readableBy(actor, ctx, { includeSensitive }))
      .orderBy(ctx.id)
  ).map((r) => r.id);

describe('sensitivity', () => {
  it('excludes sensitive records by default', async () => {
    expect(await idsFor(sam)).toEqual(['shared-normal']);
    expect(await idsFor(alex)).toEqual(['alex-private-normal', 'shared-normal']);
  });

  it('includes them only when asked, and still only within visibility', async () => {
    expect(await idsFor(sam, true)).toEqual([
      'sam-private-sensitive',
      'shared-normal',
      'shared-sensitive',
    ]);
    expect(await idsFor(alex, true)).toEqual([
      'alex-private-normal',
      'shared-normal',
      'shared-sensitive',
    ]);
  });

  it('the bare filter is a plain predicate on the column', async () => {
    const rows = await db
      .select({ id: ctx.id })
      .from(ctx)
      .where(sensitivityFilter(ctx))
      .orderBy(ctx.id);
    expect(rows.map((r) => r.id)).toEqual(['alex-private-normal', 'shared-normal']);
  });

  it('the system actor is still subject to the sensitivity default', async () => {
    expect(await idsFor(systemActor)).toEqual(['alex-private-normal', 'shared-normal']);
    expect(await idsFor(systemActor, true)).toHaveLength(4);
  });
});
