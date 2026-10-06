import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getTableName, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { auditSubjects } from '@/trust/audit-subjects';

// P-1 can only follow a record's current visibility if the Activity filter
// knows the record's table. Every table with a visibility column must be
// registered (contract §2.3 carry-forward); audit_log itself is the log.
//
// Migration-first (contract §2.1): a migration-only PR adds tables that no
// application code may use yet, and registering them would make the Activity
// query read tables production does not have until the migration runs. So a
// table may be PENDING between its migration PR and its application PR, and
// only while nothing outside src/db refers to it. The application PR that
// starts using a table registers it and removes it from this list.
const PENDING_REGISTRATION: Record<string, string> = {
  calendar_source: 'migration 0007 (M4 Package 4a); registered by the calendar service in 4b',
};

// Tables private to one user by user_id (P-1 b): registered with an
// owner-only rule although they carry no visibility column. Messages are
// audited as their conversation; each kev_usage row is its user's alone.
const OWNER_ONLY = ['conversation', 'insight_response', 'kev_usage'];

const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
const visibilityTables = tables
  .filter((t) => getTableConfig(t).columns.some((c) => c.name === 'visibility'))
  .map((t) => getTableName(t))
  .filter((name) => name !== 'audit_log')
  .sort();

/** The exported Drizzle names of a table (e.g. `eventPerson` for event_person). */
const exportNamesOf = (table: string) =>
  Object.entries(schema)
    .filter(([, v]) => is(v as never, PgTable) && getTableName(v as PgTable) === table)
    .map(([name]) => name);

/**
 * Schema exports a source file imports (named, or through a namespace) and
 * table names it uses in raw SQL after from/into/update/join.
 */
function schemaReferences(text: string): { names: string[]; tables: string[] } {
  const names: string[] = [];
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@\/db\/schema['"]/g))
    names.push(
      ...(m[1] ?? '')
        .split(',')
        .map(
          (x) =>
            x
              .trim()
              .replace(/^type\s+/, '')
              .split(/\s+as\s+/)[0] ?? '',
        )
        .filter(Boolean),
    );
  for (const m of text.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*['"]@\/db\/schema['"]/g))
    for (const use of text.matchAll(new RegExp(`\\b${m[1]}\\.(\\w+)`, 'g')))
      names.push(use[1] ?? '');
  const tables = [...text.matchAll(/\b(?:from|into|update|join)\s+"?(\w+)"?/gi)].map((x) =>
    (x[1] ?? '').toLowerCase(),
  );
  return { names, tables };
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('Activity subject registry', () => {
  it('finds the visibility-bearing tables in the schema (sanity)', () => {
    expect(visibilityTables).toContain('person');
  });

  it('registers every table with a visibility column, except those pending their application PR, plus the owner-only tables', () => {
    const expected = [
      ...visibilityTables.filter((t) => !(t in PENDING_REGISTRATION)),
      ...OWNER_ONLY,
    ].sort();
    expect(Object.keys(auditSubjects).sort()).toEqual(expected);
  });

  it('owner-only subjects have no visibility column, a user_id, and their own read rule', () => {
    for (const t of OWNER_ONLY) {
      const table = tables.find((x) => getTableName(x) === t);
      const cols = table ? getTableConfig(table).columns.map((c) => c.name) : [];
      expect(cols, t).not.toContain('visibility');
      expect(cols, t).toContain('user_id');
      expect(auditSubjects[t]?.visible, t).toBeTypeOf('function');
    }
  });

  it('lists as pending only real, unregistered visibility tables', () => {
    for (const t of Object.keys(PENDING_REGISTRATION)) {
      expect(visibilityTables, `${t} is not a visibility table`).toContain(t);
      expect(
        Object.keys(auditSubjects),
        `${t} is registered; remove it from the pending list`,
      ).not.toContain(t);
    }
  });

  it('a pending table is not used by any application code yet', () => {
    const app = walk('src').filter(
      (f) => /\.(ts|tsx)$/.test(f) && !f.startsWith(join('src', 'db')),
    );
    for (const table of Object.keys(PENDING_REGISTRATION)) {
      const names = exportNamesOf(table);
      expect(names.length, `no schema export for ${table}`).toBeGreaterThan(0);
      for (const file of app) {
        const uses = schemaReferences(readFileSync(file, 'utf8'));
        for (const name of names)
          expect(uses.names, `${file} imports pending table ${table}`).not.toContain(name);
        expect(uses.tables, `${file} names pending table ${table} in SQL`).not.toContain(table);
      }
    }
  });

  it('detects a pending table however it is referenced (guard self-check)', () => {
    const multiLine = "import {\n  auditLog,\n  event,\n} from '@/db/schema';";
    expect(schemaReferences(multiLine).names).toContain('event');
    expect(
      schemaReferences("import * as s from '@/db/schema';\nconst x = s.task;").names,
    ).toContain('task');
    expect(schemaReferences('sql`select id from "note" where x`').tables).toContain('note');
    expect(schemaReferences('sql`delete from project`').tables).toContain('project');
    expect(schemaReferences("import { person } from '@/db/schema';").names).toEqual(['person']);
  });

  it('keys each subject by its table name, which is the subject_type services audit with', () => {
    for (const [type, subject] of Object.entries(auditSubjects)) {
      expect(getTableName(subject.table)).toBe(type);
    }
  });
});
