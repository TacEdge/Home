import { and, eq, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insightResponse } from '@/db/schema';
import { NotPermittedError } from '@/domain/common/errors';
import { agenda } from '@/domain/engines/agenda';
import type { Insight, InsightKind, Insights } from '@/domain/engines/insights';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import { createEventWithPeople } from '@/domain/events/service';
import { conflictsOver } from '@/domain/insights/conflicts';
import { FORWARD_SHOWN, forwardInsights } from '@/domain/insights/forward';
import {
  insightsFor,
  insightsInput,
  OPENINGS_LISTED,
  respondToInsight,
} from '@/domain/insights/today';
import { createPerson } from '@/domain/people/service';
import {
  archiveProject,
  createProject,
  listProjects,
  updateProject,
} from '@/domain/projects/service';
import { archiveTask, createTask } from '@/domain/tasks/service';
import { toStoredHour } from '@/domain/weather/provider';
import { syntheticHours, utcDayStart, type SyntheticValues } from '@/integrations/weather/fake';
import { addDays, isoDateInZone } from '@/lib/dates';
import { weatherConfig } from '@/lib/env';
import { listAudit } from '@/trust/audit';
import type { UserActor } from '@/trust/actor';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// Openings through the real services as `home_app` (M7 Package 3; contract
// §3.5, §5.6–§5.8, §8.2, §8.3, §8.6 O1–O3, O18, O19, O21, O23, P2, P3; ADR
// 0011 §28–§35). Two adults. Composed exactly as Today and Forward Week
// compose them: one agenda read as the signed-in adult, the conflict engine
// over it, the insights read (which adds openings from the same records and
// one read of the forecast cache), the reader's responses in one more query.
// The forecast is written straight into `weather_forecast` for the synthetic
// public point and a test-only key, as the scenario harness does; no
// provider is ever called. Synthetic only.
//
// Package 3 derived openings and accepted responses on them; Package 4 lists
// them (contract §2.1: `OPENINGS_LISTED` is true). These tests read the
// composition's output (every opening derived, in `all`, with its key), the
// reader's recorded responses (`responded`) and the listing, with Today's
// cap of one and Forward Week's of two, after every other family.

const { db, pool, close } = testDb();
const admin = adminDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
const at = (date: string, clock: string) => new Date(`${date}T${clock}:00+13:00`);
// Wednesday 14 October 2026, 07:03 at home.
const NOW = at('2026-10-14', '07:03');
const SAT = '2026-10-17';
const SUN = '2026-10-18';

let queries = 0;
const send = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof send>) => {
  queries++;
  return send(...args);
}) as typeof pool.query;

let h: Household;
const id = { sam: '', alex: '', milo: '', isla: '', nana: '', calendar: '', fence: '', garage: '' };
const key = { satTask: '', satPlain: '', sunPlain: '' };
const savedEnv = { ...process.env };
const setWeatherEnv = (vars: Record<string, string>) => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, vars);
};

const timed = (start: Date, end: Date) => ({
  allDay: false as const,
  startsAt: start.toISOString(),
  endsAt: end.toISOString(),
  timeZone: ZONE,
});

/** F0's values (contract §8.6): Saturday dry; Sunday one hour at 40% and 0.1 mm; gusts 30 km/h. */
const F0_VALUES = (s: Date): Partial<SyntheticValues> =>
  s.getTime() === at(SUN, '13:00').getTime()
    ? { precipitationProbability: 40, precipitationMm: 0.1 }
    : {};

/** The forecast row for the configured synthetic point, fetched at `fetchedAt` (F0's values). */
async function writeForecast(
  fetchedAt: Date,
  values: (s: Date) => Partial<SyntheticValues> = F0_VALUES,
) {
  const config = weatherConfig();
  if (config.status !== 'set') throw new Error('weather must be configured');
  const hours = syntheticHours(utcDayStart(fetchedAt), 191, values);
  await admin.db.execute(sql`delete from weather_forecast`);
  await admin.db.execute(sql`
    insert into weather_forecast (provider, fetched_at, hours, location_fingerprint, first_hour, last_hour, last_attempt_at, last_attempt_status)
    values ('open_meteo', ${fetchedAt.toISOString()}::timestamptz, ${JSON.stringify(hours.map(toStoredHour))}::jsonb,
            ${config.fingerprint}, ${hours[0]!.start.toISOString()}::timestamptz, ${hours.at(-1)!.start.toISOString()}::timestamptz,
            ${fetchedAt.toISOString()}::timestamptz, 'ok')`);
}

