import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db/create';
import { createPerson, listPeople } from '@/domain/people/service';
import { systemActor, type UserActor } from '@/trust/actor';
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

// ---------------------------------------------------------------------------
// 0004: event, event_person, project, task, note (Package 3a, migration only)
// ---------------------------------------------------------------------------

type Col = [name: string, type: string, nullable: 'YES' | 'NO', dflt: string | null];

async function columnsOf(table: string): Promise<Col[]> {
  const r = await db.execute(sql`
    select column_name, case when data_type = 'ARRAY' then udt_name else data_type end as t,
           is_nullable, column_default
    from information_schema.columns where table_schema = 'public' and table_name = ${table}
    order by ordinal_position`);
  return r.rows.map((c) => [c.column_name, c.t, c.is_nullable, c.column_default] as Col);
}

const TS = 'timestamp with time zone';
const COMMON: Col[] = [
  ['id', 'uuid', 'NO', 'gen_random_uuid()'],
  ['created_at', TS, 'NO', 'now()'],
  ['updated_at', TS, 'NO', 'now()'],
  ['created_by', 'text', 'YES', null],
  ['created_via', 'text', 'NO', null],
  ['visibility', 'text', 'NO', "'household'::text"],
  ['archived_at', TS, 'YES', null],
];

describe('0004: tables and columns', () => {
  it('event: common fields, provider-neutral time and sync fields', async () => {
    expect(await columnsOf('event')).toEqual([
      ...COMMON,
      ['title', 'text', 'NO', null],
      ['description', 'text', 'YES', null],
      ['location', 'text', 'YES', null],
      ['all_day', 'boolean', 'NO', 'false'],
      ['starts_at', TS, 'YES', null],
      ['ends_at', TS, 'YES', null],
      ['time_zone', 'text', 'YES', null],
      ['start_date', 'date', 'YES', null],
      ['end_date', 'date', 'YES', null],
      ['rrule', 'text', 'YES', null],
      ['exdates', '_text', 'YES', null],
      ['kind', 'text', 'NO', null],
      ['domain', 'text', 'YES', null],
      ['source', 'text', 'NO', "'manual'::text"],
      ['calendar_source_id', 'uuid', 'YES', null],
      ['external_uid', 'text', 'YES', null],
      ['external_etag', 'text', 'YES', null],
    ]);
  });

  it('event_person: an annotation with no visibility, archive or update columns', async () => {
    expect(await columnsOf('event_person')).toEqual([
      ['id', 'uuid', 'NO', 'gen_random_uuid()'],
      ['event_id', 'uuid', 'NO', null],
      ['person_id', 'uuid', 'NO', null],
      ['role', 'text', 'NO', null],
      ['created_at', TS, 'NO', 'now()'],
      ['created_by', 'text', 'YES', null],
      ['created_via', 'text', 'NO', null],
    ]);
  });

  it('project', async () => {
    expect(await columnsOf('project')).toEqual([
      ...COMMON,
      ['title', 'text', 'NO', null],
      ['summary', 'text', 'YES', null],
      ['domain', 'text', 'NO', "'home'::text"],
      ['status', 'text', 'NO', "'idea'::text"],
      ['target_date', 'date', 'YES', null],
    ]);
  });

  it('task', async () => {
    expect(await columnsOf('task')).toEqual([
      ...COMMON,
      ['title', 'text', 'NO', null],
      ['notes', 'text', 'YES', null],
      ['status', 'text', 'NO', "'open'::text"],
      ['project_id', 'uuid', 'YES', null],
      ['domain', 'text', 'YES', null],
      ['assignee_person_id', 'uuid', 'YES', null],
      ['about_person_id', 'uuid', 'YES', null],
      ['due_date', 'date', 'YES', null],
      ['estimate_minutes', 'integer', 'YES', null],
      ['needs', 'jsonb', 'NO', "'[]'::jsonb"],
      ['scheduled_starts_at', TS, 'YES', null],
      ['scheduled_ends_at', TS, 'YES', null],
      ['completed_at', TS, 'YES', null],
    ]);
  });

  it('note', async () => {
    expect(await columnsOf('note')).toEqual([
      ...COMMON,
      ['body', 'text', 'NO', null],
      ['subject_type', 'text', 'YES', null],
      ['subject_id', 'uuid', 'YES', null],
    ]);
  });

  it('no CalendarConnection or CalendarSource tables, and no foreign key on calendar_source_id (D-M2-3)', async () => {
    const r = await db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name like 'calendar%'`);
    expect(r.rows).toEqual([]);
  });
});

describe('0004: constraints and indexes', () => {
  const checksOf = async (table: string) =>
    (
      await db.execute(
        sql`select conname from pg_constraint where conrelid = ${table}::regclass and contype = 'c' order by 1`,
      )
    ).rows.map((r) => r.conname);

  it('has the CHECK constraints the contract requires', async () => {
    expect(await checksOf('event')).toEqual([
      'event_created_via_check',
      'event_domain_check',
      'event_kind_check',
      'event_source_check',
      'event_synced_check',
      'event_time_order_check',
      'event_time_shape_check',
      'event_visibility_check',
    ]);
    expect(await checksOf('event_person')).toEqual([
      'event_person_created_via_check',
      'event_person_role_check',
    ]);
    expect(await checksOf('project')).toEqual([
      'project_created_via_check',
      'project_domain_check',
      'project_status_check',
      'project_visibility_check',
    ]);
    expect(await checksOf('task')).toEqual([
      'task_created_via_check',
      'task_domain_check',
      'task_estimate_positive_check',
      'task_needs_check',
      'task_scheduled_window_check',
      'task_status_check',
      'task_visibility_check',
    ]);
    expect(await checksOf('note')).toEqual([
      'note_created_via_check',
      'note_subject_pair_check',
      'note_subject_type_check',
      'note_visibility_check',
    ]);
  });

  it('has exactly these foreign keys and delete rules (§4.4: provenance SET NULL, owned children CASCADE)', async () => {
    // information_schema shows constraint details only to the table owner.
    const r = await admin.db.execute(sql`
      select tc.table_name, kcu.column_name, ccu.table_name as target, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu using (constraint_schema, constraint_name)
      join information_schema.referential_constraints rc using (constraint_schema, constraint_name)
      join information_schema.constraint_column_usage ccu using (constraint_schema, constraint_name)
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_name in ('event', 'event_person', 'project', 'task', 'note')
      order by 1, 2`);
    expect(
      r.rows.map((x) => `${x.table_name}.${x.column_name} -> ${x.target} ${x.delete_rule}`),
    ).toEqual([
      'event.created_by -> user RESTRICT',
      'event_person.created_by -> user RESTRICT',
      'event_person.event_id -> event CASCADE',
      'event_person.person_id -> person CASCADE',
      'note.created_by -> user RESTRICT',
      'project.created_by -> user RESTRICT',
      'task.about_person_id -> person SET NULL',
      'task.assignee_person_id -> person SET NULL',
      'task.created_by -> user RESTRICT',
      'task.project_id -> project SET NULL',
    ]);
  });

  it('indexes every foreign key, (visibility, created_by), archived_at and the event time columns', async () => {
    const r = await db.execute(sql`
      select tablename, indexname from pg_indexes
      where tablename in ('event', 'event_person', 'project', 'task', 'note') order by 1, 2`);
    expect(r.rows.map((x) => x.indexname)).toEqual([
      'event_archived_at_idx',
      'event_created_by_idx',
      'event_pkey',
      'event_start_date_idx',
      'event_starts_at_idx',
      'event_visibility_created_by_idx',
      'event_person_created_by_idx',
      'event_person_event_person_role_unique',
      'event_person_person_id_idx',
      'event_person_pkey',
      'note_archived_at_idx',
      'note_created_by_idx',
      'note_pkey',
      'note_subject_idx',
      'note_visibility_created_by_idx',
      'project_archived_at_idx',
      'project_created_by_idx',
      'project_pkey',
      'project_visibility_created_by_idx',
      'task_about_person_id_idx',
      'task_archived_at_idx',
      'task_assignee_person_id_idx',
      'task_created_by_idx',
      'task_pkey',
      'task_project_id_idx',
      'task_visibility_created_by_idx',
    ]);
  });
});

describe('0004: constraint behaviour for the runtime role (each case rolled back)', () => {
  const U = 'u-0004';
  /** In a rolled-back transaction: a user, a person, a project and a timed event to hang rows on. */
  const withBase = (
    fn: (tx: Db, ids: { person: string; project: string; event: string }) => Promise<void>,
  ) =>
    rolledBack(async (tx) => {
      await tx.execute(
        sql`insert into "user" (id, name, email) values (${U}, 'U', 'u-0004@example.test')`,
      );
      const p = await tx.execute(
        sql`insert into person (created_by, created_via, name, role) values (${U}, 'ui', 'Milo', 'child') returning id`,
      );
      const pr = await tx.execute(
        sql`insert into project (created_by, created_via, title) values (${U}, 'ui', 'Back fence') returning id`,
      );
      const ev = await tx.execute(sql`
        insert into event (created_by, created_via, title, kind, starts_at, ends_at, time_zone)
        values (${U}, 'ui', 'Swimming', 'activity', '2026-10-14T02:30:00Z', '2026-10-14T03:15:00Z', 'Pacific/Auckland')
        returning id`);
      await fn(tx, {
        person: p.rows[0]?.id as string,
        project: pr.rows[0]?.id as string,
        event: ev.rows[0]?.id as string,
      });
    });
  const ev = (tx: Db, cols: string) =>
    tx.execute(
      sql.raw(`insert into event (created_by, created_via, title, kind, ${cols.split('|')[0]})
      values ('${U}', 'ui', 'E', 'other', ${cols.split('|')[1]})`),
    );

  it('event: accepts a timed and an all-day event, with defaults', () =>
    withBase(async (tx) => {
      await ev(
        tx,
        "starts_at, ends_at, time_zone|'2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z', 'Pacific/Auckland'",
      );
      await ev(tx, "all_day, start_date, end_date|true, '2026-10-14', '2026-10-15'");
      const r = await tx.execute(
        sql`select source, all_day, visibility from event where title = 'E' order by all_day`,
      );
      expect(r.rows).toEqual([
        { source: 'manual', all_day: false, visibility: 'household' },
        { source: 'manual', all_day: true, visibility: 'household' },
      ]);
    }));

  it.each([
    ['timed without a zone', "starts_at, ends_at|'2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z'"],
    [
      'timed with a date as well',
      "starts_at, ends_at, time_zone, start_date|'2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z', 'UTC', '2026-10-14'",
    ],
    [
      'all-day with an instant as well',
      "all_day, start_date, end_date, starts_at|true, '2026-10-14', '2026-10-15', '2026-10-14T00:00:00Z'",
    ],
    ['all-day with no end', "all_day, start_date|true, '2026-10-14'"],
    [
      'a timed end before its start',
      "starts_at, ends_at, time_zone|'2026-10-14T03:30:00Z', '2026-10-14T02:30:00Z', 'UTC'",
    ],
    [
      'an all-day end not after its start (the end is exclusive)',
      "all_day, start_date, end_date|true, '2026-10-14', '2026-10-14'",
    ],
    [
      'a synced event with no calendar source',
      "starts_at, ends_at, time_zone, source, external_uid|'2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z', 'UTC', 'synced', 'uid-1'",
    ],
    [
      'an unknown source',
      "starts_at, ends_at, time_zone, source|'2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z', 'UTC', 'imported'",
    ],
    [
      'an unknown domain',
      "starts_at, ends_at, time_zone, domain|'2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z', 'UTC', 'work'",
    ],
  ])('event rejects %s (CHECK)', (_label, cols) =>
    withBase(async (tx) => expectCode(ev(tx, cols), '23514')),
  );

  it('event: a synced event with a source and uid is accepted; RRULE and EXDATEs are stored as given', () =>
    withBase(async (tx) => {
      await ev(
        tx,
        "starts_at, ends_at, time_zone, source, calendar_source_id, external_uid, rrule, exdates|'2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z', 'Pacific/Auckland', 'synced', gen_random_uuid(), 'uid-1', 'FREQ=WEEKLY;BYDAY=WE', array['2026-10-21T02:30:00Z']",
      );
      const r = await tx.execute(sql`select rrule, exdates from event where source = 'synced'`);
      expect(r.rows[0]).toEqual({
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        exdates: ['2026-10-21T02:30:00Z'],
      });
    }));

  it('event_person: one row per event, person and role', () =>
    withBase(async (tx, ids) => {
      const add = (role: string) =>
        tx.execute(sql`insert into event_person (event_id, person_id, role, created_by, created_via)
          values (${ids.event}, ${ids.person}, ${role}, ${U}, 'ui')`);
      await add('attending');
      await add('responsible');
      await expectCode(add('attending'), '23505');
    }));

  it('event_person rows go when their event goes (CASCADE)', () =>
    withBase(async (tx, ids) => {
      await tx.execute(
        sql`insert into event_person (event_id, person_id, role, created_via) values (${ids.event}, ${ids.person}, 'attending', 'ui')`,
      );
      await tx.execute(sql`delete from event where id = ${ids.event}`);
      const left = await tx.execute(sql`select count(*)::int as n from event_person`);
      expect(left.rows[0]?.n).toBe(0);
    }));

  it('event_person: an unknown role is rejected', () =>
    withBase(async (tx, ids) => {
      await expectCode(
        tx.execute(
          sql`insert into event_person (event_id, person_id, role, created_via) values (${ids.event}, ${ids.person}, 'driving', 'ui')`,
        ),
        '23514',
      );
    }));

  it('event_person rows go when their person goes (CASCADE)', () =>
    withBase(async (tx, ids) => {
      await tx.execute(
        sql`insert into event_person (event_id, person_id, role, created_via) values (${ids.event}, ${ids.person}, 'attending', 'ui')`,
      );
      await tx.execute(sql`delete from person where id = ${ids.person}`);
      const left = await tx.execute(
        sql`select count(*)::int as n from event_person where event_id = ${ids.event}`,
      );
      expect(left.rows[0]?.n).toBe(0);
    }));

  it('project: defaults home and idea; rejects an unknown status or domain', () =>
    withBase(async (tx, ids) => {
      const r = await tx.execute(sql`select domain, status from project where id = ${ids.project}`);
      expect(r.rows[0]).toEqual({ domain: 'home', status: 'idea' });
      await expectCode(
        tx.execute(
          sql`insert into project (created_via, title, status) values ('ui', 'P', 'someday')`,
        ),
        '23514',
      );
    }));

  it('project: rejects an unknown domain', () =>
    withBase(async (tx) => {
      await expectCode(
        tx.execute(
          sql`insert into project (created_via, title, domain) values ('ui', 'P', 'garden')`,
        ),
        '23514',
      );
    }));

  const task = (tx: Db, cols: string, vals: string) =>
    tx.execute(
      sql.raw(
        `insert into task (created_via, title${cols ? ', ' + cols : ''}) values ('ui', 'T'${vals ? ', ' + vals : ''})`,
      ),
    );

  it('task: defaults open with no needs; accepts known needs and a full window', () =>
    withBase(async (tx) => {
      await task(
        tx,
        'needs, estimate_minutes, scheduled_starts_at, scheduled_ends_at',
        `'["dry_weather","daylight"]'::jsonb, 180, '2026-10-17T20:00:00Z', '2026-10-17T23:00:00Z'`,
      );
      await task(tx, '', '');
      const r = await tx.execute(
        sql`select status, needs from task where title = 'T' order by estimate_minutes nulls last`,
      );
      expect(r.rows).toEqual([
        { status: 'open', needs: ['dry_weather', 'daylight'] },
        { status: 'open', needs: [] },
      ]);
    }));

  it.each([
    ['an unknown need', 'needs', `'["sunshine"]'::jsonb`],
    ['needs that are not an array', 'needs', `'{"dry_weather": true}'::jsonb`],
    ['a zero estimate', 'estimate_minutes', '0'],
    ['a negative estimate', 'estimate_minutes', '-5'],
    ['a window with only a start', 'scheduled_starts_at', `'2026-10-17T20:00:00Z'`],
    [
      'a window that ends before it starts',
      'scheduled_starts_at, scheduled_ends_at',
      `'2026-10-17T20:00:00Z', '2026-10-17T19:00:00Z'`,
    ],
    ['an unknown status', 'status', `'later'`],
    ['an unknown domain', 'domain', `'work'`],
  ])('task rejects %s (CHECK)', (_label, cols, vals) =>
    withBase(async (tx) => expectCode(task(tx, cols, vals), '23514')),
  );

  it('task: deleting its project or people clears the links and keeps the task (SET NULL)', () =>
    withBase(async (tx, ids) => {
      const t = await tx.execute(sql`
        insert into task (created_via, title, project_id, assignee_person_id, about_person_id)
        values ('ui', 'Paint', ${ids.project}, ${ids.person}, ${ids.person}) returning id`);
      await tx.execute(sql`delete from project where id = ${ids.project}`);
      await tx.execute(sql`delete from person where id = ${ids.person}`);
      const r = await tx.execute(
        sql`select project_id, assignee_person_id, about_person_id from task where id = ${t.rows[0]?.id}`,
      );
      expect(r.rows[0]).toEqual({
        project_id: null,
        assignee_person_id: null,
        about_person_id: null,
      });
    }));

  it('note: a subject is a type and an id together, or neither', () =>
    withBase(async (tx, ids) => {
      await tx.execute(sql`insert into note (created_via, body) values ('ui', 'free-standing')`);
      await tx.execute(
        sql`insert into note (created_via, body, subject_type, subject_id) values ('ui', 'about', 'project', ${ids.project})`,
      );
      await expectCode(
        tx.execute(
          sql`insert into note (created_via, body, subject_type) values ('ui', 'x', 'project')`,
        ),
        '23514',
      );
    }));

  it('note: rejects an id without a type, and an unknown subject type', () =>
    withBase(async (tx, ids) => {
      await expectCode(
        tx.execute(
          sql`insert into note (created_via, body, subject_id) values ('ui', 'x', ${ids.project})`,
        ),
        '23514',
      );
    }));

  it('note: rejects an unknown subject type', () =>
    withBase(async (tx, ids) => {
      await expectCode(
        tx.execute(
          sql`insert into note (created_via, body, subject_type, subject_id) values ('ui', 'x', 'task', ${ids.project})`,
        ),
        '23514',
      );
    }));

  it('a creator who owns records cannot be deleted (RESTRICT)', () =>
    withBase(async (tx) => {
      await expectCode(tx.execute(sql`delete from "user" where id = ${U}`), '23503');
    }));
});

describe('0004 upgrades the production schema (0000–0003) in place', () => {
  it('applies on top of 0003 with existing People and audit data, changing nothing that was there', async () => {
    const name = 'home_upgrade_0004_test';
    const adminUrl = onDatabase(TEST_DATABASE_URL, name);
    const appUrl = onDatabase(TEST_APP_DATABASE_URL, name);
    await admin.db.execute(sql.raw(`drop database if exists ${name}`));
    await admin.db.execute(sql.raw(`create database ${name}`));
    const upAdmin = createDb(adminUrl);
    const upApp = createDb(appUrl);
    const production = migrationsUpTo('0003_person_and_audit_visibility');
    const sam: UserActor = {
      kind: 'user',
      userId: 'u-up4',
      email: 'sam@example.test',
      via: 'ui',
      channel: 'web',
    };
    try {
      // Production today: 0000–0003, with People written through the real service.
      await migrate(upAdmin.db, { migrationsFolder: production });
      await upApp.db.execute(
        sql`insert into "user" (id, name, email) values ('u-up4', 'Sam', 'sam@example.test')`,
      );
      await createPerson(
        sam,
        { name: 'Milo', role: 'child', dateOfBirth: '2017-05-03' },
        { db: upApp.db },
      );
      await createPerson(
        sam,
        { name: 'Private', role: 'other', visibility: 'private' },
        { db: upApp.db },
      );
      await recordAudit(systemActor, { event: 'auth.sign_in' }, { db: upApp.db });
      const snapshot = async () => ({
        people: (await upAdmin.db.execute(sql`select * from person order by id`)).rows,
        audit: (await upAdmin.db.execute(sql`select * from audit_log order by at, id`)).rows,
        users: (await upAdmin.db.execute(sql`select id, email from "user" order by id`)).rows,
      });
      const before = await snapshot();
      expect(
        (await upAdmin.db.execute(sql`select to_regclass('public.event') as t`)).rows[0]?.t,
      ).toBeNull();

      // Apply only what is new: 0004.
      await migrate(upAdmin.db, { migrationsFolder: MIGRATIONS });
      const applied = await upAdmin.db.execute(
        sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
      );
      expect(applied.rows[0]?.n).toBe(journal.entries.length);

      // Existing rows are byte-for-byte unchanged; the new tables exist and are empty.
      expect(await snapshot()).toEqual(before);
      for (const t of ['event', 'event_person', 'project', 'task', 'note']) {
        const r = await upAdmin.db.execute(sql.raw(`select count(*)::int as n from ${t}`));
        expect(r.rows[0]?.n, t).toBe(0);
      }

      // The runtime role reaches every new table through 0002's default privileges.
      for (const t of ['event', 'event_person', 'project', 'task', 'note']) {
        const g = await upApp.db.execute(
          sql.raw(`
          select has_table_privilege('home_app', '${t}', 'SELECT') as s,
                 has_table_privilege('home_app', '${t}', 'INSERT') as i,
                 has_table_privilege('home_app', '${t}', 'UPDATE') as u,
                 has_table_privilege('home_app', '${t}', 'DELETE') as d,
                 has_table_privilege('home_app', '${t}', 'TRUNCATE') as tr`),
        );
        expect(g.rows[0], t).toEqual({ s: true, i: true, u: true, d: true, tr: false });
      }

      // The deployed app keeps working on the upgraded schema: People and audit.
      await expect(
        createPerson(sam, { name: 'Isla', role: 'child' }, { db: upApp.db }),
      ).resolves.toBeDefined();
      expect((await listPeople(sam, {}, { db: upApp.db })).map((p) => p.name).sort()).toEqual([
        'Isla',
        'Milo',
        'Private',
      ]);
      await expect(
        recordAudit(systemActor, { event: 'auth.sign_out' }, { db: upApp.db }),
      ).resolves.toBeDefined();
      await expect(upAdmin.db.execute(sql`update audit_log set summary = 'x'`)).rejects.toThrow();
    } finally {
      await upApp.close();
      await upAdmin.close();
      rmSync(production, { recursive: true, force: true });
      await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
    }
  });
});
