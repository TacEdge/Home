import Link from 'next/link';
import { AgendaItemRow } from '@/app/_agenda/agenda-list';
import type { AgendaItem } from '@/domain/engines/agenda';
import type { Fact } from '@/domain/engines/day-facts';
import type { Conflict, ConflictOccurrence } from '@/domain/engines/conflicts';
import type { Insight } from '@/domain/engines/insights';
import { clockOf, isoDateInZone, longDate } from '@/lib/dates';
import { ItemRow, List } from '@/ui/list';
import { eventRow, refreshFailed, updated, when, type FactLookup } from './facts';

// Why HOME says an insight (M5 contract §4.4, ADR 0008 §33): its rule in
// one plain sentence, from the numbers the rule compared, then the records
// it stands on, in the rows Today uses everywhere. Facts are ids and dates
// from the reader's own records; anything that no longer resolves is left
// out, never invented. No wording comes from a model.

const of = <K extends Fact['kind']>(facts: readonly Fact[], kind: K) =>
  facts.filter((f): f is Extract<Fact, { kind: K }> => f.kind === kind);

export function InsightExplanation({ insight, lookup }: { insight: Insight; lookup: FactLookup }) {
  if (insight.conflict) return <ConflictExplanation conflict={insight.conflict} lookup={lookup} />;
  const { facts, basis } = insight;
  const events = of(facts, 'event')
    .map((f) => eventRow(f, lookup.days))
    .filter((i): i is AgendaItem => i !== null);
  const people = of(facts, 'person')
    .map((f) => lookup.people.get(f.id))
    .filter((p) => p !== undefined);
  const calendars = of(facts, 'calendar')
    .map((f) => lookup.calendars.get(f.id))
    .filter((c) => c !== undefined);
  const project = of(facts, 'project')
    .map((f) => ({ id: f.id, ...lookup.projects.get(f.id) }))
    .find((p) => p.title !== undefined);
  const tasks = of(facts, 'task')
    .map((f) => lookup.tasks.get(f.id))
    .filter((t) => t !== undefined);

  let rule: string;
  switch (insight.rule) {
    case 'busy_day.count':
      rule = `HOME mentions a day with ${basis.threshold} or more things on, besides the usual. These are the ${basis.count}:`;
      break;
    case 'busy_day.late':
      rule = `Each of ${people.map((p) => p.name).join(' and ')} has something on that ends after 6:`;
      break;
    case 'preparation.birthday':
      rule = `${people[0] ? `${people[0].name}’s` : 'Their'} birthday is recorded as ${longDate(String(basis.date)).replace(/^\w+ /, '')}.`;
      break;
    case 'preparation.project_target':
      rule = `${project?.title ?? 'This project'} has a target date of ${longDate(String(basis.targetDate))}, and these tasks are open:`;
      break;
    case 'data_health.stale':
      rule =
        'HOME mentions a calendar when it hasn’t updated for more than a day. What HOME shows from it may be out of date.';
      break;
    case 'data_health.failed':
      rule =
        'The last time HOME checked this calendar, it couldn’t read it. What HOME shows from it may be out of date.';
      break;
    default:
      rule = '';
  }

  return (
    <div className="mt-1 mb-2 text-[15px]">
      <p className="text-ink-2">{rule}</p>
      {events.length > 0 ? (
        <List label="Events">
          {events.map((item, i) => (
            <AgendaItemRow key={i} item={item} timeZone={lookup.timeZone} people={lookup.people} />
          ))}
        </List>
      ) : null}
      {insight.rule === 'preparation.birthday' && people[0] ? (
        <p className="mt-1">
          <Link
            href={`/people/${people[0].id}`}
            className="text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4"
          >
            {people[0].name} ›
          </Link>
        </p>
      ) : null}
      {project?.title ? (
        <List label="Project and open tasks">
          <ItemRow href={`/home/projects/${project.id}`} title={project.title} detail="Project" />
          {tasks.map((t) => (
            <ItemRow key={t.id} href={`/tasks/${t.id}`} title={t.title} detail="Open task" />
          ))}
        </List>
      ) : null}
      {calendars.length > 0 ? (
        <List label="Calendars">
          {calendars.map((c) => (
            <ItemRow
              key={c.id}
              href={`/settings/calendars/${c.id}`}
              title={c.name}
              detail={
                refreshFailed(c) && c.lastAttemptAt
                  ? `Last checked ${when(c.lastAttemptAt, lookup.timeZone)}; ${updated(c, lookup.timeZone).replace(/^the last refresh didn’t work; /, '')}`
                  : updated(c, lookup.timeZone).replace(/^l/, 'L')
              }
            />
          ))}
        </List>
      ) : null}
    </div>
  );
}

/**
 * Why a conflict is said (ADR 0009 §14): the rule in one plain sentence, the
 * two commitments as recorded, each with its own times (so two with the same
 * title are told apart) and the person's recorded role, and the overlap. For
 * a standing conflict, that both repeat and when the next one is. Never a
 * place, travel, a reason, availability or what anyone should do. Every word
 * is the reader's own records, from the conflict engine's facts.
 */
function ConflictExplanation({ conflict, lookup }: { conflict: Conflict; lookup: FactLookup }) {
  const zone = lookup.timeZone;
  const name = conflict.person.name;
  const from = clockOf(conflict.overlap.from, zone);
  const to = clockOf(conflict.overlap.to, zone);
  const lead =
    conflict.rule === 'conflict.responsible'
      ? `${name} is recorded as responsible for both of these, and their times overlap from ${from} to ${to}.`
      : `${name} is recorded on both of these, and their times overlap from ${from} to ${to}.`;
  const span = (o: ConflictOccurrence) => {
    const start = isoDateInZone(o.startsAt, zone);
    const end = isoDateInZone(o.endsAt, zone);
    return end === start
      ? `${longDate(start)}, ${clockOf(o.startsAt, zone)}–${clockOf(o.endsAt, zone)}`
      : `${longDate(start)}, ${clockOf(o.startsAt, zone)} to ${longDate(end)}, ${clockOf(o.endsAt, zone)}`;
  };
  return (
    <div className="mt-1 mb-2 text-[15px]">
      <p className="text-ink-2">{lead}</p>
      {conflict.identity === 'standing' ? (
        <p className="text-ink-2 mt-1">
          Both repeat, and they overlap at this time each time. The next is{' '}
          {longDate(conflict.when)}.
        </p>
      ) : null}
      <List label="The two commitments">
        {conflict.occurrences.map((o) => (
          <ItemRow
            key={o.occurrence}
            href={`/events/${o.eventId}`}
            time={clockOf(o.startsAt, zone)}
            title={o.title}
            detail={`${span(o)} · ${name} ${o.role === 'responsible' ? 'responsible' : 'attending'}`}
          />
        ))}
      </List>
    </div>
  );
}