/** A calendar source with a given freshness, written as the owner (no address, nothing sealed). */
async function calendarRow(
  ownerUserId: string,
  visibility: 'household' | 'private',
  name: string,
  lastSyncedAt: Date,
  n: string,
): Promise<string> {
  const sealed = `hc1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`;
  const c = await admin.db.execute(sql`
    insert into calendar_connection (owner_user_id, provider, credentials_encrypted, credentials_key_id, address_fingerprint)
    values (${ownerUserId}, 'ics', ${sealed}, '0123456789abcdef', ${`fp1.${n.repeat(43)}`}) returning id`);
  const s = await admin.db.execute(sql`
    insert into calendar_source (created_by, created_via, visibility, connection_id, external_calendar_id, name, last_attempt_at, last_synced_at, last_sync_status)
    values (${ownerUserId}, 'ui', ${visibility}, ${c.rows[0]?.id as string}::uuid, 'primary', ${name},
            ${lastSyncedAt.toISOString()}::timestamptz, ${lastSyncedAt.toISOString()}::timestamptz, 'ok')
    returning id`);
  return s.rows[0]?.id as string;
}
/** The household calendar's last success: five minutes before `now`. */
const freshAt = async (now: Date) => {
  const t = new Date(now.getTime() - 5 * 60_000).toISOString();
  await admin.db.execute(
    sql`update calendar_source set last_synced_at = ${t}::timestamptz, last_attempt_at = ${t}::timestamptz where id = ${id.calendar}::uuid`,
  );
};
/** A scene: `now`, with the calendar fresh and the forecast fetched at `fetchedAt` (F0's values). */
const scene = async (now: Date, fetchedAt: Date) => {
  await freshAt(now);
  await writeForecast(fetchedAt);
};

type Read = Insights & { responded: ReadonlySet<string> };

/** Forward Week, as the page composes it: the 90-day agenda, conflicts, then the insights read. */
async function forward(actor: UserActor, now = NOW): Promise<Read> {
  const inputs = await readAgendaInputs(actor, deps);
  const today = isoDateInZone(now, ZONE);
  const coverage = { from: today, to: addDays(today, 89) };
  const days = agenda({
    ...coverage,
    timeZone: ZONE,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: inputs.tasks,
    projects: inputs.projects,
  });
  const found = conflictsOver(inputs, days, now, ZONE, coverage);
  return forwardInsights(actor, inputs, days, now, ZONE, 'week', 7, found, deps);
}

/**
 * Today, as the page composes it: eight days of agenda, conflicts, then the
 * insights read. `listed` overrides the families listed (for M6's baseline).
 */
async function today(
  actor: UserActor,
  now = NOW,
  listed?: ReadonlySet<InsightKind>,
): Promise<Read> {
  const inputs = await readAgendaInputs(actor, deps);
  const date = isoDateInZone(now, ZONE);
  const window = { from: date, to: addDays(date, 7) };
  const days = agenda({
    ...window,
    timeZone: ZONE,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: inputs.tasks,
    projects: inputs.projects,
  });
  const found = conflictsOver(inputs, days, now, ZONE, window);
  return insightsFor(
    actor,
    insightsInput(inputs, days, now, ZONE, new Set(), {
      conflicts: found,
      ...(listed ? { listed } : {}),
    }),
    deps,
  );
}

/**
 * M6's Forward Week (ADR 0009): the same 90-day read and conflicts, listing
 * only a calendar's health, two shown, no openings looked for.
 */
async function forwardM6(actor: UserActor, now = NOW): Promise<Read> {
  const inputs = await readAgendaInputs(actor, deps);
  const date = isoDateInZone(now, ZONE);
  const coverage = { from: date, to: addDays(date, 89) };
  const days = agenda({
    ...coverage,
    timeZone: ZONE,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: inputs.tasks,
    projects: inputs.projects,
  });
  const found = conflictsOver(inputs, days, now, ZONE, coverage);
  return insightsFor(
    actor,
    {
      ...insightsInput(inputs, days, now, ZONE, new Set(), { conflicts: found }),
      through: addDays(date, 6),
      listed: new Set<InsightKind>(['data_health']),
      shown: FORWARD_SHOWN,
    },
    deps,
  );
}
/** M6's Today listing: M5's four families, no openings. */
const M6_TODAY = new Set<InsightKind>(['data_health', 'conflict', 'preparation', 'busy_day']);

/** Every opening the composition derived (in `all`, listed or not), in rank order. */
const opens = (r: Insights): Insight[] => r.all.filter((i) => i.kind === 'open_window');
const openKeys = (r: Insights) => opens(r).map((i) => i.key);
/** The derived openings the reader has not responded to (what Package 4 would choose from). */
const unanswered = (r: Read) => openKeys(r).filter((k) => !r.responded.has(k));
/** Openings in the listing: shown or folded (the surface's cap already applied). */
const listedOpenings = (r: Insights) =>
  [...r.shown, ...r.rest].filter((i) => i.kind === 'open_window').map((i) => i.key);
