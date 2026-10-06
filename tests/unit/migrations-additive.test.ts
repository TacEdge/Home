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

/**
 * Foreign keys the contracts planned on columns that already exist: links
 * whose target table arrived later. Each names the only delete rule it may
 * have. No deployed code path sets the column before its table exists, so no
 * live row or write can break; were one to dangle, the migration would fail
 * validation and roll back, never change data.
 */
export const APPROVED_EXISTING_COLUMN_FKS: Record<
  string,
  { reason: string; onDelete: 'set null' | 'restrict' }
> = {
  'capture.message_id': { reason: 'message, M2 Package 5 (contract §4.2)', onDelete: 'set null' },
  'proposal.conversation_id': {
    reason: 'conversation, M2 Package 5 (contract §4.2)',
    onDelete: 'set null',
  },
  // RESTRICT, not SET NULL: a synced event must keep its source (event_synced_check),
  // and a source is archived, never deleted (ADR 0007 §5). No synced event
  // exists before M4 Package 4b, so every existing value is null.
  'event.calendar_source_id': {
    reason: 'calendar_source, M4 Package 4a (contract §7, ADR 0007 §33)',
    onDelete: 'restrict',
  },
};

/**
 * Partial unique indexes approved on an existing table, by name. Each covers
 * only rows no deployed code can write (synced events and occurrence
 * overrides, from M4), so it cannot reject an existing row or a deployed
 * write. They must stay partial.
 */
export const APPROVED_EXISTING_TABLE_UNIQUE_INDEXES: Record<string, string> = {
  event_synced_identity_unique:
    "synced identity, only where source = 'synced' (M4 Package 4a, ADR 0007 §13, §33)",
  event_manual_override_unique:
    'one live change per occurrence, only where recurrence_parent_id is set (M4 Package 8a, ADR 0007 §33)',
};

/**
 * CHECKs approved on existing columns of an existing table, by name. Each
 * holds for every existing row and every write the deployed code can make.
 */
