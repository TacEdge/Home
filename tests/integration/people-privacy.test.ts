import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archivePerson, createPerson, listPeople, updatePerson } from '@/domain/people/service';
import { systemActor, type UserActor } from '@/trust/actor';
import { listAudit, recordAudit } from '@/trust/audit';
import { CANARY, CANARY_MARK } from '../fixtures/family';
import { adminDb, testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// P-1 (ADR 0005 §9): audit metadata never reveals more than the affected
// record would. Whoever wrote a row, Activity lists it only to someone who
// can currently see the record; the write-time snapshot decides only once
// the record is gone. Domain audit rows carry no user-written content.

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

let n = 0;
const privateOf = (who: 'sam' | 'alex') => ({
  ...CANARY[who],
  name: `${CANARY[who].name}-p${++n}`,
});

/** Every audit event about `subjectId` that this actor's Activity lists, newest first. */
async function activityAbout(actor: UserActor | typeof systemActor, subjectId: string) {
  const seen: string[] = [];
  let before: { id: string } | undefined;
  for (let guard = 0; guard < 10_000; guard++) {
    const page = await listAudit(actor, { limit: 200, before }, deps);
    seen.push(...page.rows.filter((r) => r.subjectId === subjectId).map((r) => r.event));
    if (!page.next) break;
    before = page.next;
  }
  return seen;
}

describe('Activity follows the affected record (P-1)', () => {
  it("a private record's rows: its owner sees them, the other adult does not", async () => {
    const mine = await createPerson(h.sam, privateOf('sam'), deps);
    await updatePerson(h.sam, mine.id, { stageNote: 'canary-sam-edit' }, deps);
    expect(await activityAbout(h.sam, mine.id)).toEqual(['person.update', 'person.create']);
    expect(await activityAbout(h.alex, mine.id)).toEqual([]);
  });

  it('whoever wrote the row: a system process touching a private record stays private too', async () => {
    const mine = await createPerson(h.alex, privateOf('alex'), deps);
    // A future sync or purge writes through the same audit path, as the system actor.
    await recordAudit(
      systemActor,
      {
        event: 'person.system_touch',
        subjectType: 'person',
        subjectId: mine.id,
        snapshot: { visibility: 'private', visibleToUserId: h.alex.userId },
      },
      deps,
    );
    expect(await activityAbout(h.alex, mine.id)).toEqual(['person.system_touch', 'person.create']);
    expect(await activityAbout(h.sam, mine.id)).toEqual([]);
  });

  it("the record's current visibility decides, even for rows written as household", async () => {
    // A row whose snapshot says household is still hidden once its record is private.
    const p = await createPerson(h.sam, { name: 'Flip', role: 'other' }, deps);
    await updatePerson(h.alex, p.id, { shortName: 'F' }, deps);
    expect(await activityAbout(h.alex, p.id)).toEqual(['person.update', 'person.create']);
    await updatePerson(h.sam, p.id, { visibility: 'private' }, deps);
    expect(await activityAbout(h.alex, p.id)).toEqual([]); // including Alex's own edit
    expect(await activityAbout(h.sam, p.id)).toEqual([
      'person.update',
      'person.update',
      'person.create',
    ]);
    await updatePerson(h.sam, p.id, { visibility: 'household' }, deps);
    expect(await activityAbout(h.alex, p.id)).toEqual([
      'person.update',
      'person.update',
      'person.update',
      'person.create',
    ]);
  });

  it('archiving does not change who sees the record or its rows', async () => {
    const mine = await createPerson(h.sam, privateOf('sam'), deps);
    await archivePerson(h.sam, mine.id, deps);
    expect(await activityAbout(h.sam, mine.id)).toEqual(['person.archive', 'person.create']);
    expect(await activityAbout(h.alex, mine.id)).toEqual([]);
    // The archived private record itself is invisible to Alex in every read.
    const all = await listPeople(h.alex, { includeArchived: true }, deps);
    expect(all.map((p) => p.id)).not.toContain(mine.id);
  });

  it('once the record no longer exists, the snapshot decides', async () => {
    const gone = await createPerson(h.sam, privateOf('sam'), deps);
    const shared = await createPerson(h.sam, { name: 'Gone Shared', role: 'other' }, deps);
    // A hard delete, as a future purge would do it (the runtime role cannot).
    await admin.db.execute(
      sql`delete from person where id in (${gone.id}::uuid, ${shared.id}::uuid)`,
    );
    expect(await activityAbout(h.sam, gone.id)).toEqual(['person.create']);
    expect(await activityAbout(h.alex, gone.id)).toEqual([]);
    expect(await activityAbout(h.alex, shared.id)).toEqual(['person.create']);
  });

  it('rows with no domain subject are unchanged: household, listed to both', async () => {
    const { id } = await recordAudit(
      h.sam,
      { event: 'auth.sign_in', subjectType: 'session', subjectId: 's-p1' },
      deps,
    );
    const r = await db.execute(
      sql`select visibility, visible_to_user_id from audit_log where id = ${id}::uuid`,
    );
    expect(r.rows[0]).toEqual({ visibility: 'household', visible_to_user_id: null });
    expect(await activityAbout(h.alex, 's-p1')).toEqual(['auth.sign_in']);
  });

  it('an unregistered subject type falls back to its snapshot, never to household', async () => {
    await recordAudit(
      h.sam,
      {
        event: 'future.thing',
        subjectType: 'future_entity',
        subjectId: 'f-1',
        snapshot: { visibility: 'private', visibleToUserId: h.sam.userId },
      },
      deps,
    );
    expect(await activityAbout(h.sam, 'f-1')).toEqual(['future.thing']);
    expect(await activityAbout(h.alex, 'f-1')).toEqual([]);
  });

  it('the system actor lists everything', async () => {
    const mine = await createPerson(h.sam, privateOf('sam'), deps);
    expect(await activityAbout(systemActor, mine.id)).toEqual(['person.create']);
  });
});

describe('no user-written content in the audit log', () => {
  it('no canary string appears in any audit row, from either adult', async () => {
    const rows = await admin.db.execute(sql`select summary, meta::text as meta from audit_log`);
    const text = JSON.stringify(rows.rows);
    expect(text).not.toContain(CANARY_MARK.sam);
    expect(text).not.toContain(CANARY_MARK.alex);
  });

  it("no person row's name, relationship or note appears in any person audit row", async () => {
    const people = await admin.db.execute(sql`select name, relationship, stage_note from person`);
    const audit = await admin.db.execute(
      sql`select coalesce(summary, '') || ' ' || coalesce(meta::text, '') as t from audit_log where subject_type = 'person'`,
    );
    const text = audit.rows.map((r) => r.t).join('\n');
    for (const p of people.rows)
      for (const v of [p.name, p.relationship, p.stage_note])
        if (typeof v === 'string' && v.length > 3) expect(text).not.toContain(v);
  });
});
