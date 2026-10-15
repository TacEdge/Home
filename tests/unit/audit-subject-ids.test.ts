import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { auditSubjects } from '@/trust/audit-subjects';

// Issue #77: Activity matches an audit row's subject_id to its record as a
// uuid (src/trust/audit-subjects.ts, `subjectUuid`), which equals the old
// `id::text = subject_id` only because every registered table's id is a
// uuid. A table registered with any other id type must change that first.

describe('Activity subject ids', () => {
  it('every registered subject table has a uuid primary key named id', () => {
    for (const [type, subject] of Object.entries(auditSubjects)) {
      const id = getTableConfig(subject.table).columns.find((c) => c.name === 'id');
      expect(id?.getSQLType(), type).toBe('uuid');
      expect(id?.primary, type).toBe(true);
    }
  });
});
