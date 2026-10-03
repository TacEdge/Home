import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capture, context } from '@/db/schema';
import {
  archiveCapture,
  captureVerbatim,
  dismissCapture,
  getCapture,
  listCaptures,
  restoreCapture,
  undismissCapture,
} from '@/domain/captures/service';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import { issueExecution } from '@/domain/common/write';
import {
  archiveContext,
  confirmContext,
  createContext,
  getContext,
  listContext,
  reinstateContext,
  restoreContext,
  retireContext,
  stalenessOf,
  updateContext,
} from '@/domain/context/service';
import { createPerson, updatePerson } from '@/domain/people/service';
import { createProject, updateProject } from '@/domain/projects/service';
import { systemActor, type UserActor } from '@/trust/actor';
import { listAudit } from '@/trust/audit';
import { adminDb, testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// Captures and context (Package 4b; contract §5.4, §5.6). Captures keep the
// person's exact words, privately; context is dated, sourced, sensitivity
// aware, and follows the reference rules. Everything as home_app.

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

const sys = systemActor as unknown as UserActor;
const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: unknown) =>
      e instanceof NotPermittedError
        ? e.code
        : e instanceof NotFoundError
          ? 'not_found'
          : String(e),
  );
async function activity(actor: UserActor, id: string) {
  const page = await listAudit(actor, { limit: 200 }, deps);
  return page.rows.filter((r) => r.subjectId === id).map((r) => r.event);
}

describe('captures', () => {
  const words = '  Book the WOF — and the car’s due for tyres 🚗\n\tcanary-cap-sam  \n';

  it('stores the words exactly as given, private to the person, as `new`', async () => {
    const c = await captureVerbatim(h.sam, { text: words }, deps);
    expect(c).toMatchObject({
      text: words,
      visibility: 'private',
      status: 'new',
      channel: 'web',
      createdBy: h.sam.userId,
      createdVia: 'ui',
      organisedInto: [],
    });
    const raw = await admin.db.execute(sql`select text from capture where id = ${c.id}`);
    expect(raw.rows[0]?.text).toBe(words);
  });

  it('Kev may capture (the one direct write), recorded as via kev; the system may not', async () => {
    const c = await captureVerbatim(h.samViaKev, { text: 'pick up milk' }, deps);
    expect(c.createdVia).toBe('kev');
    expect(await code(captureVerbatim(sys, { text: 'x' }, deps))).toBe('not_a_user');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', ' \n\t '],
    ['too long', 'x'.repeat(10_001)],
  ])('refuses %s text', async (_l, text) => {
    await expect(captureVerbatim(h.sam, { text }, deps)).rejects.toThrow();
  });

  it('is invisible to the other adult: get, list, dismiss, archive', async () => {
    const c = await captureVerbatim(h.sam, { text: 'canary-cap-sam private' }, deps);
    expect(await code(getCapture(h.alex, c.id, {}, deps))).toBe('not_found');
    expect((await listCaptures(h.alex, {}, deps)).map((x) => x.id)).not.toContain(c.id);
    expect(await code(dismissCapture(h.alex, c.id, deps))).toBe('not_found');
    expect(await code(archiveCapture(h.alex, c.id, deps))).toBe('not_found');
    expect(await activity(h.alex, c.id)).toEqual([]);
    expect(await activity(h.sam, c.id)).toEqual(['capture.create']);
  });

  it('dismiss records when (the purge clock); undismiss clears it; neither touches the words', async () => {
    const c = await captureVerbatim(h.sam, { text: words }, deps);
    const d = await dismissCapture(h.sam, c.id, deps);
    expect(d.status).toBe('dismissed');
    expect(d.dismissedAt).not.toBeNull();
    expect((await dismissCapture(h.sam, c.id, deps)).dismissedAt).toEqual(d.dismissedAt);
    const u = await undismissCapture(h.sam, c.id, deps);
    expect(u).toMatchObject({ status: 'new', dismissedAt: null, text: words });
    expect(await code(undismissCapture(h.sam, c.id, deps))).toBe('not_eligible');
    expect(await activity(h.sam, c.id)).toEqual([
      'capture.undismiss',
      'capture.dismiss',
      'capture.create',
    ]);
  });

  it('Kev cannot dismiss, archive or restore directly (only by an approved proposal)', async () => {
    const c = await captureVerbatim(h.sam, { text: 'x' }, deps);
    expect(await code(dismissCapture(h.samViaKev, c.id, deps))).toBe('kev_cannot_write');
    expect(await code(archiveCapture(h.samViaKev, c.id, deps))).toBe('kev_cannot_write');
    await archiveCapture(h.sam, c.id, deps);
    expect(await code(restoreCapture(h.samViaKev, c.id, deps))).toBe('kev_cannot_write');
    expect((await restoreCapture(h.sam, c.id, deps)).archivedAt).toBeNull();
  });

  it('lists the actor’s own, newest first, filtered by status', async () => {
    const a = await captureVerbatim(h.alex, { text: 'first' }, deps);
    const b = await captureVerbatim(h.alex, { text: 'second' }, deps);
    await dismissCapture(h.alex, a.id, deps);
    const mine = await listCaptures(h.alex, {}, deps);
    expect(mine.every((c) => c.createdBy === h.alex.userId)).toBe(true);
    expect(mine.findIndex((c) => c.id === b.id)).toBeLessThan(mine.findIndex((c) => c.id === a.id));
    expect((await listCaptures(h.alex, { status: 'dismissed' }, deps)).map((c) => c.id)).toContain(
      a.id,
    );
    expect((await listCaptures(h.alex, { status: 'new' }, deps)).map((c) => c.id)).not.toContain(
      a.id,
    );
  });

  it('the words cannot be changed through the database either, even by the runtime role', async () => {
    const c = await captureVerbatim(h.sam, { text: words }, deps);
    await expect(
      db.update(capture).set({ text: 'rewritten' }).where(eq(capture.id, c.id)),
    ).rejects.toThrow();
    await expect(
      db.update(capture).set({ createdVia: 'kev' }).where(eq(capture.id, c.id)),
    ).rejects.toThrow();
    expect((await getCapture(h.sam, c.id, {}, deps)).text).toBe(words);
  });
});

