import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db/create';
import { systemActor } from '@/trust/actor';
import { recordAudit } from '@/trust/audit';
import { assertTestDatabase } from '../db-guard';
import { TEST_APP_DATABASE_URL, TEST_DATABASE_URL } from '../env';
import { adminDb, testDb } from './db';

// Schema assertions: these describe the schema the migrations build, so the
// previous-schema check leaves this file out (it runs on the base's schema).

const { db, close } = testDb();
const admin = adminDb();
afterAll(async () => {
  await close();
  await admin.close();
});

const MIGRATIONS = 'src/db/migrations';
type Entry = { idx: number; tag: string };
const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
  entries: Entry[];
} & Record<string, unknown>;

/** A migrations folder holding only the migrations up to and including `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const i = journal.entries.findIndex((e) => e.tag === lastTag);
  if (i < 0) throw new Error(`no migration ${lastTag}`);
  const dir = mkdtempSync(join(tmpdir(), 'home-migrations-'));
  mkdirSync(join(dir, 'meta'));
  const entries = journal.entries.slice(0, i + 1);
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const e of entries)
    writeFileSync(join(dir, `${e.tag}.sql`), readFileSync(join(MIGRATIONS, `${e.tag}.sql`)));
  return dir;
}

/** The same URL pointed at another local *_test database. */
const onDatabase = (url: string, name: string) =>
  assertTestDatabase(url.replace(/\/[^/?]+(\?|$)/, `/${name}$1`));

/**
 * Expects a Postgres error with this SQLSTATE (Drizzle keeps it on `cause`).
 * Awaits the query exactly once: Drizzle queries are lazy, and running one
 * twice inside a transaction would report the aborted transaction instead.
 */
async function expectCode(p: PromiseLike<unknown>, code: string) {
  const error = await Promise.resolve(p).then(
    () => null,
    (e: unknown) => e as Error & { code?: string; cause?: { code?: string } },
  );
  expect(error, `expected SQLSTATE ${code}`).not.toBeNull();
  expect(error?.cause?.code ?? error?.code).toBe(code);
}

/** Runs `fn` as home_app in a transaction that is always rolled back. */
async function rolledBack(fn: (tx: Db) => Promise<void>) {
  const rollback = new Error('rollback');
  await db
    .transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw rollback;
    })
    .catch((e: unknown) => {
      if (e !== rollback) throw e;
    });
}

describe('database', () => {
  it('answers a trivial query through Drizzle', async () => {
    const rows = await db.execute(sql`select 1 as one`);
    expect(rows.rows[0]).toEqual({ one: 1 });
  });

  it('applied every migration from an empty database (global setup)', async () => {
    const rows = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const names = rows.rows.map((r) => r.table_name);
    expect(names).toEqual(expect.arrayContaining(['audit_log', 'person', 'user', 'session']));
    const applied = await admin.db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(applied.rows[0]?.n).toBe(journal.entries.length);
  });

  it('is idempotent: re-running the migrator (as the migration/admin role) makes no changes', async () => {
    await expect(migrate(admin.db, { migrationsFolder: MIGRATIONS })).resolves.toBeUndefined();
  });
});

