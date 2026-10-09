import 'server-only';
import { agenda, type AgendaDay, type AgendaEventInput } from '@/domain/engines/agenda';
import { readAgendaInputs, type AgendaInputs } from '@/domain/events/agenda-inputs';
import type { Person } from '@/domain/people/service';
import { addDays, isoDateInZone, type IsoDate } from '@/lib/dates';
import { env } from '@/lib/env';
import type { UserActor } from '@/trust/actor';

// The one place screens get an agenda from (M3 contract §5): the records are
// read and composed in the domain (`readAgendaInputs`: as the signed-in
// adult, so visibility, archive and sensitivity are applied there, with
// overrides, calendar default people and changed occurrences resolved and
// every event's people read at once), then handed to the pure agenda
// engine. Forward, a person's Coming up and Today all use this; none of them
// does date work of its own. Nothing here knows a provider.

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
  /** The whole records the agenda was composed from, for Today's tasks and calendars (one read, shared). */
  records: AgendaInputs['records'];
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
  const { events, people, tasks, projects, records } = await readAgendaInputs(actor);
  return {
    today: todayInHomeZone(),
    from,
    to,
    days: agenda({
      from,
      to,
      timeZone: env.HOME_TIMEZONE,
      events,
      people: people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
      tasks,
      projects,
    }),
    people: new Map(people.map((p) => [p.id, p])),
    events,
    records,
  };
}
