import type { AgendaDay, AgendaItem } from '@/domain/engines/agenda';
import type { Person } from '@/domain/people/service';
import { addDays, longDate, wallClockOf, type IsoDate } from '@/lib/dates';
import { ItemRow, List } from '@/ui/list';
import { Label } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';

// Agenda days as HOME shows them everywhere (Forward, Coming up, later
// Today): a label per day, then item rows in the engine's order. Rows link
// to the places that exist; tasks and projects link once Package 6 builds
// theirs. Nothing here decides what is on a day: the engine did.

export function dayLabel(date: IsoDate, today: IsoDate): string {
  const name = longDate(date);
  if (date === today) return `Today · ${name}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${name}`;
  return name;
}

export function clock(instant: Date, timeZone: string): string {
  const w = wallClockOf(instant, timeZone);
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

function who(item: AgendaItem, people: Map<string, Person>) {
  if (item.kind !== 'event') return undefined;
  return item.people
    .map((p) => people.get(p.personId))
    .filter((p): p is Person => Boolean(p))
    .map((p) => ({ name: p.name, colour: p.colour as PersonColour | null }));
}

export function AgendaItemRow({
  item,
  timeZone,
  people,
}: {
  item: AgendaItem;
  timeZone: string;
  people: Map<string, Person>;
}) {
  switch (item.kind) {
    case 'event':
      return item.allDay ? (
        <ItemRow
          href={`/events/${item.eventId}`}
          time="All day"
          title={item.title}
          detail={item.days > 1 ? `Day ${item.day} of ${item.days}` : undefined}
          who={who(item, people)}
        />
      ) : (
        <ItemRow
          href={`/events/${item.eventId}`}
          time={clock(item.startsAt, timeZone)}
          title={item.title}
          detail={`until ${clock(item.endsAt, timeZone)}`}
          who={who(item, people)}
        />
      );
    case 'birthday':
      return (
        <ItemRow
          href={`/people/${item.personId}`}
          time="All day"
          title={`${item.name}’s birthday`}
          detail={`Turns ${item.age}`}
        />
      );
    case 'project_target':
      return <ItemRow time="All day" title={item.title} detail="Project target date" />;
    case 'task_due':
      return <ItemRow time="All day" title={item.title} detail="Due" />;
  }
}

export function AgendaDays({
  days,
  today,
  timeZone,
  people,
}: {
  days: AgendaDay[];
  today: IsoDate;
  timeZone: string;
  people: Map<string, Person>;
}) {
  return (
    <>
      {days.map((d) => (
        <section key={d.date} aria-labelledby={`day-${d.date}`}>
          <Label id={`day-${d.date}`}>{dayLabel(d.date, today)}</Label>
          <List>
            {d.items.map((item, i) => (
              <AgendaItemRow key={i} item={item} timeZone={timeZone} people={people} />
            ))}
          </List>
        </section>
      ))}
    </>
  );
}
