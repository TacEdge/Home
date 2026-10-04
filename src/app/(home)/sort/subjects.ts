import 'server-only';
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
  return { people, projects, events };
}
