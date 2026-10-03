import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db/create';
import { createEvent, listEvents, updateEvent } from '@/domain/events/service';
import { createNote, listNotes } from '@/domain/notes/service';
import { createPerson, listPeople } from '@/domain/people/service';
import { createProject, listProjects } from '@/domain/projects/service';
import { createTask, listTasks, updateTask } from '@/domain/tasks/service';
import { systemActor, type UserActor } from '@/trust/actor';
import { listAudit, recordAudit } from '@/trust/audit';
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

/**
 * Drops a scratch database once its connections are gone. `pool.end()`
 * resolves before its clients' sockets close, so a forced drop straight after
 * would kill a backend that is still disconnecting and surface as an
 * unhandled 57P01 on that client. Force is kept only as a last resort.
 */
async function dropDatabase(name: string) {
  for (let i = 0; i < 50; i++) {
    const r = await admin.db.execute(
      sql`select count(*)::int as n from pg_stat_activity where datname = ${name}`,
    );
    if (r.rows[0]?.n === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
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
      await dropDatabase(name);
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
      ['origin_capture_id', 'uuid', 'YES', null], // added by 0005
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
      ['origin_capture_id', 'uuid', 'YES', null], // added by 0005
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
      ['origin_capture_id', 'uuid', 'YES', null], // added by 0005
    ]);
  });

  it('note', async () => {
    expect(await columnsOf('note')).toEqual([
      ...COMMON,
      ['body', 'text', 'NO', null],
      ['subject_type', 'text', 'YES', null],
      ['subject_id', 'uuid', 'YES', null],
      ['origin_capture_id', 'uuid', 'YES', null], // added by 0005
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
      'event.origin_capture_id -> capture SET NULL', // 0005
      'event_person.created_by -> user RESTRICT',
      'event_person.event_id -> event CASCADE',
      'event_person.person_id -> person CASCADE',
      'note.created_by -> user RESTRICT',
      'note.origin_capture_id -> capture SET NULL', // 0005
      'project.created_by -> user RESTRICT',
      'project.origin_capture_id -> capture SET NULL', // 0005
      'task.about_person_id -> person SET NULL',
      'task.assignee_person_id -> person SET NULL',
      'task.created_by -> user RESTRICT',
      'task.origin_capture_id -> capture SET NULL', // 0005
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
      'event_origin_capture_id_idx', // 0005
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
      'note_origin_capture_id_idx', // 0005
      'note_pkey',
      'note_subject_idx',
      'note_visibility_created_by_idx',
      'project_archived_at_idx',
      'project_created_by_idx',
      'project_origin_capture_id_idx', // 0005
      'project_pkey',
      'project_visibility_created_by_idx',
      'task_about_person_id_idx',
      'task_archived_at_idx',
      'task_assignee_person_id_idx',
      'task_created_by_idx',
      'task_origin_capture_id_idx', // 0005
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
        sql`select source, all_day, visibility from event where title = 'E' and created_at = now() order by all_day`,
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
      const r = await tx.execute(
        sql`select rrule, exdates from event where source = 'synced' and created_at = now()`,
      );
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
      const left = await tx.execute(
        sql`select count(*)::int as n from event_person where event_id = ${ids.event}`,
      );
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
        // now() is this transaction's start: only the rows this test inserted.
        sql`select status, needs from task where title = 'T' and created_at = now() order by estimate_minutes nulls last`,
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
      await dropDatabase(name);
    }
  });
});

// 0005: capture, context, proposal; origin_capture_id on event, project,
// task, note (Package 4a, migration only)
// ---------------------------------------------------------------------------

const TABLES_0005 = ['capture', 'context', 'proposal'];
const ORIGIN_TABLES = ['event', 'project', 'task', 'note'];
const PRIVATE_COMMON: Col[] = COMMON.map((c) =>
  c[0] === 'visibility' ? ['visibility', 'text', 'NO', "'private'::text"] : c,
);

