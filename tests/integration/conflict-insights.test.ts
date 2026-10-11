import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { insightResponse } from '@/db/schema';
import { NotPermittedError } from '@/domain/common/errors';
import {
  archiveEvent,
  changeEventOccurrence,
  createEventWithPeople,
  putBackEventOccurrence,
  restoreEvent,
  returnOccurrenceToSeries,
  skipEventOccurrence,
  updateEvent,
} from '@/domain/events/service';
import { forwardConflicts, readConflicts } from '@/domain/insights/conflicts';
import { respondedKeys } from '@/domain/insights/service';
import { readInsights, respondToInsight } from '@/domain/insights/today';
import { createPerson } from '@/domain/people/service';
import { listAudit } from '@/trust/audit';
import type { UserActor } from '@/trust/actor';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// Conflicts as insights, and the responses to them, through the real
// services as `home_app` (M6 Package 3; contract §5.7.3, §5.7.4 P3 cases,
// §5.8, §5.9; ADR 0009 §17–§19). The contract's fixture: Swimming and
// Tutoring weekly on Wednesdays, Art club and Dentist on Thursday 15
// October. A response is one adult's, for one key, everywhere; a material
// change makes a new key no old response covers; a return to an earlier
// state brings the earlier response back; nothing expires with time; the
// other adult's private records change nothing; the gate refuses before
// any read. Synthetic only.

const { db, pool, close } = testDb();
const admin = adminDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
// Wednesday 14 October 2026, 07:03 at home.
const NOW = new Date('2026-10-14T07:03:00+13:00');

let queries = 0;
const send = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof send>) => {
  queries++;
  return send(...args);
}) as typeof pool.query;

let h: Household;
const id = { milo: '', swim: '', tutor: '', art: '', dentist: '', change: '' };
const key = { standing: '', thursday: '', change: '' };

const timed = (start: string, end: string) => ({
  allDay: false as const,
  startsAt: start,
  endsAt: end,
  timeZone: ZONE,
});
const conflictsOf = (actor: UserActor, now = NOW) => readConflicts(actor, now, ZONE, deps);
const keysOf = (cs: { key: string }[]) => cs.map((c) => c.key);
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
const respond = (
  actor: UserActor,
  k: string,
  response: 'dismissed' | 'not_useful' = 'dismissed',
  surface: 'today' | 'forward' | 'person' = 'today',
) => respondToInsight(actor, k, response, surface, NOW, ZONE, deps);

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  id.milo = (await createPerson(h.sam, { name: 'Milo CI', role: 'child' }, deps)).id;
  const alex = (await createPerson(h.sam, { name: 'Alex CI', role: 'parent' }, deps)).id;
  id.swim = (
    await createEventWithPeople(
      h.sam,
      {
        title: 'Swimming',
        kind: 'activity',
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        time: timed('2026-10-14T15:30:00+13:00', '2026-10-14T16:15:00+13:00'),
      },
      [
        { personId: id.milo, role: 'attending' },
        { personId: alex, role: 'responsible' },
      ],
      deps,
    )
  ).id;
  id.tutor = (
    await createEventWithPeople(
      h.alex,
      {
        title: 'Tutoring',
        kind: 'activity',
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        time: timed('2026-10-14T15:45:00+13:00', '2026-10-14T16:30:00+13:00'),
      },
      [{ personId: id.milo, role: 'attending' }],
      deps,
    )
  ).id;
  id.art = (
    await createEventWithPeople(
      h.sam,
      {
        title: 'Art club',
        kind: 'activity',
        time: timed('2026-10-15T15:00:00+13:00', '2026-10-15T16:00:00+13:00'),
      },
      [{ personId: id.milo, role: 'attending' }],
      deps,
    )
  ).id;
  id.dentist = (
    await createEventWithPeople(
      h.alex,
      {
        title: 'Dentist',
        kind: 'appointment',
        time: timed('2026-10-15T15:30:00+13:00', '2026-10-15T16:30:00+13:00'),
      },
      [{ personId: id.milo, role: 'attending' }],
      deps,
    )
  ).id;
  const pair = (a: string, b: string) => [a, b].sort().join('.');
  key.standing = `conflict.overlap:${id.milo}:${pair(id.swim, id.tutor)}:w1545-1615`;
  key.thursday = `conflict.overlap:${id.milo}:${pair(id.art, id.dentist)}:20261015T0230Z-20261015T0300Z`;
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
  await admin.close();
});

