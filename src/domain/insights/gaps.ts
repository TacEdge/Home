import 'server-only';
import type { Deps } from '../common/write';
import { agenda, type AgendaDay } from '../engines/agenda';
import { gaps, HOUSEHOLD, type GapScope, type Gaps } from '../engines/gaps';
import { readAgendaInputs, type AgendaInputs } from '../events/agenda-inputs';
import { addDays, isoDateInZone, type IsoDate } from '@/lib/dates';
import type { UserActor } from '@/trust/actor';

// The reader's gaps (M7 Package 2; contract §3.3, §5.4–§5.5; ADR 0011 §22–§28).
// One agenda read as the signed-in adult (`readAgendaInputs`, which also
// reads the reader's calendars with their freshness), one placement, one run
// of the gap engine. No query of its own, nothing stored, nothing cached:
// gaps are derived per reader, per request, from what that reader can see
// (§3.5), so nothing computed for one adult can reach the other. No insight
// family, wording or response here: openings are Package 3's.

/** The engine run over the agenda the caller already read. Pure. */
export function gapsOver(
  inputs: Pick<AgendaInputs, 'people' | 'records'>,
  days: readonly AgendaDay[],
  now: Date,
  timeZone: string,
  range: { from: IsoDate; to: IsoDate },
  agendaRange: { from: IsoDate; to: IsoDate },
  scopes: readonly GapScope[] = householdScopes(inputs),
): Gaps {
  return gaps({
    now,
    timeZone,
    range,
    agendaRange,
    days,
    people: inputs.people.map((p) => ({ id: p.id, inHousehold: p.inHousehold })),
    tasks: inputs.records.tasks.map((t) => ({ id: t.id, assigneePersonId: t.assigneePersonId })),
    calendars: inputs.records.calendars,
    scopes,
  });
}

/** The household, then each visible household person (by id). */
export function householdScopes(inputs: Pick<AgendaInputs, 'people'>): GapScope[] {
  return [
    HOUSEHOLD,
    ...inputs.people
      .filter((p) => p.inHousehold)
      .map((p) => p.id)
      .sort(),
  ];
}

/**
 * The reader's gaps from today for `days` home days (Forward Week's seven by
 * default), for the household and each visible household person unless
 * `scopes` says otherwise: one agenda read and one engine run.
 */
export async function readGaps(
  actor: UserActor,
  now: Date,
  timeZone: string,
  deps: Deps = {},
  days = 7,
  scopes?: readonly GapScope[],
): Promise<Gaps & { days: AgendaDay[]; inputs: AgendaInputs }> {
  const inputs = await readAgendaInputs(actor, deps);
  const from = isoDateInZone(now, timeZone);
  const range = { from, to: addDays(from, days - 1) };
  const placed = agenda({
    ...range,
    timeZone,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: inputs.tasks,
    projects: inputs.projects,
  });
  return {
    ...gapsOver(inputs, placed, now, timeZone, range, range, scopes ?? householdScopes(inputs)),
    days: placed,
    inputs,
  };
}