/** What a reader is given about openings, byte for byte: every one, its facts and data, the listing and responses. */
const bytes = (r: Read) =>
  JSON.stringify({
    openings: opens(r),
    shown: r.shown.map((i) => i.key),
    rest: r.rest.map((i) => i.key),
    more: r.more,
    responded: [...r.responded].sort(),
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
const respond = (
  actor: UserActor,
  k: string,
  response: 'dismissed' | 'not_useful',
  surface: 'today' | 'forward' | 'person',
  now = NOW,
) => respondToInsight(actor, k, response, surface, now, ZONE, deps);

beforeAll(async () => {
  await clearDomainRows(db);
  await admin.db.execute(sql`delete from weather_forecast`);
  setWeatherEnv(weatherEnv(WELLINGTON));
  h = await ensureFixtureUsers(db);
  const person = async (name: string, role: 'parent' | 'child' | 'other', inHousehold = true) =>
    (await createPerson(h.sam, { name, role, inHousehold }, deps)).id;
  id.sam = await person('Sam OW', 'parent');
  id.alex = await person('Alex OW', 'parent');
  id.milo = await person('Milo OW', 'child');
  id.isla = await person('Isla OW', 'child');
  id.nana = await person('Nana Jo OW', 'other', false);
  id.calendar = await calendarRow(
    h.sam.userId,
    'household',
    'Family calendar OW',
    at('2026-10-14', '06:58'),
    '5',
  );
  await createEventWithPeople(
    h.sam,
    {
      title: 'Football',
      kind: 'activity',
      rrule: 'FREQ=WEEKLY;BYDAY=SA',
      time: timed(at(SAT, '09:00'), at(SAT, '10:00')),
    },
    [{ personId: id.isla, role: 'attending' }],
    deps,
  );
  const fence = await createProject(h.sam, { title: 'Back fence', status: 'active' }, deps);
  id.fence = (
    await createTask(
      h.sam,
      {
        title: 'Paint the back fence',
        estimateMinutes: 180,
        needs: ['dry_weather', 'daylight'],
        projectId: fence.id,
        assigneePersonId: id.sam,
      },
      deps,
    )
  ).id;
  id.garage = (
    await createTask(h.sam, { title: 'Sort the garage light', estimateMinutes: 30 }, deps)
  ).id;
  key.satTask = `open_window:household:${SAT}:1000-1930:task:${id.fence}`;
  key.satPlain = `open_window:household:${SAT}:1000-1930`;
  key.sunPlain = `open_window:household:${SUN}:0800-1930`;
});
beforeEach(async () => {
  await scene(NOW, at('2026-10-14', '06:55'));
});
afterAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await admin.db.execute(sql`delete from weather_forecast`);
  await clearDomainRows(db);
  await close();
  await admin.close();
});

describe('the fixture stands: both adults see O1–O3 through the real services', () => {
  it('O1–O3: Forward Week derives Saturday’s task opening and Sunday’s plain one, worded as the matrix writes them, and lists both', async () => {
    for (const actor of [h.sam, h.alex]) {
      const r = await forward(actor);
      expect(openKeys(r)).toEqual([key.satTask, key.sunPlain]);
      expect(unanswered(r)).toEqual([key.satTask, key.sunPlain]);
      expect(listedOpenings(r)).toEqual([key.satTask, key.sunPlain]);
      // Keys are stable: the same read again gives the same keys and text.
      expect(bytes(await forward(actor))).toBe(bytes(r));
      const [sat, sun] = opens(r);
      expect(sat!.text).toBe(
        'Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–19:30, and the forecast for Saturday as of 06:55 looks dry.',
      );
      expect(sun!.text).toBe(
        'Nothing is recorded for the household on Sunday, 08:00–19:30. The forecast for Sunday as of 06:55 has showers possible.',
      );
      // Today (Wednesday): no opening, today and tomorrow are weekdays.
      expect(opens(await today(actor))).toEqual([]);
    }
  });

  it('O18 and O20: Today on Saturday 07:30 derives Saturday’s first, then Sunday’s; on Friday 07:03, Saturday’s worded with “tomorrow”; one listed', async () => {
    await scene(at(SAT, '07:30'), at(SAT, '06:55'));
    const r = await today(h.alex, at(SAT, '07:30'));
    expect(openKeys(r)).toEqual([key.satTask, key.sunPlain]);
    expect(unanswered(r)).toEqual([key.satTask, key.sunPlain]);
    expect(listedOpenings(r)).toEqual([key.satTask]);
    expect(opens(r)[0]!.text).toBe(
      'Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household today, 10:00–19:30, and the forecast as of 06:55 looks dry then.',
    );
    await scene(at('2026-10-16', '07:03'), at('2026-10-16', '06:55'));
    const fri = await today(h.alex, at('2026-10-16', '07:03'));
    expect(openKeys(fri)).toEqual([key.satTask]);
    expect(listedOpenings(fri)).toEqual([key.satTask]);
    expect(opens(fri)[0]!.text).toContain(
      'Nothing is recorded for the household tomorrow, 10:00–19:30',
    );
  });
});

