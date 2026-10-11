import 'server-only';
import type { Deps } from '../common/write';
import type { AgendaDay } from '../engines/agenda';
import type { AgendaInputs } from '../events/agenda-inputs';
import { addDays, isoDateInZone } from '@/lib/dates';
import type { UserActor } from '@/trust/actor';
import { conflictsOver, personConflicts } from './conflicts';
import { insightsFor, insightsInput } from './today';

// A person's Coming up marks (M6 Package 4; contract §4.6, ADR 0009 §28): the
// person's conflicts over the 30 days the page shows, with the reader's
// responses applied (one query), so a key here is the key Today and Forward
// use. Nothing is listed on a person's page (it has no Worth knowing): the
// conflicts are only said on their items.

export async function personInsights(
  actor: UserActor,
  inputs: Pick<AgendaInputs, 'events' | 'people' | 'records'>,
  days: readonly AgendaDay[],
  now: Date,
  timeZone: string,
  personId: string,
  placed: ReadonlySet<string>,
  deps: Deps = {},
) {
  const today = isoDateInZone(now, timeZone);
  const through = addDays(today, 29);
  const found = conflictsOver(inputs, days, now, timeZone, { from: today, to: through });
  return insightsFor(
    actor,
    insightsInput(inputs, days, now, timeZone, new Set(), {
      conflicts: personConflicts(found, personId),
      placed,
      through,
      listed: new Set(),
    }),
    deps,
  );
}
