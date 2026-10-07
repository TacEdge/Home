import 'server-only';
import { listCalendars } from '@/domain/calendar/service';
import { agenda, type AgendaDay, type AgendaEventInput } from '@/domain/engines/agenda';
import {
  hiddenOccurrenceChanges,
  isOccurrenceChange,
  overriddenOriginals,
  recurringWithOverrides,
} from '@/domain/events/occurrences';
import { listEventPeople, listEvents } from '@/domain/events/service';
import { effectivePeople, occurrenceChangePeople } from '@/domain/events/who';
import { listPeople, type Person } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { listTasks } from '@/domain/tasks/service';
import { addDays, isoDateInZone, type IsoDate } from '@/lib/dates';
import { env } from '@/lib/env';
import type { UserActor } from '@/trust/actor';

// The one place screens get an agenda from (M3 contract §5): everything is
// read through the domain services as the signed-in adult (so visibility,
// archive and sensitivity are applied there), then handed to the pure
// agenda engine. Forward, a person's Coming up and Today all use this; none
// of them does date work of its own. Synced events (M4 Package 6) come
// through the same read: a series is expanded with its live overrides'
// originals skipped (occurrences.ts), and an event with no people of its own
// shows its calendar's usual people (who.ts). A changed occurrence of a
// manual series (Package 8a) replaces its original the same way, shows its
// series' people when it has none of its own, and is not shown at all
// while its series is archived. Nothing here knows a provider.

export type LoadedAgenda = {
  today: IsoDate;
  from: IsoDate;
  to: IsoDate;
  days: AgendaDay[];
  /** People the adult can see, for names and colours beside items. */
  people: Map<string, Person>;
  /**
   * The events as the engine read them, with who each is for: what a
   * profile's regular week is derived from (profile engine), so it reads
   * exactly what the agenda read.
   */
  events: AgendaEventInput[];
};

/** Today in the home time zone. */
export function todayInHomeZone(): IsoDate {
  return isoDateInZone(new Date(), env.HOME_TIMEZONE);
}

/** The agenda from `from` for `days` days (Forward: today for 30). */
export async function loadAgenda(
  actor: UserActor,
  from: IsoDate,
  days: number,
): Promise<LoadedAgenda> {
  const to = addDays(from, days - 1);
  const [events, people, tasks, projects, calendars] = await Promise.all([
    listEvents(actor),
    listPeople(actor),
    listTasks(actor, { status: 'open' }),
    listProjects(actor),
    listCalendars(actor),
  ]);
  const visible = new Set(people.map((p) => p.id));
  const defaults = new Map(calendars.map((c) => [c.id, c.defaultPersonIds]));
  const overridden = overriddenOriginals(events);
  const hidden = hiddenOccurrenceChanges(events);
  const shown = events.filter((e) => !hidden.has(e.id));
  const annotations = new Map(
    await Promise.all(
      shown.map(
        async (e) =>
          [
            e.id,
            (await listEventPeople(actor, e.id)).map((a) => ({
              personId: a.personId,
              role: a.role as 'attending' | 'responsible',
            })),
          ] as const,
      ),
    ),
  );
  const withPeople: AgendaEventInput[] = shown.map((e) => ({
    ...recurringWithOverrides(e, overridden),
    id: e.id,
    title: e.title,
    people: (isOccurrenceChange(e)
      ? occurrenceChangePeople(
          annotations.get(e.id) ?? [],
          annotations.get(e.recurrenceParentId!) ?? [],
          visible,
        )
      : effectivePeople(
          annotations.get(e.id) ?? [],
          e.calendarSourceId ? defaults.get(e.calendarSourceId) : undefined,
          visible,
        )
    ).people,
  }));
  return {
    today: todayInHomeZone(),
    from,
    to,
    days: agenda({
      from,
      to,
      timeZone: env.HOME_TIMEZONE,
      events: withPeople,
      people: people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate })),
      projects: projects.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        targetDate: p.targetDate,
      })),
    }),
    people: new Map(people.map((p) => [p.id, p])),
    events: withPeople,
  };
}
