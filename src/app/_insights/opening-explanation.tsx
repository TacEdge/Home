import { Fragment } from 'react';
import { AgendaItemRow } from '@/app/_agenda/agenda-list';
import { CreditLink } from '@/app/_weather/credit';
import { WEEKDAYS } from '@/domain/engines/day-facts';
import type { CommitmentFact } from '@/domain/engines/gaps';
import {
  estimateWords,
  needsWords,
  type Opening,
  type OpeningEdge,
  type OpeningForecast,
  type OpeningTaskRef,
} from '@/domain/engines/insights/openings';
import { bandWords } from '@/domain/engines/weather';
import { clockOf, weekdayOf } from '@/lib/dates';
import { ItemRow, List } from '@/ui/list';
import { eventRow, updated, when, type FactLookup } from './facts';

// Why HOME says an opening (M7 contract §4.5, ADR 0011 §29–§35): what the
// openings engine recorded, set out from its facts and nothing else. The rule
// in one plain sentence; the commitment either side (or the planning-hours or
// daylight edge, with sunrise or sunset); the household people it is about, as
// the reader can see them; recorded events that did not count, and why; each
// calendar and when it last updated; the forecast span in words, its time and
// the credit; for a task opening, the task as recorded and any other matching
// tasks; and the fixed limit. Nothing is inferred, no wording comes from a
// model, a fact that no longer resolves is left out, and the reader's own
// records are the only ones ever named.

const hhmm = (at: Date, zone: string) => clockOf(at, zone);

function commitmentRow(f: CommitmentFact, lookup: FactLookup) {
  if (f.kind === 'event') {
    const item = eventRow(f, lookup.days);
    return item ? (
      <AgendaItemRow item={item} timeZone={lookup.timeZone} people={lookup.people} />
    ) : null;
  }
  const t = lookup.tasks.get(f.id);
  return t ? <ItemRow href={`/tasks/${t.id}`} title={t.title} detail="Scheduled task" /> : null;
}

function commitmentName(f: CommitmentFact | null, lookup: FactLookup): string | null {
  if (!f) return null;
  if (f.kind === 'event') {
    const item = eventRow(f, lookup.days);
    return item && item.kind === 'event' ? item.title : null;
  }
  return lookup.tasks.get(f.id)?.title ?? null;
}

/** "the end of Football (10:00)", "the start of daylight (06:30; sunrise 06:29)": one end of the stretch. */
function edgeWords(end: 'from' | 'to', edge: OpeningEdge, o: Opening, lookup: FactLookup): string {
  const zone = lookup.timeZone;
  const at = hhmm(o.stretch[end], zone);
  if (edge === 'daylight' && o.daylight)
    return end === 'from'
      ? `the start of daylight (${at}; sunrise ${hhmm(o.daylight.sunrise, zone)})`
      : `the end of daylight (${at}; sunset ${hhmm(o.daylight.sunset, zone)})`;
  if (edge === 'commitment') {
    const name = commitmentName(end === 'from' ? o.gap.before : o.gap.after, lookup);
    if (name) return end === 'from' ? `the end of ${name} (${at})` : `the start of ${name} (${at})`;
    return end === 'from'
      ? `the end of a recorded commitment (${at})`
      : `the start of a recorded commitment (${at})`;
  }
  return end === 'from'
    ? `the start of planning hours (${at})`
    : `the end of planning hours (${at})`;
}

/** The forecast an opening cites, in words: its span, its band and what the band rests on. */
function forecastWords(f: OpeningForecast, o: Opening, zone: string): string {
  const span =
    f.over === 'span'
      ? `${hhmm(f.from, zone)}–${hhmm(f.to, zone)}`
      : `${WEEKDAYS[weekdayOf(o.date)]}, ${hhmm(f.from, zone)}–${hhmm(f.to, zone)}`;
  const rain = f.totalMm === 0 ? 'no rain' : `${f.totalMm} mm of rain`;
  const gust = f.maxGustKmh === null ? '' : `, gusts up to ${f.maxGustKmh} km/h`;
  return `${span}: ${bandWords(f.band).toLowerCase()}${f.windy ? ', and windy' : ''}. Chance of rain up to ${f.maxProbability}%, ${rain}${gust}.`;
}

