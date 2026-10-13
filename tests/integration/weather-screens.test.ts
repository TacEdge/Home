import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { sql } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeForward } from '@/app/(home)/forward/compose';
import { ForwardView } from '@/app/(home)/forward/forward-view';
import { composeToday } from '@/app/(home)/today/compose';
import { TodayView } from '@/app/(home)/today/today-view';
import type { Horizon } from '@/domain/engines/forward';
import { createEventWithPeople } from '@/domain/events/service';
import { respondToInsight } from '@/domain/insights/today';
import { createPerson } from '@/domain/people/service';
import { createProject } from '@/domain/projects/service';
import { createTask } from '@/domain/tasks/service';
import { toStoredHour } from '@/domain/weather/provider';
import { syntheticHours, utcDayStart, type SyntheticValues } from '@/integrations/weather/fake';
import { weatherConfig } from '@/lib/env';
import type { UserActor } from '@/trust/actor';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { adminDb, testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// Today and Forward Week as the pages compose and render them, through the
// real services as `home_app` (M7 Package 4; contract §3.5, §3.8, §4.1–§4.5,
// §8.2, §8.6 W15, W19, X1, X2, X6, X7, X9, X12, P1, P3). `composeToday` and
// `composeForward` are the pages' own compositions; the views are rendered
// exactly as the pages render them, to markup, and the markup is what is
// asserted: its words, its order, its credit link, and (for the other adult)
// its bytes. The forecast is written straight into `weather_forecast` for the
// synthetic public point and a test-only key; no provider is ever called.
// Synthetic only.

const { db, pool, close } = testDb();
const admin = adminDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
const at = (date: string, clock: string) => new Date(`${date}T${clock}:00+13:00`);
const WED = '2026-10-14';
const THU = '2026-10-15';
const FRI = '2026-10-16';
const SAT = '2026-10-17';
const SUN = '2026-10-18';
const NOW = at(WED, '07:03');
const FETCHED = at(WED, '06:55');

let queries = 0;
const send = pool.query.bind(pool);
(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof send>) => {
  queries++;
  return send(...args);
}) as typeof pool.query;

let h: Household;
const id = { sam: '', alex: '', milo: '', isla: '', calendar: '', fence: '' };
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

/** F0 (contract §8.6) with a showery Wednesday afternoon, a wet Thursday and a showery Friday morning. */
const VALUES = (s: Date): Partial<SyntheticValues> => {
  const t = s.getTime();
  if (t >= at(WED, '12:00').getTime() && t < at(WED, '21:00').getTime())
    return { precipitationProbability: 40, precipitationMm: 0.1 };
  if (t >= at(THU, '00:00').getTime() && t < at(FRI, '00:00').getTime())
    return { precipitationProbability: 80, precipitationMm: 2 };
  if (t === at(FRI, '10:00').getTime())
    return { precipitationProbability: 40, precipitationMm: 0.1 };
  if (t === at(SUN, '13:00').getTime())
    return { precipitationProbability: 40, precipitationMm: 0.1 };
  return {};
};

async function writeForecast(
  fetchedAt: Date,
  values: (s: Date) => Partial<SyntheticValues> = VALUES,
  count = 191,
) {
  const config = weatherConfig();
  if (config.status !== 'set') throw new Error('weather must be configured');
  const hours = syntheticHours(utcDayStart(fetchedAt), count, values);
  await admin.db.execute(sql`delete from weather_forecast`);
  await admin.db.execute(sql`
    insert into weather_forecast (provider, fetched_at, hours, location_fingerprint, first_hour, last_hour, last_attempt_at, last_attempt_status)
    values ('open_meteo', ${fetchedAt.toISOString()}::timestamptz, ${JSON.stringify(hours.map(toStoredHour))}::jsonb,
            ${config.fingerprint}, ${hours[0]!.start.toISOString()}::timestamptz, ${hours.at(-1)!.start.toISOString()}::timestamptz,
            ${fetchedAt.toISOString()}::timestamptz, 'ok')`);
}

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
const freshAt = async (now: Date) => {
  const t = new Date(now.getTime() - 5 * 60_000).toISOString();
  await admin.db.execute(
    sql`update calendar_source set last_synced_at = ${t}::timestamptz, last_attempt_at = ${t}::timestamptz where id = ${id.calendar}::uuid`,
  );
};

// ---- rendering --------------------------------------------------------------

