import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '@/db/schema';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import * as events from '@/domain/events/service';
import * as notes from '@/domain/notes/service';
import * as projects from '@/domain/projects/service';
import * as tasks from '@/domain/tasks/service';
import { systemActor, type UserActor } from '@/trust/actor';
import { auditRowColumns, listAudit } from '@/trust/audit';
import { adminDb, testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// What every user-facing record shares (M2 contract §5), run against each
// Package 3b service: privacy at the service boundary, Kev and system
// refusal, archive and restore on the database clock, record-following
// Activity (P-1), structural audit, rollback, and the race of a concurrent
// change to private. Event annotations, references and entity specifics
// have their own suites.

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

type Row = {
  id: string;
  visibility: string;
  createdBy: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
};
type Service = {
  name: 'event' | 'project' | 'task' | 'note';
  table: string;
  /** A valid create input whose user-written text carries `mark`. */
  input: (mark: string, visibility?: 'household' | 'private') => Record<string, unknown>;
  /** A valid patch that writes `mark` into user-written text. */
  edit: (mark: string) => Record<string, unknown>;
  create: (a: UserActor, input: never) => Promise<Row>;
  get: (a: UserActor, id: string, o?: { includeArchived?: boolean }) => Promise<Row>;
  list: (a: UserActor, o?: { includeArchived?: boolean }) => Promise<Row[]>;
  update: (a: UserActor, id: string, patch: never) => Promise<Row>;
  archive: (a: UserActor, id: string) => Promise<Row>;
  restore: (a: UserActor, id: string) => Promise<Row>;
};

const timed = {
  allDay: false,
  startsAt: '2026-10-14T15:30:00+13:00',
  endsAt: '2026-10-14T16:15:00+13:00',
  timeZone: 'UTC',
};

const SERVICES: Service[] = [
  {
    name: 'event',
    table: 'event',
    input: (mark, visibility = 'household') => ({
      title: mark,
      kind: 'other',
      time: timed,
      visibility,
      description: mark,
    }),
    edit: (mark) => ({ description: mark }),
    create: (a, i) => events.createEvent(a, i, deps),
    get: (a, id, o) => events.getEvent(a, id, o, deps),
    list: (a, o) => events.listEvents(a, o, deps),
    update: (a, id, p) => events.updateEvent(a, id, p, deps),
    archive: (a, id) => events.archiveEvent(a, id, deps),
    restore: (a, id) => events.restoreEvent(a, id, deps),
  },
  {
    name: 'project',
    table: 'project',
    input: (mark, visibility = 'household') => ({ title: mark, summary: mark, visibility }),
    edit: (mark) => ({ summary: mark }),
    create: (a, i) => projects.createProject(a, i, deps),
    get: (a, id, o) => projects.getProject(a, id, o, deps),
    list: (a, o) => projects.listProjects(a, o, deps),
    update: (a, id, p) => projects.updateProject(a, id, p, deps),
    archive: (a, id) => projects.archiveProject(a, id, deps),
    restore: (a, id) => projects.restoreProject(a, id, deps),
  },
  {
    name: 'task',
    table: 'task',
    input: (mark, visibility = 'household') => ({ title: mark, notes: mark, visibility }),
    edit: (mark) => ({ notes: mark }),
    create: (a, i) => tasks.createTask(a, i, deps),
    get: (a, id, o) => tasks.getTask(a, id, o, deps),
    list: (a, o) => tasks.listTasks(a, o, deps),
    update: (a, id, p) => tasks.updateTask(a, id, p, deps),
    archive: (a, id) => tasks.archiveTask(a, id, deps),
    restore: (a, id) => tasks.restoreTask(a, id, deps),
  },
  {
    name: 'note',
    table: 'note',
    input: (mark, visibility = 'household') => ({ body: mark, visibility }),
    edit: (mark) => ({ body: mark }),
    create: (a, i) => notes.createNote(a, i, deps),
    get: (a, id, o) => notes.getNote(a, id, o, deps),
    list: (a, o) => notes.listNotes(a, o, deps),
    update: (a, id, p) => notes.updateNote(a, id, p, deps),
    archive: (a, id) => notes.archiveNote(a, id, deps),
    restore: (a, id) => notes.restoreNote(a, id, deps),
  },
];

let n = 0;
const mark = (who: string, s: Service) => `canary-${who}-${s.name}-${++n}`;
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
const expectNotFound = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(NotFoundError);
const auditOf = (id: string) =>
  db.select(auditRowColumns).from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.at);
