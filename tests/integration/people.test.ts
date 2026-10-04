import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { person } from '@/db/schema';
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
import { auditRowColumns } from '@/trust/audit';
import { auditLog } from '@/db/schema';
import { CANARY, CANARY_MARK, FAMILY_PEOPLE } from '../fixtures/family';
import { testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// The People service as the application runs it: as home_app, with the two
// fixture adults. The other adult's private record must be indistinguishable
// from a missing one, for every operation.

const { db, close } = testDb();
const deps = { db };
let h: Household;
beforeAll(async () => {
  h = await ensureFixtureUsers(db);
});
afterAll(close);

let n = 0;
const unique = (base: string) => `${base}-${++n}`;
const privateOf = (who: 'sam' | 'alex') => ({ ...CANARY[who], name: unique(CANARY[who].name) });

async function expectNotPermitted(p: Promise<unknown>, code: NotPermittedError['code']) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(NotPermittedError);
  expect((e as NotPermittedError).code).toBe(code);
}
const expectNotFound = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(NotFoundError);

const auditFor = (id: string) =>
  db.select(auditRowColumns).from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.at);

describe('createPerson', () => {
  it('creates with the common fields set from the actor, never from input', async () => {
    const milo = await createPerson(h.sam, FAMILY_PEOPLE.milo, deps);
    expect(milo).toMatchObject({
      createdBy: h.sam.userId,
      createdVia: 'ui',
      visibility: 'household',
      archivedAt: null,
      userId: null,
      dateOfBirth: '2017-05-03',
      inHousehold: true,
    });
  });

  it('validates with the shared Zod schema', async () => {
    await expect(createPerson(h.sam, { name: '', role: 'child' }, deps)).rejects.toThrow();
    await expect(
      createPerson(h.sam, { name: 'X', role: 'child', dateOfBirth: '2023-02-29' }, deps),
    ).rejects.toThrow();
  });

  it('audits structurally: event, subject, enum meta and the P-1 snapshot; no names or notes', async () => {
    const row = await createPerson(h.sam, privateOf('sam'), deps);
    const [a] = await auditFor(row.id);
    expect(a).toMatchObject({
      event: 'person.create',
      subjectType: 'person',
      actorUserId: h.sam.userId,
      actorVia: 'ui',
      summary: null,
      meta: { role: 'other', visibility: 'private' },
    });
    const snap = await db.execute(
      sql`select visibility, visible_to_user_id from audit_log where id = ${a?.id}::uuid`,
    );
    expect(snap.rows[0]).toEqual({ visibility: 'private', visible_to_user_id: h.sam.userId });
    expect(JSON.stringify(a)).not.toContain(CANARY_MARK.sam);
  });
});

describe('reading', () => {
  let shared: string;
  let samPrivate: string;
  let alexPrivate: string;
  beforeAll(async () => {
    shared = (await createPerson(h.sam, FAMILY_PEOPLE.nanaJo, deps)).id;
    samPrivate = (await createPerson(h.sam, privateOf('sam'), deps)).id;
    alexPrivate = (await createPerson(h.alex, privateOf('alex'), deps)).id;
  });

  it('shows each adult household records and their own private ones only', async () => {
    const sam = (await listPeople(h.sam, {}, deps)).map((p) => p.id);
    const alex = (await listPeople(h.alex, {}, deps)).map((p) => p.id);
    expect(sam).toEqual(expect.arrayContaining([shared, samPrivate]));
    expect(sam).not.toContain(alexPrivate);
    expect(alex).toEqual(expect.arrayContaining([shared, alexPrivate]));
    expect(alex).not.toContain(samPrivate);
    expect(JSON.stringify(await listPeople(h.alex, { includeArchived: true }, deps))).not.toContain(
      CANARY_MARK.sam,
    );
  });

  it("the other adult's private record, a missing id and a malformed id all read as NotFound", async () => {
    await expectNotFound(getPerson(h.alex, samPrivate, {}, deps));
    await expectNotFound(getPerson(h.alex, samPrivate, { includeArchived: true }, deps));
    await expectNotFound(getPerson(h.alex, '00000000-0000-0000-0000-000000000000', {}, deps));
    await expectNotFound(getPerson(h.alex, 'not-a-uuid', {}, deps));
    await expect(getPerson(h.sam, samPrivate, {}, deps)).resolves.toMatchObject({ id: samPrivate });
  });

  it('Kev reads as the user it acts for', async () => {
    const ids = (await listPeople(h.samViaKev, {}, deps)).map((p) => p.id);
    expect(ids).toContain(samPrivate);
    expect(ids).not.toContain(alexPrivate);
  });

  it('lists in case-insensitive name order', async () => {
    const letters = (await listPeople(h.sam, {}, deps)).map((p) =>
      p.name.toLowerCase().replace(/[^a-z]/g, ''),
    );
    expect(letters).toEqual([...letters].sort());
  });
});

