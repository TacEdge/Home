import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayInHomeZone } from '@/app/_agenda/load';
import { NotFoundError } from '@/domain/common/errors';
import { getCapture } from '@/domain/captures/service';
import { CONTEXT_CATEGORIES } from '@/domain/context/schema';
import { listPeople } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { requireActor } from '@/trust/session';
import { Page, Quiet } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';
import { EventForm } from '../../../events/event-form';
import { newEventDefaults } from '../../../events/form-defaults';
import { ProjectForm } from '../../../home/project-form';
import { CONTEXT_CATEGORY_LABEL } from '../../../people/copy';
import { newTaskDefaults } from '../../../tasks/task-defaults';
import { TaskForm } from '../../../tasks/task-form';
import { organiseAction } from '../../actions';
import { kindOf } from '../../copy';
import { ContextOrganiseForm, NoteOrganiseForm } from '../../organise-forms';
import { subjectsFor } from '../../subjects';

export const dynamic = 'force-dynamic';

// Make it a… (M3 contract §3.8): the normal form for the chosen record,
// prefilled from the capture's words, all editable. Saving goes through
// organiseCapture (propose and approve in one transaction).
export default async function OrganisePage({
  params,
}: {
  params: Promise<{ id: string; as: string }>;
}) {
  const actor = await requireActor();
  const { id, as } = await params;
  const kind = kindOf(as);
  if (!kind) notFound();
  const c = await getCapture(actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const action = organiseAction.bind(null, c.id, kind.as);
  const words = c.text;
  // A title is one line: a line break in the words becomes a space there,
  // rather than the browser dropping it. A note or something to know keeps them.
  const title = words.replace(/\s*\r?\n\s*/g, ' ');
  const dismissed = c.status === 'dismissed';

  let form: React.ReactNode;
  switch (kind.as) {
    case 'task': {
      const [projects, people] = await Promise.all([listProjects(actor), listPeople(actor)]);
      form = (
        <TaskForm
          action={action}
          initialTitle={title}
          projects={projects.map((p) => ({ id: p.id, name: p.title }))}
          people={people.map((p) => ({
            id: p.id,
            name: p.name,
            colour: p.colour as PersonColour | null,
          }))}
          defaults={newTaskDefaults()}
          submitLabel="Make it a task"
        />
      );
      break;
    }
    case 'event':
      form = (
        <>
          <EventForm
            action={action}
            initialTitle={title}
            people={[]}
            defaults={newEventDefaults(todayInHomeZone())}
            submitLabel="Make it an event"
          />
          <Quiet>Who’s going can be added on the event’s page afterwards.</Quiet>
        </>
      );
      break;
    case 'project':
      form = <ProjectForm action={action} initialTitle={title} submitLabel="Make it a project" />;
      break;
    case 'note': {
      const s = await subjectsFor(actor, true);
      form = (
        <NoteOrganiseForm
          action={action}
          words={words}
          subjects={[
            ...s.people.map((p) => ({ value: `person:${p.id}`, label: `Person: ${p.name}` })),
            ...s.projects.map((p) => ({ value: `project:${p.id}`, label: `Project: ${p.title}` })),
            ...s.events.map((e) => ({ value: `event:${e.id}`, label: `Event: ${e.title}` })),
          ]}
        />
      );
      break;
    }
    case 'know': {
      const s = await subjectsFor(actor, false);
      form = (
        <ContextOrganiseForm
          action={action}
          words={words}
          subjects={[
            ...s.people.map((p) => ({ value: `person:${p.id}`, label: p.name })),
            ...s.projects.map((p) => ({ value: `project:${p.id}`, label: `Project: ${p.title}` })),
          ]}
          categories={CONTEXT_CATEGORIES.map((k) => ({
            value: k,
            label: CONTEXT_CATEGORY_LABEL[k] ?? 'Something else',
          }))}
        />
      );
      break;
    }
  }

  return (
    <Page title={kind.heading}>
      <p className="border-line mt-2 border-l-2 pl-4 break-words whitespace-pre-wrap text-ink-2">
        {words}
      </p>
      {dismissed ? (
        <div className="mt-6">
          <Quiet>This was set aside. Bring it back from its page first.</Quiet>
        </div>
      ) : (
        form
      )}
      <p className="mt-8">
        <Link
          href={`/sort/${c.id}`}
          className="text-ink-2 inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
        >
          Back
        </Link>
      </p>
    </Page>
  );
}
