import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, capture, task } from '@/db/schema';
import { captureVerbatim, getCapture } from '@/domain/captures/service';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import { createContext, getContext } from '@/domain/context/service';
import { addMessage, startConversation } from '@/domain/conversations/service';
import { createEvent, getEvent, listEventPeople } from '@/domain/events/service';
import { getNote } from '@/domain/notes/service';
import { createPerson } from '@/domain/people/service';
import { createProject, getProject } from '@/domain/projects/service';
import {
  approveMany,
  approveProposal,
  createProposal,
  expireOverdueProposals,
  getProposal,
  listProposals,
  rejectProposal,
  type Decision,
} from '@/domain/proposals/service';
import { createTask, getTask } from '@/domain/tasks/service';
import { systemActor, type UserActor } from '@/trust/actor';
import { listAudit } from '@/trust/audit';
import { adminDb, testDb } from './db';
import { ensureFixtureUsers, syntheticCalendarSource, type Household } from './fixtures';

// Proposals and the executor (Package 4b; contract §5.7, P-2, P-3, ADR 0005
// §30, §32). Kev proposes; only the requesting person, acting directly,
// approves or rejects; approval executes through the target service in one
// transaction; anything that fails leaves no write. Adversarial throughout.

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
let h: Household;
let alexViaKev: UserActor;
beforeAll(async () => {
  h = await ensureFixtureUsers(db);
  alexViaKev = { ...h.alex, via: 'kev' };
});
afterAll(async () => {
  await close();
  await admin.close();
});

const sys = systemActor as unknown as UserActor;
const SUMMARY = 'canary-prop-summary: add it';
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: unknown) =>
      e instanceof NotPermittedError
        ? e.code
        : e instanceof NotFoundError
          ? 'not_found'
          : String(e),
  );
const propose = (
  actor: UserActor,
  action: Parameters<typeof createProposal>[1]['action'],
  payload: Record<string, unknown>,
  extra: { captureId?: string } = {},
) => createProposal(actor, { action, payload, summary: SUMMARY, ...extra }, deps);
const approve = (actor: UserActor, id: string) => approveProposal(actor, id, deps);
const approved = (d: Decision) => {
  expect(d.outcome, d.outcome === 'failed' ? d.reason : '').toBe('approved');
  return d as Extract<Decision, { outcome: 'approved' }>;
};
const timed = {
  allDay: false as const,
  startsAt: '2026-10-14T15:30:00+13:00',
  endsAt: '2026-10-14T16:15:00+13:00',
  timeZone: 'Pacific/Auckland',
};
const tasksTitled = async (title: string) =>
  (await admin.db.select({ id: task.id }).from(task).where(eq(task.title, title))).length;
async function activity(actor: UserActor, id: string) {
  const page = await listAudit(actor, { limit: 200 }, deps);
  return page.rows.filter((r) => r.subjectId === id);
}
/** Makes a pending proposal overdue (created 8 days ago, expired yesterday). */
const backdate = (id: string) =>
  admin.db.execute(sql`update proposal set created_at = now() - interval '8 days',
    expires_at = now() - interval '1 day' where id = ${id}`);

