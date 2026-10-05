import { ActionForm } from '@/app/_forms/action-form';
import { listCaptures } from '@/domain/captures/service';
import { listContext } from '@/domain/context/service';
import { listConversations } from '@/domain/conversations/service';
import { listEvents } from '@/domain/events/service';
import { listNotes } from '@/domain/notes/service';
import { listPeople } from '@/domain/people/service';
import { listProjects } from '@/domain/projects/service';
import { listTasks } from '@/domain/tasks/service';
import { isoDateInZone, longDate } from '@/lib/dates';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { Button } from '@/ui/button';
import { EmptyState, Label, Page, Quiet } from '@/ui/page';
import { restoreArchivedAction } from './actions';

export const dynamic = 'force-dynamic';

// Archived (M3 contract §3.10, ADR 0006 §8): what the signed-in adult has
// put away, of every kind, each with Restore; and their captures set aside
// as not needed, each with Back to To sort. Everything is read through the
// record's own service as the adult, so the other adult's private records
// are never here, and sensitive context stays out (a default read). Copy
// never says deleted: nothing here is.

type Row = { type: string; id: string; title: string; when: Date; private: boolean };
type Group = { key: string; label: string; action: string; rows: Row[] };

const snippet = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 90 ? `${one.slice(0, 89)}…` : one;
};

export default async function ArchivedPage() {
  const actor = await requireActor();
  const tz = env.HOME_TIMEZONE;
  const only = <T extends { archivedAt: Date | null }>(rows: T[]) =>
    rows.filter((r) => r.archivedAt !== null) as (T & { archivedAt: Date })[];
  const [people, events, projects, tasks, notes, context, retired, captures, dismissed, convs] =
    await Promise.all([
      listPeople(actor, { includeArchived: true }),
      listEvents(actor, { includeArchived: true }),
      listProjects(actor, { includeArchived: true }),
      listTasks(actor, { includeArchived: true }),
      listNotes(actor, { includeArchived: true }),
      listContext(actor, { includeArchived: true }),
      listContext(actor, { includeArchived: true, status: 'retired' }),
      listCaptures(actor, { includeArchived: true }),
      listCaptures(actor, { status: 'dismissed' }),
      listConversations(actor, { includeArchived: true }),
    ]);
  const row = (
    type: string,
    r: { id: string; archivedAt: Date; visibility?: string },
    title: string,
  ): Row => ({
    type,
    id: r.id,
    title,
    when: r.archivedAt,
    private: r.visibility === 'private',
  });
  const groups: Group[] = [
    {
      key: 'people',
      label: 'People',
      action: 'Restore',
      rows: only(people).map((p) => row('person', p, p.name)),
    },
    {
      key: 'events',
      label: 'Events',
      action: 'Restore',
      rows: only(events).map((e) => row('event', e, e.title)),
    },
    {
      key: 'projects',
      label: 'Projects',
      action: 'Restore',
      rows: only(projects).map((p) => row('project', p, p.title)),
    },
    {
      key: 'tasks',
      label: 'Tasks',
      action: 'Restore',
      rows: only(tasks).map((t) => row('task', t, t.title)),
    },
    {
      key: 'notes',
      label: 'Notes',
      action: 'Restore',
      rows: only(notes).map((n) => row('note', n, snippet(n.body))),
    },
    {
      key: 'knows',
      label: 'Things to know',
      action: 'Restore',
      rows: only([...context, ...retired]).map((c) => row('context', c, snippet(c.content))),
    },
    {
      key: 'set-aside',
      label: 'Set aside from To sort',
      action: 'Back to To sort',
      rows: dismissed
        .filter((c) => c.archivedAt === null)
        .map((c) => ({
          type: 'dismissed_capture',
          id: c.id,
          title: snippet(c.text),
          when: c.dismissedAt ?? c.createdAt,
          private: true,
        })),
    },
    {
      key: 'captures',
      label: 'Captures',
      action: 'Restore',
      rows: only(captures).map((c) => row('capture', c, snippet(c.text))),
    },
    {
      key: 'conversations',
      label: 'Conversations with Kev',
      action: 'Restore',
      rows: only(convs).map((c) => ({
        type: 'conversation',
        id: c.id,
        title: `A conversation from ${longDate(isoDateInZone(c.createdAt, tz))}`,
        when: c.archivedAt,
        private: true,
      })),
    },
  ].filter((g) => g.rows.length > 0);
  for (const g of groups) g.rows.sort((a, b) => b.when.getTime() - a.when.getTime());

  return (
    <Page title="Archived" intro="Put away, and kept as it was. Anything here can come back.">
      {groups.length === 0 ? (
        <EmptyState title="Nothing put away.">
          Archived records and captures set aside from To sort will wait here.
        </EmptyState>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`archived-${g.key}`}>
            <Label id={`archived-${g.key}`}>{g.label}</Label>
            <ul className="border-line border-b">
              {g.rows.map((r) => (
                <li
                  key={`${r.type}:${r.id}`}
                  data-id={r.id}
                  className="border-line flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{r.title}</span>
                    <span className="text-muted block text-[14px]">
                      {g.key === 'set-aside' ? 'set aside' : 'archived'}{' '}
                      {longDate(isoDateInZone(r.when, tz), 'short')}
                      {r.private &&
                      g.key !== 'set-aside' &&
                      g.key !== 'captures' &&
                      g.key !== 'conversations'
                        ? ' · just me'
                        : ''}
                    </span>
                  </span>
                  <ActionForm action={restoreArchivedAction}>
                    <input type="hidden" name="type" value={r.type} />
                    <input type="hidden" name="id" value={r.id} />
                    <Button variant="quiet" ariaLabel={`${g.action}: ${r.title.slice(0, 40)}`}>
                      {g.action}
                    </Button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {groups.length > 0 ? (
        <div className="mt-8">
          <Quiet>Nothing here is thrown away; it is only put away.</Quiet>
        </div>
      ) : null}
    </Page>
  );
}