describe('conflicts are insights for both adults, with the same keys', () => {
  it('both adults have the standing and the Thursday conflict, current and unanswered', async () => {
    for (const actor of [h.sam, h.alex]) {
      const read = await conflictsOf(actor);
      expect(keysOf(read.current)).toEqual([key.standing, key.thursday]);
      const insights = await readInsights(actor, NOW, ZONE, deps);
      const conflicts = insights.all.filter((i) => i.kind === 'conflict');
      expect(keysOf(conflicts)).toEqual([key.standing, key.thursday]);
      // The conflict family sits after data_health and before preparation (ADR 0009 §18).
      expect(conflicts.map((i) => i.rule)).toEqual(['conflict.overlap', 'conflict.overlap']);
    }
  });

  it('a crafted or malformed key is refused, and nothing is written', async () => {
    const audits = await auditCount();
    expect(await outcome(respond(h.sam, `conflict.overlap:${id.milo}:a.b:w0000-0001`))).toBe(
      'not_eligible',
    );
    expect(await outcome(respond(h.sam, 'not a key!'))).toBe('invalid');
    expect(await outcome(respond(h.sam, key.thursday, 'liked' as 'dismissed'))).toBe('invalid');
    expect(await outcome(respond(h.sam, key.thursday, 'dismissed', 'elsewhere' as 'today'))).toBe(
      'invalid',
    );
    expect(await auditCount()).toBe(audits);
  });
});

// A stale key is refused (acceptance R-1, matrix P3-4): eligibility is the
// reader's current conflicts, re-derived at `now`, so a key whose overlap has
// ended is refused and nothing is written.
describe('a stale key', () => {
  it('R-1: once the Thursday overlap has ended (16:00), responding to it is refused; no row, no audit', async () => {
    const ended = new Date('2026-10-15T16:00:00+13:00');
    expect(keysOf((await conflictsOf(h.sam, ended)).all)).not.toContain(key.thursday);
    const audits = await auditCount();
    for (const response of ['dismissed', 'not_useful'] as const)
      expect(
        await outcome(respondToInsight(h.sam, key.thursday, response, 'today', ended, ZONE, deps)),
      ).toBe('not_eligible');
    expect(await rowsFor(h.sam.userId, key.thursday)).toHaveLength(0);
    expect(await auditCount()).toBe(audits);
    // A minute before it ends it is still current, and so still eligible (not answered here).
    const running = new Date('2026-10-15T15:59:00+13:00');
    expect(keysOf((await conflictsOf(h.sam, running)).current)).toContain(key.thursday);
  });
});

