import { agenda, type AgendaEventInput } from '@/domain/engines/agenda';
import { daylightFor, type Daylight } from '@/domain/engines/daylight';
import { gaps, HOUSEHOLD, scheduledTasks, type GapPerson, type Gaps } from '@/domain/engines/gaps';
import {
  insights,
  type InsightKind,
  type Insights,
  type InsightPerson,
} from '@/domain/engines/insights';
import {
  OPENING_DAYS,
  OPENINGS_SHOWN,
  openings,
  type Opening,
  type OpeningTask,
} from '@/domain/engines/insights/openings';
import type { TodayCalendar } from '@/domain/engines/today';
import type { Forecast } from '@/domain/engines/weather';
import { FORWARD_LISTED, FORWARD_SHOWN } from '@/domain/insights/forward';
import { syntheticHours, utcDayStart, type SyntheticValues } from '@/integrations/weather/fake';
import { addDays, isoDateInZone, type IsoDate } from '@/lib/dates';
import { allDay, ID, NZ, PEOPLE, timed } from '../today/household';

// The openings fixture (M7 contract §8.6, "Fixture" and F0–F2): the synthetic
// household of the M5–M7 engine tests (Sam and Alex, Milo and Isla, Nana Jo
// outside the household), its records exactly as the matrix lists them, the
// synthetic public point (Wellington's Civic Square) and the forecasts F0, F1
// and F2. A runner that composes the gap engine, daylight and the openings
// engine exactly as `openingsOver` does, and one that lists them on a surface
// exactly as Today and Forward Week do. Times are NZDT (UTC+13) unless a test
// says so. Nothing here is real.

export { ID, NZ, PEOPLE };

export const att = (...ids: string[]) =>
  ids.map((personId) => ({ personId, role: 'attending' as const }));
export const resp = (...ids: string[]) =>
  ids.map((personId) => ({ personId, role: 'responsible' as const }));

/** A home wall-clock instant, NZDT unless an offset is given. */
export const at = (date: string, clock: string, offset = '+13:00') =>
  new Date(`${date}T${clock}:00${offset}`);
export const on = (
  id: string,
  title: string,
  date: string,
  from: string,
  to: string,
  extra: Partial<AgendaEventInput> = {},
) => timed(id, title, `${date}T${from}:00+13:00`, `${date}T${to}:00+13:00`, extra);

/** The synthetic public point (contract §7): the rounded values only. */
export const WELLINGTON = { lat: -41.29, lon: 174.78 } as const;

/** Wednesday 14 October 2026, 07:03 at home: the matrix's `now`. */
export const WED_0703 = at('2026-10-14', '07:03');

// ---- Records (§8.6) -----------------------------------------------------

export const FOOTBALL = on('e-football', 'Football', '2026-10-17', '09:00', '10:00', {
  kind: 'activity',
  rrule: 'FREQ=WEEKLY;BYDAY=SA',
  people: att(ID.isla),
});
export const SWIMMING = on('e-swim', 'Swimming', '2026-10-14', '15:30', '16:15', {
  kind: 'activity',
  rrule: 'FREQ=WEEKLY;BYDAY=WE',
  people: [...att(ID.milo), ...resp(ID.sam)],
});
export const NANA_BIRTHDAY = allDay(
  'e-nana-birthday',
  'Nana Jo’s birthday',
  '2026-10-20',
  '2026-10-21',
);
export const EVENTS: AgendaEventInput[] = [FOOTBALL, SWIMMING, NANA_BIRTHDAY];

/** A task record as the authorised read gives it, with its assignee. */
export type FixtureTask = OpeningTask & { assigneePersonId: string | null };

export const task = (id: string, title: string, extra: Partial<FixtureTask> = {}): FixtureTask => ({
  id,
  title,
  status: 'open',
  dueDate: null,
  estimateMinutes: null,
  needs: [],
  projectId: null,
  assigneePersonId: null,
  scheduledStartsAt: null,
  scheduledEndsAt: null,
  ...extra,
});

export const FENCE = task('t-fence', 'Paint the back fence', {
  estimateMinutes: 180,
  needs: ['dry_weather', 'daylight'],
  projectId: 'pr-fence',
  assigneePersonId: ID.sam,
});
export const GARAGE = task('t-garage', 'Sort the garage light', { estimateMinutes: 30 });
export const TASKS: FixtureTask[] = [FENCE, GARAGE];

