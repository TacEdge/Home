import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/create';
import { person, user } from '@/db/schema';
import { archiveCapture, captureVerbatim } from '@/domain/captures/service';
import { archiveContext, createContext } from '@/domain/context/service';
import { addMessage, archiveConversation, startConversation } from '@/domain/conversations/service';
import { archiveEvent, createEvent, setEventPerson } from '@/domain/events/service';
import { respond } from '@/domain/insights/service';
import { recordUsage } from '@/domain/kev-usage/service';
import { archiveNote, createNote } from '@/domain/notes/service';
import { archivePerson, createPerson, linkSelf } from '@/domain/people/service';
import { archiveProject, createProject } from '@/domain/projects/service';
import { createProposal } from '@/domain/proposals/service';
import { archiveTask, createTask } from '@/domain/tasks/service';
import type { UserActor } from '@/trust/actor';
import {
  CANARY,
  CANARY_MARK,
  FAMILY_EVENTS,
  FAMILY_NOTES,
  FAMILY_PEOPLE,
  FAMILY_PROJECTS,
  FAMILY_TASKS,
} from './family';
import { ALEX, SAM } from './users';

// The fixture seed (M2 contract §7): the synthetic household from
// docs/concepts/README.md, written entirely through the domain services as
// the two fixture adults, so it obeys every rule the app does. For the
// privacy suite it adds, for each adult, a private canary record of every
// user-facing type, and an archived household canary of every type. Every
// canary string starts with CANARY_MARK[adult] or ARCHIVED_MARK, so a test
// can search any output for a leak. Synthetic only (D-M2-8).

export const ARCHIVED_MARK = 'canary-archived-';
export const SENSITIVE_MARK = 'canary-sensitive-';

type Adult = 'sam' | 'alex';
export type CanaryIds = {
  person: string;
  event: string;
  project: string;
  task: string;
  note: string;
  context: string;
  capture: string;
  proposal: string;
  conversation: string;
  userMessage: string;
  insightKey: string;
};
export type SeedManifest = {
  status: 'seeded' | 'already_seeded';
  actors?: Record<Adult, UserActor>;
  canaries?: Record<Adult, CanaryIds>;
  archived?: Record<string, string>;
  sensitive?: { household: string; private: string };
};

async function fixtureUser(
  db: Db,
  f: { name: string; email: string },
  id: string,
): Promise<UserActor> {
  await db.insert(user).values({ id, name: f.name, email: f.email }).onConflictDoNothing();
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, f.email));
  if (!row) throw new Error('fixture user missing');
  return { kind: 'user', userId: row.id, email: f.email, via: 'ui', channel: 'web' };
}

/** Every user-facing type, private to one adult, each carrying that adult's canary mark. */
async function canaries(db: Db, a: UserActor, adult: Adult): Promise<CanaryIds> {
  const mark = CANARY_MARK[adult];
  const deps = { db };
  const kev: UserActor = { ...a, via: 'kev' };
  const v = 'private' as const;
  const p = await createPerson(a, CANARY[adult], deps);
  const ev = await createEvent(
    a,
    {
      title: `${mark}event`,
      description: `${mark}event-description`,
      kind: 'appointment',
      visibility: v,
      time: { allDay: true, startDate: '2026-10-16', endDate: '2026-10-17' },
    },
    deps,
  );
  await setEventPerson(a, { eventId: ev.id, personId: p.id, role: 'attending' }, deps);
  const pr = await createProject(
    a,
    { title: `${mark}project`, summary: `${mark}summary`, visibility: v },
    deps,
  );
  const t = await createTask(
    a,
    {
      title: `${mark}task`,
      notes: `${mark}task-notes`,
      projectId: pr.id,
      aboutPersonId: p.id,
      visibility: v,
    },
    deps,
  );
  const n = await createNote(
    a,
    { body: `${mark}note`, subject: { type: 'project', id: pr.id }, visibility: v },
    deps,
  );
  const c = await createContext(
    a,
    {
      subject: { type: 'person', id: p.id },
      content: `${mark}context`,
      category: 'preference',
      visibility: v,
    },
    deps,
  );
  // Kev never authors a capture: it captures the person's own message, word for word.
  const conv = await startConversation(a, deps);
  const said = await addMessage(
    a,
    conv.id,
    { role: 'user', content: { v: 1, text: `${mark}capture: remember the surprise` } },
    deps,
  );
  const cap = await captureVerbatim(kev, { messageId: said.id }, deps);
  const prop = await createProposal(
    kev,
    {
      action: 'task.create',
      payload: { title: `${mark}proposal-task`, visibility: 'private' },
      summary: `${mark}proposal-summary`,
      captureId: cap.id,
      conversationId: conv.id,
    },
    deps,
  );
  const userMessage = await addMessage(
    a,
    conv.id,
    { role: 'user', content: { v: 1, text: `${mark}message-user` } },
    deps,
  );
  await addMessage(
    a,
    conv.id,
    {
      role: 'kev',
      tier: 'fast',
      model: 'fixture-model',
      content: { v: 1, text: `${mark}message-kev`, proposalIds: [prop.id] },
    },
    deps,
  );
  await recordUsage(
    a,
    {
      conversationId: conv.id,
      tier: 'fast',
      model: 'fixture-model',
      inputTokens: 900,
      outputTokens: 120,
      costUsdMicros: 2400,
    },
    deps,
  );
  const insightKey = `${mark}insight-key`;
  await respond(a, insightKey, 'dismissed', deps);
  return {
    person: p.id,
    event: ev.id,
    project: pr.id,
    task: t.id,
    note: n.id,
    context: c.id,
    capture: cap.id,
    proposal: prop.id,
    conversation: conv.id,
    userMessage: userMessage.id,
    insightKey,
  };
}

