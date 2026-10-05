import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import { NotesSection } from '@/app/_notes/notes-section';
import { NotFoundError } from '@/domain/common/errors';
import { listNotes } from '@/domain/notes/service';
import { listPeople } from '@/domain/people/service';
import { getProject } from '@/domain/projects/service';
import { getTask, listTasks } from '@/domain/tasks/service';
import { longDate } from '@/lib/dates';
import { requireActor } from '@/trust/session';
import { Label, Page, Quiet } from '@/ui/page';
import { TaskList } from '../../../tasks/task-list';
import { archiveProjectAction, restoreProjectAction } from '../../actions';
import { projectStatusLabel } from '../../copy';

export const dynamic = 'force-dynamic';

// A project (M3 contract §3.5): its line, where it's at and the date it
// aims for; its tasks (open first, done and dropped folded away); its
// notes, written and edited here. Done on a task here returns here, with
// Undo. Edit, Archive and Restore as every record.
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ undo?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const { undo } = await searchParams;
  const project = await getProject(actor, id, { includeArchived: true }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [tasks, notes, people] = await Promise.all([
    listTasks(actor, { projectId: project.id }),
    listNotes(actor, { subject: { type: 'project', id: project.id }, includeArchived: true }),
    listPeople(actor),
  ]);
  const archived = project.archivedAt !== null;
  const justSettled = undo ? await getTask(actor, undo).catch(() => undefined) : undefined;

  return (
    <Page
      title={project.title}
      intro={
        <Quiet>
          {[
            projectStatusLabel(project.status),
            project.targetDate ? `aiming for ${longDate(project.targetDate)}` : null,
            archived ? 'archived' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Quiet>
      }
    >
      {project.summary ? <p className="mt-4 whitespace-pre-wrap">{project.summary}</p> : null}

      <Label>Tasks</Label>
      <TaskList
        tasks={tasks}
        people={people}
        projects={[project]}
        showProject={false}
        returnTo={`/home/projects/${project.id}`}
        empty="Nothing to do on this yet."
        undo={
          justSettled && justSettled.status !== 'open' && justSettled.projectId === project.id
            ? justSettled
            : undefined
        }
      />
      {archived ? null : (
        <p className="mt-4">
          <Link
            href={`/tasks/new?project=${project.id}`}
            className="text-ink-2 inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
          >
            Add a task
          </Link>
        </p>
      )}

      <NotesSection
        notes={notes}
        subject={{ type: 'project', id: project.id }}
        subjectVisibility={project.visibility}
        returnTo={`/home/projects/${project.id}`}
        readOnly={archived}
      />

      <Label>This project</Label>
      {archived ? (
        <ConfirmAction
          action={restoreProjectAction}
          hidden={{ id: project.id }}
          label="Restore"
          question={`Bring ${project.title} back?`}
          confirmLabel="Restore"
          cancelLabel="Leave archived"
        />
      ) : (
        <>
          <p>
            <Link
              href={`/home/projects/${project.id}/edit`}
              className="text-ink-2 inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
            >
              Edit
            </Link>
          </p>
          <ConfirmAction
            action={archiveProjectAction}
            hidden={{ id: project.id }}
            label="Archive"
            question={`Put ${project.title} away? Nothing is deleted; you can bring it back from Settings.`}
            confirmLabel="Archive"
          />
        </>
      )}
    </Page>
  );
}
