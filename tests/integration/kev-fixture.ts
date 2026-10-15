import { sql } from 'drizzle-orm';
import type { Db } from '@/db/create';
import { createContext } from '@/domain/context/service';
import { addMessage, startConversation } from '@/domain/conversations/service';
import { createEventWithPeople } from '@/domain/events/service';
import { respondToInsight } from '@/domain/insights/today';
import { createNote } from '@/domain/notes/service';
import { createPerson, linkSelf } from '@/domain/people/service';
import { createProject } from '@/domain/projects/service';
import { createTask } from '@/domain/tasks/service';
import { toStoredHour } from '@/domain/weather/provider';
import { syntheticHours, utcDayStart, type SyntheticValues } from '@/integrations/weather/fake';
import { weatherConfig } from '@/lib/env';
import { createToolRunner } from '@/kev/tools/registry';
import type { UserActor } from '@/trust/actor';
import {
  CANARY,
  CANARY_MARK,
  FAMILY_EVENTS,
  FAMILY_NOTES,
  FAMILY_PEOPLE,
  FAMILY_PROJECTS,
  FAMILY_TASKS,
  SENSITIVE_MARK,
} from '../fixtures/family';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// The M8 contract's fixture (§15.6), written through the real domain services
// as the two fixture adults, for Kev's tools as `home_app`. Wednesday 14
// October 2026, 07:03, Pacific/Auckland. People: Sam and Alex (parents,
// each linked to their login), Milo (9) and Isla (6), Nana Jo outside the
// household (birthday 20 October). Swimming (weekly on Wednesdays, Milo
// attending, Sam responsible); Football (weekly on Saturdays, Milo
// attending); Thursday's Board meeting (Sam's own, private) and Parent
// interviews (Sam attending), which overlap 18:00–18:30; Nana Jo's birthday.
// Back fence (active) with Paint the back fence (Sam's) and its note; Garage
// (idea) with Sort the garage light (Alex's). Context: Milo's interest, the
// bins routine, and sensitive household and private context. One household
// calendar, last success 06:58. Forecast F0 (M7's), fetched 06:55: Saturday
// dry; Sunday one hour at 40% and 0.1 mm. Each adult's private canaries.
//
// `addPrivateFor(adult)` adds §15.2's records only that adult can see, for
// the non-interference invariant. Synthetic only.

export const ZONE = 'Pacific/Auckland';
export const at = (date: string, clock: string) => new Date(`${date}T${clock}:00+13:00`);
export const NOW = at('2026-10-14', '07:03');
export const SAT = '2026-10-17';
export const SUN = '2026-10-18';
export const THU = '2026-10-15';

export type Adult = 'sam' | 'alex';
export type KevFixture = {
  h: Household;
  kev: Record<Adult, UserActor>;
  id: {
    sam: string;
    alex: string;
    milo: string;
    isla: string;
    nana: string;
    calendar: string;
    swimming: string;
    football: string;
    board: string;
    interviews: string;
    birthday: string;
    fence: string;
    garage: string;
    paint: string;
    light: string;
    note: string;
    dinosaurs: string;
    bins: string;
    sensitiveHousehold: string;
    sensitivePrivate: string;
  };
  canary: Record<
    Adult,
    { person: string; event: string; project: string; task: string; context: string }
  >;
};

const timed = (start: Date, end: Date) => ({
  allDay: false as const,
  startsAt: start.toISOString(),
  endsAt: end.toISOString(),
  timeZone: ZONE,
});

/** F0's values: Sunday 13:00 at 40% and 0.1 mm; everything else dry, gusts 30 km/h. */
const F0 = (s: Date): Partial<SyntheticValues> =>
  s.getTime() === at(SUN, '13:00').getTime()
    ? { precipitationProbability: 40, precipitationMm: 0.1 }
    : {};

