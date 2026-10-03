import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, eventPerson, project as projectTable, task as taskTable } from '@/db/schema';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import {
  archiveEvent,
  createEvent,
  listEventPeople,
  removeEventPerson,
  setEventPerson,
  updateEvent,
} from '@/domain/events/service';
import { createNote, updateNote } from '@/domain/notes/service';
import { archivePerson, createPerson, updatePerson } from '@/domain/people/service';
import { archiveProject, createProject, updateProject } from '@/domain/projects/service';
import { archiveTask, createTask, updateTask } from '@/domain/tasks/service';
import type { UserActor } from '@/trust/actor';
import { auditRowColumns, listAudit } from '@/trust/audit';
import { adminDb, testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// Reference rules (M2 contract §5.5) in both directions, and event
// annotations. A household record may not point at a private one; a record
// cannot become private while household records point at it; and the two
// cannot interleave (FOR SHARE on the referenced row against FOR UPDATE on
// the record changing visibility).

const { db, pool, close } = testDb();
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

const timed = {
  allDay: false,
  startsAt: '2026-10-14T15:30:00+13:00',
  endsAt: '2026-10-14T16:15:00+13:00',
  timeZone: 'UTC',
} as const;
const settle = (p: Promise<unknown>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
async function expectNotPermitted(p: Promise<unknown>, code: NotPermittedError['code']) {
  const r = await settle(p);
  expect(r.ok, `expected ${code}`).toBe(false);
  expect(!r.ok && r.e).toBeInstanceOf(NotPermittedError);
  expect(!r.ok && (r.e as NotPermittedError).code).toBe(code);
}
const expectNotFound = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(NotFoundError);
const proj = (a: UserActor, visibility: 'household' | 'private' = 'household') =>
  createProject(a, { title: 'Ref project', visibility }, deps);
const pers = (a: UserActor, visibility: 'household' | 'private' = 'household') =>
  createPerson(a, { name: 'Ref person', role: 'child', visibility }, deps);
const ev = (a: UserActor, visibility: 'household' | 'private' = 'household') =>
  createEvent(a, { title: 'Ref event', kind: 'other', time: timed, visibility }, deps);

describe('a household record may not point at a private one', () => {
  it('tasks: project, assignee and about-person', async () => {
    const pp = await proj(h.sam, 'private');
    const person = await pers(h.sam, 'private');
    await expectNotPermitted(
      createTask(h.sam, { title: 'T', projectId: pp.id }, deps),
      'references_private',
    );
    await expectNotPermitted(
      createTask(h.sam, { title: 'T', assigneePersonId: person.id }, deps),
      'references_private',
    );
    await expectNotPermitted(
      createTask(h.sam, { title: 'T', aboutPersonId: person.id }, deps),
      'references_private',
    );
    // A private task may, for its creator.
    const t = await createTask(
      h.sam,
      { title: 'T', projectId: pp.id, aboutPersonId: person.id, visibility: 'private' },
      deps,
    );
    expect(t.projectId).toBe(pp.id);
    // And it cannot then become household while it points there.
    await expectNotPermitted(
      updateTask(h.sam, t.id, { visibility: 'household' }, deps),
      'references_private',
    );
  });

  it('notes: about a private project, person or event', async () => {
    for (const subject of [
      { type: 'project' as const, id: (await proj(h.sam, 'private')).id },
      { type: 'person' as const, id: (await pers(h.sam, 'private')).id },
      { type: 'event' as const, id: (await ev(h.sam, 'private')).id },
    ]) {
      await expectNotPermitted(
        createNote(h.sam, { body: 'x', subject }, deps),
        'references_private',
      );
      const mine = await createNote(h.sam, { body: 'x', subject, visibility: 'private' }, deps);
      await expectNotPermitted(
        updateNote(h.sam, mine.id, { visibility: 'household' }, deps),
        'references_private',
      );
    }
  });

  it('references the actor cannot see are NotFound, and so are archived ones', async () => {
    const alexPrivate = await proj(h.alex, 'private');
    await expectNotFound(
      createTask(h.sam, { title: 'T', projectId: alexPrivate.id, visibility: 'private' }, deps),
    );
    const gone = await proj(h.sam);
    await archiveProject(h.sam, gone.id, deps);
    await expectNotFound(createTask(h.sam, { title: 'T', projectId: gone.id }, deps));
    await expectNotFound(
      createNote(
        h.sam,
        { body: 'x', subject: { type: 'event', id: '00000000-0000-0000-0000-000000000000' } },
        deps,
      ),
    );
  });

  it('changing a reference re-checks it; household-to-household is fine', async () => {
    const p1 = await proj(h.sam);
    const p2 = await proj(h.alex);
    const t = await createTask(h.alex, { title: 'T', projectId: p1.id }, deps);
    expect((await updateTask(h.sam, t.id, { projectId: p2.id }, deps)).projectId).toBe(p2.id);
    const pp = await proj(h.sam, 'private');
    await expectNotPermitted(
      updateTask(h.sam, t.id, { projectId: pp.id }, deps),
      'references_private',
    );
    expect((await updateTask(h.sam, t.id, { projectId: null }, deps)).projectId).toBeNull();
  });
});

describe('a record household records point at cannot become private', () => {
  it('a project with household tasks or notes, archived ones included', async () => {
    const p = await proj(h.sam);
    const t = await createTask(h.sam, { title: 'T', projectId: p.id }, deps);
    await expectNotPermitted(
      updateProject(h.sam, p.id, { visibility: 'private' }, deps),
      'referenced_by_household',
    );
    await archiveTask(h.sam, t.id, deps); // archived records can be restored, so they still count
    await expectNotPermitted(
      updateProject(h.sam, p.id, { visibility: 'private' }, deps),
      'referenced_by_household',
    );
    const p2 = await proj(h.sam);
    await createNote(h.sam, { body: 'x', subject: { type: 'project', id: p2.id } }, deps);
    await expectNotPermitted(
      updateProject(h.sam, p2.id, { visibility: 'private' }, deps),
      'referenced_by_household',
    );
    // Once nothing household points at it, it may.
    const free = await proj(h.sam);
    expect((await updateProject(h.sam, free.id, { visibility: 'private' }, deps)).visibility).toBe(
      'private',
    );
  });

  it('a person with household tasks, notes or household-event annotations', async () => {
    const cases: ((id: string) => Promise<unknown>)[] = [
      (id) => createTask(h.sam, { title: 'T', assigneePersonId: id }, deps),
      (id) => createTask(h.sam, { title: 'T', aboutPersonId: id }, deps),
      (id) => createNote(h.sam, { body: 'x', subject: { type: 'person', id } }, deps),
      async (id) =>
        setEventPerson(
          h.sam,
          { eventId: (await ev(h.sam)).id, personId: id, role: 'attending' },
          deps,
        ),
    ];
    for (const point of cases) {
      const p = await pers(h.sam);
      await point(p.id);
      await expectNotPermitted(
        updatePerson(h.sam, p.id, { visibility: 'private' }, deps),
        'referenced_by_household',
      );
    }
  });

  it('an event with household notes; a private event cannot become household with private people on it', async () => {
    const e = await ev(h.sam);
    await createNote(h.alex, { body: 'x', subject: { type: 'event', id: e.id } }, deps);
    await expectNotPermitted(
      updateEvent(h.sam, e.id, { visibility: 'private' }, deps),
      'referenced_by_household',
    );
    const pe = await ev(h.sam, 'private');
    const secret = await pers(h.sam, 'private');
    await setEventPerson(h.sam, { eventId: pe.id, personId: secret.id, role: 'attending' }, deps);
    await expectNotPermitted(
      updateEvent(h.sam, pe.id, { visibility: 'household' }, deps),
      'references_private',
    );
  });
});

describe('references and visibility changes never interleave', () => {
  it('a task created while its project turns private is refused once the change commits', async () => {
    const p = await proj(h.sam);
    const client = await pool.connect();
    let r: Awaited<ReturnType<typeof settle>>;
    try {
      await client.query('begin');
      await client.query(`update project set visibility = 'private' where id = $1`, [p.id]);
      let done = false;
      const pending = settle(createTask(h.sam, { title: 'Raced', projectId: p.id }, deps)).finally(
        () => (done = true),
      );
      await new Promise((res) => setTimeout(res, 300));
      expect(done, 'the reference check must wait').toBe(false);
      await client.query('commit');
      r = await pending;
    } finally {
      client.release();
    }
    expect(!r.ok && (r.e as NotPermittedError).code).toBe('references_private');
    expect(await db.select().from(taskTable).where(eq(taskTable.projectId, p.id))).toHaveLength(0);
  });

  it('a project turning private while a household task is being added to it is refused once the task commits', async () => {
    const p = await proj(h.sam);
    const client = await pool.connect();
    let r: Awaited<ReturnType<typeof settle>>;
    try {
      // Another writer adds a household task, holding the project as a reference would.
      await client.query('begin');
      await client.query('select id from project where id = $1 for share', [p.id]);
      await client.query(
        `insert into task (created_by, created_via, title, project_id) values ($1, 'ui', 'Concurrent', $2)`,
        [h.alex.userId, p.id],
      );
      let done = false;
      const pending = settle(updateProject(h.sam, p.id, { visibility: 'private' }, deps)).finally(
        () => (done = true),
      );
      await new Promise((res) => setTimeout(res, 300));
      expect(done, 'the visibility change must wait').toBe(false);
      await client.query('commit');
      r = await pending;
    } finally {
      client.release();
    }
    expect(!r.ok && (r.e as NotPermittedError).code).toBe('referenced_by_household');
    const [row] = await db.select().from(projectTable).where(eq(projectTable.id, p.id));
    expect(row?.visibility).toBe('household');
  });
});

describe('event annotations (EventPerson)', () => {
  it('sets idempotently, lists, removes; audited as the event, structurally', async () => {
    const e = await ev(h.sam);
    const p = await pers(h.alex);
    const a1 = await setEventPerson(
      h.alex,
      { eventId: e.id, personId: p.id, role: 'responsible' },
      deps,
    );
    const a2 = await setEventPerson(
      h.sam,
      { eventId: e.id, personId: p.id, role: 'responsible' },
      deps,
    );
    expect(a2.id).toBe(a1.id);
    await setEventPerson(h.sam, { eventId: e.id, personId: p.id, role: 'attending' }, deps);
    expect((await listEventPeople(h.sam, e.id, {}, deps)).map((x) => x.role)).toEqual([
      'attending',
      'responsible',
    ]);
    await removeEventPerson(h.sam, { eventId: e.id, personId: p.id, role: 'attending' }, deps);
    await expectNotFound(
      removeEventPerson(h.sam, { eventId: e.id, personId: p.id, role: 'attending' }, deps),
    );
    const rows = await db
      .select(auditRowColumns)
      .from(auditLog)
      .where(eq(auditLog.subjectId, e.id))
      .orderBy(auditLog.at);
    expect(rows.map((r) => r.event)).toEqual([
      'event.create',
      'event_person.set',
      'event_person.set',
      'event_person.remove',
    ]);
    expect(rows.every((r) => r.subjectType === 'event' && r.summary === null)).toBe(true);
    expect(rows[1]?.meta).toEqual({ personId: p.id, role: 'responsible' });
  });

  it('follow their event: the other adult cannot see, set or remove annotations on a private event', async () => {
    const e = await ev(h.sam, 'private');
    const p = await pers(h.sam);
    await setEventPerson(h.sam, { eventId: e.id, personId: p.id, role: 'attending' }, deps);
    await expectNotFound(listEventPeople(h.alex, e.id, {}, deps));
    await expectNotFound(
      setEventPerson(h.alex, { eventId: e.id, personId: p.id, role: 'responsible' }, deps),
    );
    await expectNotFound(
      removeEventPerson(h.alex, { eventId: e.id, personId: p.id, role: 'attending' }, deps),
    );
    const seen = async (a: UserActor) => {
      const page = await listAudit(a, { limit: 200 }, deps);
      return page.rows.filter((r) => r.subjectId === e.id).map((r) => r.event);
    };
    expect(await seen(h.alex)).toEqual([]);
    expect(await seen(h.sam)).toContain('event_person.set');
  });

  it('a household event cannot be annotated with a private person; invisible people are NotFound', async () => {
    const e = await ev(h.sam);
    const secret = await pers(h.sam, 'private');
    await expectNotPermitted(
      setEventPerson(h.sam, { eventId: e.id, personId: secret.id, role: 'attending' }, deps),
      'references_private',
    );
    await expectNotFound(
      setEventPerson(h.alex, { eventId: e.id, personId: secret.id, role: 'attending' }, deps),
    );
    const archived = await pers(h.sam);
    await archivePerson(h.sam, archived.id, deps);
    await expectNotFound(
      setEventPerson(h.sam, { eventId: e.id, personId: archived.id, role: 'attending' }, deps),
    );
  });

  it('an archived event takes no annotations; Kev cannot annotate', async () => {
    const e = await ev(h.sam);
    const p = await pers(h.sam);
    await expect(
      setEventPerson(h.samViaKev, { eventId: e.id, personId: p.id, role: 'attending' }, deps),
    ).rejects.toBeInstanceOf(NotPermittedError);
    await archiveEvent(h.sam, e.id, deps);
    await expectNotFound(
      setEventPerson(h.sam, { eventId: e.id, personId: p.id, role: 'attending' }, deps),
    );
    expect(await db.select().from(eventPerson).where(eq(eventPerson.eventId, e.id))).toHaveLength(
      0,
    );
  });

  it('an annotation whose audit row is rejected is not written', async () => {
    const e = await ev(h.sam);
    const p = await pers(h.sam);
    await admin.db.execute(sql`
      create or replace function test_reject_annotation_audit() returns trigger language plpgsql as $$
      begin
        if new.event = 'event_person.set' then raise exception 'test: audit rejected'; end if;
        return new;
      end $$`);
    await admin.db
      .execute(sql`create trigger test_reject_annotation_audit before insert on audit_log
      for each row execute function test_reject_annotation_audit()`);
    try {
      await expect(
        setEventPerson(h.sam, { eventId: e.id, personId: p.id, role: 'attending' }, deps),
      ).rejects.toThrow();
    } finally {
      await admin.db.execute(sql`drop trigger if exists test_reject_annotation_audit on audit_log`);
      await admin.db.execute(sql`drop function if exists test_reject_annotation_audit()`);
    }
    expect(await db.select().from(eventPerson).where(eq(eventPerson.eventId, e.id))).toHaveLength(
      0,
    );
  });
});