describe('responses: per adult, everywhere, audited with the kind only (T17)', () => {
  it('T17: Alex dismisses the Thursday conflict; it is gone for Alex only', async () => {
    expect(await respond(h.alex, key.thursday)).toMatchObject({ already: false });
    expect(keysOf((await conflictsOf(h.alex)).current)).not.toContain(key.thursday);
    expect(keysOf((await conflictsOf(h.sam)).current)).toContain(key.thursday);
    expect(await rowsFor(h.sam.userId, key.thursday)).toHaveLength(0);
    // Hidden on every prepared surface for Alex: Today's list and Forward's data.
    const insights = await readInsights(h.alex, NOW, ZONE, deps);
    expect(keysOf([...insights.shown, ...insights.rest])).not.toContain(key.thursday);
    expect(keysOf(forwardConflicts((await conflictsOf(h.alex)).current))).not.toContain(
      key.thursday,
    );
  });

  it('Not useful hides it for Sam, records the judgement, and is audited with the kind only', async () => {
    const audits = await auditCount();
    expect(await respond(h.sam, key.standing, 'not_useful')).toMatchObject({
      response: 'not_useful',
      already: false,
    });
    expect(await auditCount()).toBe(audits + 1);
    const [row] = await rowsFor(h.sam.userId, key.standing);
    expect(row!.response).toBe('not_useful');
    expect(keysOf((await conflictsOf(h.sam)).current)).not.toContain(key.standing);
    expect(keysOf((await conflictsOf(h.alex)).current)).toContain(key.standing);
    // The same response again writes nothing.
    expect(await respond(h.sam, key.standing, 'not_useful')).toMatchObject({ already: true });
    expect(await auditCount()).toBe(audits + 1);
    // Audit: the response kind, never the key or a title; and only Sam sees it in Activity.
    const sams = (await listAudit(h.sam, { limit: 200 }, deps)).rows.filter(
      (r) => r.event === 'insight_response.respond',
    );
    expect(sams.some((r) => JSON.stringify(r.meta) === '{"response":"not_useful"}')).toBe(true);
    expect(JSON.stringify(sams)).not.toMatch(/Swimming|Tutoring|conflict\./);
    const alexs = (await listAudit(h.alex, { limit: 200 }, deps)).rows;
    expect(alexs.some((r) => sams.some((s) => s.id === r.id))).toBe(false);
  });

  it('Not useful changes no rule, ranking or other insight: Alex’s list is as it was, and so is Sam’s other conflict', async () => {
    const sam = await conflictsOf(h.sam);
    expect(keysOf(sam.current)).toEqual([key.thursday]);
    expect(keysOf(sam.all)).toEqual([key.standing, key.thursday]);
  });

  it('Sam turns Not useful into Dismiss: one more write, the key stays hidden', async () => {
    expect(await respond(h.sam, key.standing, 'dismissed')).toMatchObject({ already: false });
    expect((await rowsFor(h.sam.userId, key.standing))[0]!.response).toBe('dismissed');
  });
});

describe('the lifecycle through the event services (contract §5.7.3; §5.7.4 T3–T8, T14)', () => {
  it('T3: four weeks on, the standing key is the same and still answered: nothing expires', async () => {
    const later = await conflictsOf(h.sam, new Date('2026-11-11T07:03:00+13:00'));
    expect(keysOf(later.all)).toContain(key.standing);
    expect(later.responded[key.standing]).toBe('dismissed');
    expect(keysOf(later.current)).not.toContain(key.standing);
  });

  it('T4: the 28 October Swimming moved to 16:00–16:45 is a new conflict, eligible despite the standing dismissal', async () => {
    const change = await changeEventOccurrence(
      h.sam,
      id.swim,
      '2026-10-28T02:30:00Z',
      { time: timed('2026-10-28T16:00:00+13:00', '2026-10-28T16:45:00+13:00') },
      deps,
    );
    id.change = change.id;
    key.change = `conflict.overlap:${id.milo}:${[change.id, id.tutor].sort().join('.')}:20261028T0300Z-20261028T0330Z`;
    const sam = await conflictsOf(h.sam);
    expect(keysOf(sam.current)).toContain(key.change);
    expect(keysOf(sam.current)).not.toContain(key.standing);
    expect(await respond(h.sam, key.change)).toMatchObject({ already: false });
    expect(keysOf((await conflictsOf(h.sam)).current)).not.toContain(key.change);
  });

  it('T5: the change returned to its series: its conflict is gone; that week is under the standing key, still dismissed', async () => {
    await returnOccurrenceToSeries(h.sam, id.swim, '2026-10-28T02:30:00Z', deps);
    const sam = await conflictsOf(h.sam);
    expect(keysOf(sam.all)).not.toContain(key.change);
    const standing = sam.all.find((c) => c.key === key.standing)!;
    expect(standing.instances.map((i) => i.when)).toContain('2026-10-28');
    expect(sam.responded[key.standing]).toBe('dismissed');
  });

  it('T6: the put-away change restored: the same key, and the response given in T4 applies again', async () => {
    await restoreEvent(h.sam, id.change, deps);
    const sam = await conflictsOf(h.sam);
    expect(keysOf(sam.all)).toContain(key.change);
    expect(sam.responded[key.change]).toBe('dismissed');
    expect(keysOf(sam.current)).not.toContain(key.change);
  });

  it('T7 and T8: the 21 October Tutoring skipped, then put back: the same standing key throughout, its response unchanged', async () => {
    await skipEventOccurrence(h.alex, id.tutor, '2026-10-21', deps);
    const skipped = (await conflictsOf(h.sam)).all.find((c) => c.key === key.standing)!;
    expect(skipped.instances.map((i) => i.when)).not.toContain('2026-10-21');
    await putBackEventOccurrence(h.alex, id.tutor, '2026-10-21', deps);
    const back = await conflictsOf(h.sam);
    const standing = back.all.find((c) => c.key === key.standing)!;
    expect(standing.instances.map((i) => i.when)).toContain('2026-10-21');
    expect(back.responded[key.standing]).toBe('dismissed');
  });

  it('T14: Dentist archived, then restored: the conflict goes, then returns with its key and Alex’s dismissal', async () => {
    await archiveEvent(h.alex, id.dentist, deps);
    expect(keysOf((await conflictsOf(h.alex)).all)).not.toContain(key.thursday);
    await restoreEvent(h.alex, id.dentist, deps);
    const alex = await conflictsOf(h.alex);
    expect(keysOf(alex.all)).toContain(key.thursday);
    expect(alex.responded[key.thursday]).toBe('dismissed');
    expect(keysOf(alex.current)).not.toContain(key.thursday);
  });
});

