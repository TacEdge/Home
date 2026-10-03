import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { auditLog, person } from '@/db/schema';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import {
  archivePerson,
  createPerson,
  linkSelf,
  unlinkSelf,
  updatePerson,
} from '@/domain/people/service';
import { systemActor, type UserActor } from '@/trust/actor';
import { auditRowColumns, listAudit } from '@/trust/audit';
import { adminDb, testDb } from './db';

// unlinkSelf (ADR 0005 §22): the recovery path for a wrong linkSelf. It
// clears only the acting user's own link, changes no other field, cannot
// unlink another adult, refuses Kev and the system actor, and is
// transactional and structurally audited.

const { db, pool, close } = testDb();
const admin = adminDb();
const deps = { db };
afterAll(async () => {
  await close();
  await admin.close();
});

let n = 0;
/** A fresh adult per test, so no other suite's links interfere. */
async function adult(label: string): Promise<UserActor> {
  const id = `u-unlink-${label}-${++n}`;
  const email = `${id}@example.test`;
  await pool.query('insert into "user" (id, name, email) values ($1, $1, $2)', [id, email]);
  return { kind: 'user', userId: id, email, via: 'ui', channel: 'web' };
}

/** A household parent linked to `who`, with every optional field filled in. */
async function linkedParent(who: UserActor, creator: UserActor = who) {
  const p = await createPerson(
    creator,
    {
      name: `Parent ${n}`,
      shortName: 'P',
      role: 'parent',
      relationship: 'partner',
      dateOfBirth: '1988-06-12',
      stageNote: 'a note',
      colour: 'moss',
    },
    deps,
  );
  return linkSelf(who, p.id, deps);
}

function withoutLinkAndClock(row: Record<string, unknown> | undefined) {
  const copy = { ...row };
  delete copy.userId;
  delete copy.updatedAt;
  return copy;
}

const rowOf = async (id: string) => (await db.select().from(person).where(eq(person.id, id)))[0];
const auditOf = (id: string) =>
  db.select(auditRowColumns).from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.at);
const settle = (p: Promise<unknown>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
async function expectNotPermitted(p: Promise<unknown>, code: NotPermittedError['code']) {
  const r = await settle(p);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.e).toBeInstanceOf(NotPermittedError);
  expect(!r.ok && (r.e as NotPermittedError).code).toBe(code);
}

describe('unlinkSelf', () => {
  it("clears the actor's own link and nothing else", async () => {
    const sam = await adult('sam');
    const linked = await linkedParent(sam);
    const before = await rowOf(linked.id);
    const after = await unlinkSelf(sam, deps);
    expect(after.id).toBe(linked.id);
    expect(after.userId).toBeNull();
    const stored = await rowOf(linked.id);
    // Every other field is unchanged, including created_by and archived_at.
    expect(withoutLinkAndClock(stored)).toEqual(withoutLinkAndClock(before));
    expect(stored?.updatedAt.getTime()).toBeGreaterThanOrEqual(before?.updatedAt.getTime() ?? 0);
  });

  it('audits structurally: the event and subject, no content, household snapshot', async () => {
    const sam = await adult('sam');
    const linked = await linkedParent(sam);
    await unlinkSelf(sam, deps);
    const rows = await auditOf(linked.id);
    expect(rows.map((r) => r.event)).toEqual([
      'person.create',
      'person.link_self',
      'person.unlink_self',
    ]);
    const unlink = rows.at(-1);
    expect(unlink).toMatchObject({
      actorUserId: sam.userId,
      actorVia: 'ui',
      summary: null,
      meta: null,
    });
    const snap = await db.execute(
      sql`select visibility, visible_to_user_id from audit_log where id = ${unlink?.id}::uuid`,
    );
    expect(snap.rows[0]).toEqual({ visibility: 'household', visible_to_user_id: null });
  });

  it('cannot unlink another adult: an unlinked actor gets NotFound and changes nothing', async () => {
    const sam = await adult('sam');
    const alex = await adult('alex');
    const samLinked = await linkedParent(sam);
    const before = await auditOf(samLinked.id);
    await expect(unlinkSelf(alex, deps)).rejects.toBeInstanceOf(NotFoundError);
    expect((await rowOf(samLinked.id))?.userId).toBe(sam.userId);
    expect(await auditOf(samLinked.id)).toHaveLength(before.length);
  });

  it("each adult's unlink touches only their own link", async () => {
    const sam = await adult('sam');
    const alex = await adult('alex');
    const samLinked = await linkedParent(sam);
    const alexLinked = await linkedParent(alex, sam); // created by Sam, linked by Alex
    await unlinkSelf(alex, deps);
    expect((await rowOf(alexLinked.id))?.userId).toBeNull();
    expect((await rowOf(samLinked.id))?.userId).toBe(sam.userId);
  });

  it('refuses Kev and the system actor, and writes nothing', async () => {
    const sam = await adult('sam');
    const linked = await linkedParent(sam);
    const before = await auditOf(linked.id);
    await expectNotPermitted(unlinkSelf({ ...sam, via: 'kev' }, deps), 'kev_cannot_write');
    await expectNotPermitted(unlinkSelf(systemActor as unknown as UserActor, deps), 'not_a_user');
    // The same runtime refusal guards every other write.
    await expectNotPermitted(
      createPerson(
        systemActor as unknown as UserActor,
        { name: 'System Made', role: 'other' },
        deps,
      ),
      'not_a_user',
    );
    expect((await rowOf(linked.id))?.userId).toBe(sam.userId);
    expect(await auditOf(linked.id)).toHaveLength(before.length);
  });

  it('recovers from a wrong link: the right person can then link, and the record is ordinary again', async () => {
    const sam = await adult('sam');
    const alex = await adult('alex');
    const samsRecord = await createPerson(sam, { name: `Sam ${n}`, role: 'parent' }, deps);
    // Alex links to Sam's record by mistake; Sam cannot link to it.
    await linkSelf(alex, samsRecord.id, deps);
    await expectNotPermitted(linkSelf(sam, samsRecord.id, deps), 'already_linked');
    // Alex undoes it; Sam links.
    await unlinkSelf(alex, deps);
    expect((await linkSelf(sam, samsRecord.id, deps)).userId).toBe(sam.userId);
    // An unlinked record is no longer held by the linked-person rules.
    await unlinkSelf(sam, deps);
    await expect(updatePerson(sam, samsRecord.id, { role: 'other' }, deps)).resolves.toMatchObject({
      role: 'other',
    });
    await expect(archivePerson(sam, samsRecord.id, deps)).resolves.toMatchObject({ userId: null });
  });

  it('is visible in Activity to both adults, like the household record it is about', async () => {
    const sam = await adult('sam');
    const alex = await adult('alex');
    const linked = await linkedParent(sam);
    await unlinkSelf(sam, deps);
    const seen = async (who: UserActor) => {
      const out: string[] = [];
      let before: { id: string } | undefined;
      for (let guard = 0; guard < 10_000; guard++) {
        const page = await listAudit(who, { limit: 200, before }, deps);
        out.push(...page.rows.filter((r) => r.subjectId === linked.id).map((r) => r.event));
        if (!page.next) break;
        before = page.next;
      }
      return out;
    };
    expect(await seen(alex)).toContain('person.unlink_self');
    expect(await seen(sam)).toContain('person.unlink_self');
  });
});

