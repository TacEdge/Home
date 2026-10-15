import { sql } from 'drizzle-orm';
import type { Db } from '@/db/create';
import { connectCalendar } from '@/domain/calendar/service';
import { refreshCalendar } from '@/domain/calendar/sync';
import { captureVerbatim } from '@/domain/captures/service';
import { NotPermittedError } from '@/domain/common/errors';
import { createContext } from '@/domain/context/service';
import { addMessage, startConversation } from '@/domain/conversations/service';
import { createEventWithPeople } from '@/domain/events/service';
import { respondToInsight } from '@/domain/insights/today';
import { createNote } from '@/domain/notes/service';
import { createPerson, linkSelf } from '@/domain/people/service';
import { createProject } from '@/domain/projects/service';
import { createTask } from '@/domain/tasks/service';
import { toStoredHour } from '@/domain/weather/provider';
import { fakeProvider } from '@/integrations/calendar/fake';
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
import { googleFeed, nzEvent, SYNTHETIC_ADDRESS } from '../fixtures/calendars/google';
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

export const timed = (start: Date, end: Date) => ({
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

/** What `addPrivateFor` made, for S2's presence checks, and the links the domain refused. */
export type PrivateAdded = {
  series: string;
  overlap: string;
  synced: string[];
  syncedCalendar: string;
  taskInFence: string;
  birthdayPerson: string;
  miloContext: string;
  miloSensitive: string;
  capture: string;
  /** Household records that would point at a private one: each refused by the domain. */
  refused: Record<string, string>;
};

/**
 * §15.2's records, visible only to `adult`: a private event inside the
 * weekend and one on Thursday evening (overlapping their own Thursday, so a
 * conflict); a private task with an estimate and `dry_weather`; a private
 * project with a note; a private person; private context; a private stale
 * calendar; their responses on a conflict and an opening; their
 * conversation, with messages naming the other adult's records.
 *
 * And the harder joins, each reaching a household record from a private
 * one: a private weekly series with Milo attending; a private calendar,
 * synced (Milo its default person: a one-off and a weekly series with no
 * people of their own), whose last refresh then failed and whose last
 * success is two days old; a private task in the household Back fence
 * project, assigned to Milo, due and scheduled; a private person whose
 * birthday falls in the coming week; private context about Milo, normal
 * and sensitive; a private event Milo is responsible for that overlaps
 * Football (a conflict for Milo only its owner can see); a private
 * capture. The reverse links (a household record pointing at a private
 * one) are refused by the domain (`references_private`): that refusal is
 * the boundary, so they are attempted, recorded and never made.
 */
export async function addPrivateFor(
  f: KevFixture,
  adult: Adult,
  db: Db,
  admin: Db,
): Promise<PrivateAdded> {
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
  if (!mine.all[0]) throw new Error('the fixture should give them a conflict to respond to');
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
  if (!opening) throw new Error('the fixture should give them an opening to respond to');
  await respondToInsight(a, opening.key, 'not_useful', 'forward', NOW, ZONE, deps);
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

  // The harder joins: private records reaching household ones.
  const series = await createEventWithPeople(
    a,
    {
      title: `${tag}series`,
      kind: 'activity',
      visibility: v,
      time: timed(at('2026-10-16', '16:00'), at('2026-10-16', '17:00')),
      rrule: 'FREQ=WEEKLY;BYDAY=FR',
    },
    [{ personId: f.id.milo, role: 'attending' }],
    deps,
  );
  const overlap = await createEventWithPeople(
    a,
    {
      title: `${tag}overlap`,
      kind: 'other',
      visibility: v,
      time: timed(at(SAT, '09:30'), at(SAT, '10:30')),
    },
    [{ personId: f.id.milo, role: 'responsible' }],
    deps,
  );
  const taskInFence = await createTask(
    a,
    {
      title: `${tag}task-in-fence`,
      projectId: f.id.fence,
      assigneePersonId: f.id.milo,
      dueDate: '2026-10-16',
      scheduled: {
        startsAt: at('2026-10-16', '10:00').toISOString(),
        endsAt: at('2026-10-16', '11:00').toISOString(),
      },
      visibility: v,
    },
    deps,
  );
  const birthdayPerson = await createPerson(
    a,
    {
      name: `${tag}birthday-person`,
      role: 'other',
      inHousehold: false,
      dateOfBirth: '2016-10-19',
      visibility: v,
    },
    deps,
  );
  const miloContext = await createContext(
    a,
    {
      subject: { type: 'person', id: f.id.milo },
      content: `${tag}milo-context`,
      category: 'interest',
      visibility: v,
    },
    deps,
  );
  const miloSensitive = await createContext(
    a,
    {
      subject: { type: 'person', id: f.id.milo },
      content: `${SENSITIVE_MARK}${tag}milo-sensitive`,
      category: 'other',
      sensitivity: 'sensitive',
      visibility: v,
    },
    deps,
  );
  const capture = await captureVerbatim(a, { text: `${tag}capture` }, deps);

  // A private calendar, synced, with Milo as its default person; then a failed refresh.
  const { calendarId: syncedCalendar } = await connectCalendar(
    a,
    {
      address: SYNTHETIC_ADDRESS.replace(
        'private-0123456789abcdef0123456789abcdef',
        `private-${(adult === 'sam' ? '5a' : 'a1').repeat(16)}`,
      ),
      name: `${tag}synced-calendar`,
      visibility: v,
      defaultKind: 'activity',
      defaultPersonIds: [f.id.milo],
    },
    deps,
  );
  const feed = googleFeed([
    nzEvent({
      uid: `${tag}synced-sat@example.test`,
      start: '20261017T110000',
      end: '20261017T120000',
      summary: `${tag}synced-sat`,
    }),
    nzEvent({
      uid: `${tag}synced-weekly@example.test`,
      start: '20261015T070000',
      end: '20261015T073000',
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      summary: `${tag}synced-weekly`,
    }),
  ]);
  const provider = fakeProvider([{ ics: feed }, { fail: 'unreachable' }], {
    homeTimeZone: ZONE,
  });
  const first = await refreshCalendar(a, syncedCalendar, provider, { today: '2026-10-14' }, deps);
  if (first.status !== 'ok') throw new Error('the private calendar should sync');
  provider.advance();
  const second = await refreshCalendar(a, syncedCalendar, provider, { today: '2026-10-14' }, deps);
  if (second.status === 'ok') throw new Error('the private calendar should fail its refresh');
  // Fixed times, so the failing, stale state reads the same on every run.
  await admin.execute(sql`
    update calendar_source set last_synced_at = ${at('2026-10-12', '06:00').toISOString()}::timestamptz,
                               last_attempt_at = ${at('2026-10-14', '06:30').toISOString()}::timestamptz
    where id = ${syncedCalendar}::uuid`);
  const synced = (
    await admin.execute<{ id: string }>(
      sql`select id from event where calendar_source_id = ${syncedCalendar}::uuid order by external_uid`,
    )
  ).rows.map((r) => r.id);
  if (synced.length !== 2) throw new Error('the private calendar should hold two events');

  // The reverse links: a household record may not point at a private one.
  const refusedCode = async (write: () => Promise<unknown>) =>
    write().then(
      () => 'made',
      (e: unknown) => (e instanceof NotPermittedError ? e.code : 'other'),
    );
  const refused = {
    householdTaskForPrivatePerson: await refusedCode(() =>
      createTask(a, { title: `${tag}refused-1`, assigneePersonId: birthdayPerson.id }, deps),
    ),
    householdTaskInPrivateProject: await refusedCode(() =>
      createTask(a, { title: `${tag}refused-2`, projectId: project.id }, deps),
    ),
    householdEventWithPrivatePerson: await refusedCode(() =>
      createEventWithPeople(
        a,
        {
          title: `${tag}refused-3`,
          kind: 'other',
          time: timed(at(SAT, '16:00'), at(SAT, '17:00')),
        },
        [{ personId: birthdayPerson.id, role: 'attending' }],
        deps,
      ),
    ),
    householdContextAboutPrivatePerson: await refusedCode(() =>
      createContext(
        a,
        {
          subject: { type: 'person', id: birthdayPerson.id },
          content: `${tag}refused-4`,
          category: 'interest',
        },
        deps,
      ),
    ),
  };

  return {
    series: series.id,
    overlap: overlap.id,
    synced,
    syncedCalendar,
    taskInFence: taskInFence.id,
    birthdayPerson: birthdayPerson.id,
    miloContext: miloContext.id,
    miloSensitive: miloSensitive.id,
    capture: capture.id,
    refused,
  };
}
