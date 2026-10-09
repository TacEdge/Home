import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { insightResponse } from '@/db/schema';
import { NotPermittedError } from '@/domain/common/errors';
import { createEventWithPeople } from '@/domain/events/service';
import { dismissInsight, insightsFor, insightsInput, readInsights } from '@/domain/insights/today';
import { createPerson } from '@/domain/people/service';
import { createProject } from '@/domain/projects/service';
import { createTask } from '@/domain/tasks/service';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import { agenda } from '@/domain/engines/agenda';
import { env } from '@/lib/env';
import { listAudit } from '@/trust/audit';
import type { UserActor } from '@/trust/actor';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// Worth knowing and Dismiss through the real services as `home_app` (M5
// Package 4, ADR 0008 §23, §33): two adults, each with a private record that
// makes an insight, and household records that make insights both see. A
// dismissal is its reader's own and changes nothing for the other; a key
// that is not one of the reader's current insights (the other adult's
// private one, a made-up one) is refused and writes nothing; the gate
// refuses in Production; Activity shows a response to its owner only; the
// whole thing costs one extra query. Synthetic only.

const { db, pool, close } = testDb();
const admin = adminDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
// Wednesday 14 October 2026, 07:03 at home.
const NOW = new Date('2026-10-14T07:03:00+13:00');
let h: Household;
const key = { nana: '', samSecret: '', alexProject: '', fence: '' };

let queries = 0;
const send = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof send>) => {
  queries++;
  return send(...args);
}) as typeof pool.query;

const keysOf = (r: Awaited<ReturnType<typeof readInsights>>) => ({
  all: r.all.map((i) => i.key),
  listed: [...r.shown, ...r.rest].map((i) => i.key),
});
const rowsFor = async (userId: string, k: string) =>
  admin.db
    .select()
    .from(insightResponse)
    .where(and(eq(insightResponse.userId, userId), eq(insightResponse.insightKey, k)));
const auditCount = async () =>
  Number((await admin.db.execute(sql`select count(*)::int as n from audit_log`)).rows[0]?.n);
const outcome = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof NotPermittedError) return e.code;
    if (e instanceof ZodError) return 'invalid';
    throw e;
  }
};

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  // Household: Nana Jo's birthday on Tuesday 20 October, and the back fence due Saturday with a task.
  const nana = await createPerson(
    h.sam,
    { name: 'Nana WK', role: 'other', inHousehold: false, dateOfBirth: '1958-10-20' },
    deps,
  );
  const fence = await createProject(
    h.sam,
    { title: 'Fence WK', status: 'active', targetDate: '2026-10-17' },
    deps,
  );
  await createTask(h.sam, { title: 'Paint WK', projectId: fence.id }, deps);
  // Sam's private person, with a birthday on Friday: only Sam may ever see that insight.
  const secret = await createPerson(
    h.sam,
    {
      name: 'Sam secret WK',
      role: 'other',
      inHousehold: false,
      dateOfBirth: '1990-10-16',
      visibility: 'private',
    },
    deps,
  );
  // Alex's private project due Monday with a private task: only Alex's.
  const alexProject = await createProject(
    h.alex,
    { title: 'Alex secret WK', status: 'active', targetDate: '2026-10-19', visibility: 'private' },
    deps,
  );
  await createTask(
    h.alex,
    { title: 'Alex secret task WK', projectId: alexProject.id, visibility: 'private' },
    deps,
  );
  // Something on the agenda, so the household's day is not empty.
  await createEventWithPeople(
    h.sam,
    {
      title: 'Swim WK',
      kind: 'activity',
      time: {
        allDay: false,
        startsAt: '2026-10-14T15:30:00+13:00',
        endsAt: '2026-10-14T16:15:00+13:00',
        timeZone: ZONE,
      },
    },
    [],
    deps,
  );
  key.nana = `preparation.birthday:${nana.id}:2026-10-20`;
  key.samSecret = `preparation.birthday:${secret.id}:2026-10-16`;
  key.alexProject = `preparation.project_target:${alexProject.id}:2026-10-19`;
  key.fence = `preparation.project_target:${fence.id}:2026-10-17`;
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
  await admin.close();
});

describe('each adult’s insights are their own records’', () => {
  it('both see the household’s; each sees only their own private one; nothing else leaks', async () => {
    const sam = keysOf(await readInsights(h.sam, NOW, ZONE, deps));
    const alex = keysOf(await readInsights(h.alex, NOW, ZONE, deps));
    expect(sam.listed).toEqual(expect.arrayContaining([key.nana, key.fence, key.samSecret]));
    expect(alex.listed).toEqual(expect.arrayContaining([key.nana, key.fence, key.alexProject]));
    expect(sam.all).not.toContain(key.alexProject);
    expect(alex.all).not.toContain(key.samSecret);
    // Not by any trace either: text, facts or basis.
    const alexAll = JSON.stringify(await readInsights(h.alex, NOW, ZONE, deps));
    expect(alexAll).not.toContain('Sam secret');
    expect(alexAll).not.toContain(key.samSecret.split(':')[1]);
    const samAll = JSON.stringify(await readInsights(h.sam, NOW, ZONE, deps));
    expect(samAll).not.toContain('Alex secret');
    // The household project counts only the tasks this reader can see.
    const fence = (await readInsights(h.alex, NOW, ZONE, deps)).all.find(
      (i) => i.key === key.fence,
    )!;
    expect(fence.basis.openTasks).toBe(1);
  });
});