describe('creating a proposal', () => {
  it('Kev proposes as the requesting person: pending, private, expiring in 7 days', async () => {
    const p = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-task' });
    expect(p).toMatchObject({
      status: 'pending',
      visibility: 'private',
      requestedByUserId: h.sam.userId,
      createdBy: h.sam.userId,
      createdVia: 'kev',
      decidedBy: null,
      resultRef: null,
    });
    expect(p.expiresAt.getTime() - p.createdAt.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(await tasksTitled('canary-prop-task')).toBe(0);
  });

  it.each([
    ['an unknown field', 'task.create', { title: 'x', priority: 'high' }],
    ['a missing title', 'task.create', {}],
    ['an unknown action', 'task.delete', { id: crypto.randomUUID() }],
    [
      'sensitive context (D15)',
      'context.create',
      { subject: { type: 'household' }, content: 'x', category: 'other', sensitivity: 'sensitive' },
    ],
    [
      'a sensitive context edit',
      'context.update',
      { op: 'edit', id: crypto.randomUUID(), patch: { sensitivity: 'sensitive' } },
    ],
    [
      'a synced-source field',
      'event.create',
      { title: 'x', kind: 'other', time: timed, source: 'synced' },
    ],
  ])('refuses %s', async (_l, action, payload) => {
    await expect(propose(h.samViaKev, action as never, payload)).rejects.toThrow();
  });

  it('the system actor cannot propose', async () => {
    expect(await code(propose(sys, 'task.create', { title: 'x' }))).toBe('not_a_user');
  });
});

describe('executing each of the twelve actions, through the target service', () => {
  it('runs every action as the approving person, recording created_via kev and the result', async () => {
    const proj = await createProject(h.sam, { title: 'Back fence' }, deps);
    const t = await createTask(h.sam, { title: 'Paint', projectId: proj.id }, deps);
    const ev = await createEvent(h.sam, { title: 'Swimming', kind: 'activity', time: timed }, deps);
    const milo = await createPerson(h.sam, { name: 'Milo', role: 'child' }, deps);
    const ctx = await createContext(
      h.sam,
      { subject: { type: 'household' }, content: 'x', category: 'routine' },
      deps,
    );
    const cap = await captureVerbatim(h.sam, { text: 'tidy the garage' }, deps);
    const run = async (action: Parameters<typeof propose>[1], payload: Record<string, unknown>) =>
      approved(await approve(h.sam, (await propose(h.samViaKev, action, payload)).id)).resultRef;

    const [newTask] = await run('task.create', { title: 'Buy hinges', needs: ['shops_open'] });
    expect(await getTask(h.sam, newTask!.id, {}, deps)).toMatchObject({
      createdVia: 'kev',
      createdBy: h.sam.userId,
    });
    await run('task.update', { id: t.id, patch: { status: 'done' } });
    expect((await getTask(h.sam, t.id, {}, deps)).status).toBe('done');
    await run('task.schedule', {
      id: t.id,
      scheduled: { startsAt: '2026-10-17T09:00:00+13:00', endsAt: '2026-10-17T12:00:00+13:00' },
    });
    expect((await getTask(h.sam, t.id, {}, deps)).scheduledStartsAt?.toISOString()).toBe(
      '2026-10-16T20:00:00.000Z',
    );
    expect((await getTask(h.sam, t.id, {}, deps)).createdVia).toBe('ui');
    const [newEvent] = await run('event.create', {
      title: 'Football',
      kind: 'activity',
      time: timed,
    });
    expect((await getEvent(h.sam, newEvent!.id, {}, deps)).createdVia).toBe('kev');
    await run('event.update', { id: ev.id, patch: { location: 'Pool' } });
    expect((await getEvent(h.sam, ev.id, {}, deps)).location).toBe('Pool');
    expect(
      await run('event_person.set', { eventId: ev.id, personId: milo.id, role: 'attending' }),
    ).toEqual([{ type: 'event', id: ev.id }]);
    expect((await listEventPeople(h.sam, ev.id, {}, deps))[0]).toMatchObject({
      personId: milo.id,
      createdVia: 'kev',
    });
    const [newProject] = await run('project.create', { title: 'Garage' });
    expect((await getProject(h.sam, newProject!.id, {}, deps)).createdVia).toBe('kev');
    await run('project.update', { id: proj.id, patch: { status: 'active' } });
    expect((await getProject(h.sam, proj.id, {}, deps)).status).toBe('active');
    const [newNote] = await run('note.create', {
      body: 'Measure the gate',
      subject: { type: 'project', id: proj.id },
    });
    expect((await getNote(h.sam, newNote!.id, {}, deps)).createdVia).toBe('kev');
    const [newCtx] = await run('context.create', {
      subject: { type: 'household' },
      content: 'Bins out Tuesday',
      category: 'routine',
    });
    expect(await getContext(h.sam, newCtx!.id, {}, deps)).toMatchObject({
      createdVia: 'kev',
      sourceType: 'told_kev',
      sourceUserId: h.sam.userId,
      sensitivity: 'normal',
      status: 'active',
    });
    await run('context.update', {
      op: 'edit',
      id: ctx.id,
      patch: { content: 'Bins out Wednesday' },
    });
    await run('context.update', { op: 'confirm', id: ctx.id });
    await run('context.update', { op: 'retire', id: ctx.id });
    expect((await getContext(h.sam, ctx.id, {}, deps)).status).toBe('retired');
    expect(await run('capture.dismiss', { id: cap.id })).toEqual([{ type: 'capture', id: cap.id }]);
    expect((await getCapture(h.sam, cap.id, {}, deps)).status).toBe('dismissed');
  });

  it('records the decision: approver, time, channel and result; audits requester and approver', async () => {
    const p = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-audit' });
    const d = approved(await approve(h.sam, p.id));
    expect(d.proposal).toMatchObject({
      status: 'approved',
      decidedBy: h.sam.userId,
      decidedChannel: 'web',
      failureReason: null,
    });
    expect(d.proposal.resultRef).toEqual(d.resultRef);
    const rows = await activity(h.sam, p.id);
    expect(rows.map((r) => r.event)).toEqual(['proposal.approve', 'proposal.create']);
    expect(rows[0]?.meta).toMatchObject({
      action: 'task.create',
      requested_by: h.sam.userId,
      approved_by: h.sam.userId,
      result_types: ['task'],
    });
    const created = await activity(h.sam, d.resultRef[0]!.id);
    expect(created.map((r) => r.event)).toEqual(['task.create']);
    expect(created[0]?.meta).toMatchObject({ executed: 'proposal' });
    expect(JSON.stringify(created[0]?.meta)).not.toContain(p.id);
  });
});

describe('only the requester, acting directly, decides (P-2)', () => {
  it('is invisible to the other adult: get, list, approve, reject, and its Activity', async () => {
    const p = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-hidden' });
    expect(await code(getProposal(h.alex, p.id, deps))).toBe('not_found');
    expect((await listProposals(h.alex, {}, deps)).map((x) => x.id)).not.toContain(p.id);
    expect(await code(approve(h.alex, p.id))).toBe('not_found');
    expect(await code(rejectProposal(h.alex, p.id, deps))).toBe('not_found');
    expect(await code(approve(alexViaKev, p.id))).toBe('kev_cannot_write');
    expect(await activity(h.alex, p.id)).toEqual([]);
    expect((await getProposal(h.sam, p.id, deps)).status).toBe('pending');
  });

  it('Kev and the system can never approve or reject, even their own proposal', async () => {
    const p = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-kev' });
    expect(await code(approve(h.samViaKev, p.id))).toBe('kev_cannot_write');
    expect(await code(rejectProposal(h.samViaKev, p.id, deps))).toBe('kev_cannot_write');
    expect(await code(approve(sys, p.id))).toBe('not_a_user');
    expect(await code(approveMany(h.samViaKev, [p.id], deps))).toBe('kev_cannot_write');
    expect(await tasksTitled('canary-prop-kev')).toBe(0);
    expect((await getProposal(h.sam, p.id, deps)).status).toBe('pending');
  });
});

describe('rejected, expired and decided proposals never execute', () => {
  it('reject records the decision and writes nothing; a decided proposal cannot be decided again', async () => {
    const p = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-rejected' });
    const d = await rejectProposal(h.sam, p.id, deps);
    expect(d.outcome).toBe('rejected');
    expect(d.proposal).toMatchObject({
      status: 'rejected',
      decidedBy: h.sam.userId,
      resultRef: null,
    });
    expect(await code(approve(h.sam, p.id))).toBe('proposal_not_pending');
    expect(await code(rejectProposal(h.sam, p.id, deps))).toBe('proposal_not_pending');
    expect(await tasksTitled('canary-prop-rejected')).toBe(0);
  });

  it('expires 7 days after creation: reported on read, stored when next touched, never executed', async () => {
    const p = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-expired' });
    await backdate(p.id);
    expect((await getProposal(h.sam, p.id, deps)).status).toBe('expired');
    expect((await listProposals(h.sam, { status: 'expired' }, deps)).map((x) => x.id)).toContain(
      p.id,
    );
    expect(
      (await listProposals(h.sam, { status: 'pending' }, deps)).map((x) => x.id),
    ).not.toContain(p.id);
    const d = await approve(h.sam, p.id);
    expect(d.outcome).toBe('expired');
    expect(d.proposal).toMatchObject({
      status: 'expired',
      decidedBy: null,
      decidedAt: null,
      resultRef: null,
    });
    expect(await code(approve(h.sam, p.id))).toBe('proposal_not_pending');
    expect(await tasksTitled('canary-prop-expired')).toBe(0);
    const q = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-expired' });
    await backdate(q.id);
    expect((await rejectProposal(h.sam, q.id, deps)).outcome).toBe('expired');
  });

  it('expireOverdueProposals stores expired on the actor’s own overdue proposals only', async () => {
    const mine = await propose(h.samViaKev, 'task.create', { title: 'x' });
    const theirs = await propose(alexViaKev, 'task.create', { title: 'x' });
    await backdate(mine.id);
    await backdate(theirs.id);
    const done = await expireOverdueProposals(h.sam, deps);
    expect(done.map((p) => p.id)).toContain(mine.id);
    expect(done.map((p) => p.id)).not.toContain(theirs.id);
    const raw = await admin.db.execute(sql`select status from proposal where id = ${theirs.id}`);
    expect(raw.rows[0]?.status).toBe('pending');
  });
});

describe('races', () => {
  /**
   * Holds the proposal row while both decisions start, so they truly contend
   * for it when it is released (without the hold, one could finish first).
   */
  async function contend(id: string, both: () => Promise<string>[]) {
    const client = await admin.pool.connect();
    try {
      await client.query('begin');
      await client.query('select 1 from proposal where id = $1 for update', [id]);
      const running = both();
      await new Promise((r) => setTimeout(r, 300));
      await client.query('commit');
      return await Promise.all(running);
    } finally {
      client.release();
    }
  }

  it('two approvals at once: exactly one executes, the other is told it is decided', async () => {
    const p = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-double' });
    const results = await contend(p.id, () => [
      code(approve(h.sam, p.id)),
      code(approve(h.sam, p.id)),
    ]);
    expect(results.sort()).toEqual(['proposal_not_pending', 'resolved']);
    expect(await tasksTitled('canary-prop-double')).toBe(1);
  });

  it('an approval and a rejection at once: exactly one decision, executed only if approved', async () => {
    const p = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-versus' });
    const results = await contend(p.id, () => [
      code(approve(h.sam, p.id)),
      code(rejectProposal(h.sam, p.id, deps)),
    ]);
    expect(results.sort()).toEqual(['proposal_not_pending', 'resolved']);
    const status = (await getProposal(h.sam, p.id, deps)).status;
    expect(await tasksTitled('canary-prop-versus')).toBe(status === 'approved' ? 1 : 0);
  });

  it('a target that becomes private to the other adult mid-approval is not written', async () => {
    const t = await createTask(h.alex, { title: 'Alex task' }, deps);
    const p = await propose(h.samViaKev, 'task.update', {
      id: t.id,
      patch: { title: 'canary-prop-raced' },
    });
    const client = await admin.pool.connect();
    let d: Decision;
    try {
      await client.query('begin');
      await client.query(`update task set visibility = 'private' where id = $1`, [t.id]);
      let done = false;
      const pending = approve(h.sam, p.id).finally(() => (done = true));
      await new Promise((r) => setTimeout(r, 300));
      expect(done, 'the approval must wait for the lock').toBe(false);
      await client.query('commit');
      d = await pending;
    } finally {
      client.release();
    }
    expect(d).toMatchObject({ outcome: 'failed', reason: 'not_found' });
    expect((await getTask(h.alex, t.id, {}, deps)).title).toBe('Alex task');
  });
});

describe('failure leaves no write, with a fixed reason', () => {
  it.each([
    [
      'the other adult’s private task',
      async () => ({
        action: 'task.update' as const,
        payload: {
          id: (await createTask(h.alex, { title: 'p', visibility: 'private' }, deps)).id,
          patch: { title: 'canary-prop-fail' },
        },
      }),
      'not_found',
    ],
    [
      'a household event annotating a private person',
      async () => ({
        action: 'event_person.set' as const,
        payload: {
          eventId: (await createEvent(h.sam, { title: 'e', kind: 'other', time: timed }, deps)).id,
          personId: (
            await createPerson(h.sam, { name: 'p', role: 'other', visibility: 'private' }, deps)
          ).id,
          role: 'attending',
        },
      }),
      'references_private',
    ],
    [
      'a synced event',
      async () => ({
        action: 'event.update' as const,
        payload: {
          id: (
            await admin.db.execute(
              sql`insert into event (created_by, created_via, title, kind, starts_at, ends_at, time_zone, source, calendar_source_id, external_uid) values (${h.sam.userId}, 'sync', 'S', 'work', now(), now(), 'UTC', 'synced', ${await syntheticCalendarSource(admin.db, h.sam.userId)}::uuid, gen_random_uuid()::text) returning id`,
            )
          ).rows[0]?.id as string,
          patch: { title: 'canary-prop-fail' },
        },
      }),
      'synced_event',
    ],
  ])('%s → failed, reason %s', async (_l, make, reason) => {
    const { action, payload } = await make();
    const p = await propose(h.samViaKev, action, payload);
    const d = await approve(h.sam, p.id);
    expect(d).toMatchObject({ outcome: 'failed', reason });
    expect(d.proposal).toMatchObject({
      status: 'failed',
      failureReason: reason,
      resultRef: null,
      decidedBy: h.sam.userId,
    });
    expect(await code(approve(h.sam, p.id))).toBe('proposal_not_pending');
    const leaked = await admin.db.execute(
      sql`select count(*)::int as n from task where title = 'canary-prop-fail'`,
    );
    expect(leaked.rows[0]?.n).toBe(0);
  });

  it('a failure after the record was written rolls the record back (savepoint), and keeps the failed status', async () => {
    const p = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-rollback' });
    await admin.db.execute(sql`
      create or replace function test_reject_task_create() returns trigger language plpgsql as $$
      begin
        if new.event = 'task.create' then raise exception 'test: audit rejected'; end if;
        return new;
      end $$`);
    await admin.db.execute(sql`create trigger test_reject_task_create before insert on audit_log
      for each row execute function test_reject_task_create()`);
    let d: Decision;
    try {
      d = await approve(h.sam, p.id);
    } finally {
      await admin.db.execute(sql`drop trigger if exists test_reject_task_create on audit_log`);
      await admin.db.execute(sql`drop function if exists test_reject_task_create()`);
    }
    expect(d).toMatchObject({ outcome: 'failed', reason: 'execution_error' });
    expect(await tasksTitled('canary-prop-rollback')).toBe(0);
    expect((await getProposal(h.sam, p.id, deps)).status).toBe('failed');
    expect((await activity(h.sam, p.id)).map((r) => r.event)).toEqual([
      'proposal.fail',
      'proposal.create',
    ]);
  });

  it('a stored payload that no longer validates (e.g. sensitive) fails as invalid_payload', async () => {
    const p = await propose(h.samViaKev, 'context.create', {
      subject: { type: 'household' },
      content: 'x',
      category: 'other',
    });
    await admin.db.execute(
      sql`update proposal set payload = payload || '{"sensitivity":"sensitive"}' where id = ${p.id}`,
    );
    expect(await approve(h.sam, p.id)).toMatchObject({
      outcome: 'failed',
      reason: 'invalid_payload',
    });
    const n = await admin.db.execute(
      sql`select count(*)::int as n from context where sensitivity = 'sensitive' and created_via = 'kev'`,
    );
    expect(n.rows[0]?.n).toBe(0);
  });

  it('a proposal cannot reach sensitive context', async () => {
    const s = await createContext(
      h.sam,
      { subject: { type: 'household' }, content: 'x', category: 'other', sensitivity: 'sensitive' },
      deps,
    );
    for (const payload of [
      { op: 'edit', id: s.id, patch: { content: 'canary-prop-sens' } },
      { op: 'retire', id: s.id },
    ]) {
      const p = await propose(h.samViaKev, 'context.update', payload);
      expect(await approve(h.sam, p.id)).toMatchObject({ outcome: 'failed', reason: 'not_found' });
    }
    expect(await getContext(h.sam, s.id, { includeSensitive: true }, deps)).toMatchObject({
      content: 'x',
      status: 'active',
    });
  });
});

describe('capture organisation', () => {
  const words = ' Book the WOF, and the car is due for tyres \n';

  it('records what a capture became, with provenance, and never touches its words', async () => {
    // Kev captures the person's own message (it never supplies the words).
    const conv = await startConversation(h.sam, deps);
    const m = await addMessage(
      h.sam,
      conv.id,
      { role: 'user', content: { v: 1, text: words } },
      deps,
    );
    const c = await captureVerbatim(h.samViaKev, { messageId: m.id }, deps);
    const a = await propose(
      h.samViaKev,
      'task.create',
      { title: 'Book the WOF' },
      { captureId: c.id },
    );
    expect((await getCapture(h.sam, c.id, {}, deps)).status).toBe('proposed');
    const b = await propose(
      h.samViaKev,
      'context.create',
      { subject: { type: 'household' }, content: 'Car due for tyres', category: 'practical' },
      { captureId: c.id },
    );
    const [t] = approved(await approve(h.sam, a.id)).resultRef;
    let cap = await getCapture(h.sam, c.id, {}, deps);
    expect(cap.status).toBe('proposed');
    expect(cap.organisedInto).toEqual([{ type: 'task', id: t!.id }]);
    const [x] = approved(await approve(h.sam, b.id)).resultRef;
    cap = await getCapture(h.sam, c.id, {}, deps);
    expect(cap).toMatchObject({
      status: 'organised',
      text: words,
      organisedInto: [
        { type: 'task', id: t!.id },
        { type: 'context', id: x!.id },
      ],
    });
    expect(cap.organisedAt).not.toBeNull();
    expect((await getTask(h.sam, t!.id, {}, deps)).originCaptureId).toBe(c.id);
    expect(await getContext(h.sam, x!.id, {}, deps)).toMatchObject({
      originCaptureId: c.id,
      sourceType: 'capture',
      sourceRef: c.id,
      sourceUserId: h.sam.userId,
    });
    const raw = await admin.db.execute(
      sql`select text, created_via from capture where id = ${c.id}`,
    );
    expect(raw.rows[0]).toEqual({ text: words, created_via: 'kev' });
  });

  it('goes back to `new` when its only proposal is rejected, fails or expires', async () => {
    for (const end of ['reject', 'fail', 'expire'] as const) {
      const c = await captureVerbatim(h.sam, { text: `capture ${end}` }, deps);
      const target =
        end === 'fail'
          ? (await createTask(h.alex, { title: 'p', visibility: 'private' }, deps)).id
          : null;
      const p = target
        ? await propose(
            h.samViaKev,
            'task.update',
            { id: target, patch: { title: 'x' } },
            { captureId: c.id },
          )
        : await propose(h.samViaKev, 'task.create', { title: 'x' }, { captureId: c.id });
      if (end === 'reject') await rejectProposal(h.sam, p.id, deps);
      if (end === 'fail') await approve(h.sam, p.id);
      if (end === 'expire') {
        await backdate(p.id);
        await approve(h.sam, p.id);
      }
      expect(await getCapture(h.sam, c.id, {}, deps)).toMatchObject({
        status: 'new',
        organisedInto: [],
      });
    }
  });

  it('refuses a proposal on another person’s or a dismissed capture', async () => {
    const theirs = await captureVerbatim(h.alex, { text: 'alex' }, deps);
    expect(
      await code(propose(h.samViaKev, 'task.create', { title: 'x' }, { captureId: theirs.id })),
    ).toBe('not_found');
    const c = await captureVerbatim(h.sam, { text: 'x' }, deps);
    const d = await propose(h.samViaKev, 'capture.dismiss', { id: c.id }, { captureId: c.id });
    approved(await approve(h.sam, d.id));
    expect((await getCapture(h.sam, c.id, {}, deps)).status).toBe('dismissed');
    expect(
      await code(propose(h.samViaKev, 'task.create', { title: 'x' }, { captureId: c.id })),
    ).toBe('not_eligible');
  });
});

describe('provenance follows the proposal (ADR 0005 §43)', () => {
  it('a proposal the person made themselves creates records as theirs (ui); Kev’s as kev', async () => {
    const mine = await propose(h.sam, 'task.create', { title: 'typed by Sam' });
    expect(mine.createdVia).toBe('ui');
    const [t] = approved(await approve(h.sam, mine.id)).resultRef;
    expect((await getTask(h.sam, t!.id, {}, deps)).createdVia).toBe('ui');
    const ctx = await propose(h.sam, 'context.create', {
      subject: { type: 'household' },
      content: 'x',
      category: 'other',
    });
    const [c] = approved(await approve(h.sam, ctx.id)).resultRef;
    expect(await getContext(h.sam, c!.id, {}, deps)).toMatchObject({
      createdVia: 'ui',
      sourceType: 'manual',
      sourceRef: null,
    });
    const kevs = await propose(h.samViaKev, 'task.create', { title: 'proposed by Kev' });
    const [k] = approved(await approve(h.sam, kevs.id)).resultRef;
    expect((await getTask(h.sam, k!.id, {}, deps)).createdVia).toBe('kev');
  });
});

describe('a proposal may name only its requester’s own conversation', () => {
  it('the other adult’s conversation, or none at all, is not found; the requester’s own is accepted', async () => {
    const theirs = await startConversation(h.alex, deps);
    const before = (await admin.db.execute(sql`select count(*)::int as n from proposal`)).rows[0]
      ?.n;
    const linked = (conversationId: string) =>
      createProposal(
        h.samViaKev,
        { action: 'task.create', payload: { title: 'x' }, summary: 'x', conversationId },
        deps,
      );
    expect(await code(linked(theirs.id))).toBe('not_found');
    expect(await code(linked(crypto.randomUUID()))).toBe('not_found');
    expect((await admin.db.execute(sql`select count(*)::int as n from proposal`)).rows[0]?.n).toBe(
      before,
    );
    const own = await startConversation(h.sam, deps);
    expect((await linked(own.id)).conversationId).toBe(own.id);
  });
});

describe('approveMany', () => {
  it('approves each independently and reports each result', async () => {
    const ok = await propose(h.samViaKev, 'task.create', { title: 'canary-prop-many' });
    const done = await propose(h.samViaKev, 'task.create', { title: 'x' });
    await rejectProposal(h.sam, done.id, deps);
    const theirs = await propose(alexViaKev, 'task.create', { title: 'x' });
    const failing = await propose(h.samViaKev, 'task.update', {
      id: crypto.randomUUID(),
      patch: { title: 'x' },
    });
    const r = await approveMany(h.sam, [ok.id, done.id, theirs.id, failing.id], deps);
    expect(r.map((x) => (x.ok ? x.decision.outcome : x.error))).toEqual([
      'approved',
      'proposal_not_pending',
      'not_found',
      'failed',
    ]);
    expect(await tasksTitled('canary-prop-many')).toBe(1);
  });
});

describe('privacy of the log', () => {
  it('no summary or payload text reaches any audit row; proposals and captures never reach the other adult', async () => {
    const rows = await admin.db
      .select({
        summary: auditLog.summary,
        meta: auditLog.meta,
        subjectType: auditLog.subjectType,
        visibility: auditLog.visibility,
        owner: auditLog.visibleToUserId,
      })
      .from(auditLog);
    const text = rows.map((r) => `${r.summary ?? ''} ${JSON.stringify(r.meta ?? {})}`).join('\n');
    expect(text).not.toMatch(/canary-prop|Book the WOF|tyres/);
    for (const r of rows.filter(
      (x) => x.subjectType === 'proposal' || x.subjectType === 'capture',
    )) {
      expect(r.visibility).toBe('private');
      expect(r.owner).not.toBeNull();
    }
    const alexSees = (await listAudit(h.alex, { limit: 200 }, deps)).rows;
    const samOwn = new Set(
      (
        await admin.db
          .execute(sql`select id::text from proposal where requested_by_user_id = ${h.sam.userId}
        union all select id::text from capture where created_by = ${h.sam.userId}`)
      ).rows.map((r) => r.id),
    );
    expect(alexSees.filter((r) => samOwn.has(r.subjectId ?? ''))).toEqual([]);
  });

  it('the capture row is untouched by every proposal path', async () => {
    const all = await admin.db.select({ id: capture.id, text: capture.text }).from(capture);
    expect(all.every((c) => typeof c.text === 'string' && /\S/.test(c.text))).toBe(true);
  });
});