function TaskLine({ t, lookup }: { t: OpeningTaskRef; lookup: FactLookup }) {
  const rec = lookup.tasks.get(t.id);
  if (!rec) return null;
  return (
    <ItemRow
      href={`/tasks/${t.id}`}
      title={rec.title}
      detail={`About ${estimateWords(t.estimateMinutes)}; ${needsWords(t.needs)}`}
    />
  );
}

export function OpeningExplanation({
  opening: o,
  lookup,
}: {
  opening: Opening;
  lookup: FactLookup;
}) {
  const zone = lookup.timeZone;
  const people = o.people.map((id) => lookup.people.get(id)).filter((p) => p !== undefined);
  const before = o.edges.from === 'commitment' && o.gap.before ? o.gap.before : null;
  const after = o.edges.to === 'commitment' && o.gap.after ? o.gap.after : null;
  const beforeRow = before ? commitmentRow(before, lookup) : null;
  const afterRow = after ? commitmentRow(after, lookup) : null;
  const unblocking = o.gap.unblocking
    .map((f) => ({ f, row: commitmentRow(f, lookup) }))
    .filter((x) => x.row !== null);
  const calendars = o.coverage.calendars
    .map((c) => lookup.calendars.get(c.id))
    .filter((c) => c !== undefined);
  const clipped = o.shown.from.getTime() > o.stretch.from.getTime();

  return (
    <div className="mt-1 mb-2 text-[15px]" data-testid="opening-why">
      <p className="text-ink-2">
        Nothing is recorded for anyone in the household from{' '}
        {edgeWords('from', o.edges.from, o, lookup)} to {edgeWords('to', o.edges.to, o, lookup)}.
        {clipped ? ` Shown from ${hhmm(o.shown.from, zone)}.` : ''}
      </p>
      {beforeRow ? (
        <>
          <p className="text-muted mt-2 text-[13px]">Before</p>
          <List>{beforeRow}</List>
        </>
      ) : null}
      {afterRow ? (
        <>
          <p className="text-muted mt-2 text-[13px]">After</p>
          <List>{afterRow}</List>
        </>
      ) : null}
      {people.length > 0 ? (
        <p className="mt-2">Household: {people.map((p) => p.name).join(', ')}</p>
      ) : null}
      {unblocking.length > 0 ? (
        <>
          <p className="text-ink-2 mt-2">
            Recorded, but not on anyone in the household, so it doesn’t shorten this:
          </p>
          <List label="Recorded but not counted">
            {unblocking.map((x, i) => (
              <Fragment key={i}>{x.row}</Fragment>
            ))}
          </List>
        </>
      ) : null}
      {calendars.length > 0 ? (
        <>
          <p className="text-muted mt-2 text-[13px]">Calendars</p>
          <ul className="text-ink-2">
            {calendars.map((c) => (
              <li key={c.id}>
                {c.name} · {updated(c, zone)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {o.forecast ? (
        <p className="mt-2">
          Forecast fetched {when(o.forecast.fetchedAt, zone)} (Open-Meteo), for{' '}
          {forecastWords(o.forecast, o, zone)}
          <br />
          <CreditLink />
        </p>
      ) : null}
      {o.task ? (
        <>
          <p className="text-muted mt-2 text-[13px]">The task, as recorded</p>
          <List>
            <TaskLine t={o.task} lookup={lookup} />
          </List>
          {o.others.length > 0 ? (
            <>
              <p className="text-muted mt-2 text-[13px]">Other tasks recorded the same way</p>
              <List>
                {o.others.map((t) => (
                  <TaskLine key={t.id} t={t} lookup={lookup} />
                ))}
              </List>
            </>
          ) : null}
        </>
      ) : null}
      <p className="text-ink-2 mt-2" data-testid="opening-limit">
        {o.limit}
      </p>
    </div>
  );
}
