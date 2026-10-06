import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  EXCLUDED_COLUMNS,
  EXCLUDED_TABLES,
  EXPORT_TYPES,
  EXPORTED_COLUMNS,
  SECRET_COLUMNS,
  exportV1,
  type ExportType,
} from '@/domain/export/spec';

// The export completeness guard (ADR 0006 §6, M3 contract §7.1): every table
// in the schema is exported or excluded with a reason, and every column of
// an exported table is exported or excluded with a reason. A new table or
// column fails here until someone decides where it goes.

const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
const types = Object.keys(EXPORT_TYPES) as ExportType[];
const exportedTables = new Map(types.map((t) => [EXPORT_TYPES[t].table as string, t]));

describe('export completeness', () => {
  it('every table is exported or excluded, never both', () => {
    for (const t of tables) {
      const name = getTableName(t);
      const exported = exportedTables.has(name);
      const excluded = name in EXCLUDED_TABLES;
      expect(exported !== excluded, `${name}: exported=${exported} excluded=${excluded}`).toBe(
        true,
      );
    }
  });

  it('names only tables that exist', () => {
    const names = new Set(tables.map(getTableName));
    for (const n of [
      ...exportedTables.keys(),
      ...Object.keys(EXCLUDED_TABLES),
      ...Object.keys(EXCLUDED_COLUMNS),
    ])
      expect(names.has(n), n).toBe(true);
  });

  it('every column of an exported table is exported or excluded, never both', () => {
    for (const t of tables) {
      const name = getTableName(t);
      const type = exportedTables.get(name);
      if (!type) continue;
      const columns = Object.keys(getTableColumns(t)).sort();
      const exported = [...EXPORTED_COLUMNS[type]];
      const excluded = Object.keys(EXCLUDED_COLUMNS[name] ?? {});
      expect(
        exported.filter((c) => excluded.includes(c)),
        name,
      ).toEqual([]);
      expect([...exported, ...excluded].sort(), name).toEqual(columns);
      expect(new Set(exported).size, `${name}: duplicate columns`).toBe(exported.length);
    }
  });

  it('every exclusion says why', () => {
    for (const reason of Object.values(EXCLUDED_TABLES)) expect(reason.length).toBeGreaterThan(10);
    for (const cols of Object.values(EXCLUDED_COLUMNS))
      for (const reason of Object.values(cols)) expect(reason.length).toBeGreaterThan(10);
  });

  it('each type sorts by one of its own columns, and every type carries an id', () => {
    for (const t of types) {
      expect(EXPORTED_COLUMNS[t], t).toContain(EXPORT_TYPES[t].sortBy);
      expect(EXPORTED_COLUMNS[t][0], t).toBe('id');
    }
  });

  it('the version-1 schema refuses unknown fields, so a file says exactly what it holds', () => {
    const empty = Object.fromEntries(types.map((t) => [t, []]));
    const base = {
      format: 'home-export',
      version: 1,
      exportedAt: '2026-10-14T18:03:00.000Z',
      timeZone: 'Pacific/Auckland',
      exportedBy: { personId: null },
      includesSensitive: false,
      records: empty,
    };
    expect(exportV1.safeParse(base).success).toBe(true);
    expect(exportV1.safeParse({ ...base, version: 2 }).success).toBe(false);
    expect(
      exportV1.safeParse({ ...base, records: { ...empty, people: [{ id: 'x', secret: 1 }] } })
        .success,
    ).toBe(false);
  });

  it('no credential column is exported, by any record type, and its table stays excluded', () => {
    for (const [table, columns] of Object.entries(SECRET_COLUMNS)) {
      expect(EXCLUDED_TABLES[table], `${table} must stay excluded`).toBeTruthy();
      expect(exportedTables.has(table), table).toBe(false);
      const defined = Object.keys(
        getTableColumns(tables.find((t) => getTableName(t) === table) as PgTable),
      );
      for (const c of columns) {
        expect(defined, `${table}.${c} exists`).toContain(c);
        for (const type of types) expect(EXPORTED_COLUMNS[type], `${type}: ${c}`).not.toContain(c);
      }
    }
  });

  it('every column that can hold a calendar credential is listed as secret', () => {
    const conn = tables.find((t) => getTableName(t) === 'calendar_connection') as PgTable;
    const credentialish = Object.keys(getTableColumns(conn)).filter((c) =>
      /credential|fingerprint|secret|token|key/i.test(c),
    );
    expect(credentialish.sort()).toEqual([...SECRET_COLUMNS.calendar_connection].sort());
  });
});