describe('0005: tables and columns', () => {
  it('capture: private common fields; verbatim text; organisation recorded beside it', async () => {
    expect(await columnsOf('capture')).toEqual([
      ...PRIVATE_COMMON,
      ['text', 'text', 'NO', null],
      ['channel', 'text', 'NO', null],
      ['message_id', 'uuid', 'YES', null],
      ['status', 'text', 'NO', "'new'::text"],
      ['organised_into', 'jsonb', 'NO', "'[]'::jsonb"],
      ['organised_at', TS, 'YES', null],
      ['dismissed_at', TS, 'YES', null],
    ]);
  });

  it('context: subject, content, source, confirmation, validity, sensitivity and status', async () => {
    expect(await columnsOf('context')).toEqual([
      ...COMMON,
      ['origin_capture_id', 'uuid', 'YES', null],
      ['subject_type', 'text', 'NO', null],
      ['subject_id', 'uuid', 'YES', null],
      ['content', 'text', 'NO', null],
      ['category', 'text', 'NO', null],
      ['source_type', 'text', 'NO', null],
      ['source_user_id', 'text', 'NO', null],
      ['source_ref', 'uuid', 'YES', null],
      ['last_confirmed_at', TS, 'NO', 'now()'],
      ['valid_until', 'date', 'YES', null],
      ['sensitivity', 'text', 'NO', "'normal'::text"],
      ['status', 'text', 'NO', "'active'::text"],
      ['retired_at', TS, 'YES', null],
    ]);
  });

  it('proposal: private to its requester, with expiry, decision and execution result', async () => {
    expect(await columnsOf('proposal')).toEqual([
      ...PRIVATE_COMMON,
      ['conversation_id', 'uuid', 'YES', null],
      ['requested_by_user_id', 'text', 'NO', null],
      ['capture_id', 'uuid', 'YES', null],
      ['action', 'text', 'NO', null],
      ['payload', 'jsonb', 'NO', null],
      ['summary', 'text', 'NO', null],
      ['status', 'text', 'NO', "'pending'::text"],
      ['expires_at', TS, 'NO', "(now() + '7 days'::interval)"],
      ['decided_by', 'text', 'YES', null],
      ['decided_at', TS, 'YES', null],
      ['decided_channel', 'text', 'YES', null],
      ['result_ref', 'jsonb', 'YES', null],
      ['failure_reason', 'text', 'YES', null],
    ]);
  });

  it('adds a nullable origin_capture_id, with no default, as the last column of event, project, task and note', async () => {
    for (const t of ORIGIN_TABLES)
      expect((await columnsOf(t)).at(-1), t).toEqual(['origin_capture_id', 'uuid', 'YES', null]);
  });

  it('no conversation or message tables yet, so no foreign key on message_id or conversation_id (Package 5)', async () => {
    const r = await db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('conversation', 'message')`);
    expect(r.rows).toEqual([]);
  });
});

describe('0005: constraints, foreign keys, indexes and trigger', () => {
  const checksOf = async (table: string) =>
    (
      await db.execute(
        sql`select conname from pg_constraint where conrelid = ${table}::regclass and contype = 'c' order by 1`,
      )
    ).rows.map((r) => r.conname);

  it('has the CHECK constraints for every enum, shape and state rule', async () => {
    expect(await checksOf('capture')).toEqual([
      'capture_channel_check',
      'capture_created_by_check',
      'capture_created_via_check',
      'capture_dismissed_check',
      'capture_organised_check',
      'capture_organised_into_check',
      'capture_status_check',
      'capture_text_check',
      'capture_visibility_check',
    ]);
    expect(await checksOf('context')).toEqual([
      'context_category_check',
      'context_content_check',
      'context_created_via_check',
      'context_retired_check',
      'context_sensitivity_check',
      'context_source_type_check',
      'context_status_check',
      'context_subject_check',
      'context_subject_type_check',
      'context_visibility_check',
    ]);
    expect(await checksOf('proposal')).toEqual([
      'proposal_action_check',
      'proposal_created_via_check',
      'proposal_decided_channel_check',
      'proposal_decider_check',
      'proposal_expiry_check',
      'proposal_failure_reason_check',
      'proposal_payload_check',
      'proposal_requester_check',
      'proposal_status_check',
      'proposal_status_shape_check',
      'proposal_summary_check',
      'proposal_visibility_check',
    ]);
    // No new CHECK on an existing table.
    for (const t of ORIGIN_TABLES)
      expect(
        (await checksOf(t)).filter((c) => String(c).includes('origin')),
        t,
      ).toEqual([]);
  });

  it('has exactly these foreign keys and delete rules (§4.4: provenance SET NULL, users RESTRICT)', async () => {
    const r = await admin.db.execute(sql`
      select tc.table_name, kcu.column_name, ccu.table_name as target, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu using (constraint_schema, constraint_name)
      join information_schema.referential_constraints rc using (constraint_schema, constraint_name)
      join information_schema.constraint_column_usage ccu using (constraint_schema, constraint_name)
      where tc.constraint_type = 'FOREIGN KEY'
        and (tc.table_name in ('capture', 'context', 'proposal') or kcu.column_name = 'origin_capture_id')
      order by 1, 2`);
    expect(
      r.rows.map((x) => `${x.table_name}.${x.column_name} -> ${x.target} ${x.delete_rule}`),
    ).toEqual([
      'capture.created_by -> user RESTRICT',
      'context.created_by -> user RESTRICT',
      'context.origin_capture_id -> capture SET NULL',
      'context.source_user_id -> user RESTRICT',
      'event.origin_capture_id -> capture SET NULL',
      'note.origin_capture_id -> capture SET NULL',
      'project.origin_capture_id -> capture SET NULL',
      'proposal.capture_id -> capture SET NULL',
      'proposal.created_by -> user RESTRICT',
      'proposal.decided_by -> user RESTRICT',
      'proposal.requested_by_user_id -> user RESTRICT',
      'task.origin_capture_id -> capture SET NULL',
    ]);
  });

  it('indexes every foreign key and future one, (visibility, created_by), archived_at and the purge clock', async () => {
    const r = await db.execute(sql`
      select indexname from pg_indexes
      where tablename in ('capture', 'context', 'proposal') or indexname like '%origin_capture_id%'
      order by tablename, indexname`);
    expect(r.rows.map((x) => x.indexname)).toEqual([
      'capture_archived_at_idx',
      'capture_created_by_status_idx',
      'capture_dismissed_at_idx',
      'capture_message_id_idx',
      'capture_pkey',
      'capture_visibility_created_by_idx',
      'context_archived_at_idx',
      'context_created_by_idx',
      'context_origin_capture_id_idx',
      'context_pkey',
      'context_source_user_id_idx',
      'context_subject_idx',
      'context_visibility_created_by_idx',
      'event_origin_capture_id_idx',
      'note_origin_capture_id_idx',
      'project_origin_capture_id_idx',
      'proposal_archived_at_idx',
      'proposal_capture_id_idx',
      'proposal_conversation_id_idx',
      'proposal_created_by_idx',
      'proposal_decided_by_idx',
      'proposal_pkey',
      'proposal_requested_by_status_idx',
      'proposal_visibility_created_by_idx',
      'task_origin_capture_id_idx',
    ]);
  });

  it('has one row trigger on capture, owned by the migration role, and no unique index on an existing table', async () => {
    const t = await admin.db.execute(sql`
      select tgname, tgenabled, pg_get_userbyid(p.proowner) as owner
      from pg_trigger g join pg_proc p on p.oid = g.tgfoid
      where tgrelid = 'capture'::regclass and not tgisinternal`);
    expect(t.rows).toEqual([
      {
        tgname: 'capture_source_immutable',
        tgenabled: 'O',
        owner: expect.not.stringMatching(/^home_app$/),
      },
    ]);
    const u = await db.execute(sql`
      select indexname from pg_indexes
      where tablename in ('event', 'project', 'task', 'note') and indexdef ilike '%unique%'
        and indexname <> tablename || '_pkey'`);
    expect(u.rows).toEqual([]);
  });
});

describe('0005: constraint behaviour for the runtime role (each case rolled back)', () => {
  const U = 'u-0005';
  const V = 'u-0005-other';
  type Ids = { capture: string; project: string; person: string };
  /** In a rolled-back transaction, as home_app: two users, a project, a person and a capture. */
  const withBase = (fn: (tx: Db, ids: Ids) => Promise<void>, as: Db = db) =>
    rolledBackAs(as, async (tx) => {
      await tx.execute(sql`insert into "user" (id, name, email) values
        (${U}, 'U', 'u-0005@example.test'), (${V}, 'V', 'v-0005@example.test')`);
      const pr = await tx.execute(
        sql`insert into project (created_by, created_via, title) values (${U}, 'ui', 'Garage') returning id`,
      );
      const pe = await tx.execute(
        sql`insert into person (created_by, created_via, name, role) values (${U}, 'ui', 'Milo', 'child') returning id`,
      );
      const c = await tx.execute(
        sql`insert into capture (created_by, created_via, text, channel) values (${U}, 'ui', 'x', 'web') returning id`,
      );
      await fn(tx, {
        capture: c.rows[0]?.id as string,
        project: pr.rows[0]?.id as string,
        person: pe.rows[0]?.id as string,
      });
    });
  /** Expects the statement to fail with this SQLSTATE, inside a savepoint so the case can go on. */
  const fails = (tx: Db, q: ReturnType<typeof sql>, code: string) =>
    expectCode(
      tx.transaction(async (sp) => {
        await sp.execute(q);
      }),
      code,
    );
  const CHECK = '23514';
  const RAISED = 'P0001';

  describe('capture', () => {
    it('stores the text exactly as given: spacing, line breaks, case, punctuation and emoji', () =>
      withBase(async (tx) => {
        const words = "  remember the WOF —\n\tand the car's tyres 🚗  \n";
        const r = await tx.execute(sql`
          insert into capture (created_by, created_via, text, channel) values (${U}, 'kev', ${words}, 'web')
          returning text, status, visibility, organised_into, organised_at, dismissed_at`);
        expect(r.rows[0]).toEqual({
          text: words,
          status: 'new',
          visibility: 'private',
          organised_into: [],
          organised_at: null,
          dismissed_at: null,
        });
      }));

    it('organising records the result beside the words and never changes them', () =>
      withBase(async (tx, ids) => {
        const ref = [{ type: 'task', id: ids.project }];
        await tx.execute(
          sql`update capture set status = 'proposed', updated_at = now() where id = ${ids.capture}`,
        );
        await tx.execute(sql`update capture set status = 'organised', organised_at = now(),
          organised_into = ${JSON.stringify(ref)}::jsonb where id = ${ids.capture}`);
        const r = await tx.execute(
          sql`select text, status, organised_into from capture where id = ${ids.capture}`,
        );
        expect(r.rows[0]).toEqual({ text: 'x', status: 'organised', organised_into: ref });
      }));

    it.each([
      ['its text', sql`text = 'rewritten'`],
      ['its text, even by a trailing space', sql`text = text || ' '`],
      ['who said it', sql`created_by = ${V}`],
      ['when it was said', sql`created_at = now() - interval '1 day'`],
      ['how it was created', sql`created_via = 'kev'`],
      ['its channel', sql`channel = 'sms'`],
    ])(
      'refuses any change to %s, for the runtime role (the trigger runs before any CHECK)',
      (_label, set) =>
        withBase(async (tx, ids) => {
          await fails(tx, sql`update capture set ${set} where id = ${ids.capture}`, RAISED);
        }),
    );

    it('keeps message_id writable, so Package 5 can attach or backfill the message', () =>
      withBase(async (tx, ids) => {
        const m = '00000000-0000-4000-8000-000000000001';
        await tx.execute(sql`update capture set message_id = ${m} where id = ${ids.capture}`);
        expect(
          (await tx.execute(sql`select message_id from capture where id = ${ids.capture}`)).rows,
        ).toEqual([{ message_id: m }]);
        await tx.execute(sql`update capture set message_id = null where id = ${ids.capture}`);
        const r = await tx.execute(
          sql`select text, message_id from capture where id = ${ids.capture}`,
        );
        expect(r.rows[0]).toEqual({ text: 'x', message_id: null });
      }));

    it('refuses changing the words even for the migration/admin role (trigger, not permission)', () =>
      withBase(async (tx, ids) => {
        await fails(
          tx,
          sql`update capture set text = 'rewritten' where id = ${ids.capture}`,
          RAISED,
        );
        await fails(
          tx,
          sql`update capture set created_via = 'kev' where id = ${ids.capture}`,
          RAISED,
        );
        // Setting the same words is not a change, and other columns stay writable.
        await tx.execute(
          sql`update capture set text = text, status = 'proposed' where id = ${ids.capture}`,
        );
      }, admin.db));

    it('can still be deleted (a later purge), clearing every provenance link to it', () =>
      withBase(async (tx, ids) => {
        const ctx = await tx.execute(sql`
          insert into context (created_by, created_via, origin_capture_id, subject_type, content, category, source_type, source_user_id, source_ref)
          values (${U}, 'kev', ${ids.capture}, 'household', 'Bins go out on Tuesday', 'routine', 'capture', ${U}, ${ids.capture})
          returning id`);
        const pr = await tx.execute(sql`
          insert into proposal (created_by, created_via, requested_by_user_id, capture_id, action, payload, summary)
          values (${U}, 'kev', ${U}, ${ids.capture}, 'task.create', '{"title":"WOF"}', 'Add a task: WOF')
          returning id`);
        for (const t of ORIGIN_TABLES)
          await tx.execute(
            sql.raw(
              `update ${t} set origin_capture_id = '${ids.capture}' where created_by = '${U}'`,
            ),
          );
        await tx.execute(sql`insert into task (created_by, created_via, title, origin_capture_id)
          values (${U}, 'kev', 'WOF', ${ids.capture})`);
        await tx.execute(sql`delete from capture where id = ${ids.capture}`);
        expect(
          (
            await tx.execute(
              sql`select origin_capture_id from context where id = ${ctx.rows[0]?.id}`,
            )
          ).rows,
        ).toEqual([{ origin_capture_id: null }]);
        expect(
          (await tx.execute(sql`select capture_id from proposal where id = ${pr.rows[0]?.id}`))
            .rows,
        ).toEqual([{ capture_id: null }]);
        for (const t of ORIGIN_TABLES) {
          const r = await tx.execute(
            sql.raw(
              `select count(*)::int as n from ${t} where origin_capture_id is not null and created_by = '${U}'`,
            ),
          );
          expect(r.rows[0]?.n, t).toBe(0);
        }
      }));

    it.each([
      ['empty text', sql`(${U}, 'ui', '', 'web')`],
      ['whitespace-only text', sql`(${U}, 'ui', ${' \n\t '}, 'web')`],
      ['an unknown channel', sql`(${U}, 'ui', 'x', 'sms')`],
      ['no author', sql`(null, 'ui', 'x', 'web')`],
      ['a sync author', sql`(${U}, 'sync', 'x', 'web')`],
    ])('refuses %s', (_label, values) =>
      withBase(async (tx) => {
        await fails(
          tx,
          sql`insert into capture (created_by, created_via, text, channel) values ${values}`,
          CHECK,
        );
      }),
    );

    it.each([
      ['household visibility', sql`visibility = 'household'`],
      ['organised with nothing organised into', sql`status = 'organised', organised_at = now()`],
      [
        'organised with no time',
        sql`status = 'organised', organised_into = '[{"type":"task","id":"00000000-0000-4000-8000-000000000000"}]'`,
      ],
      ['dismissed with no time', sql`status = 'dismissed'`],
      ['a dismissal time while not dismissed', sql`dismissed_at = now()`],
      ['an unknown status', sql`status = 'sorted'`],
      ['organised_into that is not an array', sql`organised_into = '{}'`],
      [
        'an unknown record type',
        sql`organised_into = '[{"type":"photo","id":"00000000-0000-4000-8000-000000000000"}]'`,
      ],
      ['a reference without an id', sql`organised_into = '[{"type":"task"}]'`],
      ['a reference whose id is not a uuid', sql`organised_into = '[{"type":"task","id":"42"}]'`],
      ['a reference that is not an object', sql`organised_into = '["task"]'`],
    ])('refuses %s', (_label, set) =>
      withBase(async (tx, ids) => {
        await fails(tx, sql`update capture set ${set} where id = ${ids.capture}`, CHECK);
      }),
    );

    it('a dismissed capture records when, for the 30-day purge, and clears it if undismissed', () =>
      withBase(async (tx, ids) => {
        await tx.execute(
          sql`update capture set status = 'dismissed', dismissed_at = now() where id = ${ids.capture}`,
        );
        await tx.execute(
          sql`update capture set status = 'new', dismissed_at = null where id = ${ids.capture}`,
        );
        const r = await tx.execute(
          sql`select status, dismissed_at from capture where id = ${ids.capture}`,
        );
        expect(r.rows[0]).toEqual({ status: 'new', dismissed_at: null });
      }));
  });

  describe('context', () => {
    /** Inserts a context row: sensible defaults, overridden column by column (SQL literals). */
    const ctx = (tx: Db, over: Record<string, string>) => {
      const row: Record<string, string> = {
        created_by: `'${U}'`,
        created_via: `'ui'`,
        subject_type: `'household'`,
        content: `'Enjoys dinosaurs at the moment'`,
        category: `'interest'`,
        source_type: `'manual'`,
        source_user_id: `'${U}'`,
        ...over,
      };
      return tx.execute(
        sql.raw(`insert into context (${Object.keys(row).join(', ')}) values (${Object.values(row).join(', ')})
        returning subject_type, sensitivity, status, visibility, valid_until, retired_at,
                  last_confirmed_at = now() as confirmed_now`),
      );
    };

    it('defaults to normal, active (P-6), household, confirmed now, with no expiry', () =>
      withBase(async (tx, ids) => {
        const r = await ctx(tx, { subject_type: `'person'`, subject_id: `'${ids.person}'` });
        expect(r.rows[0]).toEqual({
          subject_type: 'person',
          sensitivity: 'normal',
          status: 'active',
          visibility: 'household',
          valid_until: null,
          retired_at: null,
          confirmed_now: true,
        });
      }));

    it('accepts household context, sensitive context, a valid_until date and retirement', () =>
      withBase(async (tx) => {
        await ctx(tx, {});
        await ctx(tx, {
          sensitivity: `'sensitive'`,
          visibility: `'private'`,
          valid_until: `'2026-10-31'`,
        });
        await ctx(tx, { status: `'retired'`, retired_at: 'now()' });
        await ctx(tx, {
          subject_type: `'project'`,
          subject_id: 'gen_random_uuid()',
          category: `'other'`,
        });
      }));

    it.each([
      ['a household subject with an id', { subject_id: 'gen_random_uuid()' }],
      ['a person subject without an id', { subject_type: `'person'` }],
      ['an unknown subject type', { subject_type: `'place'`, subject_id: 'gen_random_uuid()' }],
      ['an unknown category', { category: `'mood'` }],
      ['an unknown sensitivity', { sensitivity: `'secret'` }],
      ['an unknown status', { status: `'stale'` }],
      ['retired with no time', { status: `'retired'` }],
      ['a retirement time while active', { retired_at: 'now()' }],
      ['an unknown source type', { source_type: `'inferred'` }],
      ['blank content', { content: `'   '` }],
      ['an unknown visibility', { visibility: `'everyone'` }],
    ])('refuses %s', (_label, over) =>
      withBase(async (tx) => {
        await expectCode(
          tx.transaction(async (sp) => {
            await ctx(sp as unknown as Db, over);
          }),
          CHECK,
        );
      }),
    );

    it('refuses a missing source user (who said it)', () =>
      withBase(async (tx) => {
        await expectCode(
          tx.transaction(async (sp) => {
            await ctx(sp as unknown as Db, { source_user_id: 'null' });
          }),
          '23502',
        );
      }));
  });

  describe('proposal', () => {
    /** A proposal insert: a pending task proposal, overridden column by column (SQL literals). */
    const insert = (over: Record<string, string> = {}) => {
      const row: Record<string, string> = {
        created_by: `'${U}'`,
        created_via: `'kev'`,
        requested_by_user_id: `'${U}'`,
        action: `'task.create'`,
        payload: `'{"title":"Book the WOF"}'`,
        summary: `'Add a task: book the WOF'`,
        ...over,
      };
      return sql.raw(
        `insert into proposal (${Object.keys(row).join(', ')}) values (${Object.values(row).join(', ')}) returning id`,
      );
    };
    const decided = (by = `'${U}'`, channel = `'web'`) => ({
      decided_by: by,
      decided_at: 'now()',
      decided_channel: channel,
    });
    const REF = `'[{"type":"task","id":"00000000-0000-4000-8000-000000000000"}]'`;

    it('starts pending and private, expiring exactly 7 days after creation (P-3)', () =>
      withBase(async (tx) => {
        const id = (await tx.execute(insert())).rows[0]?.id as string;
        const r = await tx.execute(sql`
          select status, visibility, expires_at - created_at = interval '7 days' as week,
                 decided_by, decided_at, decided_channel, result_ref, failure_reason
          from proposal where id = ${id}`);
        expect(r.rows[0]).toEqual({
          status: 'pending',
          visibility: 'private',
          week: true,
          decided_by: null,
          decided_at: null,
          decided_channel: null,
          result_ref: null,
          failure_reason: null,
        });
      }));

    it('records each decision with who, when, where and its outcome', () =>
      withBase(async (tx) => {
        await tx.execute(insert({ status: `'approved'`, ...decided(), result_ref: REF }));
        await tx.execute(insert({ status: `'rejected'`, ...decided() }));
        await tx.execute(
          insert({ status: `'failed'`, ...decided(), failure_reason: `'not_found'` }),
        );
        await tx.execute(insert({ status: `'expired'` }));
        await tx.execute(
          insert({ action: `'capture.dismiss'`, payload: `'{}'`, created_via: `'ui'` }),
        );
      }));

    it.each([
      ['household visibility', { visibility: `'household'` }],
      ['a requester other than the creator', { requested_by_user_id: `'${V}'` }],
      ['a sync creator', { created_via: `'sync'` }],
      ['a decider other than the requester (P-2)', { status: `'rejected'`, ...decided(`'${V}'`) }],
      ['an unknown action', { action: `'task.delete'` }],
      ['a payload that is not an object', { payload: `'[]'` }],
      ['a blank summary', { summary: `' '` }],
      ['an expiry not after creation', { expires_at: 'now()' }],
      ['an unknown decision channel', { status: `'rejected'`, ...decided(`'${U}'`, `'sms'`) }],
      [
        'free text as a failure reason',
        { status: `'failed'`, ...decided(), failure_reason: `'Could not find it'` },
      ],
      ['approved without a result', { status: `'approved'`, ...decided() }],
      ['approved without a decider', { status: `'approved'`, ...decided('null'), result_ref: REF }],
      ['rejected with a result', { status: `'rejected'`, ...decided(), result_ref: REF }],
      ['rejected with no time', { status: `'rejected'`, ...decided(), decided_at: 'null' }],
      ['failed without a reason', { status: `'failed'`, ...decided() }],
      [
        'failed with a result',
        { status: `'failed'`, ...decided(), failure_reason: `'not_found'`, result_ref: REF },
      ],
      ['pending with a decision', { ...decided() }],
      ['expired with a decision', { status: `'expired'`, ...decided() }],
      ['an unknown status', { status: `'withdrawn'` }],
    ])('refuses %s', (_label, over) =>
      withBase(async (tx) => {
        await fails(tx, insert(over), CHECK);
      }),
    );

    it('refuses a missing creator', () =>
      withBase(async (tx) => {
        await fails(tx, insert({ created_by: 'null' }), CHECK);
      }));
  });

  it('a user with captures, context or proposals cannot be deleted (RESTRICT)', () =>
    withBase(async (tx) => {
      await fails(tx, sql`delete from "user" where id = ${U}`, '23503');
    }));
});

describe('0005 upgrades the production schema (0000–0004) in place', () => {
  it('applies on top of 0004 with data the deployed app wrote, changing nothing that was there, and the deployed app keeps working', async () => {
    const name = 'home_upgrade_0005_test';
    const adminUrl = onDatabase(TEST_DATABASE_URL, name);
    const appUrl = onDatabase(TEST_APP_DATABASE_URL, name);
    await admin.db.execute(sql.raw(`drop database if exists ${name}`));
    await admin.db.execute(sql.raw(`create database ${name}`));
    const upAdmin = createDb(adminUrl);
    const upApp = createDb(appUrl);
    const production = migrationsUpTo('0004_events_projects_tasks_notes');
    const deps = { db: upApp.db };
    const sam: UserActor = {
      kind: 'user',
      userId: 'u-up5',
      email: 'sam@example.test',
      via: 'ui',
      channel: 'web',
    };
    const timed = {
      allDay: false as const,
      startsAt: '2026-10-14T15:30:00+13:00',
      endsAt: '2026-10-14T16:15:00+13:00',
      timeZone: 'UTC',
    };
    try {
      // Production today: 0000–0004, written through the deployed services.
      await migrate(upAdmin.db, { migrationsFolder: production });
      await upApp.db.execute(
        sql`insert into "user" (id, name, email) values ('u-up5', 'Sam', 'sam@example.test')`,
      );
      const milo = await createPerson(sam, { name: 'Milo', role: 'child' }, deps);
      const fence = await createProject(sam, { title: 'Back fence' }, deps);
      const swim = await createEvent(
        sam,
        { title: 'Swimming', kind: 'activity', time: timed },
        deps,
      );
      const paint = await createTask(
        sam,
        { title: 'Paint', projectId: fence.id, assigneePersonId: milo.id, needs: ['daylight'] },
        deps,
      );
      await createNote(
        sam,
        { body: 'Measure the gate', subject: { type: 'project', id: fence.id } },
        deps,
      );
      await createTask(sam, { title: 'Private', visibility: 'private' }, deps);
      await recordAudit(systemActor, { event: 'auth.sign_in' }, { db: upApp.db });

      const rows = async (t: string) =>
        (
          await upAdmin.db.execute(
            sql.raw(`select to_jsonb(r) - 'origin_capture_id' as row from ${t} r order by id`),
          )
        ).rows;
      const snapshot = async () => ({
        ...Object.fromEntries(
          await Promise.all(
            ['person', 'event', 'event_person', 'project', 'task', 'note'].map(
              async (t) => [t, await rows(t)] as const,
            ),
          ),
        ),
        audit: (await upAdmin.db.execute(sql`select * from audit_log order by at, id`)).rows,
        users: (await upAdmin.db.execute(sql`select id, email from "user" order by id`)).rows,
      });
      const before = await snapshot();
      expect(
        (await upAdmin.db.execute(sql`select to_regclass('public.capture') as t`)).rows[0]?.t,
      ).toBeNull();

      // Apply only what is new: 0005.
      await migrate(upAdmin.db, { migrationsFolder: MIGRATIONS });
      const applied = await upAdmin.db.execute(
        sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
      );
      expect(applied.rows[0]?.n).toBe(journal.entries.length);

      // Existing rows are unchanged; the only addition is an empty origin_capture_id.
      expect(await snapshot()).toEqual(before);
      for (const t of ORIGIN_TABLES) {
        const r = await upAdmin.db.execute(
          sql.raw(`select count(*)::int as n from ${t} where origin_capture_id is not null`),
        );
        expect(r.rows[0]?.n, t).toBe(0);
      }
      for (const t of TABLES_0005) {
        const r = await upAdmin.db.execute(sql.raw(`select count(*)::int as n from ${t}`));
        expect(r.rows[0]?.n, t).toBe(0);
      }

      // The runtime role reaches every new table through 0002's default privileges.
      for (const t of TABLES_0005) {
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

      // The deployed app keeps working on the upgraded schema: every 3b service
      // that inserts, returns or lists every column of a table that gained one.
      await expect(
        updateEvent(sam, swim.id, { title: 'Swimming lessons' }, deps),
      ).resolves.toMatchObject({ title: 'Swimming lessons' });
      await expect(
        createEvent(sam, { title: 'Football', kind: 'activity', time: timed }, deps),
      ).resolves.toBeDefined();
      await expect(updateTask(sam, paint.id, { status: 'done' }, deps)).resolves.toMatchObject({
        status: 'done',
      });
      await expect(createProject(sam, { title: 'Garage' }, deps)).resolves.toBeDefined();
      await expect(createNote(sam, { body: 'Buy hinges' }, deps)).resolves.toBeDefined();
      expect((await listEvents(sam, {}, deps)).map((e) => e.title).sort()).toEqual([
        'Football',
        'Swimming lessons',
      ]);
      expect((await listProjects(sam, {}, deps)).map((p) => p.title).sort()).toEqual([
        'Back fence',
        'Garage',
      ]);
      expect((await listTasks(sam, {}, deps)).map((t) => t.title).sort()).toEqual([
        'Paint',
        'Private',
      ]);
      expect(await listNotes(sam, {}, deps)).toHaveLength(2);
      expect((await listPeople(sam, {}, deps)).map((p) => p.name)).toEqual(['Milo']);
      expect((await listAudit(sam, {}, deps)).rows.length).toBeGreaterThan(0);
      await expect(
        recordAudit(systemActor, { event: 'auth.sign_out' }, { db: upApp.db }),
      ).resolves.toBeDefined();
    } finally {
      await upApp.close();
      await upAdmin.close();
      rmSync(production, { recursive: true, force: true });
      await dropDatabase(name);
    }
  });
});

/** Runs `fn` on `on` in a transaction that is always rolled back. */
async function rolledBackAs(on: Db, fn: (tx: Db) => Promise<void>) {
  const rollback = new Error('rollback');
  await on
    .transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw rollback;
    })
    .catch((e: unknown) => {
      if (e !== rollback) throw e;
    });
}
