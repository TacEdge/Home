import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import { NotFoundError } from '@/domain/common/errors';
import type { ContextCategory } from '@/domain/context/schema';
import { listContext } from '@/domain/context/service';
import { forPerson } from '@/domain/engines/agenda';
import { ageOn } from '@/domain/engines/profile';
import { listNotes } from '@/domain/notes/service';
import { getPerson } from '@/domain/people/service';
import { AgendaDays } from '@/app/_agenda/agenda-list';
import { loadAgenda, todayInHomeZone } from '@/app/_agenda/load';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { ItemRow, List } from '@/ui/list';
import { Label, Page, Quiet } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';
import { PersonName } from '@/ui/person-dot';
import { archivePersonAction, restorePersonAction } from '../actions';
import { ageLabel, CONTEXT_CATEGORY_LABEL, roleLabel } from '../copy';

// A person's profile (M3 contract §3.4, FAMILY-DATA-MODEL §3): lightweight
// context, never a development record. Age and next birthday come from the
// profile engine; things to know are normal context about them (sensitive
// never appears here: the default read leaves it out); coming up is the
// what is coming up for them in the next 30 days (the agenda engine, as
// Forward uses it). Archived people are shown,
// with Restore.
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const person = await getPerson(actor, id, { includeArchived: true }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [things, notes] = await Promise.all([
    listContext(actor, { subject: { type: 'person', id: person.id } }),
    listNotes(actor, { subject: { type: 'person', id: person.id } }),
  ]);
  const today = todayInHomeZone();
  const age = ageOn(person.dateOfBirth, today);
  // Coming up: the same agenda engine as Forward, for this person (§3.4).
  const loaded = await loadAgenda(actor, today, 30);
  const coming = forPerson(loaded.days, person.id);
  const you = person.userId === actor.userId;
  const linked = person.userId !== null;
  const archived = person.archivedAt !== null;

  return (
    <Page
      title={
        <>
          <PersonName name={person.name} colour={person.colour as PersonColour | null} />
          {you ? <span className="text-muted"> · you</span> : null}
        </>
      }
      intro={
        <Quiet>
          {[
            person.relationship ?? roleLabel(person.role),
            person.inHousehold ? null : 'lives elsewhere',
            age !== null ? ageLabel(age) : null,
            archived ? 'archived' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Quiet>
      }
    >
      {person.stageNote ? (
        <>
          <Label>Right now</Label>
          <p className="whitespace-pre-wrap">{person.stageNote}</p>
        </>
      ) : null}

      <Label>Things to know</Label>
      {things.length === 0 ? (
        <Quiet>Nothing noted yet.</Quiet>
      ) : (
        <List>
          {things.map((c) => (
            <ItemRow
              key={c.id}
              title={c.content}
              detail={CONTEXT_CATEGORY_LABEL[c.category as ContextCategory] ?? undefined}
            />
          ))}
        </List>
      )}

      <Label>Coming up</Label>
      {coming.length === 0 ? (
        <Quiet>Nothing in the next 30 days.</Quiet>
      ) : (
        <AgendaDays
          days={coming}
          today={today}
          timeZone={env.HOME_TIMEZONE}
          people={loaded.people}
        />
      )}

      <Label>Notes</Label>
      {notes.length === 0 ? (
        <Quiet>No notes yet.</Quiet>
      ) : (
        <List>
          {notes.map((n) => (
            <ItemRow key={n.id} title={<span className="whitespace-pre-wrap">{n.body}</span>} />
          ))}
        </List>
      )}

      <Label>This record</Label>
      {archived ? (
        <ConfirmAction
          action={restorePersonAction}
          hidden={{ id: person.id }}
          label="Restore"
          question={`Bring ${person.name} back?`}
          confirmLabel="Restore"
          cancelLabel="Leave archived"
        />
      ) : (
        <>
          <p>
            <Link
              href={`/people/${person.id}/edit`}
              className="text-ink-2 underline underline-offset-4"
            >
              Edit
            </Link>
          </p>
          {linked ? (
            <Quiet>
              {you ? 'This is your own record' : 'This is someone’s own record'}, so it stays while
              they can sign in. Change who you are under Settings › You.
            </Quiet>
          ) : (
            <ConfirmAction
              action={archivePersonAction}
              hidden={{ id: person.id }}
              label="Archive"
              question={`Put ${person.name} away for now? Nothing is deleted; you can bring them back from Settings.`}
              confirmLabel="Archive"
            />
          )}
        </>
      )}
    </Page>
  );
}
