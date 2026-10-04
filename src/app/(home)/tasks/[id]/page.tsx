import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/app/_forms/action-form';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import { NotFoundError } from '@/domain/common/errors';
import { listPeople } from '@/domain/people/service';
import { getProject, listProjects } from '@/domain/projects/service';
import { getTask } from '@/domain/tasks/service';
import { clockOf, isoDateInZone, longDate } from '@/lib/dates';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { Button } from '@/ui/button';
import { ItemRow, List } from '@/ui/list';
import { Label, Page, Quiet } from '@/ui/page';
import { PersonName, type PersonColour } from '@/ui/person-dot';
import {
  archiveTaskAction,
  restoreTaskAction,
  setTaskStatusAction,
  updateTaskAction,
} from '../actions';
import { estimateLabel, needLabel, taskStatusLabel } from '../copy';
import { existingTaskDefaults } from '../task-defaults';
import { TaskForm } from '../task-form';

export const dynamic = 'force-dynamic';

// A task (M3 contract §3.5): where it stands, with Done, Dropped and back
// to To do in one tap; what it's part of and who it's for (links); then the
// form to change it; Archive and Restore as every record.
export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ undo?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const { undo } = await searchParams;
  const task = await getTask(actor, id, { includeArchived: true }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [projects, people] = await Promise.all([listProjects(actor), listPeople(actor)]);
  // The task's own project is offered even when it is done or archived.
  const own =
    task.projectId && !projects.some((p) => p.id === task.projectId)
      ? await getProject(actor, task.projectId, { includeArchived: true }).catch(() => null)
      : null;
  const offered = own ? [...projects, own] : projects;
  const project = task.projectId ? offered.find((p) => p.id === task.projectId) : undefined;
  const person = (pid: string | null) => (pid ? people.find((p) => p.id === pid) : undefined);
  const assignee = person(task.assigneePersonId);
  const about = person(task.aboutPersonId);
  const archived = task.archivedAt !== null;
  const tz = env.HOME_TIMEZONE;
  const act = setTaskStatusAction.bind(null, `/tasks/${task.id}`);
  const statusButton = (status: string, label: string) => (
    <ActionForm action={act}>
      <input type="hidden" name="id" value={task.id} />
      <input type="hidden" name="status" value={status} />
      <Button variant={status === 'done' ? 'primary' : 'quiet'}>{label}</Button>
    </ActionForm>
  );

  return (
    <Page
      title={task.title}
      intro={
        <Quiet>
          {[
            taskStatusLabel(task.status),
            task.dueDate ? `due ${longDate(task.dueDate)}` : null,
            task.estimateMinutes ? estimateLabel(task.estimateMinutes) : null,
            archived ? 'archived' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Quiet>
      }
    >
      {archived ? null : (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {task.status === 'open' ? (
            <>
              {statusButton('done', 'Done')}
              {statusButton('dropped', 'Drop it')}
            </>
          ) : (
            <>
              {undo === task.id ? (
                <span role="status" className="text-ink-2">
                  {taskStatusLabel(task.status)}.
                </span>
              ) : null}
              {statusButton('open', undo === task.id ? 'Undo' : 'Back to To do')}
            </>
          )}
        </div>
      )}

      {task.notes ? (
        <>
          <Label>Notes</Label>
          <p className="whitespace-pre-wrap">{task.notes}</p>
        </>
      ) : null}

      {project || assignee || about || task.needs.length > 0 || task.scheduledStartsAt ? (
        <>
          <Label>Details</Label>
          <List>
            {project ? (
              <ItemRow
                href={`/home/projects/${project.id}`}
                title={project.title}
                detail="Part of"
              />
            ) : null}
            {assignee ? (
              <ItemRow
                href={`/people/${assignee.id}`}
                title={
                  <PersonName
                    name={assignee.name}
                    colour={assignee.colour as PersonColour | null}
                  />
                }
                detail="Doing it"
              />
            ) : null}
            {about ? (
              <ItemRow
                href={`/people/${about.id}`}
                title={
                  <PersonName name={about.name} colour={about.colour as PersonColour | null} />
                }
                detail="About"
              />
            ) : null}
            {task.needs.length > 0 ? (
              <ItemRow title={task.needs.map(needLabel).join(', ')} detail="Needs" />
            ) : null}
            {task.scheduledStartsAt && task.scheduledEndsAt ? (
              <ItemRow
                time={clockOf(task.scheduledStartsAt, tz)}
                title={`${longDate(isoDateInZone(task.scheduledStartsAt, tz))}, until ${clockOf(task.scheduledEndsAt, tz)}`}
                detail="A window to do it"
              />
            ) : null}
          </List>
        </>
      ) : null}

      {archived ? null : (
        <>
          <Label>Change it</Label>
          <TaskForm
            action={updateTaskAction.bind(null, task.id)}
            task={task}
            projects={offered.map((p) => ({ id: p.id, name: p.title }))}
            people={people.map((p) => ({
              id: p.id,
              name: p.name,
              colour: p.colour as PersonColour | null,
            }))}
            defaults={existingTaskDefaults(task, tz)}
            submitLabel="Save"
          />
        </>
      )}

      <Label>This task</Label>
      {archived ? (
        <ConfirmAction
          action={restoreTaskAction}
          hidden={{ id: task.id }}
          label="Restore"
          question={`Bring ${task.title} back?`}
          confirmLabel="Restore"
          cancelLabel="Leave archived"
        />
      ) : (
        <ConfirmAction
          action={archiveTaskAction}
          hidden={{ id: task.id }}
          label="Archive"
          question={`Put ${task.title} away? Nothing is deleted; you can bring it back from Settings.`}
          confirmLabel="Archive"
        />
      )}
      <p className="mt-6">
        <Link href="/tasks" className="text-ink-2 underline underline-offset-4">
          To do
        </Link>
      </p>
    </Page>
  );
}
