import Link from 'next/link';
import { AgendaItemRow } from '@/app/_agenda/agenda-list';
import type { AgendaItem } from '@/domain/engines/agenda';
import type { LineEntry, PersonLine, TodayModel, TodoEntry } from '@/domain/engines/today';
import type { Person } from '@/domain/people/service';
import { clockOf } from '@/lib/dates';
import { ItemRow, List } from '@/ui/list';
import { Label } from '@/ui/page';
import { PersonName, type PersonColour } from '@/ui/person-dot';
import { toSortLine } from '../sort/copy';
import { Disclosure } from './disclosure';
import { FactsInPlace, type FactLookup } from './facts';
import { moreToDoLine, todayHeadline, todoDetail } from './copy';
import { WorthKnowing } from './worth-knowing';
import type { Insights } from '@/domain/engines/insights';
import type { Fact } from '@/domain/engines/day-facts';

// The Today screen (M5 contract §4, ADR 0008 §32): presentation of what the
// Today engine decided. It orders nothing, counts nothing and words nothing
// of its own: the headline, the lines, Also today, the to-dos and the evening
// state are the model's, rendered as given. All it adds is layout, links to
// the places that exist, and the records a statement stands on.

const link = 'text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4';

export type TodayViewProps = {
  model: TodayModel;
  lookup: FactLookup;
  /** Whether to point an unlinked adult at "Which one is you?". */
  linked: boolean;
  /** The reader's insights, own dismissals applied (Package 4). */
  worth: Pick<Insights, 'shown' | 'rest'>;
};

export function TodayView({ model, lookup, linked, worth }: TodayViewProps) {
  const { headline, state } = model;
  const day = state === 'day';
  const twoColumns = day && (model.personLines.length > 0 || model.alsoToday.length > 0);
  const toSort = toSortLine(model.toSort);
  // A calendar Worth knowing already speaks about is not listed again under
  // the headline's facts (ADR 0008 §33): its health is said once. The list of
  // calendars looked at for "Nothing on today" stays whole.
  const saidBelow = new Set(
    [...worth.shown, ...worth.rest]
      .filter((i) => i.kind === 'data_health')
      .flatMap((i) => i.facts)
      .filter((f): f is Extract<Fact, { kind: 'calendar' }> => f.kind === 'calendar')
      .map((f) => f.id),
  );

  const header = (
    <header className="md:row-start-1 md:col-start-1">
      <h1 className="text-ink-2 text-[15px] leading-6">{todayHeadline(model.date)}</h1>
      <p
        data-testid="headline"
        className="font-display mt-2 text-[27px] leading-[1.18] font-normal tracking-[-0.015em] text-balance break-words md:text-[34px]"
      >
        {headline.sentence}
      </p>
      {headline.qualified ? (
        <p data-testid="qualifier" className="text-ink-2 mt-1 text-[17px]">
          As far as HOME knows.
        </p>
      ) : null}
      {headline.late ? (
        <p className="font-display text-ink-2 mt-2 text-[20px] leading-[1.3] text-balance break-words">
          {headline.late.text}
        </p>
      ) : null}
      {state === 'first_run' ? (
        <p className="mt-3">
          <Link href="/settings/calendars" className={link}>
            Connect a calendar ›
          </Link>
        </p>
      ) : (
        <FactsInPlace
          facts={[...headline.facts, ...(headline.late?.facts ?? [])].filter(
            (f) =>
              !(
                f.kind === 'calendar' &&
                saidBelow.has(f.id) &&
                headline.rule !== 'headline.nothing'
              ),
          )}
          lookup={lookup}
        />
      )}
    </header>
  );

  const everyone =
    day && model.personLines.length > 0 ? (
      <section aria-labelledby="today-day">
        <Label id="today-day">Everyone’s day</Label>
        <ul className="border-line border-b md:border-b-0">
          {model.personLines.map((line) => (
            <PersonLineRow key={line.personId} line={line} lookup={lookup} />
          ))}
        </ul>
      </section>
    ) : null;

  const also =
    day && model.alsoToday.length > 0 ? (
      <section aria-labelledby="today-also">
        <Label id="today-also">Also today</Label>
        <List>
          {model.alsoToday.map((item, i) => (
            <AgendaItemRow key={i} item={item} timeZone={lookup.timeZone} people={lookup.people} />
          ))}
        </List>
      </section>
    ) : null;

  const todo =
    model.todo.shown.length > 0 ? (
      <section aria-labelledby="today-todo" className="md:col-start-1 md:row-start-3">
        <Label id="today-todo">To do</Label>
        <List>
          {model.todo.shown.map((e) => (
            <TodoRow key={e.task.id} entry={e} model={model} lookup={lookup} />
          ))}
        </List>
        {model.todo.more > 0 ? (
          <p>
            <Link href="/tasks" className={link}>
              {moreToDoLine(model.todo.more)} ›
            </Link>
          </p>
        ) : null}
      </section>
    ) : null;

  const sort = toSort ? (
    <p className="mt-6 md:col-start-1 md:row-start-4">
      <Link href="/sort" className={link}>
        {toSort} ›
      </Link>
    </p>
  ) : null;

  const footer = (
    <div className="mt-6 md:col-start-1 md:row-start-5">
      {linked ? null : (
        <p>
          <Link href="/settings/you" className={link}>
            Which one is you? ›
          </Link>
        </p>
      )}
      <p className="text-ink-2">
        <Link href="/forward" className={link}>
          The next 30 days ›
        </Link>
      </p>
    </div>
  );

  // Worth knowing sits between the headline and Everyone's day (contract
  // §4.1); on a tablet it stays in the left column, under the headline. It
  // shows on first run too (M5 Package 5): a household with birthdays or a
  // project recorded before any calendar still has those insights. It is
  // absent, as every empty section is, when there are none.
  const worthKnowing = (
    <div className="md:col-start-1 md:row-start-2">
      <WorthKnowing shown={worth.shown} rest={worth.rest} lookup={lookup} />
    </div>
  );

  return (
    <div
      data-wide=""
      className={
        twoColumns
          ? 'md:grid md:grid-cols-2 md:grid-rows-[auto_auto_auto_auto_1fr] md:gap-x-10'
          : 'md:max-w-[720px]'
      }
    >
      {header}
      {worthKnowing}
      {twoColumns ? (
        <div className="md:col-start-2 md:row-span-5 md:row-start-1">
          {everyone}
          {also}
        </div>
      ) : null}
      {state === 'evening' && model.evening ? <Evening model={model} lookup={lookup} /> : null}
      {todo}
      {sort}
      {state === 'evening' ? <EarlierToday model={model} lookup={lookup} /> : null}
      {footer}
    </div>
  );
}

