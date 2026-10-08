import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayInHomeZone } from '@/app/_agenda/load';
import { ActionForm } from '@/app/_forms/action-form';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import { NotesSection } from '@/app/_notes/notes-section';
import { getCalendar } from '@/domain/calendar/service';
import { NotFoundError } from '@/domain/common/errors';
import { expandEvent, readRRule, startDateOf } from '@/domain/engines/recurrence';
import {
  isOccurrenceChange,
  nextTimes,
  occurrenceIdentity,
  occurrenceOf,
  originalDateOf,
  overriddenOriginals,
  putAwayChanges,
  recurringWithOverrides,
  startOf,
  upcomingSkips,
  type NextTime,
} from '@/domain/events/occurrences';
import {
  getEvent,
  listEventPeople,
  listEvents,
  listOccurrenceChanges,
  type Event,
} from '@/domain/events/service';
import { effectivePeople, occurrenceChangePeople } from '@/domain/events/who';
import { listNotes } from '@/domain/notes/service';
import { listPeople } from '@/domain/people/service';
import { addDays, clockOf as clock, longDate } from '@/lib/dates';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { Button } from '@/ui/button';
import { ItemRow, List } from '@/ui/list';
import { Label, Page, Quiet } from '@/ui/page';
import { PersonName, type PersonColour } from '@/ui/person-dot';
import {
  archiveEventAction,
  putBackOccurrenceAction,
  restoreEventAction,
  returnToSeriesAction,
  skipOccurrenceAction,
} from '../actions';
import {
  backToSeriesQuestion,
  changedFromUsual,
  KIND_LABEL,
  occurrenceWhen,
  ownedElsewhereLine,
  repeatLabel,
  REPEATS_AS_IN_CALENDAR,
  sourceLine,
  usuallyLine,
  whenLabel,
} from '../copy';

export const dynamic = 'force-dynamic';

const UPCOMING_DAYS = 56;
const UPCOMING_MAX = 6;

const link = 'text-ink-2 inline-flex min-h-11 min-w-11 items-center underline underline-offset-4';