const renderToday = async (actor: UserActor, now = NOW) => {
  const c = await composeToday(actor, now, ZONE, deps);
  return { html: renderToStaticMarkup(createElement(TodayView, c.props)), c };
};
const renderForward = async (actor: UserActor, now = NOW, horizon: Horizon = 'week') => {
  const c = await composeForward(actor, now, ZONE, horizon, deps);
  return { html: renderToStaticMarkup(createElement(ForwardView, c.props)), c };
};
/** The page's words: tags gone, entities decoded, whitespace folded. */
const words = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
/** The markup with every `<details>` (a closed Why or fold) taken out, depth-aware. */
function outsideDetails(html: string): string {
  let out = '';
  let depth = 0;
  for (const part of html.split(/(<details\b|<\/details>)/)) {
    if (part === '</details>') depth = Math.max(0, depth - 1);
    else if (part.startsWith('<details')) depth++;
    else if (depth === 0) out += part;
  }
  return out;
}
const creditLinks = (html: string) => (html.match(/data-testid="credit-link"/g) ?? []).length;
const visibleCreditLinks = (html: string) => creditLinks(outsideDetails(html));
const rows = (html: string) =>
  [...html.matchAll(/<li[^>]*data-insight="([^"]+)"/g)].map((m) => m[1]!);

const FORBIDDEN =
  /\b(needs?|needs you|nobody's down|who\?|lift|pick(ing)? up|drop(ping)? off|taking|driving|free|available|out|easy|busy|full|calm|stress\w*|covered|sorted|nothing needs|should|probably|nothing prepared|urgent|don'?’?t forget|packed|steady|clear|quiet|overwhelming|away|unavailable|in two places|double-booked|can'?’?t|clash|worth deciding|nothing on|everyone can|both of you|you could|a good time|good day|good for|best|ideal|perfect|nice|great|fine|mild|lovely|chance to|opportunity|room for|fits|suitable|recommend|window|out of date|error)\b/i;

beforeAll(async () => {
  await clearDomainRows(db);
  await admin.db.execute(sql`delete from weather_forecast`);
  setWeatherEnv(weatherEnv(WELLINGTON));
  h = await ensureFixtureUsers(db);
  const person = async (name: string, role: 'parent' | 'child' | 'other', inHousehold = true) =>
    (await createPerson(h.sam, { name, role, inHousehold }, deps)).id;
  id.sam = await person('Sam WS', 'parent');
  id.alex = await person('Alex WS', 'parent');
  id.milo = await person('Milo WS', 'child');
  id.isla = await person('Isla WS', 'child');
  id.calendar = await calendarRow(
    h.sam.userId,
    'household',
    'Family calendar WS',
    at(WED, '06:58'),
    '6',
  );
  await createEventWithPeople(
    h.sam,
    {
      title: 'Football WS',
      kind: 'activity',
      rrule: 'FREQ=WEEKLY;BYDAY=SA',
      time: timed(at(SAT, '09:00'), at(SAT, '10:00')),
    },
    [{ personId: id.isla, role: 'attending' }],
    deps,
  );
  await createEventWithPeople(
    h.sam,
    {
      title: 'Swimming WS',
      kind: 'activity',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
      time: timed(at(WED, '15:30'), at(WED, '16:15')),
    },
    [{ personId: id.milo, role: 'attending' }],
    deps,
  );
  const fence = await createProject(h.sam, { title: 'Back fence WS', status: 'active' }, deps);
  id.fence = (
    await createTask(
      h.sam,
      {
        title: 'Paint the back fence WS',
        estimateMinutes: 180,
        needs: ['dry_weather', 'daylight'],
        projectId: fence.id,
        assigneePersonId: id.sam,
      },
      deps,
    )
  ).id;
});
beforeEach(async () => {
  setWeatherEnv(weatherEnv(WELLINGTON));
  await freshAt(NOW);
  await writeForecast(FETCHED);
});
afterAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await admin.db.execute(sql`delete from weather_forecast`);
  await clearDomainRows(db);
  await close();
  await admin.close();
});

