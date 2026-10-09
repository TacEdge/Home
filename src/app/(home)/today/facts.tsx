import { AgendaItemRow } from '@/app/_agenda/agenda-list';
import type { CalendarView } from '@/domain/calendar/service';
import type { AgendaDay, AgendaItem } from '@/domain/engines/agenda';
import type { Fact } from '@/domain/engines/day-facts';
import type { Person } from '@/domain/people/service';
import type { Task } from '@/domain/tasks/service';
import { clockOf, isoDateInZone, longDate, type IsoDate } from '@/lib/dates';
import { List } from '@/ui/list';
import { Disclosure } from './disclosure';

// A statement's facts, in place (M5 contract §3.6, §4.4): the records the
// headline stands on, set out with the same rows Today uses everywhere, so
// anyone can see what a sentence was built from, without JavaScript. Facts
// are ids and dates; this turns them back into what the reader can already
// see. A fact that no longer resolves is left out, never invented.

export type FactLookup = {
  days: readonly AgendaDay[];
  people: Map<string, Person>;
  calendars: Map<string, CalendarView>;
  tasks: Map<string, Task>;
  timeZone: string;
};

const sameFact = (a: Fact, b: Fact) => JSON.stringify(a) === JSON.stringify(b);

function eventRow(
  f: Extract<Fact, { kind: 'event' }>,
  days: readonly AgendaDay[],
): AgendaItem | null {
  for (const d of days)
    for (const i of d.items)
      if (i.kind === 'event' && i.eventId === f.id && i.occurrenceDate === f.occurrenceDate)
        return i;
  return null;
}

/** "last updated Tuesday 13 October, 09:05", in the home zone. */
function updated(c: CalendarView, timeZone: string): string {
  if (c.lastSyncedAt === null) return 'not updated yet';
  const day: IsoDate = isoDateInZone(c.lastSyncedAt, timeZone);
  return `last updated ${longDate(day)}, ${clockOf(c.lastSyncedAt, timeZone)}`;
}

export function FactsInPlace({
  facts,
  lookup,
  label = 'What this is based on',
}: {
  facts: readonly Fact[];
  lookup: FactLookup;
  label?: string;
}) {
  const unique = facts.filter((f, i) => facts.findIndex((g) => sameFact(f, g)) === i);
  const events = unique
    .filter((f): f is Extract<Fact, { kind: 'event' }> => f.kind === 'event')
    .map((f) => eventRow(f, lookup.days))
    .filter((i): i is AgendaItem => i !== null);
  const calendars = unique
    .filter((f): f is Extract<Fact, { kind: 'calendar' }> => f.kind === 'calendar')
    .map((f) => lookup.calendars.get(f.id))
    .filter((c): c is CalendarView => c !== undefined);
  const range = unique.find((f): f is Extract<Fact, { kind: 'range' }> => f.kind === 'range');
  if (events.length === 0 && calendars.length === 0 && !range) return null;

  return (
    <Disclosure label={label}>
      {range && events.length === 0 ? (
        <p className="text-ink-2 mt-2 text-[15px]">
          HOME has nothing recorded for {longDate(range.from)}
          {calendars.length > 0 ? ', looking at:' : '.'}
        </p>
      ) : null}
      {events.length > 0 ? (
        <List label="Events counted">
          {events.map((item, i) => (
            <AgendaItemRow key={i} item={item} timeZone={lookup.timeZone} people={lookup.people} />
          ))}
        </List>
      ) : null}
      {calendars.length > 0 ? (
        <ul className="text-ink-2 mt-3 text-[15px]">
          {calendars.map((c) => (
            <li key={c.id}>
              {c.name} · {updated(c, lookup.timeZone)}
            </li>
          ))}
        </ul>
      ) : null}
    </Disclosure>
  );
}
