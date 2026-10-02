import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, person } from '@/db/schema';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import {
  archivePerson,
  createPerson,
  getPerson,
  linkSelf,
  listPeople,
  restorePerson,
  updatePerson,
} from '@/domain/people/service';
import { CANARY, CANARY_STRINGS, FAMILY_PEOPLE } from '../fixtures/family';
import { testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// The people service as the application runs it: as home_app, with the two
// fixture adults. Privacy is proven at the service boundary: the other adult
// gets NotFoundError, never a row, never a different error.

const { db, close } = testDb();
const deps = { db };
let h: Household;

beforeAll(async () => {
  h = await ensureFixtureUsers(db);
});
afterAll(close);

async function expectNotPermitted(p: Promise<unknown>, code: NotPermittedError['code']) {
  await expect(p).rejects.toBeInstanceOf(NotPermittedError);
  await p.catch((e: unknown) => expect((e as NotPermittedError).code).toBe(code));
}

describe('createPerson', () => {
  it('creates a household person with the common fields set', async () => {
    const milo = await createPerson(h.sam, FAMILY_PEOPLE.milo, deps);
    expect(milo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(milo.createdBy).toBe(h.sam.userId);
    expect(milo.createdVia).toBe('ui');
    expect(milo.visibility).toBe('household');
    expect(milo.archivedAt).toBeNull();
    expect(milo.userId).toBeNull();
    expect(milo.dateOfBirth).toBe('2017-05-03');
    expect(milo.inHousehold).toBe(true);
  });

  it('validates input with the shared Zod schema', async () => {
    await expect(createPerson(h.sam, { name: '', role: 'child' }, deps)).rejects.toThrow();
    await expect(
      createPerson(h.sam, { name: 'X', role: 'child', dateOfBirth: '2023-02-29' }, deps),
    ).rejects.toThrow();
  });

  it('refuses a Kev actor: Kev proposes, people approve (rule 3)', async () => {
    await expectNotPermitted(
      createPerson(h.samViaKev, FAMILY_PEOPLE.isla, deps),
      'kev_cannot_write',
    );
  });

  it('audits the write structurally, with the visibility snapshot and no content', async () => {
    const row = await createPerson(h.sam, CANARY.sam.person, deps);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.subjectId, row.id));
    expect(audit).toMatchObject({
      event: 'person.create',
      subjectType: 'person',
      actorUserId: h.sam.userId,
      actorVia: 'ui',
      visibility: 'private',
      visibleToUserId: h.sam.userId,
    });
    const text = JSON.stringify([audit?.summary, audit?.meta]);
    for (const s of CANARY_STRINGS.sam) expect(text).not.toContain(s);
  });

  it('a failed audit means no write: the two are one transaction', async () => {
    // A subject id longer than the column allows cannot happen; instead make
    // the audit insert fail with an actor channel the CHECK-free table still
    // accepts but a constraint elsewhere rejects — simplest honest probe:
    // an impossible createdBy breaks the FK inside the same transaction.
    const ghost = { ...h.sam, userId: 'u-nobody' };
    await expect(createPerson(ghost, FAMILY_PEOPLE.isla, deps)).rejects.toThrow();
    const rows = await db.select().from(person).where(eq(person.name, 'Isla'));
    expect(rows).toHaveLength(0);
  });
});

