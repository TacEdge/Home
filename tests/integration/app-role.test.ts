import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { connectedRoleOwnsTable, RuntimeRoleError, assertRuntimeRole } from '@/db/role-check';
import { adminDb, testDb } from './db';

// Proves the runtime/app role model (contract §1.7, I5) with the same role the
// application uses: every statement here runs as home_app through testDb().
// Failures must be *permission* errors (SQLSTATE 42501) — the role check —
// not the append-only trigger, which is the second layer.

const { db, close } = testDb();
const admin = adminDb();
afterAll(async () => {
  await close();
  await admin.close();
});

async function expectPermissionDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow();
  await p.catch((e: unknown) => {
    const err = e as Error & { cause?: Error & { code?: string } };
    expect(err.cause?.code).toBe('42501');
    expect(`${err.message} ${err.cause?.message ?? ''}`).not.toMatch(/append-only/);
  });
}

describe('runtime/app role (home_app)', () => {
  it('is the role the application code under test connects as', async () => {
    const r = await db.execute(sql`select current_user as who`);
    expect(r.rows[0]?.who).toBe('home_app');
  });

  it('has no superuser, createrole, createdb or inherit attributes', async () => {
    const r = await db.execute(
      sql`select rolsuper, rolcreaterole, rolcreatedb, rolinherit from pg_roles where rolname = 'home_app'`,
    );
    expect(r.rows[0]).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolinherit: false,
    });
  });

  it('is not a member of the role that owns the schema', async () => {
    const r = await db.execute(
      sql`select pg_has_role('home_app', pg_get_userbyid(c.relowner), 'member') as member
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'audit_log'`,
    );
    expect(r.rows[0]?.member).toBe(false);
  });

  it('owns no tables, indexes, sequences, views or schemas', async () => {
    const rels = await db.execute(
      sql`select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'home_app'`,
    );
    const schemas = await db.execute(
      sql`select count(*)::int as n from pg_namespace s join pg_roles r on r.oid = s.nspowner where r.rolname = 'home_app'`,
    );
    expect(rels.rows[0]?.n).toBe(0);
    expect(schemas.rows[0]?.n).toBe(0);
  });

  it('can INSERT into and SELECT from audit_log', async () => {
    await db.execute(
      sql`insert into audit_log (actor_via, event) values ('system', 'test.app_role')`,
    );
    const r = await db.execute(
      sql`select count(*)::int as n from audit_log where event = 'test.app_role'`,
    );
    expect(r.rows[0]?.n).toBeGreaterThan(0);
  });

  it("has exactly SELECT, INSERT, UPDATE and DELETE on person, through 0002's default privileges", async () => {
    const grants = await db.execute(
      sql`select privilege_type from information_schema.role_table_grants
          where grantee = 'home_app' and table_name = 'person' order by 1`,
    );
    expect(grants.rows.map((r) => r.privilege_type)).toEqual([
      'DELETE',
      'INSERT',
      'SELECT',
      'UPDATE',
    ]);
  });

  it.each(['event', 'event_person', 'project', 'task', 'note'])(
    "has exactly SELECT, INSERT, UPDATE and DELETE on %s (0004, through 0002's default privileges)",
    async (table) => {
      const grants = await db.execute(
        sql`select privilege_type from information_schema.role_table_grants
            where grantee = 'home_app' and table_name = ${table} order by 1`,
      );
      expect(grants.rows.map((r) => r.privilege_type)).toEqual([
        'DELETE',
        'INSERT',
        'SELECT',
        'UPDATE',
      ]);
    },
  );

  it.each(['event', 'event_person', 'project', 'task', 'note'])(
    'cannot ALTER, DROP or TRUNCATE %s',
    async (table) => {
      await expectPermissionDenied(db.execute(sql.raw(`alter table ${table} add column x int`)));
      await expectPermissionDenied(db.execute(sql.raw(`drop table ${table}`)));
      await expectPermissionDenied(db.execute(sql.raw(`truncate ${table}`)));
    },
  );

  it.each(['capture', 'context', 'proposal'])(
    "has exactly SELECT, INSERT, UPDATE and DELETE on %s (0005, through 0002's default privileges)",
    async (table) => {
      const grants = await db.execute(
        sql`select privilege_type, is_grantable from information_schema.role_table_grants
            where grantee = 'home_app' and table_name = ${table} order by 1`,
      );
      expect(grants.rows).toEqual(
        ['DELETE', 'INSERT', 'SELECT', 'UPDATE'].map((privilege_type) => ({
          privilege_type,
          is_grantable: 'NO',
        })),
      );
    },
  );

  it.each(['capture', 'context', 'proposal'])(
    'cannot ALTER, DROP or TRUNCATE %s',
    async (table) => {
      await expectPermissionDenied(db.execute(sql.raw(`alter table ${table} add column x int`)));
      await expectPermissionDenied(db.execute(sql.raw(`drop table ${table}`)));
      await expectPermissionDenied(db.execute(sql.raw(`truncate ${table}`)));
    },
  );

  it('gains no column-level grants and no privileges on any other table through 0005', async () => {
    // No explicit column ACL on any table 0005 creates or alters.
    const cols = await db.execute(sql`
      select attrelid::regclass::text as table_name, attname from pg_attribute
      where attrelid = any (array['capture', 'context', 'proposal', 'event', 'project', 'task', 'note']::regclass[])
        and attacl is not null`);
    expect(cols.rows).toEqual([]);
    const tables = await db.execute(sql`
      select distinct table_name from information_schema.role_table_grants
      where grantee = 'home_app' and table_schema = 'public' order by 1`);
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'account',
      'audit_log',
      'capture',
      'context',
      'event',
      'event_person',
      'note',
      'person',
      'project',
      'proposal',
      'rate_limit',
      'session',
      'task',
      'user',
      'verification',
    ]);
  });

  it('cannot disable or drop the capture trigger that keeps the original words', async () => {
    await expectPermissionDenied(db.execute(sql`alter table capture disable trigger all`));
    await expectPermissionDenied(db.execute(sql`drop trigger capture_source_immutable on capture`));
    await expectPermissionDenied(
      db.execute(sql`create or replace function capture_source_immutable() returns trigger as $$
        begin return new; end $$ language plpgsql`),
    );
    const r = await db.execute(
      sql`select tgname, tgenabled from pg_trigger where tgrelid = 'capture'::regclass and not tgisinternal`,
    );
    expect(r.rows).toEqual([{ tgname: 'capture_source_immutable', tgenabled: 'O' }]);
  });

  it('cannot ALTER, DROP or TRUNCATE person', async () => {
    await expectPermissionDenied(db.execute(sql`alter table person add column x int`));
    await expectPermissionDenied(db.execute(sql`drop table person`));
    await expectPermissionDenied(db.execute(sql`truncate person`));
  });

  it('cannot UPDATE the new audit_log columns either (permission, not trigger)', async () => {
    await expectPermissionDenied(
      db.execute(sql`update audit_log set visibility = 'private' where event = 'test.app_role'`),
    );
    await expectPermissionDenied(
      db.execute(
        sql`update audit_log set visible_to_user_id = 'u-x' where event = 'test.app_role'`,
      ),
    );
  });

  it('cannot UPDATE audit_log rows (permission, not trigger)', async () => {
    await expectPermissionDenied(
      db.execute(sql`update audit_log set summary = 'tampered' where event = 'test.app_role'`),
    );
  });

  it('cannot DELETE audit_log rows (permission, not trigger)', async () => {
    await expectPermissionDenied(
      db.execute(sql`delete from audit_log where event = 'test.app_role'`),
    );
  });

  it('cannot TRUNCATE audit_log (permission, not trigger)', async () => {
    await expectPermissionDenied(db.execute(sql`truncate audit_log`));
  });

  it('cannot disable the audit triggers', async () => {
    await expectPermissionDenied(db.execute(sql`alter table audit_log disable trigger all`));
  });

  it('cannot drop the audit trigger', async () => {
    await expectPermissionDenied(
      db.execute(sql`drop trigger audit_log_no_update_delete on audit_log`),
    );
  });

  it('cannot ALTER the audit table', async () => {
    await expectPermissionDenied(db.execute(sql`alter table audit_log add column x int`));
  });

  it('cannot create tables in public', async () => {
    await expectPermissionDenied(db.execute(sql`create table public.intruder (id int)`));
  });

  it('the triggers are still in place afterwards', async () => {
    const r = await db.execute(
      sql`select tgname, tgenabled from pg_trigger where tgrelid = 'audit_log'::regclass and not tgisinternal order by 1`,
    );
    expect(r.rows).toEqual([
      { tgname: 'audit_log_no_truncate', tgenabled: 'O' },
      { tgname: 'audit_log_no_update_delete', tgenabled: 'O' },
    ]);
  });
});

describe('owner-role startup check', () => {
  it('sees that home_app does not own audit_log, and the owner does', async () => {
    expect(await connectedRoleOwnsTable(db, 'audit_log')).toBe(false);
    expect(await connectedRoleOwnsTable(admin.db, 'audit_log')).toBe(true);
  });

  it('refuses to start on Vercel when connected as the owner, and allows home_app', async () => {
    await expect(assertRuntimeRole(admin.db, 'production')).rejects.toThrow(RuntimeRoleError);
    await expect(assertRuntimeRole(admin.db, 'preview')).rejects.toThrow(RuntimeRoleError);
    await expect(assertRuntimeRole(db, 'production')).resolves.toBeUndefined();
    await expect(assertRuntimeRole(db, 'preview')).resolves.toBeUndefined();
  });

  it('is skipped outside Vercel (local development and tests)', async () => {
    await expect(assertRuntimeRole(admin.db, undefined)).resolves.toBeUndefined();
  });
});
