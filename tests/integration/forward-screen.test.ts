import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { insightResponse } from '@/db/schema';
import { NotPermittedError } from '@/domain/common/errors';
import { agenda, forPerson } from '@/domain/engines/agenda';
import { occurrenceKey } from '@/domain/engines/day-facts';
import {
  forward,
  forwardPlacements,
  HORIZON_DAYS,
  HORIZONS,
  type Horizon,
} from '@/domain/engines/forward';
import { conflictMarks } from '@/domain/engines/insights';
import { placement } from '@/domain/engines/today';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import { createEventWithPeople } from '@/domain/events/service';
import { conflictsOver, forwardConflicts } from '@/domain/insights/conflicts';
import { forwardInsights } from '@/domain/insights/forward';
import { personInsights } from '@/domain/insights/person';
import { readInsights, respondToInsight } from '@/domain/insights/today';
import { createPerson } from '@/domain/people/service';
import { createProject } from '@/domain/projects/service';
import { createTask } from '@/domain/tasks/service';
import { addDays, isoDateInZone } from '@/lib/dates';
import { listAudit } from '@/trust/audit';
import type { UserActor } from '@/trust/actor';
import { todayInput } from '@/app/_agenda/today-input';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// The Forward screen's composition through the real services as `home_app`
// (M6 Package 4; contract §4, §5.8, §8.2; ADR 0009 §18, §19, §28): composed
// exactly as the page composes it (one 90-day agenda read as the signed-in
// adult, the conflict engine over it, the reader's responses in one more
// query, the Forward engine, the marks) and as the person page composes its
// Coming up marks. Two adults. The other adult's private records and
// responses change nothing in a reader's Forward, insights or marks; a
// response given anywhere is a response everywhere for that adult only; the
// forward and person surfaces refuse what they may not answer; the read costs
// the same however much is recorded. Synthetic only.

const { db, pool, close } = testDb();
const admin = adminDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
// Wednesday 14 October 2026, 07:03 at home.
const NOW = new Date('2026-10-14T07:03:00+13:00');
const TODAY = isoDateInZone(NOW, ZONE);

let queries = 0;
const send = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof send>) => {
  queries++;
  return send(...args);
}) as typeof pool.query;

let h: Household;
const id = { sam: '', alex: '', milo: '', isla: '' };
const key = { art: '', piano: '', bee: '', samPrivate: '', birthday: '', busy: '' };

const timed = (start: string, end: string) => ({
  allDay: false as const,
  startsAt: start,
  endsAt: end,
  timeZone: ZONE,
});
const day = (d: string, from: string, to: string) =>
  timed(`${d}T${from}:00+13:00`, `${d}T${to}:00+13:00`);

type Page = Awaited<ReturnType<typeof page>>;

/**
 * The Forward page's composition for one horizon, step for step: one agenda
 * read (`readAgendaInputs`, which `loadAgenda` wraps), the 90-day agenda, the
 * conflict engine, the one responses query, the engine and the marks.
 */
async function page(actor: UserActor, horizon: Horizon) {
  const inputs = await readAgendaInputs(actor, deps);
  const coverage = { from: TODAY, to: addDays(TODAY, 89) };
  const days = agenda({
    ...coverage,
    timeZone: ZONE,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: inputs.tasks,
    projects: inputs.projects,
  });
  const loaded = {
    days,
    events: inputs.events,
    people: new Map(inputs.people.map((p) => [p.id, p])),
    records: inputs.records,
  };
  const records = { events: inputs.events, people: inputs.people, records: inputs.records };
  const found = conflictsOver(records, days, NOW, ZONE, coverage);
  const worth = await forwardInsights(
    actor,
    records,
    days,
    NOW,
    ZONE,
    horizon,
    HORIZON_DAYS[horizon],
    found,
    deps,
  );
  const current = found.filter((c) => !worth.responded.has(c.key));
  const input = todayInput(loaded as Parameters<typeof todayInput>[0], NOW, ZONE, 0);
  const model = forward({
    now: NOW,
    timeZone: ZONE,
    horizon,
    days,
    coverage,
    events: inputs.events,
    people: input.people,
    calendars: input.calendars,
    conflicts: forwardConflicts(current),
  });
  const marks = conflictMarks(worth, worth.responded, forwardPlacements(model), ZONE);
  return { found, current, worth, model, marks };
}

