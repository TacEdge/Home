import { agenda, type AgendaEventInput } from '@/domain/engines/agenda';
import { insights, type InsightPerson, type InsightProject } from '@/domain/engines/insights';
import { conflicts } from '@/domain/engines/conflicts';
import {
  conflictPlacements,
  today,
  type TodayCalendar,
  type TodayTask,
} from '@/domain/engines/today';
import { addDays, isoDateInZone } from '@/lib/dates';

// The synthetic fixture household (docs/concepts/README.md) as pure engine
// inputs for M5 Package 2: Sam and Alex, Milo (9) and Isla (6), Nana Jo
// outside the household. Times are NZDT (UTC+13) unless a test says
// otherwise. Ids are fixed strings; nothing here is real.

export const NZ = 'Pacific/Auckland';
export const ID = {
  sam: 'p-sam',
  alex: 'p-alex',
  milo: 'p-milo',
  isla: 'p-isla',
  nana: 'p-nana',
} as const;

/** People in the order People lists them (by lower-cased name). */
export const PEOPLE: InsightPerson[] = [
  { id: ID.alex, name: 'Alex', role: 'parent', inHousehold: true, dateOfBirth: '1986-03-02' },
  { id: ID.isla, name: 'Isla', role: 'child', inHousehold: true, dateOfBirth: '2020-05-11' },
  { id: ID.milo, name: 'Milo', role: 'child', inHousehold: true, dateOfBirth: '2017-02-08' },
  { id: ID.nana, name: 'Nana Jo', role: 'other', inHousehold: false, dateOfBirth: '1958-10-20' },
  { id: ID.sam, name: 'Sam', role: 'parent', inHousehold: true, dateOfBirth: '1984-07-19' },
];

const att = (...ids: string[]) => ids.map((personId) => ({ personId, role: 'attending' as const }));
const resp = (...ids: string[]) =>
  ids.map((personId) => ({ personId, role: 'responsible' as const }));

export const timed = (
  id: string,
  title: string,
  startsAt: string,
  endsAt: string,
  extra: Partial<AgendaEventInput> = {},
): AgendaEventInput =>
  ({
    id,
    title,
    kind: 'other',
    allDay: false,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    timeZone: NZ,
    rrule: null,
    exdates: null,
    people: [],
    ...extra,
  }) as AgendaEventInput;

export const allDay = (
  id: string,
  title: string,
  startDate: string,
  endDate: string,
  extra: Partial<AgendaEventInput> = {},
): AgendaEventInput =>
  ({
    id,
    title,
    kind: 'other',
    allDay: true,
    startDate,
    endDate,
    rrule: null,
    exdates: null,
    people: [],
    ...extra,
  }) as AgendaEventInput;

const WEEKDAYS = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';

/** The household's usual week, from Monday 12 October 2026. */
export const ROUTINE: AgendaEventInput[] = [
  timed('e-school', 'School', '2026-10-12T08:45:00+13:00', '2026-10-12T15:00:00+13:00', {
    kind: 'school',
    rrule: WEEKDAYS,
    people: att(ID.milo, ID.isla),
  }),
  timed('e-work-alex', 'Work', '2026-10-12T09:00:00+13:00', '2026-10-12T14:30:00+13:00', {
    kind: 'work',
    rrule: WEEKDAYS,
    people: att(ID.alex),
  }),
  allDay('e-site', 'Client site', '2026-10-14', '2026-10-15', {
    kind: 'work',
    rrule: 'FREQ=WEEKLY;BYDAY=WE',
    people: att(ID.sam),
  }),
  timed('e-swim', 'Swimming', '2026-10-14T15:30:00+13:00', '2026-10-14T16:15:00+13:00', {
    kind: 'activity',
    rrule: 'FREQ=WEEKLY;BYDAY=WE',
    people: [...att(ID.milo), ...resp(ID.alex)],
  }),
  timed('e-pilates', 'Pilates', '2026-10-14T18:15:00+13:00', '2026-10-14T19:15:00+13:00', {
    kind: 'activity',
    rrule: 'FREQ=WEEKLY;BYDAY=WE',
    people: att(ID.alex),
  }),
  timed('e-football', 'Football', '2026-10-17T09:00:00+13:00', '2026-10-17T10:00:00+13:00', {
    kind: 'activity',
    rrule: 'FREQ=WEEKLY;BYDAY=SA',
    people: att(ID.milo),
  }),
];