async function activityAbout(actor: UserActor | typeof systemActor, id: string) {
  const out: string[] = [];
  let before: { id: string } | undefined;
  for (let guard = 0; guard < 10_000; guard++) {
    const page = await listAudit(actor, { limit: 200, before }, deps);
    out.push(...page.rows.filter((r) => r.subjectId === id).map((r) => r.event));
    if (!page.next) break;
    before = page.next;
  }
  return out;
}

describe.each(SERVICES)('$name service', (s) => {
  const make = (a: UserActor, m: string, v?: 'household' | 'private') =>
    s.create(a, s.input(m, v) as never);

  it('creates with the common fields set from the actor, audited structurally with the P-1 snapshot', async () => {
    const m = mark('sam', s);
    const row = await make(h.sam, m, 'private');
    expect(row).toMatchObject({ createdBy: h.sam.userId, visibility: 'private', archivedAt: null });
    expect((row as unknown as { createdVia: string }).createdVia).toBe('ui');
    const [a] = await auditOf(row.id);
    expect(a).toMatchObject({
      event: `${s.name}.create`,
      subjectType: s.name,
      actorUserId: h.sam.userId,
      summary: null,
    });
    const snap = await db.execute(
      sql`select visibility, visible_to_user_id from audit_log where id = ${a?.id}::uuid`,
    );
    expect(snap.rows[0]).toEqual({ visibility: 'private', visible_to_user_id: h.sam.userId });
    expect(JSON.stringify(a)).not.toContain(m);
  });

  it("the other adult's private record is NotFound for every operation, archived or not", async () => {
    const row = await make(h.sam, mark('sam', s), 'private');
    await expectNotFound(s.get(h.alex, row.id));
    await expectNotFound(s.update(h.alex, row.id, s.edit('alex-wrote') as never));
    await expectNotFound(s.archive(h.alex, row.id));
    expect((await s.list(h.alex, { includeArchived: true })).map((r) => r.id)).not.toContain(
      row.id,
    );
    await s.archive(h.sam, row.id);
    await expectNotFound(s.get(h.alex, row.id, { includeArchived: true }));
    await expectNotFound(s.restore(h.alex, row.id));
    expect((await s.list(h.alex, { includeArchived: true })).map((r) => r.id)).not.toContain(
      row.id,
    );
    // Missing and malformed ids look exactly the same.
    await expectNotFound(s.get(h.alex, '00000000-0000-0000-0000-000000000000'));
    await expectNotFound(s.get(h.alex, 'not-a-uuid'));
  });

  it('either adult edits a household record; only the creator changes visibility', async () => {
    const row = await make(h.sam, mark('sam', s));
    const edited = await s.update(h.alex, row.id, s.edit('edited-by-alex') as never);
    expect(edited.updatedAt.getTime()).toBeGreaterThanOrEqual(row.updatedAt.getTime());
    await expectNotPermitted(
      s.update(h.alex, row.id, { visibility: 'private' } as never),
      'not_creator',
    );
    expect((await s.update(h.sam, row.id, { visibility: 'private' } as never)).visibility).toBe(
      'private',
    );
    await expectNotFound(s.get(h.alex, row.id));
    const [, upd] = await auditOf(row.id);
    expect(upd?.meta).toMatchObject({ fields: expect.any(Array) });
    expect(JSON.stringify(upd)).not.toContain('edited-by-alex');
  });

  it('archives softly and restores, each on one database timestamp; restoring a live record is refused', async () => {
    const row = await make(h.sam, mark('sam', s));
    await expectNotPermitted(s.restore(h.sam, row.id), 'not_archived');
    const archived = await s.archive(h.alex, row.id);
    expect(archived.archivedAt?.getTime()).toBe(archived.updatedAt.getTime());
    await expectNotFound(s.get(h.sam, row.id));
    await expectNotFound(s.archive(h.sam, row.id));
    await expectNotFound(s.update(h.sam, row.id, s.edit('x') as never));
    expect((await s.list(h.sam)).map((r) => r.id)).not.toContain(row.id);
    expect((await s.list(h.sam, { includeArchived: true })).map((r) => r.id)).toContain(row.id);
    expect((await s.restore(h.sam, row.id)).archivedAt).toBeNull();
    expect((await auditOf(row.id)).map((a) => a.event)).toEqual([
      `${s.name}.create`,
      `${s.name}.archive`,
      `${s.name}.restore`,
    ]);
  });

  it('refuses Kev and the system actor on every write, writing nothing', async () => {
    const row = await make(h.sam, mark('sam', s));
    await s.archive(h.sam, row.id);
    const before = await auditOf(row.id);
    const sys = systemActor as unknown as UserActor;
    for (const actor of [h.samViaKev, sys]) {
      const code = actor === sys ? 'not_a_user' : 'kev_cannot_write';
      await expectNotPermitted(make(actor, mark('kev', s)), code);
      await expectNotPermitted(s.update(actor, row.id, s.edit('kev') as never), code);
      await expectNotPermitted(s.archive(actor, row.id), code);
      await expectNotPermitted(s.restore(actor, row.id), code);
    }
    expect(await auditOf(row.id)).toHaveLength(before.length);
    // Nothing Kev or the system tried to write reached the table, in any column.
    const kevMade = await admin.db.execute(
      sql.raw(
        `select count(*)::int as n from ${s.table} t where row_to_json(t)::text like '%canary-kev-%'`,
      ),
    );
    expect(kevMade.rows[0]?.n).toBe(0);
  });

  it('Activity follows the record: hidden from the other adult while private, including earlier household rows', async () => {
    const row = await make(h.sam, mark('sam', s));
    await s.update(h.alex, row.id, s.edit('alex-edit') as never);
    expect(await activityAbout(h.alex, row.id)).toEqual([`${s.name}.update`, `${s.name}.create`]);
    await s.update(h.sam, row.id, { visibility: 'private' } as never);
    expect(await activityAbout(h.alex, row.id)).toEqual([]);
    expect(await activityAbout(h.sam, row.id)).toHaveLength(3);
    await s.update(h.sam, row.id, { visibility: 'household' } as never);
    expect(await activityAbout(h.alex, row.id)).toHaveLength(4);
  });

  it('a write and its audit row are one transaction: a rejected audit leaves no record', async () => {
    const m = mark('sam', s);
    await admin.db.execute(
      sql.raw(`
      create or replace function test_reject_create_audit() returns trigger language plpgsql as $$
      begin
        if new.event = '${s.name}.create' then raise exception 'test: audit rejected'; end if;
        return new;
      end $$`),
    );
    await admin.db.execute(sql`create trigger test_reject_create_audit before insert on audit_log
      for each row execute function test_reject_create_audit()`);
    try {
      await expect(make(h.sam, m)).rejects.toThrow();
    } finally {
      await admin.db.execute(sql`drop trigger if exists test_reject_create_audit on audit_log`);
      await admin.db.execute(sql`drop function if exists test_reject_create_audit()`);
    }
    const col = s.name === 'note' ? 'body' : 'title';
    const left = await admin.db.execute(
      sql.raw(`select count(*)::int as n from ${s.table} where ${col} = '${m}'`),
    );
    expect(left.rows[0]?.n).toBe(0);
  });

  it.each(['update', 'archive'] as const)(
    'race: the other adult cannot %s a record that became private while they were writing',
    async (op) => {
      const row = await make(h.sam, mark('sam', s));
      const client = await pool.connect();
      let outcome: Awaited<ReturnType<typeof settle>>;
      try {
        await client.query('begin');
        await client.query(`update ${s.table} set visibility = 'private' where id = $1`, [row.id]);
        let done = false;
        const write =
          op === 'update'
            ? s.update(h.alex, row.id, s.edit('alex-raced') as never)
            : s.archive(h.alex, row.id);
        const pending = settle(write).finally(() => (done = true));
        await new Promise((r) => setTimeout(r, 300));
        expect(done, 'the write must wait for the lock').toBe(false);
        await client.query('commit');
        outcome = await pending;
      } finally {
        client.release();
      }
      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.e).toBeInstanceOf(NotFoundError);
      const after = await s.get(h.sam, row.id, { includeArchived: true });
      expect(after.archivedAt).toBeNull();
      expect(JSON.stringify(after)).not.toContain('alex-raced');
    },
  );
});

describe('no user-written content reaches the audit log', () => {
  it('no canary written by any service appears in any audit row', async () => {
    const rows = await admin.db.execute(
      sql`select coalesce(summary,'') || ' ' || coalesce(meta::text,'') as t from audit_log`,
    );
    expect(rows.rows.map((r) => r.t).join('\n')).not.toMatch(
      /canary-(sam|alex|kev)-(event|project|task|note)-/,
    );
  });
});
