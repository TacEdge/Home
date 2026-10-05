import Link from 'next/link';
import { listProjects, type Project } from '@/domain/projects/service';
import { longDate } from '@/lib/dates';
import { requireActor } from '@/trust/session';
import { ItemRow, List } from '@/ui/list';
import { EmptyState, Label, Page } from '@/ui/page';
import { PROJECT_GROUPS } from './copy';

export const dynamic = 'force-dynamic';

// Home (M3 contract §3.5): home projects grouped by where they're at, done
// ones folded away. A row is the title, its line and the date it aims for.
export default async function HomePage() {
  const actor = await requireActor();
  const projects = await listProjects(actor);
  const done = projects.filter((p) => p.status === 'done');

  const row = (p: Project) => (
    <ItemRow
      key={p.id}
      href={`/home/projects/${p.id}`}
      title={p.title}
      time={p.targetDate ? longDate(p.targetDate, 'short') : undefined}
      detail={p.summary ?? undefined}
    />
  );

  return (
    <Page title="Home" intro="Projects around the house.">
      {projects.length === 0 ? (
        <EmptyState title="No projects yet.">
          <Link
            href="/home/projects/new"
            className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
          >
            Start one
          </Link>
        </EmptyState>
      ) : (
        <>
          {PROJECT_GROUPS.map(({ status, label }) => {
            const group = projects.filter((p) => p.status === status);
            return group.length === 0 ? null : (
              <section key={status} aria-labelledby={`projects-${status}`}>
                <Label id={`projects-${status}`}>{label}</Label>
                <List>{group.map(row)}</List>
              </section>
            );
          })}
          {done.length > 0 ? (
            <details className="mt-8">
              <summary className="text-muted inline-flex min-h-11 cursor-pointer items-center font-mono text-[11.5px] tracking-[0.14em] uppercase">
                Done · {done.length}
              </summary>
              <List label="Done projects">{done.map(row)}</List>
            </details>
          ) : null}
          <p className="mt-8">
            <Link
              href="/home/projects/new"
              className="text-ink-2 inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
            >
              Start a project
            </Link>
          </p>
        </>
      )}
    </Page>
  );
}