export const APPROVED_EXISTING_COLUMN_CHECKS: Record<string, string> = {
  // Every existing event is manual and made through ui or kev; only M4's
  // sync path writes source 'synced' with created_via 'sync'.
  event_sync_provenance_check: "source 'synced' exactly when created_via 'sync' (ADR 0007 §8, §33)",
};

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
      const name = st.match(/INDEX "([^"]+)"/i)?.[1] ?? '';
      const approved = name in APPROVED_EXISTING_TABLE_UNIQUE_INDEXES && / WHERE /i.test(st);
      if (/^CREATE UNIQUE/i.test(st) && existingTables.has(on) && !created.has(on) && !approved)
        problems.push(`unique index on existing table: ${head}`);
    } else if ((m = st.match(/^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"(.*)$/is))) {
      const [, table = '', column = '', rest = ''] = m;
      // NOT NULL without a default would reject the deployed app's inserts.
      if (/NOT NULL/i.test(rest) && !/DEFAULT/i.test(rest) && existingTables.has(table))
        problems.push(`NOT NULL column without default on existing table: ${head}`);
      if (!added.has(table)) added.set(table, new Set());
      added.get(table)?.add(column);
    } else if (
      (m = st.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" (CHECK|FOREIGN KEY) (.*)$/is))
    ) {
      const [, table = '', name = '', kind = '', body = ''] = m;
      const approvedCheck =
        kind.toUpperCase() === 'CHECK' && name in APPROVED_EXISTING_COLUMN_CHECKS;
      if (existingTables.has(table) && !created.has(table) && !approvedCheck) {
        // On an existing table a constraint may only cover columns this
        // migration added, so no existing row or deployed write can break.
        const cols =
          kind.toUpperCase() === 'CHECK'
            ? [...body.matchAll(new RegExp(`"${table}"\\."([^"]+)"`, 'g'))].map((x) => x[1] ?? '')
            : [body.match(/^\("([^"]+)"\)/)?.[1] ?? ''];
        for (const c of cols) {
          if (added.get(table)?.has(c)) continue;
          const fk = APPROVED_EXISTING_COLUMN_FKS[`${table}.${c}`];
          const planned =
            kind.toUpperCase() === 'FOREIGN KEY' &&
            fk !== undefined &&
            new RegExp(`ON DELETE ${fk.onDelete}\\b`, 'i').test(body);
          if (!planned) problems.push(`constraint on existing column ${table}.${c}: ${head}`);
        }
      }
    } else if (/^DO \$\$/i.test(st) || /^CREATE (OR REPLACE )?(FUNCTION|TRIGGER)/i.test(st)) {
      // Taking privileges from the runtime role (the append-only rule) and a
      // trigger's event clause (one that refuses changes) are not changes.
      const body = st
        .replace(/REVOKE [A-Z, ]+ ON TABLE "[^"]+" FROM home_app;/gi, '')
        .replace(
          /BEFORE (INSERT|UPDATE|DELETE|TRUNCATE)( OR (INSERT|UPDATE|DELETE|TRUNCATE))* ON "[^"]+"/gi,
          '',
        );
      if (/\b(DROP|RENAME|ALTER COLUMN|DELETE FROM|UPDATE "|TRUNCATE|GRANT)\b/i.test(body))
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
    [
      'DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'home_app\') THEN REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "x" FROM home_app; END IF; END $$;',
      [],
    ],
    ['CREATE TRIGGER t BEFORE TRUNCATE ON "x" FOR EACH STATEMENT EXECUTE FUNCTION f();', []],
    [
      'ALTER TABLE "capture" ADD CONSTRAINT "f" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;',
      [],
    ],
    [
      'ALTER TABLE "event" ADD CONSTRAINT "f" FOREIGN KEY ("calendar_source_id") REFERENCES "public"."calendar_source"("id") ON DELETE restrict ON UPDATE no action;',
      [],
    ],
    [
      'CREATE UNIQUE INDEX "event_synced_identity_unique" ON "event" USING btree ("calendar_source_id") WHERE "event"."source" = \'synced\';',
      [],
    ],
    [
      'ALTER TABLE "event" ADD CONSTRAINT "event_sync_provenance_check" CHECK (("event"."source" = \'synced\') = ("event"."created_via" = \'sync\'));',
      [],
    ],
  ])('accepts %s', (text, expected) => {
    expect(nonAdditive(text, new Set([...existing, 'capture', 'event']))).toEqual(expected);
  });

  it.each([
    [
      'an approved column with another delete rule',
      'ALTER TABLE "capture" ADD CONSTRAINT "f" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade;',
    ],
    [
      'an unapproved existing column',
      'ALTER TABLE "capture" ADD CONSTRAINT "f" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null;',
    ],
    [
      'a CHECK on an approved column',
      'ALTER TABLE "capture" ADD CONSTRAINT "c" CHECK ("capture"."message_id" is null);',
    ],
    [
      'the source FK with a cascading delete',
      'ALTER TABLE "event" ADD CONSTRAINT "f" FOREIGN KEY ("calendar_source_id") REFERENCES "public"."calendar_source"("id") ON DELETE cascade;',
    ],
    [
      'the source FK with SET NULL (a synced event must keep its source)',
      'ALTER TABLE "event" ADD CONSTRAINT "f" FOREIGN KEY ("calendar_source_id") REFERENCES "public"."calendar_source"("id") ON DELETE set null;',
    ],
    [
      'an approved unique index made total (no WHERE)',
      'CREATE UNIQUE INDEX "event_synced_identity_unique" ON "event" USING btree ("calendar_source_id","external_uid");',
    ],
    [
      'an unapproved partial unique index on an existing table',
      'CREATE UNIQUE INDEX "event_title_unique" ON "event" USING btree ("title") WHERE "event"."source" = \'synced\';',
    ],
    [
      'an unapproved CHECK on existing columns',
      'ALTER TABLE "event" ADD CONSTRAINT "event_title_check" CHECK ("event"."title" <> \'\');',
    ],
    ['a grant in a block', 'DO $$ BEGIN GRANT ALL ON TABLE "x" TO home_app; END $$;'],
    ['a truncate in a block', 'DO $$ BEGIN TRUNCATE "capture"; END $$;'],
  ])('rejects %s', (_l, text) => {
    expect(nonAdditive(text, new Set([...existing, 'capture', 'event']))).not.toEqual([]);
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