/** Every horizon, as the page would draw each. */
const pages = async (actor: UserActor) =>
  Object.fromEntries(
    await Promise.all(HORIZONS.map(async (x) => [x, await page(actor, x)])),
  ) as Record<Horizon, Page>;

/** What a reader sees of a page, as data: for byte-for-byte comparison. */
const seen = (p: Page) =>
  JSON.stringify({
    model: p.model,
    conflicts: p.found,
    insights: { all: p.worth.all, shown: p.worth.shown, rest: p.worth.rest, more: p.worth.more },
    responded: [...p.worth.responded],
    marks: [...p.marks],
  });
const seenAll = (ps: Record<Horizon, Page>) => JSON.stringify(HORIZONS.map((x) => seen(ps[x])));

/** A person's Coming up as the person page composes it. */
async function person(actor: UserActor, personId: string) {
  const inputs = await readAgendaInputs(actor, deps);
  const to = addDays(TODAY, 29);
  const days = agenda({
    from: TODAY,
    to,
    timeZone: ZONE,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: inputs.tasks,
    projects: inputs.projects,
  });
  const placed = new Set(
    forPerson(days, personId)
      .flatMap((d) => d.items)
      .filter((i) => i.kind === 'event')
      .map((i) => placement(personId, occurrenceKey(i))),
  );
  const worth = await personInsights(
    actor,
    { events: inputs.events, people: inputs.people, records: inputs.records },
    days,
    NOW,
    ZONE,
    personId,
    placed,
    deps,
  );
  return { worth, marks: conflictMarks(worth, worth.responded, placed, ZONE), placed };
}
const markKeys = (m: Map<string, { insight: { key: string } }[]>) =>
  new Set([...m.values()].flat().map((x) => x.insight.key));
const listedKeys = (p: Page) => [...p.worth.shown, ...p.worth.rest].map((i) => i.key);

const respond = (
  actor: UserActor,
  k: string,
  response: 'dismissed' | 'not_useful',
  surface: 'today' | 'forward' | 'person',
) => respondToInsight(actor, k, response, surface, NOW, ZONE, deps);
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
const counts = async () => ({
  audit: Number((await admin.db.execute(sql`select count(*)::int as n from audit_log`)).rows[0]?.n),
  responses: Number(
    (await admin.db.execute(sql`select count(*)::int as n from insight_response`)).rows[0]?.n,
  ),
});
const rowsFor = async (userId: string, k: string) =>
  admin.db
    .select()
    .from(insightResponse)
    .where(and(eq(insightResponse.userId, userId), eq(insightResponse.insightKey, k)));

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  id.sam = (await createPerson(h.sam, { name: 'Sam FS', role: 'parent' }, deps)).id;
  id.alex = (await createPerson(h.sam, { name: 'Alex FS', role: 'parent' }, deps)).id;
  // Milo’s birthday is on Monday 19 October: a preparation insight both adults share.
  id.milo = (
    await createPerson(h.sam, { name: 'Milo FS', role: 'child', dateOfBirth: '2017-10-19' }, deps)
  ).id;
  id.isla = (await createPerson(h.sam, { name: 'Isla FS', role: 'child' }, deps)).id;
  const att = (...ids: string[]) =>
    ids.map((personId) => ({ personId, role: 'attending' as const }));
  const resp = (...ids: string[]) =>
    ids.map((personId) => ({ personId, role: 'responsible' as const }));
  const make = (
    who: UserActor,
    title: string,
    d: string,
    from: string,
    to: string,
    people: ReturnType<typeof att>,
  ) =>
    createEventWithPeople(who, { title, kind: 'activity', time: day(d, from, to) }, people, deps);

  // A: Milo, Thursday 15th (Sam’s and Alex’s events). B: Milo, Friday 16th.
  await make(h.sam, 'Art club', '2026-10-15', '15:00', '16:00', att(id.milo));
  await make(h.alex, 'Dentist', '2026-10-15', '15:30', '16:30', att(id.milo));
  await make(h.sam, 'Piano', '2026-10-16', '15:00', '16:00', att(id.milo));
  await make(h.alex, 'Swim test', '2026-10-16', '15:30', '16:30', att(id.milo));
  // C: Alex responsible on both, Saturday 17th: Alex’s own, not Milo’s.
  await make(h.alex, 'Working bee', '2026-10-17', '10:00', '11:00', resp(id.alex));
  await make(h.alex, 'Board meeting', '2026-10-17', '10:30', '11:30', resp(id.alex));
  // Four more on Thursday 15th for Isla, with Milo’s two: six things tomorrow (busy_day.count).
  for (const [k, [from, to]] of [
    ['08:00', '08:30'],
    ['09:00', '09:30'],
    ['10:00', '10:30'],
    ['11:00', '11:30'],
  ].entries())
    await make(h.sam, `Isla thing ${k}`, '2026-10-15', from!, to!, att(id.isla));
  // Sam is on a household event on Tuesday 20th; Sam’s private one overlaps it (set up in the test).
  await make(h.sam, 'Sam standup', '2026-10-20', '09:00', '10:00', att(id.sam));

  const sam = await readInsights(h.sam, NOW, ZONE, deps);
  const conflictKeys = (await page(h.sam, 'month')).found;
  const by = (t1: string, t2: string) =>
    conflictKeys.find((c) => [t1, t2].every((t) => c.occurrences.some((o) => o.title === t)))!.key;
  key.art = by('Art club', 'Dentist');
  key.piano = by('Piano', 'Swim test');
  key.bee = by('Working bee', 'Board meeting');
  key.birthday = sam.all.find((i) => i.rule === 'preparation.birthday')!.key;
  key.busy = sam.all.find((i) => i.rule === 'busy_day.count')!.key;
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
  await admin.close();
});

