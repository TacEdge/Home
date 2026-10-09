import 'server-only';
import type { Deps } from '../common/write';
import { assertCanWrite, assertFamilyWritesOpen } from '../common/guards';
import { NotPermittedError } from '../common/errors';
import { agenda, type AgendaDay } from '../engines/agenda';
import { insights, LOOKAHEAD_DAYS, type Insights, type InsightsInput } from '../engines/insights';
import { readAgendaInputs, type AgendaInputs } from '../events/agenda-inputs';
import { addDays, isoDateInZone } from '@/lib/dates';
import type { UserActor } from '@/trust/actor';
import { respond, respondedKeys } from './service';
import { insightKey } from './schema';

// Worth knowing on Today (M5 Package 4, ADR 0008 §23, §33): the reader's
// insights from the records the reader can see, less the ones the reader
// has dismissed. Both the screen and Dismiss build them here, from the same
// read and the same window, so a key the screen showed is a key Dismiss can
// find, and a key it never showed (another adult's, a crafted one, one no
// longer true) is refused. Dismissals are the reader's own: they are read
// and written by `user_id` only, and change nothing anyone else sees.

/** The agenda window the detectors read: today and the next seven days (ADR 0008 §26). */
export const insightWindow = (today: string) => ({
  from: today,
  to: addDays(today, LOOKAHEAD_DAYS),
});

/** The engine's input from the agenda read: records handed over as they are. */
export function insightsInput(
  inputs: Pick<AgendaInputs, 'events' | 'people' | 'records'>,
  days: readonly AgendaDay[],
  now: Date,
  timeZone: string,
  dismissed: ReadonlySet<string> = new Set(),
): InsightsInput {
  return {
    now,
    timeZone,
    days,
    events: inputs.events,
    people: inputs.people.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role as 'parent' | 'child' | 'other',
      inHousehold: p.inHousehold,
      dateOfBirth: p.dateOfBirth,
    })),
    tasks: inputs.records.tasks.map((t) => ({ id: t.id, projectId: t.projectId })),
    projects: inputs.records.projects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      targetDate: p.targetDate,
    })),
    calendars: inputs.records.calendars.map((c) => ({
      id: c.id,
      name: c.name,
      archivedAt: c.archivedAt,
      lastAttemptAt: c.lastAttemptAt,
      lastSyncedAt: c.lastSyncedAt,
      lastSyncStatus: c.lastSyncStatus,
    })),
    dismissed,
  };
}

/**
 * The reader's insights with their own dismissals applied: one more query
 * than the engine needs (the reader's responses among the keys found), and
 * none when there is nothing to find.
 */
export async function insightsFor(
  actor: UserActor,
  input: InsightsInput,
  deps: Deps = {},
): Promise<Insights> {
  const found = insights({ ...input, dismissed: new Set() });
  if (found.all.length === 0) return found;
  const responded = await respondedKeys(
    actor,
    found.all.map((i) => i.key),
    deps,
  );
  return insights({ ...input, dismissed: new Set(Object.keys(responded)) });
}

/** The reader's insights now, read from scratch (what Dismiss checks a key against). */
export async function readInsights(
  actor: UserActor,
  now: Date,
  timeZone: string,
  deps: Deps = {},
): Promise<Insights> {
  const inputs = await readAgendaInputs(actor, deps);
  const { from, to } = insightWindow(isoDateInZone(now, timeZone));
  const days = agenda({
    from,
    to,
    timeZone,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
    tasks: inputs.tasks,
    projects: inputs.projects,
  });
  return insightsFor(actor, insightsInput(inputs, days, now, timeZone), deps);
}

/**
 * Dismiss (ADR 0008 §23): the reader's own, for one insight the reader can
 * see now. Refused while the real-data gate is closed, before anything is
 * read. A key that is not one of the reader's current insights (or is
 * already said on its item) is refused as not eligible, so nothing can be
 * dismissed on anyone's behalf or for a record the reader cannot see.
 * Dismissing again changes nothing and writes nothing. Source records are
 * never touched.
 */
export async function dismissInsight(
  actor: UserActor,
  key: string,
  now: Date,
  timeZone: string,
  deps: Deps = {},
): Promise<{ key: string; already: boolean }> {
  assertFamilyWritesOpen();
  assertCanWrite(actor);
  const k = insightKey.parse(key);
  const current = await readInsights(actor, now, timeZone, deps);
  const insight = current.all.find((i) => i.key === k);
  if (!insight || insight.onObject) throw new NotPermittedError('not_eligible');
  const responded = await respondedKeys(actor, [k], deps);
  if (responded[k] === 'dismissed') return { key: k, already: true };
  await respond(actor, k, 'dismissed', deps);
  return { key: k, already: false };
}