// Material changes through the real event service (contract §5.7.4 T13 and
// T9; acceptance R-1, R-11): a moved commitment is a new key; the old key is
// refused, and an old response stays stored, matching nothing.
describe('material changes through updateEvent (T13, T9)', () => {
  const art = () => key.thursday.replace(/:2026.*$/, '');

  it('T13: Dentist moves to 15:45–16:45: the old T11 key is refused and nothing is written; the new key is accepted', async () => {
    await updateEvent(
      h.alex,
      id.dentist,
      { time: timed('2026-10-15T15:45:00+13:00', '2026-10-15T16:45:00+13:00') },
      deps,
    );
    const moved = `${art()}:20261015T0245Z-20261015T0300Z`;
    const sam = await conflictsOf(h.sam);
    expect(keysOf(sam.all)).not.toContain(key.thursday);
    expect(keysOf(sam.current)).toContain(moved);
    const audits = await auditCount();
    expect(await outcome(respond(h.sam, key.thursday))).toBe('not_eligible');
    expect(await rowsFor(h.sam.userId, key.thursday)).toHaveLength(0);
    expect(await auditCount()).toBe(audits);
    expect(await respond(h.sam, moved)).toMatchObject({ key: moved, already: false });
    expect(await auditCount()).toBe(audits + 1);
    expect(keysOf((await conflictsOf(h.sam)).current)).not.toContain(moved);
    // Moved back: T11's key returns, with Alex's dismissal from T17 (and the later tests' fixture).
    await updateEvent(
      h.alex,
      id.dentist,
      { time: timed('2026-10-15T15:30:00+13:00', '2026-10-15T16:30:00+13:00') },
      deps,
    );
    const alex = await conflictsOf(h.alex);
    expect(keysOf(alex.all)).toContain(key.thursday);
    expect(alex.responded[key.thursday]).toBe('dismissed');
  });

  it('T9: Tutoring’s series moves to 16:00–16:45: a new standing key w1600-1615, eligible; Sam’s old dismissal is kept and matches nothing', async () => {
    const [old] = await rowsFor(h.sam.userId, key.standing);
    expect(old!.response).toBe('dismissed');
    await updateEvent(
      h.alex,
      id.tutor,
      { time: timed('2026-10-14T16:00:00+13:00', '2026-10-14T16:45:00+13:00') },
      deps,
    );
    const moved = key.standing.replace(/w1545-1615$/, 'w1600-1615');
    const sam = await conflictsOf(h.sam);
    expect(keysOf(sam.all)).toContain(moved);
    expect(keysOf(sam.all)).not.toContain(key.standing);
    expect(keysOf(sam.current)).toContain(moved);
    expect(sam.responded[moved]).toBeUndefined();
    expect(await respondedKeys(h.sam, [moved], deps)).toEqual({});
    // The old response is still stored, unchanged, and matches no conflict.
    expect(await rowsFor(h.sam.userId, key.standing)).toEqual([old]);
    expect(sam.all.some((c) => c.key === key.standing)).toBe(false);
    // Eligible: Alex (who never answered either key) can respond to it.
    expect(await respond(h.alex, moved)).toMatchObject({ key: moved, already: false });
  });
});