describe('unlinkSelf under concurrency', () => {
  it('two unlinks at once by the same user: exactly one succeeds, one audit row', async () => {
    const sam = await adult('sam');
    const linked = await linkedParent(sam);
    // Hold the row so both calls are in flight together, then release it.
    const client = await pool.connect();
    let results: Awaited<ReturnType<typeof settle>>[];
    try {
      await client.query('begin');
      await client.query('select id from person where id = $1 for update', [linked.id]);
      const both = Promise.all([settle(unlinkSelf(sam, deps)), settle(unlinkSelf(sam, deps))]);
      await new Promise((r) => setTimeout(r, 300));
      await client.query('commit');
      results = await both;
    } finally {
      client.release();
    }
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok && failed.e).toBeInstanceOf(NotFoundError);
    expect((await auditOf(linked.id)).filter((r) => r.event === 'person.unlink_self')).toHaveLength(
      1,
    );
  });

  it('waits for a concurrent writer on the same row, then applies cleanly', async () => {
    const sam = await adult('sam');
    const linked = await linkedParent(sam);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from person where id = $1 for update', [linked.id]);
      let done = false;
      const outcome = settle(unlinkSelf(sam, deps)).finally(() => (done = true));
      await new Promise((r) => setTimeout(r, 300));
      expect(done, 'unlinkSelf must wait for the row lock').toBe(false);
      await client.query('commit');
      expect((await outcome).ok).toBe(true);
    } finally {
      client.release();
    }
    expect((await rowOf(linked.id))?.userId).toBeNull();
  });

  it('racing the other adult relinking the same person ends in a single consistent link', async () => {
    const sam = await adult('sam');
    const alex = await adult('alex');
    const linked = await linkedParent(sam);
    const [unlink, relink] = await Promise.all([
      settle(unlinkSelf(sam, deps)),
      settle(linkSelf(alex, linked.id, deps)),
    ]);
    expect(unlink.ok).toBe(true);
    const owner = (await rowOf(linked.id))?.userId;
    // Either Alex linked after Sam's unlink, or Alex lost to Sam's link.
    if (relink.ok) expect(owner).toBe(alex.userId);
    else {
      expect((relink.e as NotPermittedError).code).toBe('already_linked');
      expect(owner).toBeNull();
    }
    expect(owner).not.toBe(sam.userId);
  });
});

describe('unlinkSelf is transactional', () => {
  it('if its audit row cannot be written, the link stays', async () => {
    const sam = await adult('sam');
    const linked = await linkedParent(sam);
    // A test-only trigger rejects exactly this audit event, as the owner.
    await admin.db.execute(sql`
      create or replace function test_reject_unlink_audit() returns trigger language plpgsql as $$
      begin
        if new.event = 'person.unlink_self' then raise exception 'test: audit rejected'; end if;
        return new;
      end $$`);
    await admin.db.execute(sql`
      create trigger test_reject_unlink_audit before insert on audit_log
      for each row execute function test_reject_unlink_audit()`);
    try {
      await expect(unlinkSelf(sam, deps)).rejects.toThrow();
      expect((await rowOf(linked.id))?.userId).toBe(sam.userId);
      expect((await auditOf(linked.id)).map((r) => r.event)).not.toContain('person.unlink_self');
    } finally {
      await admin.db.execute(sql`drop trigger if exists test_reject_unlink_audit on audit_log`);
      await admin.db.execute(sql`drop function if exists test_reject_unlink_audit()`);
    }
    // With the audit path healthy again, the same call succeeds.
    await expect(unlinkSelf(sam, deps)).resolves.toMatchObject({ userId: null });
  });
});
