import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, person } from '@/db/schema';
import { auditedWrite } from '@/domain/common/write';
import { createPerson } from '@/domain/people/service';
import { auditRowColumns } from '@/trust/audit';
import { testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// A domain write and its audit row succeed or fail together (contract §5.3,
// PR #17 review). Each test makes one half fail for a real database reason
// and checks the other half did not happen.

const { db, close } = testDb();
const deps = { db };
let h: Household;
beforeAll(async () => {
  h = await ensureFixtureUsers(db);
});
afterAll(close);

const peopleNamed = (name: string) =>
  db.select({ id: person.id }).from(person).where(eq(person.name, name));

describe('auditedWrite', () => {
  it('when the audit insert fails, the domain write is rolled back', async () => {
    const name = 'Rollback When Audit Fails';
    const attempt = auditedWrite(h.sam, deps, async (tx) => {
      const [row] = await tx
        .insert(person)
        .values({ name, role: 'other', createdBy: h.sam.userId, createdVia: 'ui' })
        .returning();
      if (!row) throw new Error('no row');
      // The insert succeeded inside the transaction ...
      const inside = await tx.select({ id: person.id }).from(person).where(eq(person.id, row.id));
      expect(inside).toHaveLength(1);
      // ... then the audit row is rejected by audit_log's CHECK constraint.
      return {
        result: row,
        audit: {
          event: 'person.create',
          subjectType: 'person',
          subjectId: row.id,
          record: { visibility: 'not-a-visibility', createdBy: h.sam.userId },
        },
      };
    });
    const e = await attempt.then(
      () => null,
      (x: unknown) => x as Error & { cause?: { code?: string } },
    );
    expect(e?.cause?.code).toBe('23514'); // check_violation on audit_log
    expect(await peopleNamed(name)).toHaveLength(0);
  });

  it('when the domain write fails, no audit row is written', async () => {
    const before = await db.execute(
      sql`select count(*)::int as n from audit_log where event = 'person.create'`,
    );
    const ghost = { ...h.sam, userId: 'u-does-not-exist' };
    await expect(
      createPerson(ghost, { name: 'Ghost Creator', role: 'other' }, deps),
    ).rejects.toThrow();
    const after = await db.execute(
      sql`select count(*)::int as n from audit_log where event = 'person.create'`,
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    expect(await peopleNamed('Ghost Creator')).toHaveLength(0);
  });

  it('on success, both exist and agree', async () => {
    const p = await createPerson(h.sam, { name: 'Both Halves', role: 'other' }, deps);
    const rows = await db
      .select(auditRowColumns)
      .from(auditLog)
      .where(eq(auditLog.subjectId, p.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: 'person.create',
      subjectType: 'person',
      actorUserId: h.sam.userId,
    });
  });
});
