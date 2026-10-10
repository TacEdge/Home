import 'server-only';
import { z } from 'zod';
import type { Deps } from '../common/write';
import { assertCanWrite, assertFamilyWritesOpen } from '../common/guards';
import { NotPermittedError } from '../common/errors';
import type { AgendaDay } from '../engines/agenda';
import {
  insights,
  LOOKAHEAD_DAYS,
  type InsightKind,
  type Insights,
  type InsightsInput,
} from '../engines/insights';
import type { AgendaInputs } from '../events/agenda-inputs';
import { addDays } from '@/lib/dates';
import type { UserActor } from '@/trust/actor';
import type { InsightResponseKind } from '@/db/schema/insight-response';
import { readConflictInputs } from './conflicts';
import { respond, respondedKeys } from './service';
import { insightKey, insightResponseKind } from './schema';

// Worth knowing on Today (M5 Package 4, ADR 0008 §23, §33): the reader's
// insights from the records the reader can see, less the ones the reader
// has responded to. Both the screen and the responses build them here, from
// the same read, so a key the screen showed is a key a response can find, and
// a key it never showed (another adult's, a crafted one, one no longer true)
// is refused. Responses are the reader's own: they are read and written by
// `user_id` only, and change nothing anyone else sees.
//
// M6 (ADR 0009 §17–§19): conflicts join as their own family, and a response
// is Dismiss or Not useful, from any surface. Both hide the insight for that
// adult on every surface; Not useful also records the adult's judgement.
// Neither changes a rule, a ranking or any other insight.

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
  extra: Pick<InsightsInput, 'conflicts' | 'placed'> = {},
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
    ...extra,
  };
}

/**
 * The reader's insights with their own responses applied (Dismiss and Not
 * useful alike): one more query than the engine needs (the reader's
 * responses among the keys found), and none when there is nothing to find.
 * `responded` is those keys, for the marks Today puts on its items.
 */
export async function insightsFor(
  actor: UserActor,
  input: InsightsInput,
  deps: Deps = {},
): Promise<Insights & { responded: ReadonlySet<string> }> {
  const found = insights({ ...input, dismissed: new Set() });
  if (found.all.length === 0) return { ...found, responded: new Set() };
  const keys = await respondedKeys(
    actor,
    found.all.map((i) => i.key),
    deps,
  );
  const responded = new Set(Object.keys(keys));
  return { ...insights({ ...input, dismissed: responded }), responded };
}

/**
 * What a response is checked against, read from scratch: one agenda read over
 * 90 days (ADR 0009 §19), the reader's conflicts over all of it, and Today's
 * insights (its window, today and the next seven days) from the same days.
 */
async function readCurrent(actor: UserActor, now: Date, timeZone: string, deps: Deps) {
  const read = await readConflictInputs(actor, now, timeZone, deps);
  const input = insightsInput(read.inputs, read.days, now, timeZone, new Set(), {
    conflicts: read.all,
  });
  return { conflicts: read.all, input };
}

/** The reader's insights now, read from scratch, their own responses applied. */
export async function readInsights(
  actor: UserActor,
  now: Date,
  timeZone: string,
  deps: Deps = {},
): Promise<Insights> {
  const { input } = await readCurrent(actor, now, timeZone, deps);
  return insightsFor(actor, input, deps);
}

/** Where a response is given from (ADR 0009 §18): what may be listed there. */
export const RESPONSE_SURFACES = ['today', 'forward', 'person'] as const;
export type ResponseSurface = (typeof RESPONSE_SURFACES)[number];
const LISTED: Record<ResponseSurface, ReadonlySet<InsightKind>> = {
  today: new Set(['data_health', 'preparation', 'busy_day']),
  forward: new Set(['data_health']),
  person: new Set(),
};

/**
 * Dismiss or Not useful (contract §5.9, ADR 0009 §17, §19): the reader's own,
 * for one insight the reader can see now, in this order:
 *  1. the real-data gate, then the actor, before anything is read;
 *  2. the key's and the response's form;
 *  3. the reader's own insights and conflicts, re-derived over 90 days;
 *  4. accepted only for a current conflict of the reader's, or for another
 *     insight that is current and listed on the named surface; anything else
 *     (a crafted key, another adult's, one for a record the reader cannot
 *     see, one said on its item) is refused as not eligible;
 *  5. the same response again changes nothing and writes nothing;
 *  6. otherwise `respond`: an upsert, audited with the response kind only.
 * Source records are never touched. Nothing else changes: no rule, ranking,
 * family or other insight.
 */
export async function respondToInsight(
  actor: UserActor,
  key: string,
  response: InsightResponseKind,
  surface: ResponseSurface,
  now: Date,
  timeZone: string,
  deps: Deps = {},
): Promise<{ key: string; response: InsightResponseKind; already: boolean }> {
  assertFamilyWritesOpen();
  assertCanWrite(actor);
  const k = insightKey.parse(key);
  const r = insightResponseKind.parse(response);
  const where = z.enum(RESPONSE_SURFACES).parse(surface);
  const { conflicts, input } = await readCurrent(actor, now, timeZone, deps);
  const isConflict = conflicts.some((c) => c.key === k);
  if (!isConflict) {
    const found = insights(input).all.find((i) => i.key === k);
    if (!found || found.onObject || found.kind === 'conflict' || !LISTED[where].has(found.kind))
      throw new NotPermittedError('not_eligible');
  }
  const responded = await respondedKeys(actor, [k], deps);
  if (responded[k] === r) return { key: k, response: r, already: true };
  await respond(actor, k, r, deps);
  return { key: k, response: r, already: false };
}

/** Dismiss from Today (M5): `respondToInsight` with `dismissed`, on Today. */
export async function dismissInsight(
  actor: UserActor,
  key: string,
  now: Date,
  timeZone: string,
  deps: Deps = {},
): Promise<{ key: string; already: boolean }> {
  const { already } = await respondToInsight(actor, key, 'dismissed', 'today', now, timeZone, deps);
  return { key, already };
}