export type FixtureProject = {
  id: string;
  title: string;
  status: string;
  targetDate: IsoDate | null;
};
export const BACK_FENCE: FixtureProject = {
  id: 'pr-fence',
  title: 'Back fence',
  status: 'active',
  targetDate: null,
};

/** One household calendar whose last success was five minutes before `now` (06:58 at 07:03: `recorded`). */
export const calendarAt = (now: Date): TodayCalendar => ({
  id: 'c-family',
  name: 'Family calendar',
  archivedAt: null,
  lastAttemptAt: new Date(now.getTime() - 5 * 60_000),
  lastSyncedAt: new Date(now.getTime() - 5 * 60_000),
  lastSyncStatus: 'ok',
});
/** The calendar at the matrix's `now`: last success at 06:58 on the 14th. */
export const CALENDAR: TodayCalendar = calendarAt(at('2026-10-14', '07:03'));
/** The calendar last updated 24:01 before the matrix's `now` (`partial`, `data_health.stale`). */
export const STALE_CALENDAR: TodayCalendar = {
  ...CALENDAR,
  lastAttemptAt: new Date(WED_0703.getTime() - (24 * 60 + 1) * 60_000),
  lastSyncedAt: new Date(WED_0703.getTime() - (24 * 60 + 1) * 60_000),
};

// ---- Forecasts (§8.6 F0–F2) ----------------------------------------------

const HOUR = 3_600_000;
const within = (start: Date, from: Date, to: Date) =>
  start.getTime() >= from.getTime() && start.getTime() < to.getTime();

/**
 * F0's values by the hour: Saturday 17's planning hours at 5% and 0 mm
 * (10% or less); Sunday 18 one hour (13:00) at 40% and 0.1 mm, the rest dry;
 * Wednesday 14 dry in the morning and showery after midday (W15); gusts
 * 30 km/h everywhere (under 50).
 */
export const F0_VALUES = (start: Date): Partial<SyntheticValues> => {
  if (start.getTime() === at('2026-10-18', '13:00').getTime())
    return { precipitationProbability: 40, precipitationMm: 0.1 };
  if (within(start, at('2026-10-14', '12:00'), at('2026-10-14', '21:00')))
    return { precipitationProbability: 35, precipitationMm: 0.1 };
  return {};
};

/** A forecast with these values, fetched at `fetchedAt`: 191 hours from that UTC day, as the adapter stores them. */
export function forecastOf(
  fetchedAt: Date,
  values: (start: Date) => Partial<SyntheticValues> = F0_VALUES,
): Forecast {
  return { fetchedAt, hours: syntheticHours(utcDayStart(fetchedAt), 191, values) };
}

/** F0: fetched at 06:55 on Wednesday 14 October. */
export const F0 = forecastOf(at('2026-10-14', '06:55'));
/** F1: fetched at 08:10 the same morning, with Saturday showery (one hour at 40%). */
export const F1 = forecastOf(at('2026-10-14', '08:10'), (s) =>
  s.getTime() === at('2026-10-17', '14:00').getTime()
    ? { precipitationProbability: 40, precipitationMm: 0.1 }
    : F0_VALUES(s),
);
/** F2: fetched at 09:20 the same morning, Saturday dry again (F0's values). */
export const F2 = forecastOf(at('2026-10-14', '09:20'));
/** Changes some hours of a forecast, keeping the rest. */
export const withHours = (
  f: Forecast,
  change: (start: Date) => Partial<SyntheticValues> | null,
): Forecast => ({
  fetchedAt: f.fetchedAt,
  hours: f.hours.map((h) => ({ ...h, ...(change(h.start) ?? {}) })),
});
/** Drops the hour starting at `start`. */
export const withoutHour = (f: Forecast, start: Date): Forecast => ({
  fetchedAt: f.fetchedAt,
  hours: f.hours.filter((h) => h.start.getTime() !== start.getTime()),
});
export { HOUR };

// ---- Runners --------------------------------------------------------------

export type Run = {
  events?: AgendaEventInput[];
  tasks?: FixtureTask[];
  projects?: FixtureProject[];
  people?: InsightPerson[];
  calendars?: TodayCalendar[];
  now?: Date;
  /** The cached forecast (default F0); null for none. */
  forecast?: Forecast | null;
  /** The rounded home point (default Wellington); null for no location. */
  point?: { lat: number; lon: number } | null;
  /** The window (default Forward Week's: today … today + 6). */
  window?: { from: IsoDate; to: IsoDate };
};

