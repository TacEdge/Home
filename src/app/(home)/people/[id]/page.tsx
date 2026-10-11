import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import { NotesSection } from '@/app/_notes/notes-section';
import { NotFoundError } from '@/domain/common/errors';
import type { ContextCategory } from '@/domain/context/schema';
import { listContext } from '@/domain/context/service';
import { forPerson } from '@/domain/engines/agenda';
import { occurrenceKey } from '@/domain/engines/day-facts';
import { conflictMarks } from '@/domain/engines/insights';
import { placement } from '@/domain/engines/today';
import { ageOn, regularWeek } from '@/domain/engines/profile';
import { personInsights } from '@/domain/insights/person';
import { listNotes } from '@/domain/notes/service';
import { getPerson } from '@/domain/people/service';
import { AgendaDays } from '@/app/_agenda/agenda-list';
import { RegularWeek } from '@/app/_profile/regular-week';
import { loadAgenda } from '@/app/_agenda/load';
import { requestNow } from '@/app/_agenda/now';
import { ConflictMarks } from '@/app/_insights/conflict-marks';
import type { FactLookup } from '@/app/_insights/facts';
import { RefreshOnUse } from '@/app/_calendar/refresh-on-use';
import { hasStaleCalendar } from '@/app/_calendar/stale';
import { isoDateInZone } from '@/lib/dates';
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
// Forward uses it); "Usually" is their regular week (M4 contract §3.6),
// shown only when they have one; conflicts are marked on their items in
// Coming up (M6 Package 4, contract §4.6); notes about them are written here (§3.7).
// Archived people are shown, with Restore.
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const person = await getPerson(actor, id, { includeArchived: true }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [things, notes] = await Promise.all([
    listContext(actor, { subject: { type: 'person', id: person.id } }),
    listNotes(actor, { subject: { type: 'person', id: person.id }, includeArchived: true }),
  ]);
  // Today as the test time source sees it, like Today and Forward.
  const now = await requestNow();
  const timeZone = env.HOME_TIMEZONE;
  const today = isoDateInZone(now, timeZone);
  const age = ageOn(person.dateOfBirth, today);
  // Coming up: the same agenda engine as Forward, for this person (§3.4).
  const [loaded, stale] = await Promise.all([
    loadAgenda(actor, today, 30, today),
    hasStaleCalendar(actor),
  ]);
  const coming = forPerson(loaded.days, person.id);
  // Conflicts of theirs, said on the items shown here (one more query).
  const records = {
    events: loaded.events,
    people: [...loaded.people.values()],
    records: loaded.records,
  };
  const placed = new Set(
    coming
      .flatMap((d) => d.items)
      .filter((i) => i.kind === 'event')
      .map((i) => placement(person.id, occurrenceKey(i))),
  );
  const worth = await personInsights(actor, records, loaded.days, now, timeZone, person.id, placed);
  const marks = conflictMarks(worth, worth.responded, placed, timeZone);
  const lookup: FactLookup = {
    days: loaded.days,
    people: loaded.people,
    calendars: new Map(loaded.records.calendars.map((c) => [c.id, c])),
    tasks: new Map(loaded.records.tasks.map((t) => [t.id, t])),
    projects: new Map(
      loaded.records.projects.map((p) => [p.id, { title: p.title, targetDate: p.targetDate }]),
    ),
    timeZone,
  };
  // Usually: their weekly and fortnightly series, from the events the agenda
  // just read as this adult (M4 contract §3.6); derived, never stored.
  const usually = regularWeek(loaded.events, person.id, {
    today,
    timeZone: env.HOME_TIMEZONE,
  });
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
      {stale ? <RefreshOnUse /> : null}
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

      <RegularWeek entries={usually} />

      <Label>Coming up</Label>
      {coming.length === 0 ? (
        <Quiet>Nothing in the next 30 days.</Quiet>
      ) : (
        <AgendaDays
          days={coming}
          today={today}
          timeZone={env.HOME_TIMEZONE}
          people={loaded.people}
          after={(item) =>
            item.kind === 'event' ? (
              <ConflictMarks
                marks={marks.get(placement(person.id, occurrenceKey(item)))}
                lookup={lookup}
                surface="person"
                returnTo={`/people/${person.id}`}
              />
            ) : null
          }
        />
      )}

      <NotesSection
        notes={notes}
        subject={{ type: 'person', id: person.id }}
        subjectVisibility={person.visibility}
        returnTo={`/people/${person.id}`}
        readOnly={archived}
      />

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
              className="text-ink-2 inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
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