describe('updatePerson', () => {
  it('lets either adult edit a household record, auditing field names only, on the database clock', async () => {
    const isla = await createPerson(h.sam, FAMILY_PEOPLE.isla, deps);
    const updated = await updatePerson(
      h.alex,
      isla.id,
      { stageNote: 'starting school in Feb' },
      deps,
    );
    expect(updated.stageNote).toBe('starting school in Feb');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(isla.updatedAt.getTime());
    const [, a] = await auditFor(isla.id);
    expect(a).toMatchObject({
      event: 'person.update',
      actorUserId: h.alex.userId,
      meta: { fields: ['stageNote'] },
    });
    expect(JSON.stringify(a)).not.toContain('starting school');
  });

  it('writes and audits only the fields that change; an unchanged patch is a no-op', async () => {
    const nana = await createPerson(
      h.sam,
      { ...FAMILY_PEOPLE.nanaJo, name: unique('Nana Audit') },
      deps,
    );
    // A form sends every field it shows; only the stage note differs.
    const updated = await updatePerson(
      h.alex,
      nana.id,
      {
        name: nana.name,
        shortName: nana.shortName,
        relationship: nana.relationship,
        inHousehold: nana.inHousehold,
        dateOfBirth: nana.dateOfBirth,
        stageNote: 'visiting at Christmas',
        colour: nana.colour as (typeof FAMILY_PEOPLE.sam)['colour'] | null,
      },
      deps,
    );
    expect(updated.stageNote).toBe('visiting at Christmas');
    const rows = await auditFor(nana.id);
    expect(rows.at(-1)).toMatchObject({ event: 'person.update', meta: { fields: ['stageNote'] } });
    // Sending the same values again changes nothing and audits nothing.
    const again = await updatePerson(
      h.alex,
      nana.id,
      { name: nana.name, stageNote: 'visiting at Christmas' },
      deps,
    );
    expect(again.updatedAt.getTime()).toBe(updated.updatedAt.getTime());
    expect(await auditFor(nana.id)).toHaveLength(rows.length);
  });

  it("cannot touch the other adult's private record", async () => {
    const mine = await createPerson(h.sam, privateOf('sam'), deps);
    await expectNotFound(updatePerson(h.alex, mine.id, { name: 'Taken' }, deps));
    expect((await getPerson(h.sam, mine.id, {}, deps)).name).toBe(mine.name);
  });

  it('only the creator may change visibility', async () => {
    const p = await createPerson(h.sam, { name: 'Vis Test', role: 'other' }, deps);
    await expectNotPermitted(
      updatePerson(h.alex, p.id, { visibility: 'private' }, deps),
      'not_creator',
    );
    expect((await updatePerson(h.sam, p.id, { visibility: 'private' }, deps)).visibility).toBe(
      'private',
    );
    await expectNotFound(getPerson(h.alex, p.id, {}, deps));
  });

  it('an empty patch changes nothing and audits nothing; archived records cannot be edited', async () => {
    const p = await createPerson(h.sam, { name: 'Empty Patch', role: 'other' }, deps);
    await updatePerson(h.sam, p.id, {}, deps);
    expect(await auditFor(p.id)).toHaveLength(1);
    await archivePerson(h.sam, p.id, deps);
    await expectNotFound(updatePerson(h.sam, p.id, { stageNote: 'x' }, deps));
  });
});

describe('archive and restore', () => {
  it('archives softly, hides by default, restores, on one database timestamp per write', async () => {
    const p = await createPerson(h.sam, { name: 'Archive Me', role: 'other' }, deps);
    const archived = await archivePerson(h.alex, p.id, deps);
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.archivedAt?.getTime()).toBe(archived.updatedAt.getTime());
    await expectNotFound(getPerson(h.sam, p.id, {}, deps));
    expect((await listPeople(h.sam, {}, deps)).map((x) => x.id)).not.toContain(p.id);
    expect((await listPeople(h.sam, { includeArchived: true }, deps)).map((x) => x.id)).toContain(
      p.id,
    );
    const restored = await restorePerson(h.sam, p.id, deps);
    expect(restored.archivedAt).toBeNull();
    expect(restored.updatedAt.getTime()).toBeGreaterThanOrEqual(archived.updatedAt.getTime());
    expect((await auditFor(p.id)).map((a) => a.event)).toEqual([
      'person.create',
      'person.archive',
      'person.restore',
    ]);
    expect(await db.select({ id: person.id }).from(person).where(eq(person.id, p.id))).toHaveLength(
      1,
    );
  });

  it('archiving twice reads as NotFound; restoring a live record is refused', async () => {
    const p = await createPerson(h.sam, { name: 'Twice', role: 'other' }, deps);
    await expectNotPermitted(restorePerson(h.sam, p.id, deps), 'not_archived');
    await archivePerson(h.sam, p.id, deps);
    await expectNotFound(archivePerson(h.sam, p.id, deps));
  });

  it("cannot archive or restore the other adult's private record, archived or not", async () => {
    const mine = await createPerson(h.alex, privateOf('alex'), deps);
    await expectNotFound(archivePerson(h.sam, mine.id, deps));
    await archivePerson(h.alex, mine.id, deps);
    await expectNotFound(restorePerson(h.sam, mine.id, deps));
    await expectNotFound(getPerson(h.sam, mine.id, { includeArchived: true }, deps));
  });
});