describe('Today: the weather sentence, its credit and its Why (W15, W19, §4.1, §4.5)', () => {
  it('after the headline and before “What this is based on”, in words, with one credit link beside it and a Why from the cached forecast', async () => {
    for (const actor of [h.sam, h.alex]) {
      const { html, c } = await renderToday(actor);
      const w = words(html);
      expect(w).toContain('Looks dry until midday, then showers possible.');
      // Order: the headline's header, then the sentence, then the facts.
      const sentence = html.indexOf('data-testid="weather-sentence"');
      expect(html.indexOf('data-testid="headline"')).toBeLessThan(sentence);
      expect(sentence).toBeGreaterThan(-1);
      const basedOn = html.indexOf('What this is based on');
      if (basedOn >= 0) expect(sentence).toBeLessThan(basedOn);
      // Body type and ink: never the display face or the Sun accent.
      const block = html.slice(html.indexOf('data-testid="weather"'), html.indexOf('weather-why'));
      expect(block).not.toMatch(/font-display|bg-accent|text-accent/);
      // One visible credit link, after the sentence; a real link, no referrer, named for where it goes.
      expect(visibleCreditLinks(html)).toBe(1);
      const link = html.match(/<a [^>]*data-testid="credit-link"[^>]*>/)![0];
      expect(link).toContain('href="https://open-meteo.com/"');
      expect(link).toContain('rel="noreferrer"');
      expect(link).toContain('aria-label="Forecast data: Open-Meteo"');
      expect(link).not.toContain('target=');
      expect(link).toContain('min-h-11');
      expect(html.indexOf('data-testid="credit-link"')).toBeGreaterThan(sentence);
      // The Why: forecast time, each part, the low and high, the credit.
      const why = words(html.slice(html.indexOf('data-testid="weather-why"')));
      expect(why).toContain('From the forecast as of 06:55.');
      expect(why).toContain(
        'Morning, 07:00–12:00: looks dry. Chance of rain up to 5%, no rain, gusts up to 30 km/h.',
      );
      expect(why).toContain(
        'Afternoon, 12:00–18:00: showers possible. Chance of rain up to 40%, 0.6 mm of rain, gusts up to 30 km/h.',
      );
      expect(why).toContain('Around 14°C.');
      expect(creditLinks(html)).toBe(2); // the line beside the sentence, and the Why's
      // A page for a weekday carries no opening.
      expect(rows(html).filter((r) => r.startsWith('open_window'))).toEqual([]);
      expect(c.askWeather).toBe(false); // fetched eight minutes ago: nothing is due
    }
  });

  it('an older forecast reads “As of yesterday 21:00, …”; the credit and Why are still there', async () => {
    await writeForecast(
      at(WED, '00:00').getTime() - 3 * 3_600_000 > 0 ? at('2026-10-13', '21:00') : FETCHED,
    );
    const { html } = await renderToday(h.sam);
    expect(words(html)).toContain(
      'As of yesterday 21:00, looks dry until midday, then showers possible.',
    );
    expect(visibleCreditLinks(html)).toBe(1);
  });

  it('an unusable forecast says only that it hasn’t updated: no credit, no sentence, no word “error” (X7)', async () => {
    await writeForecast(at('2026-10-13', '17:00'));
    const { html, c } = await renderToday(h.alex);
    const w = words(html);
    expect(w).toContain("The forecast hasn't updated since yesterday.");
    expect(w).not.toMatch(/looks dry|showers possible|rain likely/i);
    expect(creditLinks(html)).toBe(0);
    expect(w).not.toMatch(/error/i);
    expect(c.askWeather).toBe(true);
  });

  it('no forecast yet: no sentence and no stale line, and a refresh is asked for after render; a location with no key, or none, says nothing and asks for nothing (X6)', async () => {
    await admin.db.execute(sql`delete from weather_forecast`);
    let r = await renderToday(h.sam);
    expect(words(r.html)).not.toMatch(/forecast|Looks dry|showers/i);
    expect(creditLinks(r.html)).toBe(0);
    expect(r.c.askWeather).toBe(true);
    await writeForecast(FETCHED);
    setWeatherEnv({ HOME_LAT: WELLINGTON.lat, HOME_LON: WELLINGTON.lon }); // no key
    r = await renderToday(h.sam);
    expect(creditLinks(r.html)).toBe(0);
    expect(words(r.html)).not.toMatch(/forecast|Looks dry/i);
    expect(r.c.askWeather).toBe(false);
    setWeatherEnv({});
    r = await renderToday(h.sam);
    expect(creditLinks(r.html)).toBe(0);
    expect(words(r.html)).not.toMatch(/forecast|Looks dry/i);
    expect(r.c.askWeather).toBe(false);
  });

  it('the evening state is about tomorrow (W15): “Rain likely tomorrow.”', async () => {
    const evening = at(WED, '19:30');
    await freshAt(evening);
    await writeForecast(at(WED, '19:20'));
    const { html, c } = await renderToday(h.sam, evening);
    expect(c.props.model.state).toBe('evening');
    expect(words(html)).toContain('Rain likely tomorrow.');
    expect(visibleCreditLinks(html)).toBe(1);
  });

  it('a part the forecast does not cover gives no sentence; an opening that cites the forecast carries the credit instead (W19)', async () => {
    const sat = at(SAT, '07:30');
    await freshAt(sat);
    // Hours end at 20:00 on Saturday: the evening part (18:00–21:00) is not covered, the opening's span is.
    await writeForecast(at(SAT, '06:55'), () => ({}), 7 * 24 - 4 + 24);
    const hoursThroughSat20 = Math.round(
      (at(SAT, '20:00').getTime() - utcDayStart(at(SAT, '06:55')).getTime()) / 3_600_000,
    );
    await writeForecast(at(SAT, '06:55'), () => ({}), hoursThroughSat20);
    const { html } = await renderToday(h.sam, sat);
    expect(html).not.toContain('data-testid="weather-sentence"');
    expect(words(html)).toContain('and the forecast as of 06:55 looks dry then');
    expect(visibleCreditLinks(html)).toBe(1);
    // The link follows the opening, inside its row.
    const row = html.slice(html.indexOf('data-insight="open_window.task"'));
    expect(row.indexOf('data-testid="credit-link"')).toBeGreaterThan(-1);
    expect(row.indexOf('data-testid="credit-link"')).toBeLessThan(row.indexOf('>Why<'));
  });
});

