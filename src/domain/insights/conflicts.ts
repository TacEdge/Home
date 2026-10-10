import 'server-only';
import type { Deps } from '../common/write';
import { agenda, type AgendaDay } from '../engines/agenda';
import { conflicts, type Conflict } from '../engines/conflicts';
import { readAgendaInputs, type AgendaInputs } from '../events/agenda-inputs';
import { addDays, isoDateInZone, type IsoDate } from '@/lib/dates';
import type { UserActor } from '@/trust/actor';
import type { InsightResponseKind } from '@/db/schema/insight-response';
import { respondedKeys } from './service';

// The reader's conflicts for every surface (M6 Package 3; contract §3.2,
// §5.8; ADR 0009 §18, §19). One agenda read as the signed-in adult, one run
// of the conflict engine over the surface's window, one query for the
// reader's own responses among the keys found. Today, Forward and a person's
// Coming up take their conflicts from here, so a key is the same key, and a
// response hides it, everywhere the reader looks. Nothing here detects
// anything: the engine does; this reads, and applies the reader's responses.

/** The longest window a surface looks across: Forward's Season (ADR 0009 §19). */
export const CONFLICT_DAYS = 90;

/** The engine run over a window of the agenda the caller already read. Pure. */
export function conflictsOver(
  inputs: Pick<AgendaInputs, 'events' | 'people'>,
  days: readonly AgendaDay[],
  now: Date,
  timeZone: string,
  window: { from: IsoDate; to: IsoDate },
): Conflict[] {
  return conflicts({
    now,
    timeZone,
    window,
    days,
    coverage: window,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, inHousehold: p.inHousehold })),
  });
}

export type ReaderConflicts = {
  /** Every current conflict the reader can see, in order. */
  all: Conflict[];
  /** The ones the reader has not responded to: what a surface may show. */
  current: Conflict[];
  /** The reader's own responses among `all`. */
  responded: Record<string, InsightResponseKind>;
};

/** The reader's own responses applied: one query, and none when there is nothing. */
export async function withResponses(
  actor: UserActor,
  all: Conflict[],
  deps: Deps = {},
): Promise<ReaderConflicts> {
  const responded = all.length
    ? await respondedKeys(
        actor,
        all.map((c) => c.key),
        deps,
      )
    : {};
  return { all, current: all.filter((c) => !(c.key in responded)), responded };
}

/**
 * The reader's conflicts now, over the next `days` home days from today
 * (Forward's 90 by default), before responses: one agenda read and one
 * engine run, with the agenda and the records it came from.
 */
export async function readConflictInputs(
  actor: UserActor,
  now: Date,
  timeZone: string,
  deps: Deps = {},
  days = CONFLICT_DAYS,
): Promise<{ all: Conflict[]; days: AgendaDay[]; inputs: AgendaInputs }> {
  const inputs = await readAgendaInputs(actor, deps);
  const from = isoDateInZone(now, timeZone);
  const window = { from, to: addDays(from, days - 1) };
  const placed = agenda({
    ...window,
    timeZone,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: inputs.tasks,
    projects: inputs.projects,
  });
  return { all: conflictsOver(inputs, placed, now, timeZone, window), days: placed, inputs };
}

/** The reader's conflicts now with their own responses applied: one more query. */
export async function readConflicts(
  actor: UserActor,
  now: Date,
  timeZone: string,
  deps: Deps = {},
  days = CONFLICT_DAYS,
): Promise<ReaderConflicts & { days: AgendaDay[]; inputs: AgendaInputs }> {
  const read = await readConflictInputs(actor, now, timeZone, deps, days);
  return { ...(await withResponses(actor, read.all, deps)), days: read.days, inputs: read.inputs };
}

/**
 * What the Forward engine takes (its `ForwardConflict`, ADR 0009 §32): each
 * current conflict's key and the occurrences it is said at, its (next) pair.
 * The shape is written out here, not imported, so this service does not
 * depend on the Forward engine. A standing conflict is
 * said once, at its next occurrence (§13).
 */
export function forwardConflicts(
  current: readonly Conflict[],
): { key: string; occurrences: string[] }[] {
  return current.map((c) => ({ key: c.key, occurrences: c.occurrences.map((o) => o.occurrence) }));
}

/** One person's conflicts, for their Coming up (ADR 0009 §28): the same keys, the same order. */
export function personConflicts(current: readonly Conflict[], personId: string): Conflict[] {
  return current.filter((c) => c.person.id === personId);
}
