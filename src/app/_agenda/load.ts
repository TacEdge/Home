import 'server-only';
import { agenda, type AgendaDay, type AgendaEventInput } from '@/domain/engines/agenda';
import { recurringOf } from '@/domain/events/occurrences';
import { listEventPeople, listEvents } from '@/domain/events/service';
import { listPeople, type Person } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { listTasks } from '@/domain/tasks/service';
import { addDays, isoDateInZone, type IsoDate } from '@/lib/dates';
import { env } from '@/lib/env';
import type { UserActor } from '@/trust/actor';

// The one place screens get an agenda from (M3 contract §5): everything is
// read through the domain services as the signed-in adult (so visibility,
// archive and sensitivity are applied there), then handed to the pure
// agenda engine. Forward, a person's Coming up and later Today all use
// this; none of them does date work of its own.

export type LoadedAgenda = {
  today: IsoDate;
  from: IsoDate;
  to: IsoDate;
  days: AgendaDay[];
  /** People the adult can see, for names and colours beside items. */
  people: Map<string, Person>;
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
  const [events, people, tasks, projects] = await Promise.all([
    listEvents(actor),
    listPeople(actor),
    listTasks(actor, { status: 'open' }),
    listProjects(actor),
  ]);
  const withPeople: AgendaEventInput[] = await Promise.all(
    events.map(async (e) => ({
      ...recurringOf(e),
      id: e.id,
      title: e.title,
      people: (await listEventPeople(actor, e.id)).map((a) => ({
        personId: a.personId,
        role: a.role as 'attending' | 'responsible',
      })),
    })),
  );
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
  };
}
