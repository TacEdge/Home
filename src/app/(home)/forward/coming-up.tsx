import { timedRow, who } from '@/app/_agenda/agenda-list';
import { ConflictMarks } from '@/app/_insights/conflict-marks';
import { Disclosure } from '@/app/_insights/disclosure';
import type { FactLookup } from '@/app/_insights/facts';
import { occurrenceKey } from '@/domain/engines/day-facts';
import type { ConflictMark } from '@/domain/engines/insights';
import type { ForwardEntry, ForwardModel, Horizon } from '@/domain/engines/forward';
import { placement } from '@/domain/engines/today';
import { clockOf } from '@/lib/dates';
import { ItemRow, List } from '@/ui/list';
import { Label } from '@/ui/page';
import { dateColumn } from './copy';

// Coming up (M6 contract §4.1 item 4, §5.3, §5.4): the engine's units, each
// with its load as dots (ink, never the accent), the notable entries it chose
// to show, the rest under "+ N", or what is recorded in words when there is
// nothing. A row is the agenda's own row, with the day in the time column on
// Month and Season. Week says its conflicts on the rows. Nothing here ranks,
// counts or words anything of its own.

export type ComingUpProps = {
  model: Pick<ForwardModel, 'units' | 'horizon'>;
  lookup: FactLookup;
  marks: ReadonlyMap<string, readonly ConflictMark[]>;
  returnTo: string;
};

export function ComingUp({ model, lookup, marks, returnTo }: ComingUpProps) {
  const { horizon } = model;
  return (
    <section aria-labelledby="forward-coming">
      <Label id="forward-coming">Coming up</Label>
      <ul>
        {model.units.map((unit) => (
          <li key={unit.from} data-unit={unit.from} className="border-line border-t py-2">
            <h3 className="text-[15px] font-medium">
              {unit.label}
              {unit.load.band > 0 ? (
                // The dots are the load (§5.4), in ink, with their words for
                // a screen reader; with nothing recorded the words are the row.
                <>
                  <span aria-hidden="true" className="text-ink-2 ml-3 tracking-[0.2em]">
                    {'●'.repeat(unit.load.band)}
                  </span>
                  <span className="sr-only">{`, ${unit.load.text}`}</span>
                </>
              ) : null}
            </h3>
            {unit.notable.length === 0 ? (
              <p className="text-ink-2 text-[15px]">{unit.load.text}</p>
            ) : (
              <>
                <List>
                  {unit.shown.map((e) => (
                    <ForwardRow
                      key={e.key}
                      entry={e}
                      horizon={horizon}
                      lookup={lookup}
                      marks={marks}
                      returnTo={returnTo}
                    />
                  ))}
                </List>
                {unit.rest.length > 0 ? (
                  <Disclosure label={`+ ${unit.more}`}>
                    <List>
                      {unit.rest.map((e) => (
                        <ForwardRow
                          key={e.key}
                          entry={e}
                          horizon={horizon}
                          lookup={lookup}
                          marks={marks}
                          returnTo={returnTo}
                        />
                      ))}
                    </List>
                  </Disclosure>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ForwardRow({
  entry,
  horizon,
  lookup,
  marks,
  returnTo,
}: {
  entry: ForwardEntry;
  horizon: Horizon;
  lookup: FactLookup;
  marks: ReadonlyMap<string, readonly ConflictMark[]>;
  returnTo: string;
}) {
  const item = entry.item;
  const week = horizon === 'week';
  const col = (clock: string | undefined) =>
    week ? (clock ?? 'All day') : dateColumn(entry, horizon);
  switch (item.kind) {
    case 'event': {
      const timed = !item.allDay;
      const row = timed ? timedRow(item, lookup.timeZone) : null;
      return (
        <ItemRow
          href={`/events/${item.eventId}`}
          time={col(row?.time)}
          title={item.title}
          detail={
            week
              ? timed
                ? row!.detail
                : item.days > 1
                  ? `Day ${item.day} of ${item.days}`
                  : undefined
              : undefined
          }
          who={who(item, lookup.people)}
          after={
            week ? (
              <ConflictMarks
                marks={marks.get(placement(null, occurrenceKey(item)))}
                lookup={lookup}
                surface="forward"
                returnTo={returnTo}
              />
            ) : null
          }
        />
      );
    }
    case 'birthday':
      return (
        <ItemRow
          href={`/people/${item.personId}`}
          time={col(undefined)}
          title={`${item.name}’s birthday`}
          detail={`Turns ${item.age}`}
        />
      );
    case 'project_target':
      return (
        <ItemRow
          href={`/home/projects/${item.projectId}`}
          time={col(undefined)}
          title={item.title}
          detail="Project target date"
        />
      );
    case 'task_due':
      return (
        <ItemRow
          href={`/tasks/${item.taskId}`}
          time={col(undefined)}
          title={item.title}
          detail="Due"
        />
      );
    case 'task_scheduled':
      return (
        <ItemRow
          href={`/tasks/${item.taskId}`}
          time={col(clockOf(item.startsAt, lookup.timeZone))}
          title={item.title}
          detail={week ? `Scheduled until ${clockOf(item.endsAt, lookup.timeZone)}` : 'Scheduled'}
        />
      );
  }
}
