import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableName, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';

// Migration-first (contract §2.1 rule 2, MIGRATIONS.md): a column added to an
// EXISTING table stays out of that table's Drizzle definition until the
// application PR, because the deployed services insert into and return every
// defined column, and would fail on production's schema before the migration
// runs. So the newest migration snapshot may hold columns the Drizzle schema
// does not, but only these, and only until their application PR adds the
// definitions and empties this list. Running `pnpm db:generate` meanwhile
// would emit DROP statements for them; the additive-migration guard refuses
// such a migration.
const DEFERRED: Record<string, string[]> = {
  // Migration 0005 (Package 4a); Package 4b adds the definitions.
  event: ['origin_capture_id'],
  project: ['origin_capture_id'],
  task: ['origin_capture_id'],
  note: ['origin_capture_id'],
};

const dir = 'src/db/migrations';
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[];
};
const latest = journal.entries.at(-1);
const snapshot = JSON.parse(
  readFileSync(join(dir, 'meta', `${String(latest?.idx).padStart(4, '0')}_snapshot.json`), 'utf8'),
) as { tables: Record<string, { name: string; columns: Record<string, { name: string }> }> };

const inSnapshot = new Map(
  Object.values(snapshot.tables).map((t) => [t.name, Object.values(t.columns).map((c) => c.name)]),
);
const inDrizzle = new Map(
  (Object.values(schema) as unknown[])
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => [getTableName(t), getTableConfig(t).columns.map((c) => c.name)]),
);

describe('Drizzle schema against the newest migration snapshot', () => {
  it('defines the same tables', () => {
    expect([...inDrizzle.keys()].sort()).toEqual([...inSnapshot.keys()].sort());
  });

  it('defines every snapshot column except the deferred ones, and nothing the snapshot lacks', () => {
    for (const [table, columns] of inSnapshot) {
      const defined = inDrizzle.get(table) ?? [];
      const missing = columns.filter((c) => !defined.includes(c));
      expect(missing, `${table}: columns not yet in Drizzle`).toEqual(DEFERRED[table] ?? []);
      expect(
        defined.filter((c) => !columns.includes(c)),
        `${table}: Drizzle columns no migration creates`,
      ).toEqual([]);
    }
  });

  it('lists as deferred only real tables', () => {
    for (const table of Object.keys(DEFERRED)) expect(inSnapshot.has(table), table).toBe(true);
  });
});
