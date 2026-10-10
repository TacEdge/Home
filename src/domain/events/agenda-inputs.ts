import 'server-only';
import { listCalendars, type CalendarView } from '../calendar/service';
import type { Deps } from '../common/write';
import type { AgendaEventInput, AgendaProjectInput, AgendaTaskInput } from '../engines/agenda';
import { listPeople, type Person } from '../people/service';
import { listProjects, type Project } from '../projects/service';
import { listTasks, type Task } from '../tasks/service';
import {
  hiddenOccurrenceChanges,
  isOccurrenceChange,
  overriddenOriginals,
  recurringWithOverrides,
} from './occurrences';
import { listEventPeopleFor, listEvents } from './service';
import { effectivePeople, occurrenceChangePeople } from './who';
import type { EventKind } from '@/db/schema/event';
import type { UserActor } from '@/trust/actor';

// What the agenda engine is given (M3 contract §5, M4 Packages 6 and 8a,
// M5 Package 1): every record read through the domain services as the
// signed-in adult, so visibility, archive and sensitivity are applied there
// and nowhere else. A series is expanded with its live overrides' originals
// skipped; a synced event with no people of its own shows its calendar's
// usual people; a changed occurrence of a manual series shows its series'
// people when it has none of its own, and is not shown while its series is
// archived. Annotations are read for all events at once (ADR 0008 §7), so
// the number of queries does not grow with the number of events. Nothing
// here knows a provider or a screen.

export type AgendaInputs = {
  events: AgendaEventInput[];
  /** People the adult can see, for the engine's birthdays and for names beside items. */
  people: Person[];
  tasks: AgendaTaskInput[];
  projects: AgendaProjectInput[];
  /**
   * The same reads, whole, for the screens that need more than the engine
   * does (Today's tasks with their schedule and project, its calendars'
   * freshness). Nothing is read twice for them (M5 Package 3, ADR 0008 §32).
   */
  records: { tasks: Task[]; projects: Project[]; calendars: CalendarView[] };
};

type Role = 'attending' | 'responsible';

export async function readAgendaInputs(actor: UserActor, deps: Deps = {}): Promise<AgendaInputs> {
  const [events, people, tasks, projects, calendars] = await Promise.all([
    listEvents(actor, {}, deps),
    listPeople(actor, {}, deps),
    listTasks(actor, { status: 'open' }, deps),
    listProjects(actor, {}, deps),
    listCalendars(actor, {}, deps),
  ]);
  const visible = new Set(people.map((p) => p.id));
  const defaults = new Map(calendars.map((c) => [c.id, c.defaultPersonIds]));
  const overridden = overriddenOriginals(events);
  const hidden = hiddenOccurrenceChanges(events);
  const shown = events.filter((e) => !hidden.has(e.id));
  // One read for every shown event and every series a shown change belongs
  // to (a change with no people of its own shows its series' people).
  const seriesIds = shown.filter(isOccurrenceChange).map((e) => e.recurrenceParentId!);
  const read = await listEventPeopleFor(actor, [...shown.map((e) => e.id), ...seriesIds], {}, deps);
  const annotations = (id: string) =>
    (read.get(id) ?? []).map((a) => ({ personId: a.personId, role: a.role as Role }));
  return {
    events: shown.map((e) => ({
      ...recurringWithOverrides(e, overridden),
      id: e.id,
      title: e.title,
      kind: e.kind as EventKind,
      people: (isOccurrenceChange(e)
        ? occurrenceChangePeople(annotations(e.id), annotations(e.recurrenceParentId!), visible)
        : effectivePeople(
            annotations(e.id),
            e.calendarSourceId ? defaults.get(e.calendarSourceId) : undefined,
            visible,
          )
      ).people,
    })),
    people,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate,
      scheduledStartsAt: t.scheduledStartsAt,
      scheduledEndsAt: t.scheduledEndsAt,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      targetDate: p.targetDate,
    })),
    records: { tasks, projects, calendars },
  };
}
