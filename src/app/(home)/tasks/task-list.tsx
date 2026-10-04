import Link from 'next/link';
import { ActionForm } from '@/app/_forms/action-form';
import { todayInHomeZone } from '@/app/_agenda/load';
import type { Person } from '@/domain/people/service';
import type { Project } from '@/domain/projects/service';
import type { Task } from '@/domain/tasks/service';
import { longDate } from '@/lib/dates';
import { Button } from '@/ui/button';
import { Quiet } from '@/ui/page';
import { PersonName, type PersonColour } from '@/ui/person-dot';
import { setTaskStatusAction } from './actions';
import { taskStatusLabel } from './copy';

// Tasks as HOME lists them (M3 contract §3.5): open ones first, by due date
// (none last) then project; done and dropped folded away. A row is the due
// date, the title (a link), its project and who it's for; an open row has
// Done beside it, one tap. An overdue task carries the one Sun mark.

export function orderTasks(tasks: Task[], projects: Map<string, Project>): Task[] {
  const key = (t: Task) => [
    t.dueDate ?? '9999-99-99',
    (t.projectId && projects.get(t.projectId)?.title.toLowerCase()) ?? '~',
    t.createdAt.toISOString(),
    t.id,
  ];
  return [...tasks].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
    return 0;
  });
}

export function TaskList({
  tasks,
  people,
  projects,
  showProject = true,
  returnTo = '/tasks',
  empty,
  undo,
}: {
  tasks: Task[];
  people: Person[];
  projects: Project[];
  showProject?: boolean;
  /** Where a Done press returns to. */
  returnTo?: string;
  empty: string;
  /** A task just finished or dropped from here, offered back. */
  undo?: Task;
}) {
  const today = todayInHomeZone();
  const byPerson = new Map(people.map((p) => [p.id, p]));
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const open = orderTasks(
    tasks.filter((t) => t.status === 'open'),
    byProject,
  );
  const settled = orderTasks(
    tasks.filter((t) => t.status !== 'open'),
    byProject,
  );
  const act = setTaskStatusAction.bind(null, returnTo);

  const row = (t: Task) => {
    const overdue = t.status === 'open' && t.dueDate !== null && t.dueDate < today;
    const project = t.projectId ? byProject.get(t.projectId) : undefined;
    const who = t.assigneePersonId ? byPerson.get(t.assigneePersonId) : undefined;
    const details = [
      showProject && project ? project.title : null,
      t.status === 'open' ? null : taskStatusLabel(t.status),
    ].filter(Boolean);
    return (
      <li key={t.id} className="border-line flex min-h-11 items-baseline gap-3 border-t py-3">
        <span className="text-muted w-[4.5rem] shrink-0 font-mono text-[14px] tabular-nums">
          {t.dueDate ? longDate(t.dueDate, 'short') : ''}
        </span>
        <span className="min-w-0 flex-1">
          <Link
            href={`/tasks/${t.id}`}
            className="block break-words underline-offset-4 hover:underline"
          >
            {overdue ? (
              <>
                <span
                  aria-hidden="true"
                  className="bg-accent mr-2 inline-block h-2 w-2 rounded-full align-middle"
                />
                <span className="sr-only">Overdue: </span>
              </>
            ) : null}
            {t.title}
          </Link>
          {details.length || who ? (
            <span className="text-ink-2 mt-0.5 flex flex-wrap gap-x-3 text-[15px]">
              {details.map((d) => (
                <span key={String(d)}>{d}</span>
              ))}
              {who ? (
                <PersonName name={who.name} colour={who.colour as PersonColour | null} />
              ) : null}
            </span>
          ) : null}
        </span>
        {t.status === 'open' ? (
          <ActionForm action={act} className="shrink-0">
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="status" value="done" />
            <Button variant="quiet" ariaLabel={`Done: ${t.title}`}>
              Done
            </Button>
          </ActionForm>
        ) : null}
      </li>
    );
  };

  return (
    <>
      {undo ? (
        <ActionForm action={act} className="mb-4 flex flex-wrap items-baseline gap-x-3">
          <input type="hidden" name="id" value={undo.id} />
          <input type="hidden" name="status" value="open" />
          <span role="status" className="text-ink-2">
            {undo.title}: {taskStatusLabel(undo.status).toLowerCase()}.
          </span>
          <Button variant="quiet" ariaLabel={`Undo: ${undo.title}`}>
            Undo
          </Button>
        </ActionForm>
      ) : null}
      {open.length === 0 ? (
        <Quiet>{empty}</Quiet>
      ) : (
        <ul className="border-line border-b">{open.map(row)}</ul>
      )}
      {settled.length > 0 ? (
        <details className="mt-6">
          <summary className="text-muted inline-flex min-h-11 cursor-pointer items-center font-mono text-[11.5px] tracking-[0.14em] uppercase">
            Done and dropped · {settled.length}
          </summary>
          <ul className="border-line border-b">{settled.map(row)}</ul>
        </details>
      ) : null}
    </>
  );
}
