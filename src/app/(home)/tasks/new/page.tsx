import { listPeople } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { requireActor } from '@/trust/session';
import { Page } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';
import { createTaskAction } from '../actions';
import { newTaskDefaults } from '../task-defaults';
import { TaskForm } from '../task-form';

export const dynamic = 'force-dynamic';

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const actor = await requireActor();
  const { project } = await searchParams;
  const [projects, people] = await Promise.all([listProjects(actor), listPeople(actor)]);
  const chosen = projects.find((p) => p.id === project);
  return (
    <Page title="Add a task" intro={chosen ? `Part of ${chosen.title}.` : 'Something to get done.'}>
      <TaskForm
        action={createTaskAction}
        projects={projects.map((p) => ({ id: p.id, name: p.title }))}
        people={people.map((p) => ({
          id: p.id,
          name: p.name,
          colour: p.colour as PersonColour | null,
        }))}
        defaults={newTaskDefaults(chosen?.id)}
        submitLabel="Add it"
      />
    </Page>
  );
}
