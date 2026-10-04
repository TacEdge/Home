import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, proposal } from '@/db/schema';
import {
  captureVerbatim,
  dismissCapture,
  getCapture,
  undismissCapture,
} from '@/domain/captures/service';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import { getContext } from '@/domain/context/service';
import { getNote } from '@/domain/notes/service';
import { createPerson } from '@/domain/people/service';
import { createProject } from '@/domain/projects/service';
import { listProposals, organiseCapture } from '@/domain/proposals/service';
import { getTask, listTasks } from '@/domain/tasks/service';
import { auditRowColumns } from '@/trust/audit';
import { testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// organiseCapture (M3 contract §3.8, ADR 0006 §11, §49): a person organises
// their own capture by proposing and approving in one transaction, through
// the existing executor and capture settlement; nothing else.

const { db, close } = testDb();
const deps = { db };
let h: Household;
beforeAll(async () => {
  h = await ensureFixtureUsers(db);
});
afterAll(close);

const WORDS = 'Ring the plumber about the drip  \nunder the sink';
const capture = (text = WORDS) => captureVerbatim(h.sam, { text }, deps);
const auditsOf = (id: string) =>
  db.select(auditRowColumns).from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.at);

describe('organiseCapture', () => {
  it('makes the record through a self-approved proposal: provenance ui, origin_capture_id, settled capture', async () => {
    const c = await capture();
    const d = await organiseCapture(
      h.sam,
      c.id,
      {
        action: 'task.create',
        payload: { title: 'Ring the plumber' },
        summary: 'Task: Ring the plumber',
      },
      deps,
    );
    expect(d.outcome).toBe('approved');
    if (d.outcome !== 'approved') return;
    const t = await getTask(h.sam, d.resultRef[0]!.id, {}, deps);
    expect(t).toMatchObject({ title: 'Ring the plumber', createdVia: 'ui', originCaptureId: c.id });
    // The proposal: the person's own, requested and decided by them, approved.
    expect(d.proposal).toMatchObject({
      status: 'approved',
      action: 'task.create',
      captureId: c.id,
      requestedByUserId: h.sam.userId,
      decidedBy: h.sam.userId,
      createdVia: 'ui',
    });
    // The capture: words untouched, organised into the task.
    const after = await getCapture(h.sam, c.id, {}, deps);
    expect(after.text).toBe(WORDS);
    expect(after.status).toBe('organised');
    expect(after.organisedInto).toEqual([{ type: 'task', id: t.id }]);
    // Audited as the approval chain; no user-written text in any meta.
    const events = [
      ...(await auditsOf(d.proposal.id)),
      ...(await auditsOf(t.id)),
      ...(await auditsOf(c.id)),
    ].map((r) => r.event);
    expect(events).toEqual(
      expect.arrayContaining([
        'proposal.create',
        'proposal.approve',
        'task.create',
        'capture.organise',
      ]),
    );
    const metas = JSON.stringify(
      [
        ...(await auditsOf(d.proposal.id)),
        ...(await auditsOf(c.id)),
        ...(await auditsOf(t.id)),
      ].map((r) => r.meta),
    );
    expect(metas).not.toContain('plumber');
    expect(metas).not.toContain('sink');
  });

  it('makes another: one capture becomes several records', async () => {
    const c = await capture('Fence: paint it, and the gate needs a latch');
    const fence = await createProject(h.sam, { title: 'Fence EP', status: 'active' }, deps);
    const a = await organiseCapture(
      h.sam,
      c.id,
      {
        action: 'task.create',
        payload: { title: 'Fix the gate latch', projectId: fence.id },
        summary: 'Task',
      },
      deps,
    );
    const b = await organiseCapture(
      h.sam,
      c.id,
      {
        action: 'note.create',
        payload: { body: 'Paint it green', subject: { type: 'project', id: fence.id } },
        summary: 'Note',
      },
      deps,
    );
    expect(a.outcome).toBe('approved');
    expect(b.outcome).toBe('approved');
    const after = await getCapture(h.sam, c.id, {}, deps);
    expect(after.organisedInto.map((r) => r.type)).toEqual(['task', 'note']);
    const n = await getNote(h.sam, after.organisedInto[1]!.id, {}, deps);
    expect(n.originCaptureId).toBe(c.id);
  });

  it('something to know made this way is sourced from the capture, never sensitive', async () => {
    const c = await capture('Milo is into dinosaurs this term');
    const d = await organiseCapture(
      h.sam,
      c.id,
      {
        action: 'context.create',
        payload: {
          subject: { type: 'household' },
          content: 'Dinosaurs this term',
          category: 'interest',
        },
        summary: 'Something to know',
      },
      deps,
    );
    if (d.outcome !== 'approved') throw new Error(d.outcome);
    const x = await getContext(h.sam, d.resultRef[0]!.id, {}, deps);
    expect(x).toMatchObject({ sourceType: 'capture', sourceRef: c.id, sensitivity: 'normal' });
    await expect(
      organiseCapture(
        h.sam,
        c.id,
        {
          action: 'context.create',
          payload: {
            subject: { type: 'household' },
            content: 'x',
            category: 'other',
            sensitivity: 'sensitive',
          },
          summary: 'x',
        },
        deps,
      ),
    ).rejects.toThrow(); // the payload schema refuses sensitive before anything is stored
  });

  it('a refused payload stores nothing; a failed execution stores the failed proposal and nothing else', async () => {
    const c = await capture('Something for a secret person');
    const before = (await listProposals(h.sam, { captureId: c.id }, deps)).length;
    await expect(
      organiseCapture(
        h.sam,
        c.id,
        { action: 'task.create', payload: { title: '' }, summary: 'x' },
        deps,
      ),
    ).rejects.toThrow();
    expect((await listProposals(h.sam, { captureId: c.id }, deps)).length).toBe(before);

    // A household task about a private person: the executor refuses, the savepoint rolls back.
    const secret = await createPerson(
      h.sam,
      { name: 'Secret OC', role: 'other', visibility: 'private' },
      deps,
    );
    const tasksBefore = (await listTasks(h.sam, {}, deps)).length;
    const d = await organiseCapture(
      h.sam,
      c.id,
      {
        action: 'task.create',
        payload: { title: 'About them', aboutPersonId: secret.id },
        summary: 'x',
      },
      deps,
    );
    expect(d).toMatchObject({ outcome: 'failed', reason: 'references_private' });
    expect((await listTasks(h.sam, {}, deps)).length).toBe(tasksBefore);
    const after = await getCapture(h.sam, c.id, {}, deps);
    expect(after.status).toBe('new'); // still waiting in To sort
    expect(after.organisedInto).toEqual([]);
    const [stored] = await db.select().from(proposal).where(eq(proposal.id, d.proposal.id));
    expect(stored?.status).toBe('failed');
  });

  it('only the person, directly, on their own live capture, for the five organising actions', async () => {
    const c = await capture('Only mine');
    await expect(
      organiseCapture(
        h.samViaKev,
        c.id,
        { action: 'task.create', payload: { title: 'x' }, summary: 'x' },
        deps,
      ),
    ).rejects.toMatchObject(new NotPermittedError('kev_cannot_write'));
    await expect(
      organiseCapture(
        h.alex,
        c.id,
        { action: 'task.create', payload: { title: 'x' }, summary: 'x' },
        deps,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      organiseCapture(
        h.sam,
        c.id,
        { action: 'capture.dismiss' as never, payload: { id: c.id }, summary: 'x' },
        deps,
      ),
    ).rejects.toMatchObject(new NotPermittedError('not_eligible'));
    await dismissCapture(h.sam, c.id, deps);
    await expect(
      organiseCapture(
        h.sam,
        c.id,
        { action: 'task.create', payload: { title: 'x' }, summary: 'x' },
        deps,
      ),
    ).rejects.toMatchObject(new NotPermittedError('not_eligible'));
    // Not needed is undone to where it was: new, nothing organised.
    const back = await undismissCapture(h.sam, c.id, deps);
    expect(back.status).toBe('new');
    expect((await listProposals(h.sam, { captureId: c.id }, deps)).length).toBe(0);
  });
});