describe('Package 4 lists openings (contract §2.1, `OPENINGS_LISTED`): after every other family, within each surface’s cap', () => {
  it('Today lists at most one and Forward Week two, after M6’s listing; the cap is neither listed nor counted in “+ N more”', async () => {
    expect(OPENINGS_LISTED).toBe(true);
    const now = at(SAT, '07:30');
    await scene(now, at(SAT, '06:55'));
    // Four stale household calendars: four data_health insights, more than either surface shows.
    const stale: string[] = [];
    for (const n of ['8', '9', 'a', 'b'])
      stale.push(
        await calendarRow(h.sam.userId, 'household', `Stale OW ${n}`, at('2026-10-15', '06:00'), n),
      );
    try {
      for (const actor of [h.sam, h.alex]) {
        const t = await today(actor, now);
        const t6 = await today(actor, now, M6_TODAY);
        const f = await forward(actor, now);
        const f6 = await forwardM6(actor, now);
        expect(openKeys(t)).toEqual([key.satTask, key.sunPlain]);
        expect(openKeys(f)).toEqual([key.satTask, key.sunPlain]);
        // Today: one opening (the earliest), after every other family; Sunday's is past the cap.
        expect(listedOpenings(t)).toEqual([key.satTask]);
        expect(listedOpenings(f)).toEqual([key.satTask, key.sunPlain]);
        // Everything before the openings is exactly M6's order.
        const before = (r: Insights) =>
          [...r.shown, ...r.rest].filter((i) => i.kind !== 'open_window').map((i) => i.key);
        expect(before(t)).toEqual([...t6.shown, ...t6.rest].map((i) => i.key));
        expect(before(f)).toEqual([...f6.shown, ...f6.rest].map((i) => i.key));
        // The listed opening comes last; the count is M6's plus the listed ones only.
        expect([...t.shown, ...t.rest].at(-1)!.kind).toBe('open_window');
        expect(t.more).toBe(t6.more + 1);
        expect(f.more).toBe(f6.more + 2);
        expect(t.shown.every((i) => i.kind === 'data_health')).toBe(true);
      }
    } finally {
      await admin.db.execute(
        sql`delete from calendar_source where id = any(${`{${stale.join(',')}}`}::uuid[])`,
      );
    }
  });
});