describe('the fixtures stand (so the invariants below are not vacuous)', () => {
  it('both adults see the three conflicts, a birthday and a busy day, in the Forward composition', async () => {
    for (const actor of [h.sam, h.alex]) {
      const ps = await pages(actor);
      expect(ps.season.found.map((c) => c.key).sort()).toEqual(
        [key.art, key.piano, key.bee].sort(),
      );
      expect(ps.week.model.headline.conflicts?.text).toBe('There are three overlaps.');
      // Week says them on rows: marks for all three, nothing listed.
      expect(listedKeys(ps.week)).toEqual([]);
      expect(markKeys(ps.week.marks)).toEqual(new Set([key.art, key.piano, key.bee]));
      // Month lists them (two shown, one more), responsible first; no marks.
      expect(ps.month.worth.shown.map((i) => i.key)).toEqual([key.bee, key.art]);
      expect(ps.month.worth.rest.map((i) => i.key)).toEqual([key.piano]);
      expect(ps.month.worth.more).toBe(1);
      expect(ps.month.marks.size).toBe(0);
      expect(ps.season.marks.size).toBe(0);
    }
  });
});

describe('non-interference (contract §8.2)', () => {
  it('Sam’s private event, task and project change nothing in Alex’s Forward on any horizon, and do change Sam’s', async () => {
    const alexBefore = await pages(h.alex);
    const samBefore = await pages(h.sam);
    const alexMilo = await person(h.alex, id.milo);

    // Sam’s private event overlaps the household event Sam is on; a private task and project too.
    await createEventWithPeople(
      h.sam,
      {
        title: 'Private appointment',
        kind: 'appointment',
        visibility: 'private',
        time: day('2026-10-20', '09:30', '10:30'),
      },
      [{ personId: id.sam, role: 'attending' }],
      deps,
    );
    await createTask(
      h.sam,
      {
        title: 'Private scheduled',
        visibility: 'private',
        scheduled: { startsAt: '2026-10-17T10:00:00+13:00', endsAt: '2026-10-17T11:00:00+13:00' },
      },
      deps,
    );
    await createProject(
      h.sam,
      {
        title: 'Private project',
        status: 'active',
        targetDate: '2026-10-30',
        visibility: 'private',
      },
      deps,
    );

    const alexAfter = await pages(h.alex);
    for (const x of HORIZONS) expect(seen(alexAfter[x]), x).toBe(seen(alexBefore[x]));
    expect(seenAll(alexAfter)).toBe(seenAll(alexBefore));
    expect(seenAll(alexAfter)).not.toMatch(/Private/);
    expect(JSON.stringify([...(await person(h.alex, id.milo)).marks])).toBe(
      JSON.stringify([...alexMilo.marks]),
    );

    // The same records reach their owner: the invariant is not vacuous.
    const samAfter = await pages(h.sam);
    const secret = samAfter.season.found.filter((c) =>
      c.occurrences.some((o) => o.title === 'Private appointment'),
    );
    expect(secret).toHaveLength(1);
    key.samPrivate = secret[0]!.key;
    expect(samAfter.season.found).toHaveLength(samBefore.season.found.length + 1);
    expect(samAfter.week.model.headline.conflicts?.text).toBe('There are four overlaps.');
    expect(alexAfter.week.model.headline.conflicts?.text).toBe('There are three overlaps.');
    expect(JSON.stringify(samAfter.month.model)).toContain('Private project');
    expect(samAfter.week.model.counts.tasksScheduled).toBe(
      samBefore.week.model.counts.tasksScheduled + 1,
    );
    // Week marks Sam’s private conflict on its two rows; Month lists it.
    expect(markKeys(samAfter.week.marks).has(key.samPrivate)).toBe(true);
    expect(listedKeys(samAfter.month)).toContain(key.samPrivate);
    for (const m of [...samAfter.week.marks.values()]
      .flat()
      .filter((x) => x.insight.key === key.samPrivate))
      expect(m.text).toMatch(/· Sam FS$/);
  });

  it('Alex’s responses change nothing in Sam’s Forward, insights or marks, and do change Alex’s', async () => {
    const samBefore = await pages(h.sam);
    const alexBefore = await pages(h.alex);
    const samMilo = await person(h.sam, id.milo);

    await respond(h.alex, key.art, 'dismissed', 'forward');
    await respond(h.alex, key.piano, 'not_useful', 'person');
    try {
      const samAfter = await pages(h.sam);
      for (const x of HORIZONS) expect(seen(samAfter[x]), x).toBe(seen(samBefore[x]));
      expect(JSON.stringify([...(await person(h.sam, id.milo)).marks])).toBe(
        JSON.stringify([...samMilo.marks]),
      );
      expect(JSON.stringify(await readInsights(h.sam, NOW, ZONE, deps))).toContain(key.art);

      const alexAfter = await pages(h.alex);
      for (const x of HORIZONS) expect(seen(alexAfter[x]), x).not.toBe(seen(alexBefore[x]));
      expect(alexAfter.week.model.headline.conflicts?.text).toBe('There is one overlap.');
      expect(markKeys(alexAfter.week.marks)).toEqual(new Set([key.bee]));
    } finally {
      // Leave no response behind for the cross-surface case below.
      await admin.db.execute(sql`delete from insight_response`);
    }
  });
});