describe('reading people', () => {
  let shared: string;
  let samPrivate: string;
  let alexPrivate: string;

  beforeAll(async () => {
    shared = (await createPerson(h.sam, FAMILY_PEOPLE.nanaJo, deps)).id;
    samPrivate = (await getOrCreateCanary('sam')).id;
    alexPrivate = (await createPerson(h.alex, CANARY.alex.person, deps)).id;
  });

  async function getOrCreateCanary(who: 'sam') {
    const existing = (await listPeople(h[who], {}, deps)).find(
      (p) => p.name === CANARY[who].person.name,
    );
    return existing ?? createPerson(h[who], CANARY[who].person, deps);
  }

  it('shows each adult the household records and their own private ones', async () => {
    const samSees = (await listPeople(h.sam, {}, deps)).map((p) => p.id);
    const alexSees = (await listPeople(h.alex, {}, deps)).map((p) => p.id);
    expect(samSees).toContain(shared);
    expect(samSees).toContain(samPrivate);
    expect(samSees).not.toContain(alexPrivate);
    expect(alexSees).toContain(shared);
    expect(alexSees).toContain(alexPrivate);
    expect(alexSees).not.toContain(samPrivate);
  });

  it("never carries the other adult's canary strings in a list", async () => {
    const text = JSON.stringify(await listPeople(h.alex, {}, deps));
    for (const s of CANARY_STRINGS.sam) expect(text).not.toContain(s);
  });

  it("get: the other adult's private record is indistinguishable from a missing one", async () => {
    await expect(getPerson(h.alex, samPrivate, {}, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getPerson(h.alex, '00000000-0000-0000-0000-000000000000', {}, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPerson(h.sam, samPrivate, {}, deps)).resolves.toMatchObject({ id: samPrivate });
  });

  it('a Kev actor reads as the user it acts for', async () => {
    const ids = (await listPeople(h.samViaKev, {}, deps)).map((p) => p.id);
    expect(ids).toContain(samPrivate);
    expect(ids).not.toContain(alexPrivate);
  });

  it('lists in case-insensitive name order, whatever the database collation', async () => {
    const names = (await listPeople(h.sam, {}, deps)).map((p) => p.name.toLowerCase());
    // Letters only: collations differ on punctuation and case, not on a-z.
    const letters = names.map((n) => n.replace(/[^a-z]/g, ''));
    expect(letters).toEqual([...letters].sort());
  });
});

describe('updatePerson', () => {
  it('lets either adult edit a household record, and audits the field names only', async () => {
    const isla = await createPerson(h.sam, FAMILY_PEOPLE.isla, deps);
    const updated = await updatePerson(
      h.alex,
      isla.id,
      { stageNote: 'starting school in Feb' },
      deps,
    );
    expect(updated.stageNote).toBe('starting school in Feb');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(isla.updatedAt.getTime());
    const audits = await db.select().from(auditLog).where(eq(auditLog.subjectId, isla.id));
    const update = audits.find((a) => a.event === 'person.update');
    expect(update?.meta).toEqual({ fields: ['stageNote'] });
    expect(JSON.stringify(update)).not.toContain('starting school');
  });

  it("refuses to touch the other adult's private record (NotFound)", async () => {
    const mine = await createPerson(
      h.sam,
      { ...CANARY.sam.person, name: 'canary-sam-upd-7f3a' },
      deps,
    );
    await expect(updatePerson(h.alex, mine.id, { name: 'Taken' }, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getPerson(h.sam, mine.id, {}, deps)).name).toBe('canary-sam-upd-7f3a');
  });

  it('only the creator may change visibility (household → private)', async () => {
    const p = await createPerson(h.sam, { name: 'Vis Test', role: 'other' }, deps);
    await expectNotPermitted(
      updatePerson(h.alex, p.id, { visibility: 'private' }, deps),
      'not_creator',
    );
    const made = await updatePerson(h.sam, p.id, { visibility: 'private' }, deps);
    expect(made.visibility).toBe('private');
    await expect(getPerson(h.alex, p.id, {}, deps)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a Kev actor', async () => {
    const p = await createPerson(h.sam, { name: 'Kev Test', role: 'other' }, deps);
    await expectNotPermitted(
      updatePerson(h.samViaKev, p.id, { name: 'Changed' }, deps),
      'kev_cannot_write',
    );
  });

  it('an empty patch changes nothing and audits nothing', async () => {
    const p = await createPerson(h.sam, { name: 'Empty Patch', role: 'other' }, deps);
    const before = await db.select().from(auditLog).where(eq(auditLog.subjectId, p.id));
    await updatePerson(h.sam, p.id, {}, deps);
    const after = await db.select().from(auditLog).where(eq(auditLog.subjectId, p.id));
    expect(after).toHaveLength(before.length);
  });
});

describe('archive and restore', () => {
  it('archives softly, hides by default, shows with includeArchived, restores', async () => {
    const p = await createPerson(h.sam, { name: 'Archive Me', role: 'other' }, deps);
    const archived = await archivePerson(h.alex, p.id, deps);
    expect(archived.archivedAt).not.toBeNull();
    await expect(getPerson(h.sam, p.id, {}, deps)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listPeople(h.sam, {}, deps)).map((x) => x.id)).not.toContain(p.id);
    expect((await listPeople(h.sam, { includeArchived: true }, deps)).map((x) => x.id)).toContain(
      p.id,
    );
    expect((await getPerson(h.sam, p.id, { includeArchived: true }, deps)).id).toBe(p.id);
    const restored = await restorePerson(h.sam, p.id, deps);
    expect(restored.archivedAt).toBeNull();
    const events = (await db.select().from(auditLog).where(eq(auditLog.subjectId, p.id))).map(
      (a) => a.event,
    );
    expect(events).toEqual(
      expect.arrayContaining(['person.create', 'person.archive', 'person.restore']),
    );
    const stillThere = await db.select().from(person).where(eq(person.id, p.id));
    expect(stillThere).toHaveLength(1); // never hard-deleted
  });

  it("cannot archive the other adult's private record, or archive through Kev", async () => {
    const mine = await createPerson(
      h.alex,
      { ...CANARY.alex.person, name: 'canary-alex-arc-2b9c' },
      deps,
    );
    await expect(archivePerson(h.sam, mine.id, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expectNotPermitted(archivePerson(h.samViaKev, mine.id, deps), 'kev_cannot_write');
  });
});

describe('linkSelf', () => {
  it('links the acting user to an unlinked household parent, once', async () => {
    const samPerson = await createPerson(h.sam, FAMILY_PEOPLE.sam, deps);
    const linked = await linkSelf(h.sam, samPerson.id, deps);
    expect(linked.userId).toBe(h.sam.userId);
    // Already linked to someone: refused for the other adult too.
    await expectNotPermitted(linkSelf(h.alex, samPerson.id, deps), 'already_linked');
    // A user linked to one person cannot link to another.
    const another = await createPerson(h.sam, { name: 'Sam Two', role: 'parent' }, deps);
    await expectNotPermitted(linkSelf(h.sam, another.id, deps), 'already_linked');
  });

  it('refuses a child, a private record, and a Kev actor', async () => {
    const child = await createPerson(h.alex, { name: 'Link Child', role: 'child' }, deps);
    await expectNotPermitted(linkSelf(h.alex, child.id, deps), 'not_eligible');
    const hidden = await createPerson(
      h.alex,
      { name: 'Hidden Parent', role: 'parent', visibility: 'private' },
      deps,
    );
    await expectNotPermitted(linkSelf(h.alex, hidden.id, deps), 'not_eligible');
    const alexPerson = await createPerson(h.alex, FAMILY_PEOPLE.alex, deps);
    await expectNotPermitted(
      linkSelf({ ...h.alex, via: 'kev' }, alexPerson.id, deps),
      'kev_cannot_write',
    );
    // And the honest path works for Alex.
    expect((await linkSelf(h.alex, alexPerson.id, deps)).userId).toBe(h.alex.userId);
  });
});