/** Every opening the suites produce, for the forbidden-word scan. */
export const OUTPUTS: Opening[][] = [];

export type Composed = {
  now: Date;
  today: IsoDate;
  days: ReturnType<typeof agenda>;
  gaps: Gaps;
  daylight: Daylight[];
  openings: Opening[];
};

/**
 * The composition, exactly as `openingsOver` runs it: the shared agenda over
 * today … today + 13, the household's gaps over the window, daylight for
 * the window's dates at the point, then the openings engine.
 */
export function compose(o: Run = {}): Composed {
  const now = o.now ?? WED_0703;
  const today = isoDateInZone(now, NZ);
  const window = o.window ?? { from: today, to: addDays(today, OPENING_DAYS.forward - 1) };
  const agendaRange = { from: today, to: addDays(today, 13) };
  const people = o.people ?? PEOPLE;
  const tasks = o.tasks ?? TASKS;
  const projects = o.projects ?? [BACK_FENCE];
  const days = agenda({
    ...agendaRange,
    timeZone: NZ,
    events: o.events ?? EVENTS,
    people: people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks,
    projects,
  });
  const g = gaps({
    now,
    timeZone: NZ,
    range: window,
    agendaRange,
    days,
    people: people.map((p): GapPerson => ({ id: p.id, inHousehold: p.inHousehold })),
    tasks: scheduledTasks(tasks),
    calendars: o.calendars ?? [calendarAt(now)],
    scopes: [HOUSEHOLD],
  });
  const point = o.point === undefined ? WELLINGTON : o.point;
  const daylight: Daylight[] = [];
  if (point)
    for (let d = window.from; d <= window.to; d = addDays(d, 1)) {
      const x = daylightFor(d, point);
      if (x) daylight.push(x);
    }
  const out = openings({
    now,
    timeZone: NZ,
    window,
    gaps: g,
    forecast: o.forecast === undefined ? F0 : o.forecast,
    daylight,
    tasks,
    projects,
  });
  OUTPUTS.push(out);
  return { now, today, days, gaps: g, daylight, openings: out };
}

export const run = (o: Run = {}) => compose(o).openings;

/**
 * Worth knowing on a surface, exactly as Today and Forward Week list it: the
 * insights engine with the surface's listed families, cap and window, the
 * surface's openings passed in, and the reader's responses applied.
 */
export function surface(
  which: 'today' | 'forward',
  o: Run & {
    responded?: ReadonlySet<string>;
    /** Another cap, for the ±1 tests. */
    cap?: number;
    /** Another listing, for Month, Season and a person's page. */
    listedKinds?: ReadonlySet<InsightKind>;
  } = {},
): Insights {
  const now = o.now ?? WED_0703;
  const today = isoDateInZone(now, NZ);
  const days = OPENING_DAYS[which];
  const c = compose({ ...o, window: { from: today, to: addDays(today, days - 1) } });
  const people = o.people ?? PEOPLE;
  return insights({
    now,
    timeZone: NZ,
    days: c.days,
    events: o.events ?? EVENTS,
    people,
    tasks: (o.tasks ?? TASKS).map((t) => ({ id: t.id, projectId: t.projectId })),
    projects: o.projects ?? [BACK_FENCE],
    calendars: o.calendars ?? [calendarAt(now)],
    dismissed: o.responded ?? new Set(),
    ...(which === 'forward'
      ? {
          through: addDays(today, 6),
          listed: o.listedKinds ?? FORWARD_LISTED.week,
          shown: FORWARD_SHOWN,
          openingsShown: o.cap ?? OPENINGS_SHOWN.forward,
        }
      : { openingsShown: o.cap ?? OPENINGS_SHOWN.today, listed: o.listedKinds }),
    openings: c.openings,
  });
}

/** The listed insights, as a surface shows them: key and text, shown then "+ N more". */
export const listed = (r: Insights) => ({
  shown: r.shown.map((i) => i.key),
  rest: r.rest.map((i) => i.key),
  more: r.more,
});

/** A seeded generator (mulberry32), as the conflict and gap engines' determinism tests. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates over a copy. */
export function shuffle<T>(xs: readonly T[], random: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