const colour = (p: Person | undefined) => (p?.colour ?? null) as PersonColour | null;

function PersonLineRow({ line, lookup }: { line: PersonLine; lookup: FactLookup }) {
  const person = lookup.people.get(line.personId);
  const rest = line.rest;
  return (
    <li className="border-line flex gap-3 border-t py-1.5 md:mb-3 md:block md:rounded-home md:border md:px-4 md:py-2">
      <Link
        href={`/people/${line.personId}`}
        className="hover:bg-paper-2 rounded-home-sm -mx-2 flex min-h-11 w-[5.75rem] shrink-0 items-center self-start px-2 break-words md:w-auto"
      >
        <PersonName name={line.name} colour={colour(person)} />
      </Link>
      <div className="min-w-0 flex-1">
        <ul>
          {line.shown.map((e, i) => (
            <Entry key={i} entry={e} owner={line.personId} lookup={lookup} />
          ))}
        </ul>
        {rest.length > 0 ? (
          <Disclosure label={`+ ${rest.length} more`}>
            <ul>
              {rest.map((e, i) => (
                <Entry key={i} entry={e} owner={line.personId} lookup={lookup} />
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>
    </li>
  );
}

/** One line of someone's day, with the other people recorded on it (never inferred). */
function Entry({ entry, owner, lookup }: { entry: LineEntry; owner: string; lookup: FactLookup }) {
  const item = entry.item;
  const href =
    item.kind === 'event'
      ? `/events/${item.eventId}`
      : item.kind === 'birthday'
        ? `/people/${item.personId}`
        : null;
  // A routine word stays one word; anyone else recorded is shown beside a one-off.
  const others = (entry.routine ? [] : entry.people)
    .filter((p) => p.personId !== owner)
    .map((p) => lookup.people.get(p.personId))
    .filter((p): p is Person => p !== undefined);
  const body = (
    <>
      <span className={`min-w-0 break-words ${entry.routine ? 'text-ink-2' : ''}`}>
        {entry.text}
      </span>
      {others.map((p) => (
        <span key={p.id} className="text-ink-2 text-[15px]">
          <PersonName name={p.name} colour={colour(p)} />
        </span>
      ))}
    </>
  );
  const row = 'flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 py-2';
  return (
    <li>
      {href ? (
        <Link href={href} className={`${row} hover:bg-paper-2 rounded-home-sm -mx-2 px-2`}>
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}

function TodoRow({
  entry,
  model,
  lookup,
}: {
  entry: TodoEntry;
  model: TodayModel;
  lookup: FactLookup;
}) {
  const record = lookup.tasks.get(entry.task.id);
  const who = record?.assigneePersonId ? lookup.people.get(record.assigneePersonId) : undefined;
  const reason = entry.rule.slice('todo.'.length) as Parameters<typeof todoDetail>[0];
  const scheduled =
    reason === 'scheduled_today' && entry.task.scheduledStartsAt
      ? clockOf(entry.task.scheduledStartsAt, lookup.timeZone)
      : undefined;
  return (
    <ItemRow
      href={`/tasks/${entry.task.id}`}
      time={scheduled}
      title={entry.task.title}
      detail={todoDetail(
        reason,
        entry.task.dueDate,
        model.date,
        record?.projectId ? lookup.projects.get(record.projectId)?.title : undefined,
      )}
      who={who ? [{ name: who.name, colour: colour(who) }] : undefined}
    />
  );
}

/**
 * Today's items that are about the whole day, not a time: all-day events and
 * birthdays. In the evening they stay in view (M5 Package 5): a birthday is
 * still today's when the timed things are over.
 */
const allDay = (i: AgendaItem) => (i.kind === 'event' && i.allDay) || i.kind === 'birthday';

/**
 * Evening (contract §5.6): the engine says the timed events are over. What is
 * left is what is still recorded as all-day today (all-day events and
 * birthdays), tomorrow morning, and what is due tomorrow, with today's other
 * items folded away under "Earlier today".
 */
function Evening({ model, lookup }: { model: TodayModel; lookup: FactLookup }) {
  const evening = model.evening!;
  const allDayToday = evening.earlier.filter(allDay);
  const morning = evening.tomorrowMorning;
  const before = evening.beforeThen;
  const row = (item: AgendaItem, i: number) => (
    <AgendaItemRow key={i} item={item} timeZone={lookup.timeZone} people={lookup.people} />
  );
  return (
    <div>
      {allDayToday.length > 0 ? (
        <section aria-labelledby="today-allday">
          <Label id="today-allday">All day today</Label>
          <List>{allDayToday.map(row)}</List>
        </section>
      ) : null}
      {morning.length > 0 ? (
        <section aria-labelledby="today-tomorrow">
          <Label id="today-tomorrow">Tomorrow morning</Label>
          <List>{morning.map(row)}</List>
        </section>
      ) : null}
      {before.length > 0 ? (
        <section aria-labelledby="today-before">
          <Label id="today-before">{morning.length > 0 ? 'Before then' : 'Due tomorrow'}</Label>
          <List>
            {before.map((e) => (
              <ItemRow
                key={e.task.id}
                href={`/tasks/${e.task.id}`}
                title={e.task.title}
                detail={todoDetail('due_tomorrow', e.task.dueDate, model.date, undefined)}
              />
            ))}
          </List>
        </section>
      ) : null}
    </div>
  );
}

/** Today's items, folded away once the evening has come (contract §5.6). */
function EarlierToday({ model, lookup }: { model: TodayModel; lookup: FactLookup }) {
  const folded = (model.evening?.earlier ?? []).filter((i) => !allDay(i));
  if (folded.length === 0) return null;
  return (
    <section aria-label="Earlier today" className="mt-6">
      <Disclosure label="Earlier today">
        <List>
          {folded.map((item, i) => (
            <AgendaItemRow key={i} item={item} timeZone={lookup.timeZone} people={lookup.people} />
          ))}
        </List>
      </Disclosure>
    </section>
  );
}