/** Wednesday 14 October's one-offs. */
export const WEDNESDAY: AgendaEventInput[] = [
  timed('e-board', 'Board meeting', '2026-10-14T19:00:00+13:00', '2026-10-14T21:00:00+13:00', {
    kind: 'work',
    people: att(ID.sam),
  }),
  // Isla is recorded on it; nobody is recorded as responsible. Nothing is inferred from that.
  timed('e-pickup', 'Isla pickup', '2026-10-14T15:00:00+13:00', '2026-10-14T15:15:00+13:00', {
    people: att(ID.isla),
  }),
];

export const TASKS: TodayTask[] = [
  { id: 't-fees', title: 'Pay swimming term fees', dueDate: '2026-10-14', scheduledStartsAt: null },
  { id: 't-camp', title: 'Sign Milo’s camp form', dueDate: '2026-10-15', scheduledStartsAt: null },
  { id: 't-books', title: 'Return library books', dueDate: '2026-10-12', scheduledStartsAt: null },
  {
    id: 't-plumber',
    title: 'Call the plumber',
    dueDate: null,
    scheduledStartsAt: new Date('2026-10-14T10:00:00+13:00'),
  },
  { id: 't-paint', title: 'Paint the back fence', dueDate: null, scheduledStartsAt: null },
];
export const TASK_PROJECTS: Record<string, string | null> = { 't-paint': 'pr-fence' };

export const PROJECTS: InsightProject[] = [
  { id: 'pr-fence', title: 'Back fence', status: 'active', targetDate: '2026-10-17' },
  { id: 'pr-garage', title: 'Garage', status: 'idea', targetDate: '2026-10-16' },
];

export const fresh = (now: Date, extra: Partial<TodayCalendar> = {}): TodayCalendar => ({
  id: 'c-sam-work',
  name: 'Sam’s work',
  archivedAt: null,
  lastAttemptAt: new Date(now.getTime() - 60 * 60 * 1000),
  lastSyncedAt: new Date(now.getTime() - 60 * 60 * 1000),
  lastSyncStatus: 'ok',
  ...extra,
});

export type Household = {
  events: AgendaEventInput[];
  people?: InsightPerson[];
  tasks?: TodayTask[];
  projects?: InsightProject[];
  calendars?: TodayCalendar[];
  capturesWaiting?: number;
  dismissed?: ReadonlySet<string>;
  timeZone?: string;
};

/** The agenda from today for eight days, then both engines, exactly as the loader will. */
export function run(h: Household, now: Date) {
  const timeZone = h.timeZone ?? NZ;
  const people = h.people ?? PEOPLE;
  const tasks = h.tasks ?? TASKS;
  const projects = h.projects ?? PROJECTS;
  const calendars = h.calendars ?? [fresh(now)];
  const from = isoDateInZone(now, timeZone);
  const days = agenda({
    from,
    to: addDays(from, 7),
    timeZone,
    events: h.events,
    people: people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: 'open', dueDate: t.dueDate })),
    projects,
  });
  const model = today({
    now,
    timeZone,
    days,
    events: h.events,
    people,
    tasks,
    calendars,
    capturesWaiting: h.capturesWaiting ?? 0,
  });
  // The page's composition (M6 Package 3): the conflict engine over the same
  // eight days, today's said on their items where Today shows them.
  const window = { from, to: addDays(from, 7) };
  const found = conflicts({
    now,
    timeZone,
    window,
    days,
    coverage: window,
    events: h.events,
    people,
  });
  const placed = conflictPlacements(model);
  return {
    days,
    today: model,
    conflicts: found,
    placed,
    insights: insights({
      now,
      timeZone,
      days,
      events: h.events,
      people,
      tasks: tasks.map((t) => ({ id: t.id, projectId: TASK_PROJECTS[t.id] ?? null })),
      projects,
      calendars,
      dismissed: h.dismissed,
      conflicts: found,
      placed,
    }),
  };
}

export const at = (iso: string) => new Date(iso);