describe('cross-surface: one response is a response everywhere, for its reader only', () => {
  it('Sam dismisses a conflict from Forward: gone from Forward (every horizon), Today and Milo’s Coming up; Alex unchanged', async () => {
    const before = await pages(h.sam);
    const alexBefore = await pages(h.alex);
    const alexMilo = await person(h.alex, id.milo);
    expect(markKeys((await person(h.sam, id.milo)).marks).has(key.art)).toBe(true);
    const today0 = await readInsights(h.sam, NOW, ZONE, deps);
    expect([...today0.shown, ...today0.rest].map((i) => i.key)).toContain(key.art);

    expect(await respond(h.sam, key.art, 'dismissed', 'forward')).toEqual({
      key: key.art,
      response: 'dismissed',
      already: false,
    });

    const after = await pages(h.sam);
    for (const x of HORIZONS) {
      expect(after[x].worth.responded.has(key.art), x).toBe(true);
      expect(
        after[x].current.map((c) => c.key),
        x,
      ).not.toContain(key.art);
      expect(listedKeys(after[x]), x).not.toContain(key.art);
      expect(markKeys(after[x].marks).has(key.art), x).toBe(false);
      expect(
        after[x].model.units.flatMap((u) => u.notable).filter((e) => e.conflicted).length,
        x,
      ).toBe(
        before[x].model.units.flatMap((u) => u.notable).filter((e) => e.conflicted).length - 2,
      );
      expect(after[x].model.counts.conflicts, x).toBe(before[x].model.counts.conflicts - 1);
    }
    expect(after.week.model.headline.conflicts?.text).toBe('There are three overlaps.');
    const today1 = await readInsights(h.sam, NOW, ZONE, deps);
    expect([...today1.shown, ...today1.rest].map((i) => i.key)).not.toContain(key.art);
    expect((await person(h.sam, id.milo)).marks.size).toBe(2); // Piano and Swim test only
    expect(markKeys((await person(h.sam, id.milo)).marks)).toEqual(new Set([key.piano]));

    const alexAfter = await pages(h.alex);
    for (const x of HORIZONS) expect(seen(alexAfter[x]), x).toBe(seen(alexBefore[x]));
    expect(JSON.stringify([...(await person(h.alex, id.milo)).marks])).toBe(
      JSON.stringify([...alexMilo.marks]),
    );
    expect(markKeys((await person(h.alex, id.milo)).marks).has(key.art)).toBe(true);
  });

  it('Not useful from Milo’s page on another conflict: the same everywhere, audited with the kind only', async () => {
    const alexBefore = await pages(h.alex);
    const before = await counts();
    expect(await respond(h.sam, key.piano, 'not_useful', 'person')).toMatchObject({
      response: 'not_useful',
      already: false,
    });
    expect(await counts()).toEqual({ audit: before.audit + 1, responses: before.responses + 1 });
    expect((await rowsFor(h.sam.userId, key.piano))[0]!.response).toBe('not_useful');
    expect(await rowsFor(h.alex.userId, key.piano)).toHaveLength(0);

    const after = await pages(h.sam);
    for (const x of HORIZONS) {
      expect(listedKeys(after[x]), x).not.toContain(key.piano);
      expect(markKeys(after[x].marks).has(key.piano), x).toBe(false);
      expect(
        after[x].current.map((c) => c.key),
        x,
      ).not.toContain(key.piano);
    }
    // Sam’s private conflict and Alex’s own are still there.
    expect(after.week.model.headline.conflicts?.text).toBe('There are two overlaps.');
    expect(markKeys(after.week.marks)).toEqual(new Set([key.bee, key.samPrivate]));
    const today = await readInsights(h.sam, NOW, ZONE, deps);
    expect([...today.shown, ...today.rest].map((i) => i.key)).not.toContain(key.piano);
    expect((await person(h.sam, id.milo)).marks.size).toBe(0);

    const mine = (await listAudit(h.sam, { limit: 200 }, deps)).rows.filter(
      (r) => r.event === 'insight_response.respond',
    );
    expect(mine.map((r) => JSON.stringify(r.meta)).sort()).toEqual([
      '{"response":"dismissed"}',
      '{"response":"not_useful"}',
    ]);
    expect(JSON.stringify(mine)).not.toMatch(/Piano|Swim test|Art club|conflict\./);

    const alexAfter = await pages(h.alex);
    for (const x of HORIZONS) expect(seen(alexAfter[x]), x).toBe(seen(alexBefore[x]));
  });
});

