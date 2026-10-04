import Link from 'next/link';
import { listPeople } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { getTask, listTasks } from '@/domain/tasks/service';
import { requireActor } from '@/trust/session';
import { EmptyState, Page } from '@/ui/page';
import { TaskList } from './task-list';

export const dynamic = 'force-dynamic';

// To do (M3 contract §3.5): open tasks by due date (none last) then
// project; done and dropped folded away; Done is one tap, with Undo.
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ undo?: string }>;
}) {
  const actor = await requireActor();
  const { undo } = await searchParams;
  const [tasks, people, projects] = await Promise.all([
    listTasks(actor),
    listPeople(actor),
    listProjects(actor, { includeArchived: true }),
  ]);
  const justSettled = undo ? await getTask(actor, undo).catch(() => undefined) : undefined;

  return (
    <Page title="To do">
      {tasks.length === 0 ? (
        <EmptyState title="Nothing to do.">
          <Link href="/tasks/new" className="underline underline-offset-4">
            Add a task
          </Link>
        </EmptyState>
      ) : (
        <>
          <TaskList
            tasks={tasks}
            people={people}
            projects={projects}
            empty="Nothing to do. Enjoy it."
            undo={justSettled && justSettled.status !== 'open' ? justSettled : undefined}
          />
          <p className="mt-8">
            <Link href="/tasks/new" className="text-ink-2 underline underline-offset-4">
              Add a task
            </Link>
          </p>
        </>
      )}
    </Page>
  );
}
