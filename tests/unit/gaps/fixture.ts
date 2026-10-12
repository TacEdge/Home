import { agenda, type AgendaEventInput, type AgendaTaskInput } from '@/domain/engines/agenda';
import {
  gaps,
  HOUSEHOLD,
  type GapPerson,
  type GapScope,
  type Gaps,
  type GapsInput,
} from '@/domain/engines/gaps';
import type { TodayCalendar } from '@/domain/engines/today';
import { clockOf, type IsoDate } from '@/lib/dates';
import { ID, NZ, PEOPLE } from '../today/household';

// The gap engine's fixture (M7 contract §8.6): the synthetic household of the
// M5 and M6 engine tests (Sam and Alex, Milo and Isla, Nana Jo outside the
// household), its fixed ids, and a runner that places the shared agenda and
// runs the engine exactly as the composition does. Times are NZDT (UTC+13)
// unless a test says so. Nothing here is real.

export { ID, NZ };

export const att = (...ids: string[]) =>
  ids.map((personId) => ({ personId, role: 'attending' as const }));
export const resp = (...ids: string[]) =>
  ids.map((personId) => ({ personId, role: 'responsible' as const }));

export const VISIBLE: GapPerson[] = PEOPLE.map((p) => ({ id: p.id, inHousehold: p.inHousehold }));
/** The household, then each household person. */
export const ALL_SCOPES: GapScope[] = [HOUSEHOLD, ID.alex, ID.isla, ID.milo, ID.sam];

/** Wednesday 14 October 2026, 07:03 at home. */
export const WED_0703 = new Date('2026-10-14T07:03:00+13:00');

/** One household calendar whose last success was five minutes ago (06:58 at the fixture's now). */
export const healthy = (now: Date, extra: Partial<TodayCalendar> = {}): TodayCalendar => ({
  id: 'c-household',
  name: 'Household',
  archivedAt: null,
  lastAttemptAt: new Date(now.getTime() - 5 * 60_000),
  lastSyncedAt: new Date(now.getTime() - 5 * 60_000),
  lastSyncStatus: 'ok',
  ...extra,
});

export type GapTaskInput = AgendaTaskInput & { assigneePersonId: string | null };

export type Run = {
  events?: AgendaEventInput[];
  tasks?: GapTaskInput[];
  projects?: { id: string; title: string; status: string; targetDate: IsoDate | null }[];
  people?: (GapPerson & { name?: string; dateOfBirth?: IsoDate | null })[];
  now?: Date;
  /** The range asked for (default 14–31 October). */
  range?: { from: IsoDate; to: IsoDate };
  /** The agenda's range (default: the range). */
  agendaRange?: { from: IsoDate; to: IsoDate };
  scopes?: GapScope[];
  calendars?: TodayCalendar[];
};

/** The engine's input for a run: the shared agenda placed over the agenda's range, as a page will. */
export function inputOf(o: Run): GapsInput {
  const now = o.now ?? WED_0703;
  const range = o.range ?? { from: '2026-10-14', to: '2026-10-31' };
  const agendaRange = o.agendaRange ?? range;
  const people: NonNullable<Run['people']> = o.people ?? VISIBLE;
  const tasks = o.tasks ?? [];
  const days = agenda({
    ...agendaRange,
    timeZone: NZ,
    events: o.events ?? [],
    people: people.map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
      dateOfBirth: p.dateOfBirth ?? null,
    })),
    tasks,
    projects: o.projects ?? [],
  });
  return {
    now,
    timeZone: NZ,
    range,
    agendaRange,
    days,
    people: people.map((p) => ({ id: p.id, inHousehold: p.inHousehold })),
    tasks: tasks.map((t) => ({ id: t.id, assigneePersonId: t.assigneePersonId })),
    calendars: o.calendars ?? [healthy(now)],
    scopes: o.scopes ?? ALL_SCOPES,
  };
}

/** Every output the suites produce, for the forbidden-word scan. */
export const OUTPUTS: Gaps[] = [];

export function run(o: Run): Gaps {
  const out = gaps(inputOf(o));
  OUTPUTS.push(out);
  return out;
}

/** "08:00–09:00 and 10:00–20:00": a scope's stretches on a date, as the matrix writes them. */
export function said(r: Gaps, date: IsoDate, scope: GapScope = HOUSEHOLD): string {
  return r.gaps
    .filter((g) => g.date === date && g.scope === scope)
    .map((g) => `${clockOf(g.stretch.from, NZ)}–${clockOf(g.stretch.to, NZ)}`)
    .join(' and ');
}

export const keys = (r: Gaps, scope?: GapScope) =>
  r.gaps.filter((g) => scope === undefined || g.scope === scope).map((g) => g.key);

/** A seeded generator (mulberry32), as the conflict engine's T19: the same seed, the same sequence. */
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