describe('refusals from the forward and person surfaces (contract §5.9)', () => {
  it('a birthday or busy-day key is not eligible on Forward or Milo’s page; nothing is written', async () => {
    const insights = await readInsights(h.sam, NOW, ZONE, deps);
    // Both exist and are not said on an object: only their surface may answer them.
    expect(insights.all.find((i) => i.key === key.birthday)).toMatchObject({
      kind: 'preparation',
      onObject: false,
    });
    expect(insights.all.find((i) => i.key === key.busy)).toMatchObject({
      kind: 'busy_day',
      onObject: false,
    });
    const before = await counts();
    for (const k of [key.birthday, key.busy])
      for (const surface of ['forward', 'person'] as const)
        expect(await outcome(respond(h.sam, k, 'dismissed', surface)), `${k} ${surface}`).toBe(
          'not_eligible',
        );
    expect(await counts()).toEqual(before);
  });

  it('a crafted, malformed or unknown-surface key is refused, from either surface', async () => {
    const before = await counts();
    const crafted = `conflict.overlap:${id.milo}:a.b:w0000-0001`;
    for (const surface of ['forward', 'person'] as const) {
      expect(await outcome(respond(h.sam, crafted, 'dismissed', surface))).toBe('not_eligible');
      expect(await outcome(respond(h.sam, 'not a key!', 'dismissed', surface))).toBe('invalid');
    }
    expect(await outcome(respond(h.sam, key.bee, 'dismissed', 'elsewhere' as 'forward'))).toBe(
      'invalid',
    );
    // Alex cannot answer Sam’s private conflict from any surface.
    for (const surface of ['forward', 'person'] as const)
      expect(await outcome(respond(h.alex, key.samPrivate, 'dismissed', surface))).toBe(
        'not_eligible',
      );
    expect(await counts()).toEqual(before);
  });
});