describe('0003: person', () => {
  it('has exactly the contract columns, types, nullability and defaults', async () => {
    const r = await db.execute(sql`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns where table_schema = 'public' and table_name = 'person'
      order by ordinal_position`);
    expect(r.rows).toEqual([
      {
        column_name: 'id',
        data_type: 'uuid',
        is_nullable: 'NO',
        column_default: 'gen_random_uuid()',
      },
      {
        column_name: 'created_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
        column_default: 'now()',
      },
      {
        column_name: 'updated_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
        column_default: 'now()',
      },
      { column_name: 'created_by', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'created_via', data_type: 'text', is_nullable: 'NO', column_default: null },
      {
        column_name: 'visibility',
        data_type: 'text',
        is_nullable: 'NO',
        column_default: "'household'::text",
      },
      {
        column_name: 'archived_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      },
      { column_name: 'name', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'short_name', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'role', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'relationship', data_type: 'text', is_nullable: 'YES', column_default: null },
      {
        column_name: 'in_household',
        data_type: 'boolean',
        is_nullable: 'NO',
        column_default: 'true',
      },
      { column_name: 'date_of_birth', data_type: 'date', is_nullable: 'YES', column_default: null },
      { column_name: 'stage_note', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'colour', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'user_id', data_type: 'text', is_nullable: 'YES', column_default: null },
    ]);
  });

  it('has the CHECK constraints, foreign keys and indexes the contract lists', async () => {
    const checks = await db.execute(
      sql`select conname from pg_constraint where conrelid = 'person'::regclass and contype = 'c' order by 1`,
    );
    expect(checks.rows.map((r) => r.conname)).toEqual([
      'person_colour_check',
      'person_created_via_check',
      'person_role_check',
      'person_visibility_check',
    ]);
    // information_schema shows constraint details only to the table owner.
    const fks = await admin.db.execute(sql`
      select tc.constraint_name, kcu.column_name, rc.delete_rule, ccu.table_name as target
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu using (constraint_schema, constraint_name)
      join information_schema.referential_constraints rc using (constraint_schema, constraint_name)
      join information_schema.constraint_column_usage ccu using (constraint_schema, constraint_name)
      where tc.table_name = 'person' and tc.constraint_type = 'FOREIGN KEY' order by 1`);
    expect(fks.rows).toEqual([
      {
        constraint_name: 'person_created_by_user_id_fk',
        column_name: 'created_by',
        delete_rule: 'RESTRICT',
        target: 'user',
      },
      {
        constraint_name: 'person_user_id_user_id_fk',
        column_name: 'user_id',
        delete_rule: 'SET NULL',
        target: 'user',
      },
    ]);
    const idx = await db.execute(
      sql`select indexname, indexdef from pg_indexes where tablename = 'person' order by 1`,
    );
    expect(idx.rows.map((r) => r.indexname)).toEqual([
      'person_archived_at_idx',
      'person_created_by_idx',
      'person_pkey',
      'person_user_id_unique',
      'person_visibility_created_by_idx',
    ]);
    expect(idx.rows.find((r) => r.indexname === 'person_user_id_unique')?.indexdef).toMatch(
      /UNIQUE INDEX/,
    );
  });

  describe('enforces its rules for the runtime role (each case rolled back)', () => {
    const userA = 'u-0003-a';
    const userB = 'u-0003-b';
    const withUsers = (fn: (tx: Db) => Promise<void>) =>
      rolledBack(async (tx) => {
        await tx.execute(sql`insert into "user" (id, name, email) values
          (${userA}, 'A', 'a-0003@example.test'), (${userB}, 'B', 'b-0003@example.test')`);
        await fn(tx);
      });
    const insert = (tx: Db, values: Record<string, string | boolean | null>) => {
      const v = { created_by: userA, created_via: 'ui', name: 'Milo', role: 'child', ...values };
      const cols = Object.keys(v);
      return tx.execute(
        sql`insert into person (${sql.raw(cols.map((c) => `"${c}"`).join(', '))}) values (${sql.join(
          Object.values(v).map((x) => sql`${x}`),
          sql`, `,
        )}) returning id, visibility, in_household, created_at, updated_at, archived_at`,
      );
    };

    it('accepts a valid person and applies the defaults', () =>
      withUsers(async (tx) => {
        const r = await insert(tx, { colour: null });
        expect(r.rows[0]).toMatchObject({
          visibility: 'household',
          in_household: true,
          archived_at: null,
        });
      }));

    it.each([
      ['role', { role: 'pet' }],
      ['colour', { colour: 'red' }],
      ['visibility', { visibility: 'public' }],
      ['created_via', { created_via: 'import' }],
    ])('rejects an unknown %s (CHECK)', (_c, values) =>
      withUsers(async (tx) => expectCode(insert(tx, values), '23514')),
    );

    it('rejects a missing name or role (NOT NULL)', () =>
      withUsers(async (tx) => {
        await expectCode(
          tx.execute(sql`insert into person (created_via, role) values ('ui', 'child')`),
          '23502',
        );
      }));

    it('rejects a created_by that is not a user (FK)', () =>
      withUsers(async (tx) => expectCode(insert(tx, { created_by: 'u-nobody' }), '23503')));

    it('links at most one person per user; any number without a user', () =>
      withUsers(async (tx) => {
        await insert(tx, { user_id: userB, role: 'parent' });
        await insert(tx, { user_id: null });
        await insert(tx, { user_id: null });
        await expectCode(insert(tx, { user_id: userB, role: 'parent' }), '23505');
      }));

    it('deleting a linked user unlinks the person (SET NULL); deleting a creator is refused (RESTRICT)', () =>
      withUsers(async (tx) => {
        const r = await insert(tx, { user_id: userB, role: 'parent' });
        const id = r.rows[0]?.id as string;
        await tx.execute(sql`delete from "user" where id = ${userB}`);
        const after = await tx.execute(sql`select user_id from person where id = ${id}`);
        expect(after.rows[0]?.user_id).toBeNull();
        await expectCode(tx.execute(sql`delete from "user" where id = ${userA}`), '23503');
      }));
  });
});

describe('0003: audit_log P-1 columns', () => {
  it('adds visibility (NOT NULL, default household) and visible_to_user_id (nullable), nothing else', async () => {
    const r = await db.execute(sql`
      select column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_name = 'audit_log' order by ordinal_position`);
    expect(r.rows.map((c) => c.column_name)).toEqual([
      'id',
      'at',
      'actor_user_id',
      'actor_via',
      'actor_channel',
      'event',
      'subject_type',
      'subject_id',
      'summary',
      'meta',
      'visibility',
      'visible_to_user_id',
    ]);
    expect(r.rows.slice(-2)).toEqual([
      {
        column_name: 'visibility',
        data_type: 'text',
        is_nullable: 'NO',
        column_default: "'household'::text",
      },
      {
        column_name: 'visible_to_user_id',
        data_type: 'text',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
  });

  it("today's audit writes are unchanged: household, no owner", async () => {
    const { id } = await recordAudit(systemActor, { event: 'test.0003.unchanged' }, { db });
    const r = await db.execute(
      sql`select visibility, visible_to_user_id from audit_log where id = ${id}::uuid`,
    );
    expect(r.rows[0]).toEqual({ visibility: 'household', visible_to_user_id: null });
  });

  it('only household or private is accepted (CHECK)', async () => {
    await expectCode(
      db.execute(
        sql`insert into audit_log (actor_via, event, visibility) values ('system', 'test.0003', 'public')`,
      ),
      '23514',
    );
    await expect(
      db.execute(
        sql`insert into audit_log (actor_via, event, visibility, visible_to_user_id) values ('system', 'test.0003.private', 'private', 'u-x')`,
      ),
    ).resolves.toBeDefined();
  });

  it('the append-only triggers are still in place', async () => {
    const r = await admin.db.execute(
      sql`select tgname from pg_trigger where tgrelid = 'audit_log'::regclass and not tgisinternal order by 1`,
    );
    expect(r.rows.map((t) => t.tgname)).toEqual([
      'audit_log_no_truncate',
      'audit_log_no_update_delete',
    ]);
  });
});

describe('0003 upgrades the production schema (0000–0002) in place', () => {
  it('applies on top of 0002 with existing data, changing nothing that was there', async () => {
    const name = 'home_upgrade_test';
    const adminUrl = onDatabase(TEST_DATABASE_URL, name);
    const appUrl = onDatabase(TEST_APP_DATABASE_URL, name);
    await admin.db.execute(sql.raw(`drop database if exists ${name}`));
    await admin.db.execute(sql.raw(`create database ${name}`));
    const upAdmin = createDb(adminUrl);
    const upApp = createDb(appUrl);
    const production = migrationsUpTo('0002_app_role');
    try {
      // The production schema today, with M1-era data written by the app role.
      await migrate(upAdmin.db, { migrationsFolder: production });
      await upApp.db.execute(
        sql`insert into "user" (id, name, email) values ('u-up', 'Sam', 'sam@example.test')`,
      );
      for (const event of ['auth.sign_in', 'auth.link_requested', 'auth.sign_out'])
        await recordAudit(systemActor, { event, meta: { n: 1 } }, { db: upApp.db });
      const before = await upAdmin.db.execute(
        sql`select id, at, actor_via, event, meta from audit_log order by at, id`,
      );
      const noPerson = await upAdmin.db.execute(sql`select to_regclass('public.person') as t`);
      expect(noPerson.rows[0]?.t).toBeNull();

      // Apply only what is new: 0003.
      await migrate(upAdmin.db, { migrationsFolder: MIGRATIONS });
      const applied = await upAdmin.db.execute(
        sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
      );
      expect(applied.rows[0]?.n).toBe(journal.entries.length);

      // Existing rows are untouched, and read as household with no owner.
      const after = await upAdmin.db.execute(
        sql`select id, at, actor_via, event, meta, visibility, visible_to_user_id from audit_log order by at, id`,
      );
      const unchanged = after.rows.map((r) => {
        const copy = { ...r };
        delete copy.visibility;
        delete copy.visible_to_user_id;
        return copy;
      });
      expect(unchanged).toEqual(before.rows);
      expect(new Set(after.rows.map((r) => `${r.visibility}/${r.visible_to_user_id}`))).toEqual(
        new Set(['household/null']),
      );
      const users = await upApp.db.execute(sql`select id from "user"`);
      expect(users.rows).toEqual([{ id: 'u-up' }]);

      // The runtime role reaches the new table through 0002's default
      // privileges, because 0003 ran as the same role that ran 0002.
      const grants = await upApp.db.execute(sql`
        select has_table_privilege('home_app', 'person', 'SELECT') as s,
               has_table_privilege('home_app', 'person', 'INSERT') as i,
               has_table_privilege('home_app', 'person', 'UPDATE') as u,
               has_table_privilege('home_app', 'person', 'DELETE') as d,
               has_table_privilege('home_app', 'person', 'TRUNCATE') as t`);
      expect(grants.rows[0]).toEqual({ s: true, i: true, u: true, d: true, t: false });

      // The audit log is still append-only for everyone, owner included.
      await expect(upAdmin.db.execute(sql`update audit_log set summary = 'x'`)).rejects.toThrow();
      // And the deployed app keeps auditing on the upgraded schema.
      await expect(
        recordAudit(systemActor, { event: 'auth.sign_in' }, { db: upApp.db }),
      ).resolves.toBeDefined();
    } finally {
      await upApp.close();
      await upAdmin.close();
      rmSync(production, { recursive: true, force: true });
      await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
    }
  });
});
