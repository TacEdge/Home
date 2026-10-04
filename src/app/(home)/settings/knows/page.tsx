import Link from 'next/link';
import { todayInHomeZone } from '@/app/_agenda/load';
import { listContext } from '@/domain/context/service';
import { listPeople } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { Label, Page, Quiet } from '@/ui/page';
import { createContextAction } from './actions';
import { ContextForm } from './context-form';
import { stalenessLine } from './copy';
import { groupContext } from './group';
import { KnownItem } from './known-item';
import { SensitiveReveal } from './sensitive-reveal';

export const dynamic = 'force-dynamic';

// What Kev knows (M3 contract §3.9): the context the signed-in adult can
// see, grouped by subject, possibly out-of-date items first with a gentle
// "still true?", retired items folded away; Confirm, Retire, Reinstate,
// Change and Archive in place; something new at the foot. Sensitive items
// appear only after "Show sensitive items", for that response alone.
export default async function KnowsPage() {
  const actor = await requireActor();
  const today = todayInHomeZone();
  const tz = env.HOME_TIMEZONE;
  const [active, retired, people, projects] = await Promise.all([
    listContext(actor),
    listContext(actor, { status: 'retired' }),
    listPeople(actor),
    listProjects(actor),
  ]);
  const groups = groupContext([...active, ...retired], { people, projects }, today, tz);
  const subjectNames = Object.fromEntries([
    ...people.map((p) => [`person:${p.id}`, p.name]),
    ...projects.map((p) => [`project:${p.id}`, p.title]),
  ]);
  const stale = groups.reduce(
    (n, g) => n + g.active.filter((i) => i.staleness.possiblyStale).length,
    0,
  );

  return (
    <Page
      title="What Kev knows"
      intro={
        <Quiet>
          Things to know about the household, dated, in your words. Nothing here is a record of
          anyone; it can go out of date, and you can say when it has.
          {stale > 0
            ? ` ${stale === 1 ? 'One thing' : `${stale} things`} might be out of date.`
            : ''}
        </Quiet>
      }
    >
      {groups.length === 0 ? (
        <div className="mt-6">
          <Quiet>Nothing noted yet.</Quiet>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`knows-${g.key}`}>
            <Label id={`knows-${g.key}`}>
              {g.href ? (
                <Link href={g.href} className="underline-offset-4 hover:underline">
                  {g.title}
                </Link>
              ) : (
                g.title
              )}
            </Label>
            {g.active.length === 0 ? <Quiet>Nothing current.</Quiet> : null}
            {g.active.length > 0 ? (
              <ul className="border-line border-b">
                {g.active.map((i) => (
                  <KnownItem
                    key={i.row.id}
                    item={i.row}
                    staleLine={stalenessLine(i.staleness)}
                    timeZone={tz}
                  />
                ))}
              </ul>
            ) : null}
            {g.retired.length > 0 ? (
              <details className="mt-3">
                <summary className="text-muted inline-flex min-h-11 cursor-pointer items-center font-mono text-[11.5px] tracking-[0.14em] uppercase">
                  No longer true · {g.retired.length}
                </summary>
                <ul className="border-line border-b">
                  {g.retired.map((r) => (
                    <KnownItem key={r.id} item={r} staleLine={null} timeZone={tz} />
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ))
      )}

      <SensitiveReveal subjectNames={subjectNames} timeZone={tz} />

      <Label>Add something to know</Label>
      <ContextForm
        action={createContextAction}
        idPrefix="new-context"
        subjects={[
          ...people.map((p) => ({ value: `person:${p.id}`, label: p.name })),
          ...projects.map((p) => ({ value: `project:${p.id}`, label: `Project: ${p.title}` })),
        ]}
        submitLabel="Keep it"
      />
    </Page>
  );
}