describe('Kev never writes (rule 3)', () => {
  it('refuses create, update, archive, restore and linkSelf through Kev, and writes nothing', async () => {
    const p = await createPerson(h.sam, { name: 'Kev Test', role: 'parent' }, deps);
    await archivePerson(h.sam, p.id, deps);
    const before = await auditFor(p.id);
    await expectNotPermitted(
      createPerson(h.samViaKev, { name: 'Kev Made', role: 'other' }, deps),
      'kev_cannot_write',
    );
    await expectNotPermitted(
      updatePerson(h.samViaKev, p.id, { name: 'Changed' }, deps),
      'kev_cannot_write',
    );
    await expectNotPermitted(archivePerson(h.samViaKev, p.id, deps), 'kev_cannot_write');
    await expectNotPermitted(restorePerson(h.samViaKev, p.id, deps), 'kev_cannot_write');
    await expectNotPermitted(linkSelf(h.samViaKev, p.id, deps), 'kev_cannot_write');
    expect(await auditFor(p.id)).toHaveLength(before.length);
    expect(await db.select().from(person).where(eq(person.name, 'Kev Made'))).toHaveLength(0);
  });
});

describe('linkSelf', () => {
  // The fixture users link once per run; later tests use fresh users.
  it('links the acting user to an unlinked household parent, once', async () => {
    const samPerson = await createPerson(h.sam, FAMILY_PEOPLE.sam, deps);
    const linked = await linkSelf(h.sam, samPerson.id, deps);
    expect(linked.userId).toBe(h.sam.userId);
    const [, a] = await auditFor(samPerson.id);
    expect(a).toMatchObject({ event: 'person.link_self', actorUserId: h.sam.userId });
    // The person is taken, for anyone.
    await expectNotPermitted(linkSelf(h.alex, samPerson.id, deps), 'already_linked');
    // The user is taken: no second person.
    const another = await createPerson(h.sam, { name: 'Sam Two', role: 'parent' }, deps);
    await expectNotPermitted(linkSelf(h.sam, another.id, deps), 'already_linked');
  });

  it('refuses a child, an other, a private parent, an archived parent and an invisible one', async () => {
    const child = await createPerson(h.alex, { name: 'Link Child', role: 'child' }, deps);
    await expectNotPermitted(linkSelf(h.alex, child.id, deps), 'not_eligible');
    const other = await createPerson(h.alex, { name: 'Link Other', role: 'other' }, deps);
    await expectNotPermitted(linkSelf(h.alex, other.id, deps), 'not_eligible');
    const hidden = await createPerson(
      h.alex,
      { name: 'Hidden Parent', role: 'parent', visibility: 'private' },
      deps,
    );
    await expectNotPermitted(linkSelf(h.alex, hidden.id, deps), 'not_eligible');
    await expectNotFound(linkSelf(h.sam, hidden.id, deps)); // Sam cannot even see it
    const gone = await createPerson(h.alex, { name: 'Gone Parent', role: 'parent' }, deps);
    await archivePerson(h.alex, gone.id, deps);
    await expectNotFound(linkSelf(h.alex, gone.id, deps));
    // And the honest path works.
    const alexPerson = await createPerson(h.alex, FAMILY_PEOPLE.alex, deps);
    expect((await linkSelf(h.alex, alexPerson.id, deps)).userId).toBe(h.alex.userId);
  });

  it('a linked person stays a household parent: no private, no role change, no archive', async () => {
    const linked = (await listPeople(h.sam, {}, deps)).find((p) => p.userId === h.sam.userId);
    if (!linked) throw new Error('Sam should be linked by now');
    await expectNotPermitted(
      updatePerson(h.sam, linked.id, { visibility: 'private' }, deps),
      'linked_person',
    );
    await expectNotPermitted(
      updatePerson(h.alex, linked.id, { role: 'other' }, deps),
      'linked_person',
    );
    await expectNotPermitted(archivePerson(h.alex, linked.id, deps), 'linked_person');
    // Ordinary edits still work, and the link survives them.
    const edited = await updatePerson(h.alex, linked.id, { shortName: 'S' }, deps);
    expect(edited).toMatchObject({
      userId: h.sam.userId,
      shortName: 'S',
      role: 'parent',
      visibility: 'household',
    });
  });
});