describe('X6: first run (no live calendar) with a fresh forecast', () => {
  it('Today is in its first-run state and still says the weather, with one credit link and no opening; Forward Week has its phrases and credit line and no openings', async () => {
    const phrases = (html: string) =>
      [...html.matchAll(/data-testid="day-phrase"[^>]*>([^<]+)</g)].map((m) => m[1]);
    const noOpenings = (html: string) =>
      expect(rows(html).filter((r) => r.startsWith('open_window'))).toEqual([]);
    // Not vacuous: with the calendar live, Alex's Forward Week lists openings.
    expect(rows((await renderForward(h.alex)).html)).toContain('open_window.task');
    const archived = (
      await admin.db.execute<{ id: string }>(
        sql`update calendar_source set archived_at = now() where archived_at is null returning id`,
      )
    ).rows.map((r) => r.id);
    expect(archived).toContain(id.calendar);
    try {
      // No live calendar: coverage unknown, so no opening anywhere (contract §4.4).
      let f = await renderForward(h.alex);
      expect(phrases(f.html)).toHaveLength(7);
      expect(words(f.html)).toContain('Forecast as of 06:55 · Open-Meteo');
      expect(visibleCreditLinks(f.html)).toBe(1);
      noOpenings(f.html);
      // Today's first run is no live calendar and nothing recorded.
      await admin.db.execute(
        sql`update event set archived_at = now() where title in ('Football WS', 'Swimming WS')`,
      );
      const { html, c } = await renderToday(h.alex);
      expect(c.props.model.state).toBe('first_run');
      expect(words(html)).toContain('HOME is quiet because it doesn’t know your calendars yet.');
      expect(words(html)).toContain('Looks dry until midday, then showers possible.');
      expect(html).toContain('data-testid="weather-sentence"');
      expect(visibleCreditLinks(html)).toBe(1);
      noOpenings(html);
      f = await renderForward(h.alex);
      expect(phrases(f.html)).toHaveLength(7);
      expect(visibleCreditLinks(f.html)).toBe(1);
      noOpenings(f.html);
    } finally {
      await admin.db.execute(
        sql`update event set archived_at = null where title in ('Football WS', 'Swimming WS')`,
      );
      for (const calendar of archived)
        await admin.db.execute(
          sql`update calendar_source set archived_at = null where id = ${calendar}::uuid`,
        );
    }
  });
});