// An event (M3 contract §3.6): when, how it repeats, who, where; the next
// few times it happens, each with "Change this one" and "Skip this one"
// (M4 contract §5.3); upcoming skipped dates with "Put back"; one-off
// changes that were put away; Edit, Archive and Restore. A synced event (M4
// contract §5.2) is the same page with one quiet line saying which calendar
// it comes from and how fresh that is; its details are the calendar's to
// change, while who is going and the notes stay HOME's. One changed time of
// a series is the same page too: it says which series it is one time of and
// what the usual is, with "Change this one again" and "Back to the series";
// put away (on its own, or with its series) it says so, calmly. Nothing here
// names a provider, an address, an id, an override or a status code.
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const event = await getEvent(actor, id, { includeArchived: true }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const synced = event.source !== 'manual';
  const change = isOccurrenceChange(event);
  const manualSeries = !synced && !change && event.rrule !== null;
  const [annotations, people, notes, calendar, siblings, changes, series] = await Promise.all([
    listEventPeople(actor, event.id, { includeArchived: true }),
    listPeople(actor),
    listNotes(actor, { subject: { type: 'event', id: event.id }, includeArchived: true }),
    // The calendar as this adult may see it: its HOME name and freshness, nothing of its connection.
    synced && event.calendarSourceId
      ? getCalendar(actor, event.calendarSourceId, { includeArchived: true }).catch(() => null)
      : Promise.resolve(null),
    // A synced series' live overrides, so its next few times skip what they replace.
    synced && event.rrule ? listEvents(actor) : Promise.resolve([]),
    // A manual series' own one-off changes, live and put away.
    manualSeries ? listOccurrenceChanges(actor, event.id) : Promise.resolve([] as Event[]),
    // The series one changed time belongs to, as this adult may read it.
    change && event.recurrenceParentId
      ? getEvent(actor, event.recurrenceParentId, { includeArchived: true }).catch((e: unknown) => {
          if (e instanceof NotFoundError) return null;
          throw e;
        })
      : Promise.resolve(null),
  ]);
  const seriesAnnotations =
    change && series ? await listEventPeople(actor, series.id, { includeArchived: true }) : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const visible = new Set(people.map((p) => p.id));
  const refs = (rows: typeof annotations) =>
    rows.map((a) => ({ personId: a.personId, role: a.role as 'attending' | 'responsible' }));
  const who = change
    ? occurrenceChangePeople(refs(annotations), refs(seriesAnnotations), visible)
    : effectivePeople(refs(annotations), calendar?.defaultPersonIds, visible);
  const names = (role: string) =>
    who.people
      .filter((a) => a.role === role)
      .map((a) => byId.get(a.personId))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const start = startOf(event);
  const recurrence = readRRule(event.rrule, start);
  const repeats =
    synced && recurrence.preset === 'custom'
      ? REPEATS_AS_IN_CALENDAR
      : repeatLabel(recurrence, startDateOf(start));
  const archived = event.archivedAt !== null;
  // A changed time is put away with its series (ADR 0007 §46): nothing of its own to do.
  const seriesGone = change && (!series || series.archivedAt !== null);
  const usual = change && series ? occurrenceOf(series, event.recurrenceOriginal!) : null;
  const editable = !archived && !synced && !change;
  const today = todayInHomeZone();
  const to = addDays(today, UPCOMING_DAYS - 1);
  // The next few times: a manual series with its one-off changes in place
  // of what they replace (nextTimes); a synced series with its calendar's
  // overrides skipped (Package 6). Both are the domain's composition.
  const times: NextTime[] = !event.rrule
    ? []
    : manualSeries
      ? nextTimes(event, changes, today, to, env.HOME_TIMEZONE)
      : expandEvent(
          recurringWithOverrides(event, overriddenOriginals([event, ...siblings])),
          today,
          to,
        ).map((o) => ({ kind: 'regular', occurrence: o, identity: occurrenceIdentity(o) }));
  const upcoming = times.slice(0, UPCOMING_MAX);
  // Skipped dates still ahead that the rule would put it on: a past skip,
  // or one the rule no longer reaches, is not something to put back.
  const skipped = editable ? upcomingSkips(event, today) : [];
  const putAway = manualSeries ? putAwayChanges(event, changes, today) : [];
  const going = names('attending');
  const responsible = names('responsible');
  const now = new Date();
  const readOnly = archived || seriesGone;

  return (
    <Page
      title={event.title}
      intro={
        <Quiet>
          {[
            whenLabel(event),
            repeats,
            KIND_LABEL[event.kind] ?? event.kind,
            change && (archived || seriesGone) ? 'put away' : archived ? 'archived' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Quiet>
      }
    >
      {synced ? (
        <div className="mt-4">
          <Quiet>
            {calendar ? sourceLine(calendar, now, env.HOME_TIMEZONE) : 'From a calendar'}
          </Quiet>
        </div>
      ) : null}
      {change ? (
        <div className="mt-4">
          <Quiet>
            {series ? changedFromUsual(series.title) : 'One time of a repeating event.'}
            {usual ? ` ${usuallyLine(usual)}` : ''}
          </Quiet>
          {series ? (
            <p className="mt-1">
              <Link href={`/events/${series.id}`} className={link}>
                Every time it happens ›
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
      {event.location ? (
        <>
          <Label>Where</Label>
          <p>{event.location}</p>
        </>
      ) : null}
      {event.description ? (
        <>
          <Label>Details</Label>
          <p className="whitespace-pre-wrap">{event.description}</p>
        </>
      ) : null}

      {going.length > 0 || responsible.length > 0 || ((synced || change) && !readOnly) ? (
        <>
          <Label>Who</Label>
          {going.length > 0 || responsible.length > 0 ? null : (
            <Quiet>Nobody in particular yet.</Quiet>
          )}
          <List>
            {going.map((p) => (
              <ItemRow
                key={`a-${p.id}`}
                href={`/people/${p.id}`}
                title={<PersonName name={p.name} colour={p.colour as PersonColour | null} />}
                detail={who.derived ? 'Usually going' : 'Going'}
              />
            ))}
            {responsible.map((p) => (
              <ItemRow
                key={`r-${p.id}`}
                href={`/people/${p.id}`}
                title={<PersonName name={p.name} colour={p.colour as PersonColour | null} />}
                detail={who.derived ? 'Usually responsible' : 'Responsible'}
              />
            ))}
          </List>
          {(synced || change) && !readOnly ? (
            <p className="mt-3">
              <Link href={`/events/${event.id}/people`} className={link}>
                {change ? 'Change who’s going, for this one' : 'Change who’s going'}
              </Link>
            </p>
          ) : null}
        </>
      ) : null}

      {event.rrule ? (
        <>
          <Label>Next few times</Label>
          {upcoming.length === 0 ? (
            <Quiet>Nothing in the next eight weeks.</Quiet>
          ) : (
            <ul className="border-line border-b">
              {upcoming.map((t) => {
                const o = t.occurrence;
                const when = (
                  <>
                    {longDate(o.date)}
                    {o.allDay ? null : (
                      <span className="text-muted font-mono text-[14px]">
                        {' '}
                        · {clock(o.startsAt, o.timeZone)}
                      </span>
                    )}
                  </>
                );
                return t.kind === 'changed' ? (
                  <li
                    key={`changed-${t.change.id}`}
                    className="border-line flex min-h-11 flex-wrap items-center justify-between gap-3 border-t py-2"
                  >
                    <span>
                      <Link href={`/events/${t.change.id}`} className={link}>
                        {when}
                      </Link>
                      <span className="text-ink-2 block text-[14px]">
                        Changed from the usual
                        {t.change.title !== event.title ? ` · ${t.change.title}` : ''}
                      </span>
                    </span>
                    {editable ? (
                      <ActionForm action={returnToSeriesAction}>
                        <input type="hidden" name="id" value={t.change.id} />
                        <Button
                          variant="quiet"
                          ariaLabel={`Back to the series: ${longDate(o.date)}`}
                        >
                          Back to the series
                        </Button>
                      </ActionForm>
                    ) : null}
                  </li>
                ) : (
                  <li
                    key={`regular-${t.identity}`}
                    className="border-line flex min-h-11 flex-wrap items-center justify-between gap-3 border-t py-2"
                  >
                    <span>{when}</span>
                    {editable ? (
                      <span className="flex flex-wrap items-center gap-3">
                        <Link
                          href={`/events/${event.id}/change/${encodeURIComponent(t.identity)}`}
                          aria-label={`Change this one: ${longDate(o.date)}`}
                          className={link}
                        >
                          Change this one
                        </Link>
                        <ActionForm action={skipOccurrenceAction}>
                          <input type="hidden" name="id" value={event.id} />
                          <input type="hidden" name="date" value={o.date} />
                          <Button variant="quiet" ariaLabel={`Skip ${longDate(o.date)}`}>
                            Skip this one
                          </Button>
                        </ActionForm>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {skipped.length > 0 ? (
            <>
              <Label>Skipped</Label>
              <ul className="border-line border-b">
                {skipped.map((d) => (
                  <li
                    key={d}
                    className="border-line flex min-h-11 flex-wrap items-center justify-between gap-3 border-t py-2"
                  >
                    <span className="text-ink-2">{longDate(d)}</span>
                    {editable ? (
                      <ActionForm action={putBackOccurrenceAction}>
                        <input type="hidden" name="id" value={event.id} />
                        <input type="hidden" name="date" value={d} />
                        <Button variant="quiet" ariaLabel={`Put back ${longDate(d)}`}>
                          Put back
                        </Button>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {putAway.length > 0 ? (
            <>
              <Label>Put away</Label>
              <List>
                {putAway.map((c) => (
                  <ItemRow
                    key={c.id}
                    href={`/events/${c.id}`}
                    title={longDate(originalDateOf(event, c))}
                    detail="A one-off change, put away"
                  />
                ))}
              </List>
            </>
          ) : null}
        </>
      ) : null}

      <NotesSection
        notes={notes}
        subject={{ type: 'event', id: event.id }}
        subjectVisibility={event.visibility}
        returnTo={`/events/${event.id}`}
        readOnly={readOnly}
      />

      <Label>{change ? 'This one time' : 'This event'}</Label>
      {synced ? (
        <Quiet>
          {calendar
            ? ownedElsewhereLine(calendar.name)
            : 'This comes from a calendar, so change those details there.'}
        </Quiet>
      ) : change ? (
        seriesGone ? (
          <Quiet>
            {series
              ? `${series.title} is archived, so this one-off change is put away with it.`
              : 'The repeating event this belonged to is gone, so this one-off change is put away.'}
          </Quiet>
        ) : archived ? (
          <>
            <Quiet>
              This one-off change was put away. {series!.title} happens as usual that day.
            </Quiet>
            <ConfirmAction
              action={restoreEventAction}
              hidden={{ id: event.id }}
              label="Bring this change back"
              question={`Bring this one-off change back? ${series!.title}${usual ? ` on ${occurrenceWhen(usual)}` : ''} becomes ${whenLabel(event)} again.`}
              confirmLabel="Bring it back"
              cancelLabel="Leave it"
            />
          </>
        ) : (
          <>
            <p>
              <Link href={`/events/${event.id}/edit`} className={link}>
                Change this one again
              </Link>
            </p>
            <ConfirmAction
              action={returnToSeriesAction}
              hidden={{ id: event.id }}
              label="Back to the series"
              question={backToSeriesQuestion(series!.title, usual)}
              confirmLabel="Back to the series"
              cancelLabel="Keep the change"
            />
          </>
        )
      ) : archived ? (
        <ConfirmAction
          action={restoreEventAction}
          hidden={{ id: event.id }}
          label="Restore"
          question={`Bring ${event.title} back?`}
          confirmLabel="Restore"
          cancelLabel="Leave archived"
        />
      ) : (
        <>
          <p>
            <Link href={`/events/${event.id}/edit`} className={link}>
              Edit
            </Link>
          </p>
          {event.rrule ? (
            <Quiet>Edit changes every time this happens; one time at a time is above.</Quiet>
          ) : null}
          <ConfirmAction
            action={archiveEventAction}
            hidden={{ id: event.id }}
            label="Archive"
            question={`Put ${event.title} away? Nothing is deleted; you can bring it back from Settings.`}
            confirmLabel="Archive"
          />
        </>
      )}
    </Page>
  );
}
