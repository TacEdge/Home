import 'server-only';
import { hiddenOccurrenceChanges } from '@/domain/events/occurrences';
import { listEvents } from '@/domain/events/service';
import { listPeople } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import type { UserActor } from '@/trust/actor';

// What a note or something to know made from a capture may be about: the
// people, projects (and, for a note, events) the actor can see now. Read on
// the server for both the form and its action, so an id the form was not
// offered is never accepted.

export async function subjectsFor(actor: UserActor, withEvents: boolean) {
  const [people, projects, events] = await Promise.all([
    listPeople(actor),
    listProjects(actor),
    withEvents ? listEvents(actor) : Promise.resolve([]),
  ]);
  // A changed time whose series is put away is not offered as an event of its own.
  const hidden = hiddenOccurrenceChanges(events);
  return { people, projects, events: events.filter((e) => !hidden.has(e.id)) };
}