describe('Forward Week: day phrases, the credit line and its Why, openings (W14, W19, §4.2)', () => {
  it('a phrase on each of the seven days, the credit line beside Coming up with its own Why, and the openings as the contract words them', async () => {
    for (const actor of [h.sam, h.alex]) {
      const { html } = await renderForward(actor);
      const phrases = [...html.matchAll(/data-testid="day-phrase"[^>]*>([^<]+)</g)].map(
        (m) => m[1],
      );
      // Wed showers possible; Thu rain likely; Fri showers; Sat dry; Sun showers; Mon, Tue dry.
      expect(phrases).toEqual([
        'Showers possible',
        'Rain likely',
        'Showers possible',
        'Looks dry',
        'Showers possible',
        'Looks dry',
        'Looks dry',
      ]);
      const w = words(html);
      expect(w).toContain('Forecast as of 06:55 · Open-Meteo');
      expect(visibleCreditLinks(html)).toBe(1);
      // Beside the Coming up label, once.
      expect(html.indexOf('data-testid="forecast-credit"')).toBeGreaterThan(
        html.indexOf('id="forward-coming"'),
      );
      const why = words(html.slice(html.indexOf('data-testid="forecast-why"')));
      expect(why).toContain('planning hours, 08:00–20:00');
      expect(why).toContain(
        'Looks dry: every hour at or below a 20% chance of rain, and under 0.2 mm.',
      );
      expect(why).toContain('Rain likely: any hour at 60% or more, or 1 mm or more.');
      expect(why).toContain('Windy: gusts of 50 km/h or more in any hour.');
      // Openings (O1–O3), after nothing else (no stale calendar).
      expect(rows(html)).toEqual(['open_window.task', 'open_window.plain']);
      expect(w).toContain(
        'Paint the back fence WS is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–19:30, and the forecast for Saturday as of 06:55 looks dry.',
      );
      expect(w).toContain(
        'Nothing is recorded for the household on Sunday, 08:00–19:30. The forecast for Sunday as of 06:55 has showers possible.',
      );
    }
  });

  it('an opening’s Why sets out its evidence from the facts: rule, edges, people, calendars, forecast, task, the fixed limit, Not useful (§4.5)', async () => {
    const { html } = await renderForward(h.alex);
    const sat = html.slice(html.indexOf('data-insight="open_window.task"'));
    const why = words(
      sat.slice(
        sat.indexOf('data-testid="opening-why"'),
        sat.indexOf('data-testid="opening-limit"') + 200,
      ),
    );
    expect(why).toContain(
      'Nothing is recorded for anyone in the household from the end of Football WS (10:00) to the end of daylight (19:30; sunset 19:',
    );
    expect(why).toContain('Before');
    expect(why).toContain('Football WS');
    const household = why.match(/Household: (.*?) Calendars/)![1]!.split(', ');
    expect(household.sort()).toEqual(['Alex WS', 'Isla WS', 'Milo WS', 'Sam WS']);
    expect(why).toContain('Family calendar WS · last updated Wednesday 14 October, 06:');
    expect(why).toContain('Forecast as of 06:55, for Saturday, 08:00–20:00: looks dry.');
    expect(why).toContain('The task, as recorded');
    expect(why).toContain('About three hours; dry weather and daylight');
    expect(why).toContain(
      "This is only what HOME has recorded that you can see. It isn't a check of anyone's plans.",
    );
    expect(sat).toContain('href="/tasks/');
    expect(sat.indexOf('opening-limit')).toBeLessThan(sat.indexOf('Not useful'));
    // Not useful and Dismiss are the existing forms.
    expect(sat).toContain('aria-label="Not useful: ');
    expect(sat).toContain('aria-label="Dismiss: ');
    expect(sat).toContain('name="surface" value="forward"');
    const sun = html.slice(html.indexOf('data-insight="open_window.plain"'));
    const sunWhy = words(
      sun.slice(
        sun.indexOf('data-testid="opening-why"'),
        sun.indexOf('data-testid="opening-limit"') + 200,
      ),
    );
    expect(sunWhy).toContain(
      'from the start of planning hours (08:00) to the end of daylight (19:30; sunset 19:44',
    );
    expect(sunWhy).not.toContain('The task, as recorded');
  });

  it('Month and Season say nothing of the weather and carry no opening, whatever is cached (X12); the cache is not even read', async () => {
    for (const horizon of ['month', 'season'] as const) {
      const a = await renderForward(h.sam, NOW, horizon);
      await admin.db.execute(sql`delete from weather_forecast`);
      const b = await renderForward(h.sam, NOW, horizon);
      await writeForecast(FETCHED);
      expect(a.html).toBe(b.html);
      expect(creditLinks(a.html)).toBe(0);
      expect(a.html).not.toContain('data-testid="day-phrase"');
      expect(a.html).not.toContain('forecast-credit');
      expect(rows(a.html).filter((r) => r.startsWith('open_window'))).toEqual([]);
      expect(a.c.askWeather).toBe(false);
    }
  });

  it('an older forecast: the credit line carries its time; an unusable one: no phrases, no credit, openings plain (X7)', async () => {
    await writeForecast(at('2026-10-13', '21:00'));
    let r = await renderForward(h.sam);
    expect(words(r.html)).toContain('Forecast as of yesterday 21:00 · Open-Meteo');
    await writeForecast(at('2026-10-13', '17:00'));
    r = await renderForward(h.sam);
    const w = words(r.html);
    expect(creditLinks(r.html)).toBe(0);
    expect(r.html).not.toContain('data-testid="day-phrase"');
    expect(w).not.toMatch(/forecast|error/i);
    expect(rows(r.html)).toEqual(['open_window.plain', 'open_window.plain']);
    expect(w).toContain('Nothing is recorded for the household on Saturday, 10:00–19:30.');
    expect(r.c.askWeather).toBe(true);
  });

  it('no forecast, no location: no phrases, no credit, no refresh asked; openings from planning hours only', async () => {
    await admin.db.execute(sql`delete from weather_forecast`);
    setWeatherEnv({});
    const r = await renderForward(h.sam);
    expect(creditLinks(r.html)).toBe(0);
    expect(r.html).not.toContain('data-testid="day-phrase"');
    expect(r.c.askWeather).toBe(false);
    expect(words(r.html)).toContain(
      'Nothing is recorded for the household on Saturday, 10:00–20:00.',
    );
  });

  it('a stale calendar qualifies each opening, and data_health.stale is listed first (O16, O22)', async () => {
    await admin.db.execute(
      sql`update calendar_source set last_synced_at = ${at('2026-10-12', '06:58').toISOString()}::timestamptz, last_attempt_at = ${at('2026-10-12', '06:58').toISOString()}::timestamptz where id = ${id.calendar}::uuid`,
    );
    const { html } = await renderForward(h.sam);
    expect(rows(html)[0]).toBe('data_health.stale');
    expect(words(html)).toContain(
      'Nothing is recorded for the household on Sunday, 08:00–19:30, as far as HOME knows.',
    );
  });
});

