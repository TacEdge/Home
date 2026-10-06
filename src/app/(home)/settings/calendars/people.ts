import type { CalendarView } from '@/domain/calendar/service';
import { listPeople, type Person } from '@/domain/people/service';
import type { UserActor } from '@/trust/actor';
import type { PersonColour } from '@/ui/person-dot';

// The people a calendar page names: the ones this adult can see, as the
// people service returns them (privacy is decided there, never here).

export type NamedPerson = { id: string; name: string; colour: PersonColour | null };

export async function peopleFor(actor: UserActor): Promise<{
  all: NamedPerson[];
  byId: Map<string, NamedPerson>;
  /** The person linked to a user, for "Sam’s work". */
  ownerName: (c: Pick<CalendarView, 'ownerUserId' | 'isOwner'>) => string | null;
}> {
  const people: Person[] = await listPeople(actor);
  const all = people.map((p) => ({
    id: p.id,
    name: p.name,
    colour: p.colour as PersonColour | null,
  }));
  const byUser = new Map(people.filter((p) => p.userId).map((p) => [p.userId as string, p.name]));
  return {
    all,
    byId: new Map(all.map((p) => [p.id, p])),
    ownerName: (c) => (c.isOwner ? null : (byUser.get(c.ownerUserId) ?? null)),
  };
}
