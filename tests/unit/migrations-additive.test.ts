import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Migrations are additive and expand-first (M2 contract §4.3, MIGRATIONS.md):
// production is live and the app already deployed must keep working on the
// newer schema. Every migration from 0003 on is checked statement by
// statement. Better Auth owns its tables (ADR 0005, D-M2-2): no migration
// after M1 may change them.

const dir = 'src/db/migrations';
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[];
};
const FIRST_M2 = 3;
const BETTER_AUTH_TABLES = ['user', 'session', 'account', 'verification', 'rate_limit'];

type Problem = string;

/** Why a migration is not additive, if it is not. Empty when it is. */
export function nonAdditive(sqlText: string, existingTables: Set<string>): Problem[] {
  const problems: Problem[] = [];
  const created = new Set<string>();
  const added = new Map<string, Set<string>>();
  const statements = sqlText
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/--[^\n]*\n/g, '\n').trim())
    .filter(Boolean);
  for (const st of statements) {
    const head = st.slice(0, 80);
    let m: RegExpMatchArray | null;
    if ((m = st.match(/^CREATE TABLE "([^"]+)"/i))) {
      if (existingTables.has(m[1] ?? '')) problems.push(`recreates existing table: ${head}`);
      created.add(m[1] ?? '');
    } else if (/^CREATE (UNIQUE )?INDEX/i.test(st)) {
      // A new unique index on an existing table could reject existing rows.
      const on = st.match(/ON "([^"]+)"/i)?.[1] ?? '';
      if (/^CREATE UNIQUE/i.test(st) && existingTables.has(on) && !created.has(on))
        problems.push(`unique index on existing table: ${head}`);
    } else if ((m = st.match(/^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"(.*)$/is))) {
      const [, table = '', column = '', rest = ''] = m;
      // NOT NULL without a default would reject the deployed app's inserts.
      if (/NOT NULL/i.test(rest) && !/DEFAULT/i.test(rest) && existingTables.has(table))
        problems.push(`NOT NULL column without default on existing table: ${head}`);
      if (!added.has(table)) added.set(table, new Set());
      added.get(table)?.add(column);
    } else if (
      (m = st.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "[^"]+" (CHECK|FOREIGN KEY) (.*)$/is))
    ) {
      const [, table = '', kind = '', body = ''] = m;
      if (existingTables.has(table) && !created.has(table)) {
        // On an existing table a constraint may only cover columns this
        // migration added, so no existing row or deployed write can break.
        const cols =
          kind.toUpperCase() === 'CHECK'
            ? [...body.matchAll(new RegExp(`"${table}"\\."([^"]+)"`, 'g'))].map((x) => x[1] ?? '')
            : [body.match(/^\("([^"]+)"\)/)?.[1] ?? ''];
        for (const c of cols)
          if (!added.get(table)?.has(c))
            problems.push(`constraint on existing column ${table}.${c}: ${head}`);
      }
    } else if (/^DO \$\$/i.test(st) || /^CREATE (OR REPLACE )?(FUNCTION|TRIGGER)/i.test(st)) {
      if (/\b(DROP|RENAME|ALTER COLUMN|DELETE FROM|UPDATE "|TRUNCATE)\b/i.test(st))
        problems.push(`destructive statement in block: ${head}`);
    } else {
      problems.push(`not an additive statement: ${head}`);
    }
  }
  return problems;
}

const tablesIn = (snapshot: string): Set<string> => {
  const s = JSON.parse(readFileSync(join(dir, 'meta', snapshot), 'utf8')) as {
    tables: Record<string, { name: string }>;
  };
  return new Set(Object.values(s.tables).map((t) => t.name));
};

describe('the additive-migration guard', () => {
  const existing = new Set(['audit_log', 'user']);
  it.each([
    ['CREATE TABLE "x" ("id" uuid);', []],
    ['ALTER TABLE "audit_log" ADD COLUMN "v" text DEFAULT \'a\' NOT NULL;', []],
    [
      'ALTER TABLE "audit_log" ADD COLUMN "v" text;--> statement-breakpoint\nALTER TABLE "audit_log" ADD CONSTRAINT "c" CHECK ("audit_log"."v" in (\'a\'));',
      [],
    ],
  ])('accepts %s', (text, expected) => {
    expect(nonAdditive(text, existing)).toEqual(expected);
  });

  it.each([
    'DROP TABLE "user";',
    'ALTER TABLE "audit_log" DROP COLUMN "meta";',
    'ALTER TABLE "audit_log" RENAME COLUMN "meta" TO "m";',
    'ALTER TABLE "audit_log" ALTER COLUMN "meta" SET NOT NULL;',
    'ALTER TABLE "audit_log" ADD COLUMN "v" text NOT NULL;',
    'ALTER TABLE "audit_log" ADD CONSTRAINT "c" CHECK ("audit_log"."event" <> \'\');',
    'ALTER TABLE "user" ADD CONSTRAINT "f" FOREIGN KEY ("email") REFERENCES "x"("id");',
    'CREATE UNIQUE INDEX "u" ON "user" USING btree ("name");',
    'CREATE TABLE "user" ("id" text);',
    'DO $$ BEGIN DROP TABLE "audit_log"; END $$;',
  ])('rejects %s', (text) => {
    expect(nonAdditive(text, existing)).not.toEqual([]);
  });
});

describe('M2 migrations', () => {
  const m2 = journal.entries.filter((e) => e.idx >= FIRST_M2);

  it('include 0003', () => {
    expect(m2.map((e) => e.tag)).toContain('0003_person_and_audit_visibility');
  });

  it.each(m2.map((e) => [e.tag, e.idx] as const))('%s is additive', (tag, idx) => {
    const previous = journal.entries.find((e) => e.idx === idx - 1);
    if (!previous) throw new Error('no previous migration');
    const existing = tablesIn(`${String(idx - 1).padStart(4, '0')}_snapshot.json`);
    const text = readFileSync(join(dir, `${tag}.sql`), 'utf8');
    expect(nonAdditive(text, existing)).toEqual([]);
  });

  it.each(m2.map((e) => [e.tag, e.idx] as const))(
    '%s leaves the Better Auth tables exactly as M1 defined them',
    (_tag, idx) => {
      const read = (n: number) =>
        JSON.parse(
          readFileSync(join(dir, 'meta', `${String(n).padStart(4, '0')}_snapshot.json`), 'utf8'),
        ) as {
          tables: Record<string, unknown>;
        };
      const m1 = read(FIRST_M2 - 1).tables;
      const now = read(idx).tables;
      for (const t of BETTER_AUTH_TABLES) {
        expect(now[`public.${t}`], t).toEqual(m1[`public.${t}`]);
      }
      const text = readFileSync(join(dir, `${_tag}.sql`), 'utf8');
      for (const t of BETTER_AUTH_TABLES) {
        // Referencing user(id) from a new table is fine; altering it is not.
        expect(text).not.toMatch(
          new RegExp(`ALTER TABLE "${t}"|DROP TABLE "${t}"|CREATE TABLE "${t}"`),
        );
      }
    },
  );
});