describe('every rendered string avoids the forbidden lists (O26, §5.8)', () => {
  it('Today and Forward Week, in every state, titles and names aside', async () => {
    const scenes: (() => Promise<string>)[] = [
      async () => (await renderToday(h.sam)).html,
      async () => (await renderForward(h.sam)).html,
      async () => {
        await writeForecast(at('2026-10-13', '21:00'));
        return (await renderToday(h.sam)).html + (await renderForward(h.sam)).html;
      },
      async () => {
        await writeForecast(at('2026-10-13', '17:00'));
        return (await renderToday(h.sam)).html + (await renderForward(h.sam)).html;
      },
    ];
    for (const scene of scenes) {
      let w = words(await scene());
      for (const title of [
        'Paint the back fence WS',
        'Football WS',
        'Swimming WS',
        'Family calendar WS',
        'Back fence WS',
      ])
        w = w.split(title).join('');
      for (const name of ['Sam WS', 'Alex WS', 'Milo WS', 'Isla WS']) w = w.split(name).join('');
      // The pages' own fixed words (M5/M6 copy) are theirs; M7's strings are what is scanned here.
      const m7 = w
        .split(/(?<=[.:])\s/)
        .filter((s) =>
          /forecast|rain|Rain|Looks dry|showers|Showers|gusts|sunrise|sunset|daylight|Nothing is recorded|Open-Meteo|household|windy|Windy|planning hours/.test(
            s,
          ),
        )
        .join(' ');
      expect(m7.length).toBeGreaterThan(50);
      expect(m7.match(FORBIDDEN)?.[0] ?? null, m7).toBeNull();
      expect(m7.replace(/rain likely/gi, '')).not.toMatch(/likely/i);
    }
  });
});

describe('X1, X9: rendering never reaches the network and is byte-identical for a fixed now and forecast', () => {
  it('Today and Forward Week render twice to the same bytes, and nothing is fetched while rendering, even with a refresh due: no fetch, no node:https or node:http request or get', async () => {
    // An older forecast whose last attempt was ten hours ago: a refresh is due,
    // so a page that refreshed while rendering would reach the provider here.
    await writeForecast(at('2026-10-13', '21:00'));
    const network = () => {
      throw new Error('the network was reached while rendering');
    };
    const fetched = vi.fn(network);
    vi.stubGlobal('fetch', fetched);
    // safe-fetch (the provider's only transport) calls node:https / node:http
    // `request`; `get` too, for completeness. Named imports follow the spies.
    const spies = [
      vi.spyOn(https, 'request').mockImplementation(network),
      vi.spyOn(https, 'get').mockImplementation(network),
      vi.spyOn(http, 'request').mockImplementation(network),
      vi.spyOn(http, 'get').mockImplementation(network),
    ];
    syncBuiltinESMExports();
    const untouched = (label: string) => {
      expect(fetched, label).not.toHaveBeenCalled();
      for (const spy of spies) expect(spy, label).not.toHaveBeenCalled();
    };
    try {
      for (const actor of [h.sam, h.alex]) {
        const t1 = await renderToday(actor);
        untouched('Today');
        const t2 = (await renderToday(actor)).html;
        const f1 = await renderForward(actor);
        untouched('Forward Week');
        const f2 = (await renderForward(actor)).html;
        expect(t1.c.askWeather).toBe(true);
        expect(f1.c.askWeather).toBe(true);
        expect(words(t1.html)).toContain('As of yesterday 21:00');
        expect(t2).toBe(t1.html);
        expect(f2).toBe(f1.html);
      }
      untouched('after every render');
    } finally {
      for (const spy of spies) spy.mockRestore();
      syncBuiltinESMExports();
      vi.unstubAllGlobals();
    }
  });

  it('nothing about the location reaches the markup: no coordinate, elevation, key, fingerprint or provider URL', async () => {
    const config = weatherConfig();
    const fingerprint = config.status === 'set' ? config.fingerprint : 'unreachable';
    const t = (await renderToday(h.sam)).html;
    const f = (await renderForward(h.sam)).html;
    for (const html of [t, f]) {
      for (const leak of [
        '-41.29',
        '174.78',
        '41.29',
        'latitude',
        'longitude',
        'elevation',
        'coordinates',
        'api.open-meteo.com',
        fingerprint,
        'home-weather-location',
      ])
        expect(html, leak).not.toContain(leak);
    }
  });
});