describe('O23 and P2: Dismiss and Not useful on openings, per adult, audited with the kind only', () => {
  it('Dismiss from Today: accepted, audited with the kind only, marked responded on Today and Forward for Alex only; Sunday’s is then Today’s first unanswered (O19); Sam’s are byte-identical (P2)', async () => {
    const now = at(SAT, '07:30');
    await scene(now, at(SAT, '06:55'));
    const samBefore = {
      today: bytes(await today(h.sam, now)),
      forward: bytes(await forward(h.sam, now)),
    };
    const audits = await auditCount();
    expect(await respond(h.alex, key.satTask, 'dismissed', 'today', now)).toMatchObject({
      already: false,
    });
    expect(await auditCount()).toBe(audits + 1);
    const [row] = await rowsFor(h.alex.userId, key.satTask);
    expect(row!.response).toBe('dismissed');
    // Again: nothing written.
    expect(await respond(h.alex, key.satTask, 'dismissed', 'today', now)).toMatchObject({
      already: true,
    });
    expect(await auditCount()).toBe(audits + 1);
    // Responded on both surfaces for Alex (still derived, with its key); Sunday's is now
    // Today's first unanswered, worded with "tomorrow". Nothing is listed either way.
    const t = await today(h.alex, now);
    expect(openKeys(t)).toEqual([key.satTask, key.sunPlain]);
    expect(t.responded.has(key.satTask)).toBe(true);
    expect(unanswered(t)).toEqual([key.sunPlain]);
    expect(listedOpenings(t)).toEqual([key.sunPlain]);
    expect(opens(t).find((i) => i.key === key.sunPlain)!.text).toBe(
      'Nothing is recorded for the household tomorrow, 08:00–19:30. The forecast as of 06:55 has showers possible then.',
    );
    const f = await forward(h.alex, now);
    expect(f.responded.has(key.satTask)).toBe(true);
    expect(unanswered(f)).toEqual([key.sunPlain]);
    expect(listedOpenings(f)).toEqual([key.sunPlain]);
    // Sam: nothing changed, byte for byte (P2).
    expect(bytes(await today(h.sam, now))).toBe(samBefore.today);
    expect(bytes(await forward(h.sam, now))).toBe(samBefore.forward);
    expect(await rowsFor(h.sam.userId, key.satTask)).toHaveLength(0);
    // Audit: the response kind only; in Alex's Activity, not Sam's.
    const alexs = (await listAudit(h.alex, { limit: 200 }, deps)).rows.filter(
      (r) => r.event === 'insight_response.respond',
    );
    expect(alexs.some((r) => JSON.stringify(r.meta) === '{"response":"dismissed"}')).toBe(true);
    expect(JSON.stringify(alexs)).not.toMatch(/open_window|Paint|fence|Nothing is recorded/);
    const sams = (await listAudit(h.sam, { limit: 200 }, deps)).rows;
    expect(sams.some((r) => alexs.some((a) => a.id === r.id))).toBe(false);
  });

  it('Not useful from Forward: accepted, marked responded on Forward and Today for Alex only; Sam’s responses and openings unchanged (P2)', async () => {
    const samBefore = bytes(await forward(h.sam));
    const audits = await auditCount();
    expect(await respond(h.alex, key.sunPlain, 'not_useful', 'forward')).toMatchObject({
      response: 'not_useful',
      already: false,
    });
    expect(await auditCount()).toBe(audits + 1);
    const [row] = await rowsFor(h.alex.userId, key.sunPlain);
    expect(row!.response).toBe('not_useful');
    const f = await forward(h.alex);
    expect(openKeys(f)).toContain(key.sunPlain);
    expect(f.responded.has(key.sunPlain)).toBe(true);
    expect(unanswered(f)).not.toContain(key.sunPlain);
    expect(listedOpenings(f)).toEqual([]);
    // Today on Saturday: Sunday's (tomorrow) is responded there too, for Alex only.
    await scene(at(SAT, '07:30'), at(SAT, '06:55'));
    const alexSat = await today(h.alex, at(SAT, '07:30'));
    expect(alexSat.responded.has(key.sunPlain)).toBe(true);
    expect(unanswered(alexSat)).toEqual([]);
    const samSat = await today(h.sam, at(SAT, '07:30'));
    expect(samSat.responded.size).toBe(0);
    expect(unanswered(samSat)).toEqual([key.satTask, key.sunPlain]);
    expect(listedOpenings(alexSat)).toEqual([]);
    expect(listedOpenings(samSat)).toEqual([key.satTask]);
    await scene(NOW, at('2026-10-14', '06:55'));
    expect(bytes(await forward(h.sam))).toBe(samBefore);
    expect(await rowsFor(h.sam.userId, key.sunPlain)).toHaveLength(0);
    const alexs = (await listAudit(h.alex, { limit: 200 }, deps)).rows.filter(
      (r) => r.event === 'insight_response.respond',
    );
    expect(alexs.some((r) => JSON.stringify(r.meta) === '{"response":"not_useful"}')).toBe(true);
  });

  it('O7: the forecast is refreshed (new numbers, a new fetch time): still responded for Alex (so unlisted), not for Sam (still listed)', async () => {
    await writeForecast(at('2026-10-14', '07:00'), (s) =>
      s.getTime() === at(SUN, '15:00').getTime() ? { precipitationProbability: 70 } : {},
    );
    const alex = await forward(h.alex);
    const sam = await forward(h.sam);
    expect(openKeys(alex)).toContain(key.sunPlain);
    expect(alex.responded.has(key.sunPlain)).toBe(true);
    expect(unanswered(sam)).toContain(key.sunPlain);
    expect(sam.responded.has(key.sunPlain)).toBe(false);
    expect(listedOpenings(alex)).toEqual([]);
    expect(listedOpenings(sam)).toEqual([key.satTask, key.sunPlain]);
    expect(opens(sam).find((i) => i.key === key.sunPlain)!.text).toBe(
      'Nothing is recorded for the household on Sunday, 08:00–19:30. The forecast for Sunday as of 07:00 has rain likely.',
    );
  });

  it('refused as not eligible, with nothing written: from a person’s page; a crafted key with other times; Sunday’s from Today on Wednesday (not derivable there); a not-current opening (O21)', async () => {
    const audits = await auditCount();
    const crafted = `open_window:household:${SAT}:1000-1900`;
    for (const [k, surface, now] of [
      [key.satTask, 'person', NOW],
      [key.sunPlain, 'person', NOW],
      [crafted, 'forward', NOW],
      [`${crafted}:task:${id.fence}`, 'today', NOW],
      [`open_window:household:2026-10-16:0800-2000`, 'forward', NOW],
      [key.sunPlain, 'today', NOW],
    ] as const) {
      expect(await outcome(respond(h.sam, k, 'dismissed', surface, now)), `${k} ${surface}`).toBe(
        'not_eligible',
      );
      expect(await rowsFor(h.sam.userId, k)).toHaveLength(0);
    }
    // O21: Saturday 17:45, an hour and three quarters left: neither key is current.
    await scene(at(SAT, '17:45'), at(SAT, '06:55'));
    for (const k of [key.satTask, key.satPlain])
      for (const surface of ['today', 'forward'] as const) {
        expect(await outcome(respond(h.sam, k, 'dismissed', surface, at(SAT, '17:45')))).toBe(
          'not_eligible',
        );
        expect(await rowsFor(h.sam.userId, k)).toHaveLength(0);
      }
    expect(await auditCount()).toBe(audits);
  });

  it('the gate closed: refused before any query, nothing written', async () => {
    const saved = {
      VERCEL_ENV: process.env.VERCEL_ENV,
      HOME_REAL_DATA: process.env.HOME_REAL_DATA,
    };
    const audits = await auditCount();
    process.env.VERCEL_ENV = 'production';
    delete process.env.HOME_REAL_DATA;
    try {
      for (const response of ['dismissed', 'not_useful'] as const)
        for (const surface of ['today', 'forward'] as const) {
          const q = queries;
          expect(await outcome(respond(h.sam, key.satTask, response, surface))).toBe(
            'real_data_closed',
          );
          expect(queries).toBe(q);
        }
    } finally {
      for (const [k, v] of Object.entries(saved))
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    expect(await rowsFor(h.sam.userId, key.satTask)).toHaveLength(0);
    expect(await auditCount()).toBe(audits);
  });
});

describe('P3: the privacy invariant for openings (contract §3.5, §8.2)', () => {
  /** Sam's private waiting task, from the P3 scene (its records stay for what follows). */
  let samPrivateTask = '';
  it('Sam’s private event, all-day event, waiting task (with needs and an estimate) and stale calendar leave Alex’s openings, keys, order, facts and qualification byte-identical; Sam’s change', async () => {
    const before = { alex: await forward(h.alex), sam: await forward(h.sam) };
    // Not vacuous: Alex and Sam both have Saturday's and Sunday's openings.
    expect(opens(before.alex).map((i) => i.key)).toEqual([key.satTask, key.sunPlain]);
    expect(opens(before.sam).map((i) => i.key)).toEqual([key.satTask, key.sunPlain]);

    const privateEvent = await createEventWithPeople(
      h.sam,
      {
        title: 'Private Saturday',
        kind: 'appointment',
        visibility: 'private',
        time: timed(at(SAT, '12:00'), at(SAT, '13:00')),
      },
      [{ personId: id.sam, role: 'attending' }],
      deps,
    );
    const privateAllDay = await createEventWithPeople(
      h.sam,
      {
        title: 'Private Sunday',
        kind: 'other',
        visibility: 'private',
        time: { allDay: true, startDate: SUN, endDate: '2026-10-19' },
      },
      [{ personId: id.sam, role: 'attending' }],
      deps,
    );
    const privateTask = await createTask(
      h.sam,
      {
        title: 'Private outdoor job',
        visibility: 'private',
        estimateMinutes: 120,
        needs: ['dry_weather'],
        dueDate: '2026-10-16',
      },
      deps,
    );
    const staleCalendar = await calendarRow(
      h.sam.userId,
      'private',
      'Private OW',
      at('2026-10-13', '06:00'),
      '6',
    );

    const after = { alex: await forward(h.alex), sam: await forward(h.sam) };
    // Alex: identical, deep and byte for byte, with none of the private ids or titles.
    expect(opens(after.alex)).toEqual(opens(before.alex));
    expect(bytes(after.alex)).toBe(bytes(before.alex));
    for (const secret of [
      privateEvent.id,
      privateAllDay.id,
      privateTask.id,
      staleCalendar,
      'Private',
    ])
      expect(bytes(after.alex)).not.toContain(secret);
    // Today on Saturday too.
    await scene(at(SAT, '07:30'), at(SAT, '06:55'));
    const alexToday = bytes(await today(h.alex, at(SAT, '07:30')));
    expect(alexToday).not.toContain(privateTask.id);
    await scene(NOW, at('2026-10-14', '06:55'));

    // Sam: the same records change Sam's own. Saturday splits (10:00–12:00, 13:00–19:30) and
    // the private task (dated, so first) is named on the longer stretch, the fence listed;
    // Sunday has no opening; the stale private calendar qualifies every sentence.
    const sam = opens(after.sam);
    expect(sam.map((i) => i.key)).toEqual([
      `open_window:household:${SAT}:1300-1930:task:${privateTask.id}`,
    ]);
    samPrivateTask = privateTask.id;
    expect(sam[0]!.opening!.others.map((t) => t.id)).toEqual([id.fence]);
    expect(sam[0]!.text).toBe(
      'Private outdoor job is recorded as about two hours, in dry weather. Nothing is recorded for the household on Saturday, 13:00–19:30, as far as HOME knows, and the forecast for Saturday as of 06:55 looks dry.',
    );
    expect(sam[0]!.opening!.coverage.calendars.map((c) => c.id)).toContain(staleCalendar);
  });

  it('I-2: a foreign key, derivable only from Sam’s private task, is refused for Alex on Today and Forward Week, with nothing written; Sam’s own response to it is accepted', async () => {
    expect(samPrivateTask, 'the P3 scene runs first').not.toBe('');
    const samKey = `open_window:household:${SAT}:1300-1930:task:${samPrivateTask}`;
    const SAT_MORNING = at(SAT, '07:30');
    const anyRows = async () =>
      admin.db.select().from(insightResponse).where(eq(insightResponse.insightKey, samKey));
    const audits = await auditCount();
    // Forward Week on Wednesday, then Today on Saturday morning: the key is Sam's on both.
    expect(openKeys(await forward(h.sam))).toContain(samKey);
    expect(openKeys(await forward(h.alex))).not.toContain(samKey);
    for (const response of ['dismissed', 'not_useful'] as const)
      expect(await outcome(respond(h.alex, samKey, response, 'forward', NOW))).toBe('not_eligible');
    await scene(SAT_MORNING, at(SAT, '06:55'));
    expect(openKeys(await today(h.sam, SAT_MORNING))).toContain(samKey);
    expect(openKeys(await today(h.alex, SAT_MORNING))).not.toContain(samKey);
    for (const response of ['dismissed', 'not_useful'] as const)
      expect(await outcome(respond(h.alex, samKey, response, 'today', SAT_MORNING))).toBe(
        'not_eligible',
      );
    expect(await anyRows()).toHaveLength(0);
    expect(await auditCount()).toBe(audits);
    // The key is real: Sam's own responses to it are accepted, on both surfaces.
    try {
      expect(await outcome(respond(h.sam, samKey, 'not_useful', 'today', SAT_MORNING))).toBe('ok');
      await scene(NOW, at('2026-10-14', '06:55'));
      expect(await outcome(respond(h.sam, samKey, 'dismissed', 'forward', NOW))).toBe('ok');
      const rows = await anyRows();
      expect(rows.map((r) => [r.userId, r.response])).toEqual([[h.sam.userId, 'dismissed']]);
      expect(await auditCount()).toBe(audits + 2);
    } finally {
      await admin.db.delete(insightResponse).where(eq(insightResponse.insightKey, samKey));
    }
  });
});

describe('project eligibility through the real services (ADR 0011 §30, §45): only a project the reader sees as live', () => {
  /** Saturday's opening on Alex's Forward Week, and everything Alex is given about openings. */
  const saturday = async (actor: UserActor) => {
    const r = await forward(actor);
    return { sat: opens(r).find((i) => i.when === SAT)!, all: bytes(r) };
  };

  it('a visible active project matches; paused, it does not; archived (paused first), it still does not', async () => {
    const deck = await createProject(h.sam, { title: 'Deck OW', status: 'active' }, deps);
    const oil = await createTask(
      h.sam,
      {
        title: 'Oil the deck',
        estimateMinutes: 60,
        needs: ['dry_weather'],
        dueDate: '2026-10-20',
        projectId: deck.id,
      },
      deps,
    );
    try {
      // Visible and active: dated, so named first; the fence listed after it.
      let { sat } = await saturday(h.alex);
      expect(sat.key).toBe(`open_window:household:${SAT}:1000-1930:task:${oil.id}`);
      expect(sat.opening!.others.map((t) => t.id)).toEqual([id.fence]);
      // Paused: the fence is named; the deck's task is nowhere.
      await updateProject(h.sam, deck.id, { status: 'paused' }, deps);
      ({ sat } = await saturday(h.alex));
      expect(sat.key).toBe(key.satTask);
      expect(JSON.stringify(sat)).not.toContain(oil.id);
      // Archived: gone from Alex's projects, so the task is not matched (before the fix it
      // was named again, the archived project no longer being "seen as paused").
      await archiveProject(h.sam, deck.id, deps);
      expect((await listProjects(h.alex, {}, deps)).map((p) => p.id)).not.toContain(deck.id);
      const after = await saturday(h.alex);
      expect(after.sat.key).toBe(key.satTask);
      expect(after.sat.opening!.others).toEqual([]);
      expect(after.all).not.toContain(oil.id);
      expect(after.all).not.toContain(deck.id);
    } finally {
      await archiveTask(h.sam, oil.id, deps);
    }
  });

  it('Alex’s task in Sam’s household project: matched while visible and active; once Sam makes the project private and done, Alex’s opening no longer names it and carries nothing of the hidden project', async () => {
    const shed = await createProject(h.sam, { title: 'Shed OW', status: 'active' }, deps);
    const stain = await createTask(
      h.alex,
      {
        title: 'Stain the shed',
        visibility: 'private',
        estimateMinutes: 60,
        needs: ['dry_weather'],
        dueDate: '2026-10-19',
        projectId: shed.id,
      },
      deps,
    );
    try {
      let { sat } = await saturday(h.alex);
      expect(sat.key).toBe(`open_window:household:${SAT}:1000-1930:task:${stain.id}`);
      // Sam makes the project private and done: Alex can no longer see it at all.
      await updateProject(h.sam, shed.id, { visibility: 'private', status: 'done' }, deps);
      expect((await listProjects(h.alex, {}, deps)).map((p) => p.id)).not.toContain(shed.id);
      const after = await saturday(h.alex);
      sat = after.sat;
      expect(sat.key).toBe(key.satTask);
      expect(sat.opening!.others).toEqual([]);
      expect(sat.facts.some((f) => f.kind === 'project')).toBe(false);
      // Nothing of the hidden project, nor the unmatched task, in Alex's keys, facts or text.
      for (const secret of [shed.id, stain.id, 'Shed OW', 'Stain the shed'])
        expect(after.all).not.toContain(secret);
    } finally {
      await archiveTask(h.alex, stain.id, deps);
    }
  });
});

describe('the cost: one more query, constant in the number of records (contract §3.8, X2)', () => {
  const measure = async (f: () => Promise<unknown>) => {
    const q = queries;
    await f();
    return queries - q;
  };
  /** The location without its key (`set, key missing`): the same daylight and keys, no forecast read. */
  const unconfigured = async <T>(f: () => Promise<T>) => {
    setWeatherEnv({ HOME_LAT: WELLINGTON.lat, HOME_LON: WELLINGTON.lon });
    try {
      return await f();
    } finally {
      setWeatherEnv(weatherEnv(WELLINGTON));
    }
  };

  it('Today and Forward Week read one more query (the forecast row) than with weather unconfigured; respondToInsight one more; all constant after 20 more events, tasks and a second calendar', async () => {
    const sat = at(SAT, '07:30');
    await scene(sat, at(SAT, '06:55'));
    // Each measured response changes the last one, so each writes (and is counted) alike.
    const counts = async (response: 'dismissed' | 'not_useful') => ({
      forward: await measure(() => forward(h.alex, sat)),
      today: await measure(() => today(h.alex, sat)),
      respond: await measure(() => respond(h.alex, key.sunPlain, response, 'today', sat)),
    });
    const withWeather = await counts('dismissed');
    const without = await unconfigured(() => counts('not_useful'));
    expect(withWeather.forward).toBe(without.forward + 1);
    expect(withWeather.today).toBe(without.today + 1);
    expect(withWeather.respond).toBe(without.respond + 1);
    // Not vacuous: the read did find openings and the response was checked against them.
    expect(opens(await today(h.alex, sat)).length).toBeGreaterThan(0);

    for (let k = 0; k < 20; k++) {
      await createEventWithPeople(
        h.sam,
        {
          title: `Extra ${k}`,
          kind: 'other',
          time: timed(
            at(`2026-10-${19 + (k % 5)}`, '10:00'),
            at(`2026-10-${19 + (k % 5)}`, '11:00'),
          ),
        },
        [{ personId: id.milo, role: 'attending' }],
        deps,
      );
      await createTask(
        h.sam,
        // Waiting tasks with estimates but no recorded needs: read, never matched.
        { title: `Extra task ${k}`, estimateMinutes: 60 + k },
        deps,
      );
    }
    await calendarRow(
      h.sam.userId,
      'household',
      'Second OW',
      new Date(sat.getTime() - 60_000),
      '7',
    );
    const larger = await counts('dismissed');
    expect(larger).toEqual(withWeather);
    console.info(
      `Openings read (Today, Forward Week, respondToInsight): ${JSON.stringify(withWeather)} queries with weather, ${JSON.stringify(without)} without; ${JSON.stringify(larger)} after 20 more events, 20 tasks and a calendar`,
    );
  });
});