describe('context', () => {
  const household = { type: 'household' as const };

  it('creates household, person and project context: active, confirmed now, sourced to the writer', async () => {
    const p = await createPerson(h.sam, { name: 'Milo', role: 'child' }, deps);
    const pr = await createProject(h.sam, { title: 'Garage' }, deps);
    for (const subject of [
      household,
      { type: 'person' as const, id: p.id },
      { type: 'project' as const, id: pr.id },
    ]) {
      const c = await createContext(
        h.sam,
        { subject, content: 'Enjoys dinosaurs at the moment', category: 'interest' },
        deps,
      );
      expect(c).toMatchObject({
        subjectType: subject.type,
        status: 'active',
        sensitivity: 'normal',
        visibility: 'household',
        sourceType: 'manual',
        sourceUserId: h.sam.userId,
        sourceRef: null,
        createdVia: 'ui',
        originCaptureId: null,
      });
      expect(c.lastConfirmedAt.getTime()).toBe(c.createdAt.getTime());
    }
  });

  it('applies the reference rules both ways (§5.5)', async () => {
    const priv = await createPerson(
      h.sam,
      { name: 'P', role: 'other', visibility: 'private' },
      deps,
    );
    const mine = { type: 'person' as const, id: priv.id };
    expect(
      await code(createContext(h.sam, { subject: mine, content: 'x', category: 'other' }, deps)),
    ).toBe('references_private');
    expect(
      await code(
        createContext(
          h.alex,
          { subject: mine, content: 'x', category: 'other', visibility: 'private' },
          deps,
        ),
      ),
    ).toBe('not_found');
    const ok = await createContext(
      h.sam,
      { subject: mine, content: 'x', category: 'other', visibility: 'private' },
      deps,
    );
    expect(await code(updateContext(h.sam, ok.id, { visibility: 'household' }, deps))).toBe(
      'references_private',
    );
    // A person or project household context is about cannot become private.
    const pub = await createPerson(h.sam, { name: 'Q', role: 'other' }, deps);
    const proj = await createProject(h.sam, { title: 'Shed' }, deps);
    await createContext(
      h.sam,
      { subject: { type: 'person', id: pub.id }, content: 'x', category: 'other' },
      deps,
    );
    const ctx = await createContext(
      h.sam,
      { subject: { type: 'project', id: proj.id }, content: 'x', category: 'other' },
      deps,
    );
    expect(await code(updatePerson(h.sam, pub.id, { visibility: 'private' }, deps))).toBe(
      'referenced_by_household',
    );
    await archiveContext(h.sam, ctx.id, deps);
    expect(await code(updateProject(h.sam, proj.id, { visibility: 'private' }, deps))).toBe(
      'referenced_by_household',
    );
  });

  it('keeps the other adult out of private context, and Kev out of every write', async () => {
    const c = await createContext(
      h.sam,
      { subject: household, content: 'canary-ctx-sam', category: 'other', visibility: 'private' },
      deps,
    );
    expect(await code(getContext(h.alex, c.id, {}, deps))).toBe('not_found');
    expect(await code(getContext(h.alex, c.id, { includeSensitive: true }, deps))).toBe(
      'not_found',
    );
    expect((await listContext(h.alex, {}, deps)).map((x) => x.id)).not.toContain(c.id);
    for (const op of [
      () => updateContext(h.alex, c.id, { content: 'alex' }, deps),
      () => confirmContext(h.alex, c.id, deps),
      () => retireContext(h.alex, c.id, deps),
      () => archiveContext(h.alex, c.id, deps),
    ])
      expect(await code(op())).toBe('not_found');
    for (const op of [
      () =>
        createContext(h.samViaKev, { subject: household, content: 'x', category: 'other' }, deps),
      () => updateContext(h.samViaKev, c.id, { content: 'kev' }, deps),
      () => confirmContext(h.samViaKev, c.id, deps),
      () => retireContext(h.samViaKev, c.id, deps),
    ])
      expect(await code(op())).toBe('kev_cannot_write');
    expect(
      await code(createContext(sys, { subject: household, content: 'x', category: 'other' }, deps)),
    ).toBe('not_a_user');
    expect(await activity(h.alex, c.id)).toEqual([]);
  });

  it('never reads sensitive context unless a person asks; asking is audited; Kev may not ask', async () => {
    const s = await createContext(
      h.sam,
      {
        subject: household,
        content: 'Allergic to peanuts',
        category: 'practical',
        sensitivity: 'sensitive',
      },
      deps,
    );
    expect(await code(getContext(h.sam, s.id, {}, deps))).toBe('not_found');
    expect((await listContext(h.sam, {}, deps)).map((x) => x.id)).not.toContain(s.id);
    expect((await getContext(h.sam, s.id, { includeSensitive: true }, deps)).id).toBe(s.id);
    expect(
      (await listContext(h.alex, { includeSensitive: true }, deps)).map((x) => x.id),
    ).toContain(s.id);
    expect(await code(getContext(h.samViaKev, s.id, { includeSensitive: true }, deps))).toBe(
      'sensitive_context',
    );
    expect(await code(listContext(h.samViaKev, { includeSensitive: true }, deps))).toBe(
      'sensitive_context',
    );
    const events = await activity(h.sam, s.id);
    expect(events.filter((e) => e === 'context.sensitive_read')).toHaveLength(2);
  });

  it('an executing proposal can neither write sensitive context nor touch a sensitive record', async () => {
    const execution = issueExecution({
      proposalId: crypto.randomUUID(),
      requestedBy: h.sam.userId,
      captureId: null,
      conversationId: null,
    });
    const ex = { db, execution };
    expect(
      await code(
        createContext(
          h.sam,
          { subject: household, content: 'x', category: 'other', sensitivity: 'sensitive' },
          ex,
        ),
      ),
    ).toBe('sensitive_context');
    const normal = await createContext(
      h.sam,
      { subject: household, content: 'x', category: 'other' },
      deps,
    );
    expect(await code(updateContext(h.sam, normal.id, { sensitivity: 'sensitive' }, ex))).toBe(
      'sensitive_context',
    );
    const s = await createContext(
      h.sam,
      { subject: household, content: 'x', category: 'other', sensitivity: 'sensitive' },
      deps,
    );
    for (const op of [
      () => updateContext(h.sam, s.id, { content: 'y' }, ex),
      () => confirmContext(h.sam, s.id, ex),
      () => retireContext(h.sam, s.id, ex),
    ])
      expect(await code(op())).toBe('not_found');
    // A person, directly, may.
    expect((await updateContext(h.sam, s.id, { content: 'y' }, deps)).content).toBe('y');
  });

  it('a hand-made execution object is ignored: no kev provenance without the executor', async () => {
    const forged = {
      proposalId: crypto.randomUUID(),
      requestedBy: h.alex.userId,
      captureId: null,
      conversationId: null,
    };
    const c = await createContext(
      h.sam,
      { subject: household, content: 'x', category: 'other' },
      { db, execution: forged },
    );
    expect(c).toMatchObject({ createdVia: 'ui', sourceType: 'manual', sourceUserId: h.sam.userId });
  });

  it('confirm restarts the clock; retire keeps it, out of default lists; reinstate brings it back', async () => {
    const c = await createContext(
      h.alex,
      {
        subject: household,
        content: 'Bins go out Tuesday',
        category: 'routine',
        validUntil: '2026-12-31',
      },
      deps,
    );
    await admin.db.execute(
      sql`update context set last_confirmed_at = now() - interval '200 days', created_at = now() - interval '200 days' where id = ${c.id}`,
    );
    const stale = await getContext(h.alex, c.id, {}, deps);
    expect(stalenessOf(stale, '2026-10-14', 'Pacific/Auckland').possiblyStale).toBe(true);
    const confirmed = await confirmContext(h.alex, c.id, deps);
    expect(confirmed.lastConfirmedAt.getTime()).toBeGreaterThan(stale.lastConfirmedAt.getTime());
    const retired = await retireContext(h.alex, c.id, deps);
    expect(retired).toMatchObject({ status: 'retired' });
    expect(retired.retiredAt).not.toBeNull();
    expect((await retireContext(h.alex, c.id, deps)).retiredAt).toEqual(retired.retiredAt);
    expect(await code(confirmContext(h.alex, c.id, deps))).toBe('not_eligible');
    expect((await listContext(h.alex, {}, deps)).map((x) => x.id)).not.toContain(c.id);
    expect((await listContext(h.alex, { status: 'retired' }, deps)).map((x) => x.id)).toContain(
      c.id,
    );
    expect(await reinstateContext(h.alex, c.id, deps)).toMatchObject({
      status: 'active',
      retiredAt: null,
    });
    expect(await code(reinstateContext(h.alex, c.id, deps))).toBe('not_eligible');
    await archiveContext(h.alex, c.id, deps);
    expect(await code(getContext(h.alex, c.id, {}, deps))).toBe('not_found');
    expect((await restoreContext(h.alex, c.id, deps)).archivedAt).toBeNull();
    expect(await code(restoreContext(h.alex, c.id, deps))).toBe('not_archived');
    const rows = await db.select({ id: context.id }).from(context).where(eq(context.id, c.id));
    expect(rows).toHaveLength(1);
  });

  it('only the creator changes visibility; a valid_until date is stored as a date', async () => {
    const c = await createContext(
      h.sam,
      { subject: household, content: 'x', category: 'intention', validUntil: '2026-10-31' },
      deps,
    );
    expect(c.validUntil).toBe('2026-10-31');
    expect(await code(updateContext(h.alex, c.id, { visibility: 'private' }, deps))).toBe(
      'not_creator',
    );
    expect((await updateContext(h.alex, c.id, { validUntil: null }, deps)).validUntil).toBeNull();
  });
});

describe('audit stays structural', () => {
  it('no captured words or context content reach any audit row', async () => {
    const rows = await admin.db.execute(
      sql`select coalesce(summary,'') || ' ' || coalesce(meta::text,'') as t from audit_log`,
    );
    const all = rows.rows.map((r) => r.t).join('\n');
    expect(all).not.toMatch(/canary-(cap|ctx)-/);
    expect(all).not.toContain('WOF');
    expect(all).not.toContain('peanuts');
  });
});