/** The forecast row for the configured synthetic point, as the scenario harness writes it. */
export async function writeForecast(admin: Db, fetchedAt: Date): Promise<void> {
  const config = weatherConfig();
  if (config.status !== 'set') throw new Error('weather must be configured');
  const hours = syntheticHours(utcDayStart(fetchedAt), 191, F0);
  await admin.execute(sql`delete from weather_forecast`);
  await admin.execute(sql`
    insert into weather_forecast (provider, fetched_at, hours, location_fingerprint, first_hour, last_hour, last_attempt_at, last_attempt_status)
    values ('open_meteo', ${fetchedAt.toISOString()}::timestamptz, ${JSON.stringify(hours.map(toStoredHour))}::jsonb,
            ${config.fingerprint}, ${hours[0]!.start.toISOString()}::timestamptz, ${hours.at(-1)!.start.toISOString()}::timestamptz,
            ${fetchedAt.toISOString()}::timestamptz, 'ok')`);
}

/** A calendar source with a freshness, written as its owner would have it (no address, nothing sealed). */
export async function calendarRow(
  admin: Db,
  ownerUserId: string,
  visibility: 'household' | 'private',
  name: string,
  lastSyncedAt: Date,
  n: string,
): Promise<string> {
  const sealed = `hc1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`;
  const c = await admin.execute(sql`
    insert into calendar_connection (owner_user_id, provider, credentials_encrypted, credentials_key_id, address_fingerprint)
    values (${ownerUserId}, 'ics', ${sealed}, '0123456789abcdef', ${`fp1.${n.repeat(43)}`}) returning id`);
  const s = await admin.execute(sql`
    insert into calendar_source (created_by, created_via, visibility, connection_id, external_calendar_id, name, last_attempt_at, last_synced_at, last_sync_status)
    values (${ownerUserId}, 'ui', ${visibility}, ${c.rows[0]?.id as string}::uuid, 'primary', ${name},
            ${lastSyncedAt.toISOString()}::timestamptz, ${lastSyncedAt.toISOString()}::timestamptz, 'ok')
    returning id`);
  return s.rows[0]?.id as string;
}

export async function clearKevFixture(db: Db, admin: Db): Promise<void> {
  await clearDomainRows(db);
  await admin.execute(sql`delete from calendar_source`);
  await admin.execute(sql`delete from calendar_connection`);
  await admin.execute(sql`delete from weather_forecast`);
}

