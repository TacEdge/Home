import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '@/db/schema';
import { createPerson, updatePerson } from '@/domain/people/service';
import { systemActor } from '@/trust/actor';
import { listAudit, recordAudit } from '@/trust/audit';
import { CANARY, CANARY_STRINGS } from '../fixtures/family';
import { adminDb, testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// P-1 (ADR 0005): audit metadata never reveals more than the affected record
// would. Whoever wrote the row, the Activity list shows it only to someone
// who can currently see the record; the write-time snapshot decides only
// once the record is gone.

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
let h: Household;

beforeAll(async () => {
  h = await ensureFixtureUsers(db);
});
afterAll(async () => {
  await close();
  await admin.close();
});

/** Every audit row this actor can list that is about `subjectId`. */
async function rowsAbout(actor: Household['sam'], subjectId: string) {
  const seen: string[] = [];
  let cursor: { at: Date; id: string } | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const page = await listAudit(actor, { limit: 200, before: cursor }, deps);
    seen.push(...page.rows.filter((r) => r.subjectId === subjectId).map((r) => r.event));
    if (!page.next) break;
    cursor = page.next;
  }
  return seen;
}

describe('P-1: audit rows follow the affected record', () => {
  it('a private record written by its owner is invisible to the other adult', async () => {
    const mine = await createPerson(
      h.sam,
      { ...CANARY.sam.person, name: 'canary-sam-aud-7f3a' },
      deps,
    );
    expect(await rowsAbout(h.sam, mine.id)).toEqual(['person.create']);
    expect(await rowsAbout(h.alex, mine.id)).toEqual([]);
  });

  it('a private record written by a system process stays private (owner sees it, the other adult does not)', async () => {
    const mine = await createPerson(
      h.alex,
      { ...CANARY.alex.person, name: 'canary-alex-sys-2b9c' },
      deps,
    );
    // A future sync or purge writes as the system actor through the same
    // audit API, with the record's snapshot; the record decides, not the actor.
    await recordAudit(
      systemActor,
      {
        event: 'person.system_touch',
        subjectType: 'person',
        subjectId: mine.id,
        visibility: 'private',
        visibleToUserId: h.alex.userId,
      },
      deps,
    );
    expect(await rowsAbout(h.alex, mine.id)).toEqual(['person.system_touch', 'person.create']);
    expect(await rowsAbout(h.sam, mine.id)).toEqual([]);
  });

  it('household → private hides the earlier rows from the other adult; private → household shows them again', async () => {
    const p = await createPerson(h.sam, { name: 'Flip Visibility', role: 'other' }, deps);
    expect(await rowsAbout(h.alex, p.id)).toEqual(['person.create']);
    await updatePerson(h.sam, p.id, { visibility: 'private' }, deps);
    expect(await rowsAbout(h.alex, p.id)).toEqual([]);
    expect(await rowsAbout(h.sam, p.id)).toEqual(['person.update', 'person.create']);
    await updatePerson(h.sam, p.id, { visibility: 'household' }, deps);
    expect(await rowsAbout(h.alex, p.id)).toEqual([
      'person.update',
      'person.update',
      'person.create',
    ]);
  });

  it('once the record is gone, the write-time snapshot decides', async () => {
    const gone = await createPerson(
      h.sam,
      { ...CANARY.sam.person, name: 'canary-sam-gone-7f3a' },
      deps,
    );
    const shared = await createPerson(h.sam, { name: 'Gone Shared', role: 'other' }, deps);
    // Hard delete as the owner role (a future purge); home_app cannot.
    await admin.db.execute(
      sql`delete from person where id in (${gone.id}::uuid, ${shared.id}::uuid)`,
    );
    expect(await rowsAbout(h.sam, gone.id)).toEqual(['person.create']);
    expect(await rowsAbout(h.alex, gone.id)).toEqual([]);
    expect(await rowsAbout(h.alex, shared.id)).toEqual(['person.create']);
  });

  it('rows without a domain subject (auth.*) are unchanged: household, listed to both', async () => {
    const row = await recordAudit(
      h.sam,
      { event: 'auth.sign_in', subjectType: 'session', subjectId: 's-p1' },
      deps,
    );
    expect(row.visibility).toBe('household');
    expect(row.visibleToUserId).toBeNull();
    const alexSees = await listAudit(h.alex, { limit: 200 }, deps);
    expect(alexSees.rows.map((r) => r.id)).toContain(row.id);
  });

  it('an unregistered private row falls back to its snapshot, never to household', async () => {
    const row = await recordAudit(
      h.sam,
      {
        event: 'future.private',
        subjectType: 'future_entity',
        subjectId: 'f-1',
        visibility: 'private',
        visibleToUserId: h.sam.userId,
      },
      deps,
    );
    expect((await listAudit(h.sam, { limit: 200 }, deps)).rows.map((r) => r.id)).toContain(row.id);
    expect((await listAudit(h.alex, { limit: 200 }, deps)).rows.map((r) => r.id)).not.toContain(
      row.id,
    );
  });

  it('no canary string appears in any audit row, whoever lists', async () => {
    const all = await admin.db.select().from(auditLog);
    const text = JSON.stringify(all.map((r) => [r.summary, r.meta]));
    for (const s of [...CANARY_STRINGS.sam, ...CANARY_STRINGS.alex]) expect(text).not.toContain(s);
  });

  it('the system actor lists everything', async () => {
    const mine = await createPerson(
      h.sam,
      { ...CANARY.sam.person, name: 'canary-sam-sysread-7f3a' },
      deps,
    );
    const page = await listAudit(systemActor, { limit: 200 }, deps);
    expect(page.rows.map((r) => r.subjectId)).toContain(mine.id);
    const [direct] = await db.select().from(auditLog).where(eq(auditLog.subjectId, mine.id));
    expect(direct?.visibility).toBe('private');
  });
});