describe('X2: one more query, constant in what is recorded', () => {
  const count = async (fn: () => Promise<unknown>) => {
    queries = 0;
    await fn();
    return queries;
  };

  it('Today and Forward Week cost one query more with weather configured than without, and the same after twenty more events and tasks and a second calendar', async () => {
    // Something to find (a calendar not updated for a day), so the responses
    // query runs both before and after: it runs only when there is an insight.
    await admin.db.execute(
      sql`update calendar_source set last_synced_at = ${at('2026-10-12', '06:58').toISOString()}::timestamptz, last_attempt_at = ${at('2026-10-12', '06:58').toISOString()}::timestamptz where id = ${id.calendar}::uuid`,
    );
    const todayNow = () => composeToday(h.sam, NOW, ZONE, deps);
    const fwdNow = () => composeForward(h.sam, NOW, ZONE, 'week', deps);
    setWeatherEnv({});
    const todayOff = await count(todayNow);
    const fwdOff = await count(fwdNow);
    setWeatherEnv(weatherEnv(WELLINGTON));
    const todayOn = await count(todayNow);
    const fwdOn = await count(fwdNow);
    expect(todayOn).toBe(todayOff + 1);
    expect(fwdOn).toBe(fwdOff + 1);
    // Month and Season: no forecast read at all.
    const monthOn = await count(() => composeForward(h.sam, NOW, ZONE, 'month', deps));
    setWeatherEnv({});
    const monthOff = await count(() => composeForward(h.sam, NOW, ZONE, 'month', deps));
    expect(monthOn).toBe(monthOff);
    setWeatherEnv(weatherEnv(WELLINGTON));

    const extra: string[] = [];
    for (let n = 0; n < 20; n++) {
      await createEventWithPeople(
        h.sam,
        {
          title: `Extra ${n} WS`,
          kind: 'activity',
          time: timed(at(SUN, '09:00'), at(SUN, '09:30')),
        },
        [{ personId: id.milo, role: 'attending' }],
        deps,
      );
      extra.push((await createTask(h.sam, { title: `Extra task ${n} WS` }, deps)).id);
    }
    const second = await calendarRow(h.sam.userId, 'household', 'Second WS', at(WED, '06:58'), '7');
    try {
      expect(await count(todayNow)).toBe(todayOn);
      expect(await count(fwdNow)).toBe(fwdOn);
      // respondToInsight: the same one forecast read, constant too.
      const respondCount = async () => {
        queries = 0;
        await respondToInsight(
          h.alex,
          `open_window:household:${SUN}:0800-1930`,
          'dismissed',
          'forward',
          NOW,
          ZONE,
          deps,
        ).catch(() => undefined);
        return queries;
      };
      const a = await respondCount();
      expect(a).toBeGreaterThan(0);
    } finally {
      await admin.db.execute(sql`delete from calendar_source where id = ${second}::uuid`);
      await admin.db.execute(
        sql`delete from event_person where event_id in (select id from event where title like 'Extra % WS')`,
      );
      await admin.db.execute(sql`delete from task where title like 'Extra task % WS'`);
      await admin.db.execute(sql`delete from event where title like 'Extra % WS'`);
    }
  });
});