export async function buildKevFixture(db: Db, admin: Db): Promise<KevFixture> {
  await clearKevFixture(db, admin);
  const deps = { db };
  const h = await ensureFixtureUsers(db);
  const { sam, alex } = h;
  const samP = await createPerson(sam, FAMILY_PEOPLE.sam, deps);
  await linkSelf(sam, samP.id, deps);
  const alexP = await createPerson(alex, FAMILY_PEOPLE.alex, deps);
  await linkSelf(alex, alexP.id, deps);
  const milo = await createPerson(sam, FAMILY_PEOPLE.milo, deps);
  const isla = await createPerson(alex, FAMILY_PEOPLE.isla, deps);
  const nana = await createPerson(sam, FAMILY_PEOPLE.nanaJo, deps);
  const calendar = await calendarRow(
    admin,
    sam.userId,
    'household',
    'Family calendar',
    at('2026-10-14', '06:58'),
    '1',
  );

  const swimming = await createEventWithPeople(
    sam,
    FAMILY_EVENTS.swimming,
    [
      { personId: milo.id, role: 'attending' },
      { personId: samP.id, role: 'responsible' },
    ],
    deps,
  );
  const football = await createEventWithPeople(
    alex,
    FAMILY_EVENTS.football,
    [{ personId: milo.id, role: 'attending' }],
    deps,
  );
  const board = await createEventWithPeople(
    sam,
    {
      title: 'Board meeting',
      kind: 'work',
      visibility: 'private',
      time: timed(at(THU, '17:30'), at(THU, '19:30')),
    },
    [{ personId: samP.id, role: 'attending' }],
    deps,
  );
  const interviews = await createEventWithPeople(
    sam,
    {
      title: 'Parent interviews',
      kind: 'appointment',
      time: timed(at(THU, '18:00'), at(THU, '18:30')),
    },
    [{ personId: samP.id, role: 'attending' }],
    deps,
  );
  const birthday = await createEventWithPeople(sam, FAMILY_EVENTS.nanaJoBirthday, [], deps);

  const fence = await createProject(sam, FAMILY_PROJECTS.backFence, deps);
  const garage = await createProject(alex, FAMILY_PROJECTS.garage, deps);
  const paint = await createTask(
    sam,
    { ...FAMILY_TASKS.paintFence, projectId: fence.id, assigneePersonId: samP.id },
    deps,
  );
  const light = await createTask(
    alex,
    { ...FAMILY_TASKS.garageLight, projectId: garage.id, assigneePersonId: alexP.id },
    deps,
  );
  const note = await createNote(
    sam,
    { ...FAMILY_NOTES.fenceColour, subject: { type: 'project', id: fence.id } },
    deps,
  );
  const dinosaurs = await createContext(
    sam,
    {
      subject: { type: 'person', id: milo.id },
      content: 'Enjoys dinosaurs at the moment.',
      category: 'interest',
    },
    deps,
  );
  const bins = await createContext(
    alex,
    {
      subject: { type: 'household' },
      content: 'Bins go out on Tuesday night.',
      category: 'routine',
    },
    deps,
  );
  const sensitiveHousehold = await createContext(
    sam,
    {
      subject: { type: 'household' },
      content: `${SENSITIVE_MARK}household spare key arrangement`,
      category: 'practical',
      sensitivity: 'sensitive',
    },
    deps,
  );
  const sensitivePrivate = await createContext(
    alex,
    {
      subject: { type: 'household' },
      content: `${SENSITIVE_MARK}private note`,
      category: 'other',
      sensitivity: 'sensitive',
      visibility: 'private',
    },
    deps,
  );

  const canary = { sam: await canaries(sam, 'sam', db), alex: await canaries(alex, 'alex', db) };
  await writeForecast(admin, at('2026-10-14', '06:55'));
  return {
    h,
    kev: { sam: { ...sam, via: 'kev' }, alex: { ...alex, via: 'kev' } },
    id: {
      sam: samP.id,
      alex: alexP.id,
      milo: milo.id,
      isla: isla.id,
      nana: nana.id,
      calendar,
      swimming: swimming.id,
      football: football.id,
      board: board.id,
      interviews: interviews.id,
      birthday: birthday.id,
      fence: fence.id,
      garage: garage.id,
      paint: paint.id,
      light: light.id,
      note: note.id,
      dinosaurs: dinosaurs.id,
      bins: bins.id,
      sensitiveHousehold: sensitiveHousehold.id,
      sensitivePrivate: sensitivePrivate.id,
    },
    canary,
  };
}

/** One adult's private canaries: a person, an event, a project with a task and a note, context. */
async function canaries(a: UserActor, adult: Adult, db: Db) {
  const deps = { db };
  const mark = CANARY_MARK[adult];
  const p = await createPerson(a, CANARY[adult], deps);
  const ev = await createEventWithPeople(
    a,
    {
      title: `${mark}event`,
      description: `${mark}event-description`,
      location: `${mark}event-location`,
      kind: 'appointment',
      visibility: 'private',
      time: { allDay: true, startDate: '2026-10-16', endDate: '2026-10-17' },
    },
    [{ personId: p.id, role: 'attending' }],
    deps,
  );
  const pr = await createProject(
    a,
    { title: `${mark}project`, summary: `${mark}summary`, visibility: 'private' },
    deps,
  );
  const t = await createTask(
    a,
    { title: `${mark}task`, notes: `${mark}task-notes`, projectId: pr.id, visibility: 'private' },
    deps,
  );
  await createNote(
    a,
    { body: `${mark}note`, subject: { type: 'project', id: pr.id }, visibility: 'private' },
    deps,
  );
  const c = await createContext(
    a,
    {
      subject: { type: 'person', id: p.id },
      content: `${mark}context`,
      category: 'preference',
      visibility: 'private',
    },
    deps,
  );
  return { person: p.id, event: ev.id, project: pr.id, task: t.id, context: c.id };
}