/** Seeds the fixture family once; a second run finds it and does nothing. */
export async function seedFixtureFamily(db: Db): Promise<SeedManifest> {
  const deps = { db };
  const sam = await fixtureUser(db, SAM, 'fixture-sam');
  const alex = await fixtureUser(db, ALEX, 'fixture-alex');
  const [existing] = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.userId, sam.userId)))
    .limit(1);
  if (existing) return { status: 'already_seeded' };

  // People: each adult's own record (linked), the children, Nana Jo.
  const samP = await createPerson(sam, FAMILY_PEOPLE.sam, deps);
  await linkSelf(sam, samP.id, deps);
  const alexP = await createPerson(alex, FAMILY_PEOPLE.alex, deps);
  await linkSelf(alex, alexP.id, deps);
  const milo = await createPerson(sam, FAMILY_PEOPLE.milo, deps);
  const isla = await createPerson(alex, FAMILY_PEOPLE.isla, deps);
  await createPerson(sam, FAMILY_PEOPLE.nanaJo, deps);

  // The week: swimming (Milo attends, Sam responsible), football, a birthday.
  const swim = await createEvent(sam, FAMILY_EVENTS.swimming, deps);
  await setEventPerson(sam, { eventId: swim.id, personId: milo.id, role: 'attending' }, deps);
  await setEventPerson(sam, { eventId: swim.id, personId: samP.id, role: 'responsible' }, deps);
  const football = await createEvent(alex, FAMILY_EVENTS.football, deps);
  await setEventPerson(alex, { eventId: football.id, personId: isla.id, role: 'attending' }, deps);
  await createEvent(sam, FAMILY_EVENTS.nanaJoBirthday, deps);

  // Projects, tasks and a note.
  const fence = await createProject(sam, FAMILY_PROJECTS.backFence, deps);
  const garage = await createProject(alex, FAMILY_PROJECTS.garage, deps);
  await createTask(
    sam,
    { ...FAMILY_TASKS.paintFence, projectId: fence.id, assigneePersonId: samP.id },
    deps,
  );
  await createTask(alex, { ...FAMILY_TASKS.garageLight, projectId: garage.id }, deps);
  await createNote(
    sam,
    { ...FAMILY_NOTES.fenceColour, subject: { type: 'project', id: fence.id } },
    deps,
  );

  // What Kev knows: an interest, a household routine, and sensitive context
  // (household and private) that no default or automatic read may return.
  await createContext(
    sam,
    {
      subject: { type: 'person', id: milo.id },
      content: 'Enjoys dinosaurs at the moment.',
      category: 'interest',
    },
    deps,
  );
  await createContext(
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

  // Each adult's private canaries of every type.
  const canarySam = await canaries(db, sam, 'sam');
  const canaryAlex = await canaries(db, alex, 'alex');

  // Archived household canaries of every archivable type, for "archived is excluded by default".
  const am = ARCHIVED_MARK;
  const archived: Record<string, string> = {};
  const ap = await createPerson(
    sam,
    { name: `${am}person`, role: 'other', inHousehold: false },
    deps,
  );
  archived.person = (await archivePerson(sam, ap.id, deps)).id;
  const ae = await createEvent(
    sam,
    {
      title: `${am}event`,
      kind: 'other',
      time: { allDay: true, startDate: '2026-10-18', endDate: '2026-10-19' },
    },
    deps,
  );
  archived.event = (await archiveEvent(sam, ae.id, deps)).id;
  const apr = await createProject(sam, { title: `${am}project` }, deps);
  archived.project = (await archiveProject(sam, apr.id, deps)).id;
  const at = await createTask(sam, { title: `${am}task` }, deps);
  archived.task = (await archiveTask(sam, at.id, deps)).id;
  const an = await createNote(sam, { body: `${am}note` }, deps);
  archived.note = (await archiveNote(sam, an.id, deps)).id;
  const ac = await createContext(
    sam,
    { subject: { type: 'household' }, content: `${am}context`, category: 'other' },
    deps,
  );
  archived.context = (await archiveContext(sam, ac.id, deps)).id;
  const acap = await captureVerbatim(sam, { text: `${am}capture` }, deps);
  archived.capture = (await archiveCapture(sam, acap.id, deps)).id;
  const aconv = await startConversation(sam, deps);
  await addMessage(sam, aconv.id, { role: 'user', content: { v: 1, text: `${am}message` } }, deps);
  archived.conversation = (await archiveConversation(sam, aconv.id, deps)).id;

  return {
    status: 'seeded',
    actors: { sam, alex },
    canaries: { sam: canarySam, alex: canaryAlex },
    archived,
    sensitive: { household: sensitiveHousehold.id, private: sensitivePrivate.id },
  };
}
