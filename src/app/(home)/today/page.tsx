import Link from 'next/link';
import { AgendaItemRow } from '@/app/_agenda/agenda-list';
import { loadAgenda, todayInHomeZone } from '@/app/_agenda/load';
import { listCaptures } from '@/domain/captures/service';
import { listPeople } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { listTasks, type Task } from '@/domain/tasks/service';
import { env, realDataGateOpen } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { ItemRow, List } from '@/ui/list';
import { EmptyState, Label, Page, Quiet } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';
import { toSortLine } from '../sort/copy';
import { dueLabel, todayHeadline } from './copy';

export const dynamic = 'force-dynamic';

// Today, factual (M3 contract §3.2, ADR 0006 §59): the date as the headline;
// today's events from the same agenda loader and engine Forward uses,
// all-day first then by start; open tasks due today or earlier, overdue
// ones in words ("from Tuesday"); "Two things to sort ›" only when
// something waits; "Which one is you? ›" only for an unlinked adult while
// the gate allows linking. No meaning, no insights, no weather: that is
// M5. A quiet day (nothing on, nothing due) says so and nothing more;
// captures waiting don't make a day busy.
export default async function TodayPage() {
  const actor = await requireActor();
  const today = todayInHomeZone();
  const [agenda, tasks, projects, captures, people] = await Promise.all([
    loadAgenda(actor, today, 1),
    listTasks(actor, { status: 'open' }),
    listProjects(actor),
    listCaptures(actor),
    realDataGateOpen() ? listPeople(actor) : Promise.resolve(null),
  ]);
  // Tasks are listed below in their own words; the agenda's due-today rows
  // would say the same thing twice.
  const items = (agenda.days[0]?.items ?? []).filter((i) => i.kind !== 'task_due');
  const due = tasks
    .filter((t): t is Task & { dueDate: string } => t.dueDate !== null && t.dueDate <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
  const byProject = new Map(projects.map((p) => [p.id, p.title]));
  const toSort = toSortLine(
    captures.filter((c) => c.status === 'new' || c.status === 'proposed').length,
  );
  const linked = people === null || people.some((p) => p.userId === actor.userId);
  const quiet = items.length === 0 && due.length === 0;

  return (
    <Page title={todayHeadline(today)}>
      {quiet ? (
        <EmptyState title="Nothing on today.">
          <ForwardLink />
        </EmptyState>
      ) : null}

      {items.length > 0 ? (
        <section aria-labelledby="today-on">
          <Label id="today-on">On today</Label>
          <List>
            {items.map((item, i) => (
              <AgendaItemRow
                key={i}
                item={item}
                timeZone={env.HOME_TIMEZONE}
                people={agenda.people}
              />
            ))}
          </List>
        </section>
      ) : null}

      {due.length > 0 ? (
        <section aria-labelledby="today-todo">
          <Label id="today-todo">To do</Label>
          <List>
            {due.map((t) => {
              const who = t.assigneePersonId ? agenda.people.get(t.assigneePersonId) : undefined;
              const project = t.projectId ? byProject.get(t.projectId) : undefined;
              return (
                <ItemRow
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  title={t.title}
                  detail={[dueLabel(t.dueDate, today), project].filter(Boolean).join(' · ')}
                  who={
                    who
                      ? [{ name: who.name, colour: who.colour as PersonColour | null }]
                      : undefined
                  }
                />
              );
            })}
          </List>
        </section>
      ) : null}

      {toSort ? (
        <p className="mt-8">
          <Link
            href="/sort"
            className="text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4"
          >
            {toSort} ›
          </Link>
        </p>
      ) : null}
      {linked ? null : (
        <p className="mt-6">
          <Link
            href="/settings/you"
            className="text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Which one is you? ›
          </Link>
        </p>
      )}
      {quiet ? null : (
        <div className="mt-8">
          <Quiet>
            <ForwardLink />
          </Quiet>
        </div>
      )}
    </Page>
  );
}

/** The one way Today points at Forward, quiet day or busy: the same words, a tappable height. */
function ForwardLink() {
  return (
    <Link
      href="/forward"
      className="inline-flex min-h-11 items-center underline underline-offset-4"
    >
      The next 30 days ›
    </Link>
  );
}