/**
 * §15.2's records, visible only to `adult`: a private event inside the
 * weekend and one on Thursday evening (overlapping their own Thursday, so a
 * conflict); a private task with an estimate and `dry_weather`; a private
 * project with a note; a private person; private context; a private stale
 * calendar; their responses on a conflict and an opening; their
 * conversation, with messages naming the other adult's records.
 */
export async function addPrivateFor(f: KevFixture, adult: Adult, db: Db, admin: Db): Promise<void> {
  const deps = { db };
  const a = f.h[adult];
  const self = adult === 'sam' ? f.id.sam : f.id.alex;
  const tag = `ni-${adult}-`;
  const v = 'private' as const;
  await createEventWithPeople(
    a,
    {
      title: `${tag}weekend`,
      kind: 'other',
      visibility: v,
      time: timed(at(SAT, '13:00'), at(SAT, '15:00')),
    },
    [{ personId: self, role: 'attending' }],
    deps,
  );
  await createEventWithPeople(
    a,
    {
      title: `${tag}thursday`,
      kind: 'other',
      visibility: v,
      time: timed(at(THU, '18:00'), at(THU, '21:00')),
    },
    [{ personId: self, role: 'attending' }],
    deps,
  );
  await createEventWithPeople(
    a,
    {
      title: `${tag}thursday-2`,
      kind: 'other',
      visibility: v,
      time: timed(at(THU, '19:00'), at(THU, '20:00')),
    },
    [{ personId: self, role: 'attending' }],
    deps,
  );
  const project = await createProject(
    a,
    { title: `${tag}project`, summary: `${tag}summary`, visibility: v },
    deps,
  );
  await createTask(
    a,
    {
      title: `${tag}task`,
      estimateMinutes: 120,
      needs: ['dry_weather'],
      projectId: project.id,
      visibility: v,
    },
    deps,
  );
  await createNote(
    a,
    { body: `${tag}note`, subject: { type: 'project', id: project.id }, visibility: v },
    deps,
  );
  const person = await createPerson(
    a,
    {
      name: `${tag}person`,
      role: 'child',
      inHousehold: true,
      dateOfBirth: '2018-01-01',
      visibility: v,
    },
    deps,
  );
  await createContext(
    a,
    {
      subject: { type: 'person', id: person.id },
      content: `${tag}context`,
      category: 'interest',
      visibility: v,
    },
    deps,
  );
  await createContext(
    a,
    {
      subject: { type: 'household' },
      content: `${tag}household-context`,
      category: 'routine',
      visibility: v,
    },
    deps,
  );
  await calendarRow(
    admin,
    a.userId,
    'private',
    `${tag}calendar`,
    at('2026-10-12', '06:00'),
    adult === 'sam' ? '7' : '8',
  );
  // Their responses on whatever conflict and opening they now see.
  const { readConflicts } = await import('@/domain/insights/conflicts');
  const mine = await readConflicts(a, NOW, ZONE, deps);
  if (mine.all[0])
    await respondToInsight(a, mine.all[0].key, 'dismissed', 'today', NOW, ZONE, deps);
  const runner = createToolRunner({
    actor: { ...a, via: 'kev' },
    now: NOW,
    timeZone: ZONE,
    deps,
    attemptId: crypto.randomUUID(),
  });
  const week = await runner.run('get_insights', { surface: 'forward_week' });
  const listed =
    week.kind === 'ran' && week.result.ok
      ? (week.result.data as { insights: { key: string; kind: string }[] }).insights
      : [];
  const opening = listed.find((i) => i.kind === 'open_window');
  if (opening) await respondToInsight(a, opening.key, 'not_useful', 'forward', NOW, ZONE, deps);
  const conversation = await startConversation(a, deps);
  await addMessage(
    a,
    conversation.id,
    {
      role: 'user',
      content: { v: 1, text: `${tag}message about Football and Paint the back fence` },
    },
    deps,
  );
}