describe('a person’s Coming up marks (contract §4.6, ADR 0009 §28)', () => {
  it('Milo’s page marks Milo’s items only; a conflict Alex is in is not on it', async () => {
    // Alex has answered nothing here, so every conflict of Milo’s is current.
    const milo = await person(h.alex, id.milo);
    expect(markKeys(milo.marks)).toEqual(new Set([key.art, key.piano]));
    expect([...milo.marks.keys()].sort()).toEqual(
      [...milo.placed].filter((p) => milo.marks.has(p)).sort(),
    );
    // Only Milo’s own lines: every mark sits on a placement of Milo’s, and names no person.
    for (const [k, list] of milo.marks) {
      expect(milo.placed.has(k)).toBe(true);
      for (const m of list) expect(m.text).not.toContain('·');
    }
    expect(milo.marks.size).toBe(4); // two conflicts, each on its two items
    const texts = [...milo.marks.values()]
      .flat()
      .map((m) => m.text)
      .sort();
    expect(texts).toEqual([
      'overlaps Art club 15:00',
      'overlaps Dentist 15:30',
      'overlaps Piano 15:00',
      'overlaps Swim test 15:30',
    ]);
    // Alex’s responsible pair is Alex’s: it is on Alex’s page, never Milo’s.
    expect(markKeys(milo.marks).has(key.bee)).toBe(false);
    const alex = await person(h.alex, id.alex);
    expect(markKeys(alex.marks)).toEqual(new Set([key.bee]));
    expect(markKeys(alex.marks).has(key.art)).toBe(false);
    // Nothing is listed on a person’s page.
    expect([...milo.worth.shown, ...milo.worth.rest]).toEqual([]);
  });
});

describe('what the composition costs (contract §3.7)', () => {
  it('is the agenda read plus exactly one query, and the same after more is recorded', async () => {
    const measure = async () => {
      const a = queries;
      await readAgendaInputs(h.alex, deps);
      const load = queries - a;
      const b = queries;
      const p = await page(h.alex, 'season');
      return { load, total: queries - b, p };
    };
    const small = await measure();
    expect(small.p.found.length).toBeGreaterThan(0); // else the responses query is skipped
    expect(small.total).toBe(small.load + 1);

    for (let k = 0; k < 20; k++) {
      const d = addDays('2026-10-21', k * 3);
      await createEventWithPeople(
        h.sam,
        { title: `Extra ${k}`, kind: 'other', time: day(d, '12:00', '12:30') },
        [{ personId: id.isla, role: 'attending' }],
        deps,
      );
    }
    for (let k = 0; k < 3; k++)
      await createTask(h.sam, { title: `Extra task ${k}`, dueDate: addDays(TODAY, 5 + k) }, deps);
    await createProject(
      h.sam,
      { title: 'Extra project', status: 'active', targetDate: '2026-11-03' },
      deps,
    );
    const sealed = `hc1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`;
    const c = await admin.db.execute(sql`
      insert into calendar_connection (owner_user_id, provider, credentials_encrypted, credentials_key_id, address_fingerprint)
      values (${h.sam.userId}, 'ics', ${sealed}, '0123456789abcdef', ${`fp1.${'7'.repeat(43)}`}) returning id`);
    await admin.db.execute(sql`
      insert into calendar_source (created_by, created_via, visibility, connection_id, external_calendar_id, name, last_attempt_at, last_synced_at, last_sync_status)
      values (${h.sam.userId}, 'ui', 'household', ${c.rows[0]?.id as string}::uuid, 'primary', 'Second FS',
              '2026-10-14T05:00:00+13:00', '2026-10-14T05:00:00+13:00', 'ok')`);

    const large = await measure();
    expect(large.p.model.counts.events).toBeGreaterThanOrEqual(small.p.model.counts.events + 20);
    expect(large.load).toBe(small.load);
    expect(large.total).toBe(large.load + 1);
    expect(large.total).toBe(small.total);
    console.info(
      `Forward page composition: ${small.load} agenda queries + 1 responses query = ${small.total}; ${large.total} after 20 events, 3 tasks, a project and a second calendar`,
    );
  });
});