describe('dismiss', () => {
  it('is the reader’s own: gone for Sam, from the list and the count, still there for Alex', async () => {
    const before = await readInsights(h.sam, NOW, ZONE, deps);
    const alexBefore = await readInsights(h.alex, NOW, ZONE, deps);
    expect(await dismissInsight(h.sam, key.nana, NOW, ZONE, deps)).toEqual({
      key: key.nana,
      already: false,
    });
    const after = await readInsights(h.sam, NOW, ZONE, deps);
    expect(keysOf(after).listed).not.toContain(key.nana);
    expect(after.shown.length + after.more).toBe(before.shown.length + before.more - 1);
    expect(after.all.map((i) => i.key)).toContain(key.nana); // still derived, never deleted
    expect(await readInsights(h.alex, NOW, ZONE, deps)).toEqual(alexBefore);
    expect(await rowsFor(h.sam.userId, key.nana)).toHaveLength(1);
    expect(await rowsFor(h.alex.userId, key.nana)).toHaveLength(0);
  });

  it('again changes nothing: one row, no second audit entry', async () => {
    const audits = await auditCount();
    expect(await dismissInsight(h.sam, key.nana, NOW, ZONE, deps)).toEqual({
      key: key.nana,
      already: true,
    });
    expect(await rowsFor(h.sam.userId, key.nana)).toHaveLength(1);
    expect(await auditCount()).toBe(audits);
  });

  it('stays dismissed the next day, while the birthday is the same birthday (the same key)', async () => {
    const thursday = new Date('2026-10-15T07:03:00+13:00');
    const r = await readInsights(h.sam, thursday, ZONE, deps);
    expect(r.all.map((i) => i.key)).toContain(key.nana);
    expect(keysOf(r).listed).not.toContain(key.nana);
  });

  it('is audited without the insight’s words or key, and Activity shows it to its owner only', async () => {
    const samPage = await listAudit(h.sam, { limit: 200 }, deps);
    const mine = samPage.rows.filter((r) => r.event === 'insight_response.respond');
    expect(mine.length).toBeGreaterThan(0);
    const raw = JSON.stringify(mine);
    expect(raw).not.toContain('Nana');
    expect(raw).not.toContain(key.nana);
    const alexPage = await listAudit(h.alex, { limit: 200 }, deps);
    // Alex may have responses of their own (other suites share the database); none of Sam's is listed.
    const ids = new Set(mine.map((r) => r.id));
    expect(
      alexPage.rows.filter(
        (r) =>
          r.event === 'insight_response.respond' &&
          (r.actorUserId === h.sam.userId || ids.has(r.id)),
      ),
    ).toEqual([]);
  });

  it('refuses a key the reader cannot see, and writes nothing: Alex cannot touch Sam’s private insight', async () => {
    const audits = await auditCount();
    expect(await outcome(dismissInsight(h.alex, key.samSecret, NOW, ZONE, deps))).toBe(
      'not_eligible',
    );
    expect(await rowsFor(h.alex.userId, key.samSecret)).toHaveLength(0);
    expect(await auditCount()).toBe(audits);
    expect(keysOf(await readInsights(h.sam, NOW, ZONE, deps)).listed).toContain(key.samSecret);
  });

  it('refuses a made-up key, a malformed one, and one already said on its item', async () => {
    const audits = await auditCount();
    expect(
      await outcome(
        dismissInsight(h.sam, 'preparation.birthday:nobody:2026-10-20', NOW, ZONE, deps),
      ),
    ).toBe('not_eligible');
    expect(await outcome(dismissInsight(h.sam, 'not a key; drop table', NOW, ZONE, deps))).toBe(
      'invalid',
    );
    // On the day itself the fence is on Today already (on its item): not dismissible from here.
    const saturday = new Date('2026-10-17T07:03:00+13:00');
    expect(await outcome(dismissInsight(h.sam, key.fence, saturday, ZONE, deps))).toBe(
      'not_eligible',
    );
    expect(await auditCount()).toBe(audits);
  });

  it('is refused in Production while the gate is closed, before anything is read or written', async () => {
    const saved = {
      VERCEL_ENV: process.env.VERCEL_ENV,
      HOME_REAL_DATA: process.env.HOME_REAL_DATA,
    };
    void env.HOME_TIMEZONE;
    const audits = await auditCount();
    const q = queries;
    process.env.VERCEL_ENV = 'production';
    delete process.env.HOME_REAL_DATA;
    try {
      expect(await outcome(dismissInsight(h.sam, key.fence, NOW, ZONE, deps))).toBe(
        'real_data_closed',
      );
      expect(queries).toBe(q);
    } finally {
      for (const [k, v] of Object.entries(saved))
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    expect(await rowsFor(h.sam.userId, key.fence)).toHaveLength(0);
    expect(await auditCount()).toBe(audits);
  });
});

describe('what it costs', () => {
  it('dismissals are one query on top of the agenda read, whatever the number of insights', async () => {
    const inputs = await readAgendaInputs(h.sam, deps);
    const days = agenda({
      from: '2026-10-14',
      to: '2026-10-21',
      timeZone: ZONE,
      events: inputs.events,
      people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
      tasks: inputs.tasks,
      projects: inputs.projects,
    });
    const before = queries;
    const r = await insightsFor(h.sam as UserActor, insightsInput(inputs, days, NOW, ZONE), deps);
    expect(r.all.length).toBeGreaterThanOrEqual(3);
    expect(queries - before).toBe(1);
    console.info(`Worth knowing: ${queries - before} query for ${r.all.length} insights`);
  });
});