describe('privacy (contract §3.4, §8.2)', () => {
  it('Sam’s private records change nothing in Alex’s conflicts or insights; Alex cannot respond to Sam’s private conflict', async () => {
    const before = {
      conflicts: await conflictsOf(h.alex),
      insights: await readInsights(h.alex, NOW, ZONE, deps),
    };
    await createEventWithPeople(
      h.sam,
      {
        title: 'Private Milo thing',
        kind: 'activity',
        visibility: 'private',
        time: timed('2026-10-15T15:15:00+13:00', '2026-10-15T15:45:00+13:00'),
      },
      [{ personId: id.milo, role: 'attending' }],
      deps,
    );
    const after = {
      conflicts: await conflictsOf(h.alex),
      insights: await readInsights(h.alex, NOW, ZONE, deps),
    };
    const strip = (r: typeof before) =>
      JSON.stringify({
        all: r.conflicts.all,
        current: r.conflicts.current,
        responded: r.conflicts.responded,
        insights: r.insights,
      });
    expect(strip(after)).toBe(strip(before));
    expect(strip(after)).not.toContain('Private');
    const sam = await conflictsOf(h.sam);
    const secret = sam.all.filter((c) =>
      c.occurrences.some((o) => o.title === 'Private Milo thing'),
    );
    expect(secret.length).toBeGreaterThan(0);
    const audits = await auditCount();
    expect(await outcome(respond(h.alex, secret[0]!.key))).toBe('not_eligible');
    expect(await rowsFor(h.alex.userId, secret[0]!.key)).toHaveLength(0);
    expect(await auditCount()).toBe(audits);
  });
});

describe('the gate (ADR 0006 §2) and the cost', () => {
  it('Dismiss and Not useful are refused in Production while the gate is closed, before any read', async () => {
    const saved = {
      VERCEL_ENV: process.env.VERCEL_ENV,
      HOME_REAL_DATA: process.env.HOME_REAL_DATA,
    };
    const audits = await auditCount();
    process.env.VERCEL_ENV = 'production';
    delete process.env.HOME_REAL_DATA;
    try {
      for (const response of ['dismissed', 'not_useful'] as const) {
        const q = queries;
        expect(await outcome(respond(h.sam, key.thursday, response))).toBe('real_data_closed');
        expect(queries).toBe(q);
      }
    } finally {
      for (const [k, v] of Object.entries(saved))
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    expect(await rowsFor(h.sam.userId, key.thursday)).toHaveLength(0);
    expect(await auditCount()).toBe(audits);
  });

  it('reading the reader’s conflicts costs the same queries however many events are recorded', async () => {
    const measure = async () => {
      const q = queries;
      await conflictsOf(h.sam);
      return queries - q;
    };
    const small = await measure();
    for (let k = 0; k < 20; k++)
      await createEventWithPeople(
        h.sam,
        {
          title: `Extra ${k}`,
          kind: 'other',
          time: timed(
            `2026-10-${16 + (k % 10)}T10:00:00+13:00`,
            `2026-10-${16 + (k % 10)}T11:00:00+13:00`,
          ),
        },
        [{ personId: id.milo, role: 'attending' }],
        deps,
      );
    const large = await measure();
    expect(large).toBe(small);
    console.info(
      `Conflicts for a reader (90 days): ${small} queries, then ${large} with 20 more events`,
    );
  });
});