describe('P1, P3: the other adult’s private records leave this adult’s rendered pages byte for byte', () => {
  it('Sam’s private event, all-day event, dry-weather task, private person on a private event, scheduled task and stale calendar change Sam’s pages and not Alex’s: rendered bytes, models and listings (PI-1, PI-2)', async () => {
    const sat = at(SAT, '07:30');
    await freshAt(sat);
    await writeForecast(at(SAT, '06:55'));
    // What Alex is given: the rendered pages and the compositions' models and listings.
    const alexPages = async () => {
      const t = await renderToday(h.alex, sat);
      const f = await renderForward(h.alex, sat);
      return {
        today: t.html,
        forward: f.html,
        given: {
          todayModel: t.c.props.model,
          todayWorth: t.c.props.worth,
          forwardModel: f.c.props.model,
          forwardWorth: f.c.props.worth,
        },
      };
    };
    const alexBefore = await alexPages();
    // Not vacuous: Alex's pages carry Saturday's opening and the weekend.
    expect(rows(alexBefore.today)).toContain('open_window.task');
    expect(rows(alexBefore.forward).filter((r) => r.startsWith('open_window'))).not.toEqual([]);
    const samBefore = {
      today: (await renderToday(h.sam, sat)).html,
      forward: (await renderForward(h.sam, sat)).html,
    };
    const secrets: string[] = [];
    let stale = '';
    try {
      stale = await calendarRow(
        h.sam.userId,
        'private',
        'Sam private WS',
        at('2026-10-10', '06:00'),
        '8',
      );
      await createEventWithPeople(
        h.sam,
        {
          title: 'Sam private noon WS',
          kind: 'appointment',
          visibility: 'private',
          time: timed(at(SAT, '12:00'), at(SAT, '13:00')),
        },
        [{ personId: id.sam, role: 'attending' }],
        deps,
      );
      await createEventWithPeople(
        h.sam,
        {
          title: 'Sam private day WS',
          kind: 'other',
          visibility: 'private',
          time: { allDay: true as const, startDate: SUN, endDate: '2026-10-19' },
        },
        [{ personId: id.sam, role: 'attending' }],
        deps,
      );
      await createTask(
        h.sam,
        {
          title: 'Sam private dry WS',
          visibility: 'private',
          estimateMinutes: 120,
          needs: ['dry_weather'],
        },
        deps,
      );
      // A private person attending a private Saturday event (PI-1).
      const friend = (
        await createPerson(
          h.sam,
          { name: 'Sam private friend WS', role: 'other', visibility: 'private' },
          deps,
        )
      ).id;
      const visit = await createEventWithPeople(
        h.sam,
        {
          title: 'Sam private visit WS',
          kind: 'other',
          visibility: 'private',
          time: timed(at(SAT, '15:00'), at(SAT, '16:00')),
        },
        [{ personId: friend, role: 'attending' }],
        deps,
      );
      // A private task scheduled on Sunday, assigned to Sam (PI-1).
      const scheduled = await createTask(
        h.sam,
        {
          title: 'Sam private scheduled WS',
          visibility: 'private',
          assigneePersonId: id.sam,
          scheduled: {
            startsAt: at(SUN, '10:00').toISOString(),
            endsAt: at(SUN, '11:00').toISOString(),
          },
        },
        deps,
      );
      secrets.push(friend, visit.id, scheduled.id);
      const alexAfter = await alexPages();
      expect(alexAfter.today).toBe(alexBefore.today);
      expect(alexAfter.forward).toBe(alexBefore.forward);
      // PI-2: the Today model, the ForwardModel and both listings, deep and as JSON.
      expect(alexAfter.given).toEqual(alexBefore.given);
      expect(JSON.stringify(alexAfter.given)).toBe(JSON.stringify(alexBefore.given));
      expect(alexAfter.forward + alexAfter.today).not.toMatch(/Sam private/);
      for (const secret of secrets) {
        expect(alexAfter.forward + alexAfter.today, secret).not.toContain(secret);
        expect(JSON.stringify(alexAfter.given), secret).not.toContain(secret);
      }
      // And it did change Sam's own (not vacuous).
      const samForward = (await renderForward(h.sam, sat)).html;
      expect(samForward).not.toBe(samBefore.forward);
      expect(words(samForward)).toMatch(/Sam private/);
      const samToday = (await renderToday(h.sam, sat)).html;
      expect(samToday).not.toBe(samBefore.today);
      expect(words(samToday)).toMatch(/Sam private (visit|scheduled)/);
    } finally {
      if (stale) await admin.db.execute(sql`delete from calendar_source where id = ${stale}::uuid`);
      await admin.db.execute(
        sql`delete from event_person where event_id in (select id from event where title like 'Sam private % WS')`,
      );
      await admin.db.execute(sql`delete from event where title like 'Sam private % WS'`);
      await admin.db.execute(sql`delete from task where title like 'Sam private % WS'`);
      await admin.db.execute(sql`delete from person where name like 'Sam private % WS'`);
    }
  });

  it('Dismiss on an opening: gone from both pages for that adult only, and a changed forecast keeps it gone (O7)', async () => {
    const key = `open_window:household:${SUN}:0800-1930`;
    const before = await renderForward(h.sam);
    expect(rows(before.html)).toContain('open_window.plain');
    await respondToInsight(h.alex, key, 'dismissed', 'forward', NOW, ZONE, deps);
    try {
      const alex = await renderForward(h.alex);
      expect(rows(alex.html)).toEqual(['open_window.task']);
      expect(words(alex.html)).not.toContain('Nothing is recorded for the household on Sunday');
      const sam = await renderForward(h.sam);
      expect(sam.html).toBe(before.html);
      await writeForecast(at(WED, '07:00'), (s) =>
        s.getTime() === at(SUN, '15:00').getTime() ? { precipitationProbability: 70 } : VALUES(s),
      );
      expect(rows((await renderForward(h.alex)).html)).toEqual(['open_window.task']);
      expect(rows((await renderForward(h.sam)).html)).toEqual([
        'open_window.task',
        'open_window.plain',
      ]);
    } finally {
      await admin.db.execute(sql`delete from insight_response where insight_key = ${key}`);
    }
  });
});
