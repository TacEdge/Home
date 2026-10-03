import { getTableName, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { auditSubjects } from '@/trust/audit-subjects';

// P-1 can only follow a record's current visibility if the Activity filter
// knows the record's table. Every table with a visibility column must be
// registered (contract §2.3 carry-forward); audit_log itself is the log.

const visibilityTables = (Object.values(schema) as unknown[])
  .filter((v): v is PgTable => is(v, PgTable))
  .filter((t) => getTableConfig(t).columns.some((c) => c.name === 'visibility'))
  .map((t) => getTableName(t))
  .filter((name) => name !== 'audit_log')
  .sort();

describe('Activity subject registry', () => {
  it('finds the visibility-bearing tables in the schema (sanity)', () => {
    expect(visibilityTables).toContain('person');
  });

  it('registers every table with a visibility column', () => {
    expect(Object.keys(auditSubjects).sort()).toEqual(visibilityTables);
  });

  it('keys each subject by its table name, which is the subject_type services audit with', () => {
    for (const [type, subject] of Object.entries(auditSubjects)) {
      expect(getTableName(subject.table)).toBe(type);
    }
  });
});
