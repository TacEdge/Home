import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as captures from '@/domain/captures/service';
import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import * as context from '@/domain/context/service';
import * as conversations from '@/domain/conversations/service';
import * as events from '@/domain/events/service';
import * as insights from '@/domain/insights/service';
import * as kevUsage from '@/domain/kev-usage/service';
import * as notes from '@/domain/notes/service';
import * as people from '@/domain/people/service';
import * as projects from '@/domain/projects/service';
import * as proposals from '@/domain/proposals/service';
import * as tasks from '@/domain/tasks/service';
import { env } from '@/lib/env';
import { systemActor, type UserActor } from '@/trust/actor';
import { listAudit, recordAudit, type AuditRow } from '@/trust/audit';
import { CANARY_MARK } from '../fixtures/family';
import {
  ARCHIVED_MARK,
  SENSITIVE_MARK,
  seedFixtureFamily,
  type SeedManifest,
} from '../fixtures/seed';
import { adminDb, testDb } from './db';
import { clearDomainRows } from './fixtures';

// The M2 privacy suite (contract §8.3). Seeds the whole synthetic family
// through the services, with each adult's private canary of every type, an
// archived canary of every type and sensitive context, then proves, as each
// adult and as each adult through Kev:
//   - none of the other adult's canaries appears in any read of any service;
//   - sensitive context appears only when a person explicitly asks;
//   - archived records are excluded by default;
//   - Activity (listAudit) shows no row about a record the actor cannot see;
//   - no audit row anywhere carries user-written content;
//   - Kev and the system cannot write anywhere in the M2 domain, beyond the
//     two approved Kev writes (capture verbatim, propose).

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
let seed: Required<SeedManifest>;
type Adult = 'sam' | 'alex';
const OTHER: Record<Adult, Adult> = { sam: 'alex', alex: 'sam' };
const ADULTS: Adult[] = ['sam', 'alex'];

beforeAll(async () => {
  await clearDomainRows(db);
  const s = await seedFixtureFamily(db);
  if (s.status !== 'seeded') throw new Error('the privacy suite needs a fresh seed');
  seed = s as Required<SeedManifest>;
});
afterAll(async () => {
  // Leave no seeded rows (linked people especially) for the suites after this one.
  await clearDomainRows(db);
  await close();
  await admin.close();
});

const actor = (a: Adult, via: 'ui' | 'kev' = 'ui'): UserActor => ({ ...seed.actors[a], via });
const sys = systemActor as unknown as UserActor;
const settle = (p: Promise<unknown>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
const outcome = async (p: Promise<unknown>) => {
  const r = await settle(p);
  if (r.ok) return 'resolved';
  return r.e instanceof NotPermittedError
    ? r.e.code
    : r.e instanceof NotFoundError
      ? 'not_found'
      : String(r.e);
};
const json = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));

async function allAudit(a: UserActor): Promise<AuditRow[]> {
  const out: AuditRow[] = [];
  let before: NonNullable<Parameters<typeof listAudit>[1]>['before'];
  for (let i = 0; i < 1000; i++) {
    const page = await listAudit(a, { limit: 200, before }, deps);
    out.push(...page.rows);
    if (!page.next) break;
    before = page.next;
  }
  return out;
}

/** Everything every read in every M2 service returns to this actor, archived included. */
async function readEverything(a: UserActor, other: Adult): Promise<string> {
  const o = seed.canaries[other];
  const all = { includeArchived: true };
  const results: unknown[] = [
    await people.listPeople(a, all, deps),
    await events.listEvents(a, all, deps),
    await projects.listProjects(a, all, deps),
    await tasks.listTasks(a, all, deps),
    await notes.listNotes(a, all, deps),
    await captures.listCaptures(a, all, deps),
    await context.listContext(a, all, deps),
    await context.listContext(a, { ...all, status: 'retired' }, deps),
    await proposals.listProposals(a, {}, deps),
    await conversations.listConversations(a, all, deps),
    await insights.respondedKeys(
      a,
      [seed.canaries.sam.insightKey, seed.canaries.alex.insightKey],
      deps,
    ),
    await kevUsage.monthToDateCostUsdMicros(a, '2026-10', 'Pacific/Auckland', deps),
    await allAudit(a),
  ];
  for (const e of await events.listEvents(a, all, deps))
    results.push(await events.listEventPeople(a, e.id, all, deps));
  for (const c of await conversations.listConversations(a, all, deps))
    results.push(await conversations.listMessages(a, c.id, all, deps));
  // The other adult's private records, asked for by id: nothing comes back.
  results.push(await conversations.listMessages(a, o.conversation, all, deps));
  results.push(await settle(events.listEventPeople(a, o.event, all, deps)));
  return json(results);
}

describe('one adult’s private records never reach the other', () => {
  it.each(
    ADULTS.flatMap(
      (a) =>
        [
          [a, 'ui'],
          [a, 'kev'],
        ] as const,
    ),
  )(
    '%s (via %s): no read of any service returns the other adult’s canaries or sensitive context',
    async (a, via) => {
      const out = await readEverything(actor(a, via), OTHER[a]);
      expect(out).not.toContain(CANARY_MARK[OTHER[a]]);
      expect(out).not.toContain(SENSITIVE_MARK);
      // The sweep is real: it does read this adult's own private canaries.
      expect(out).toContain(`${CANARY_MARK[a]}event`);
      expect(out).toContain(`${CANARY_MARK[a]}message-user`);
      expect(out).toContain(`${CANARY_MARK[a]}proposal-summary`);
    },
  );

  it.each(ADULTS)(
    '%s: every get of the other adult’s private records is NotFound, archived or not',
    async (a) => {
      const me = actor(a);
      const o = seed.canaries[OTHER[a]];
      const all = { includeArchived: true };
      const gets: Record<string, () => Promise<unknown>> = {
        person: () => people.getPerson(me, o.person, all, deps),
        event: () => events.getEvent(me, o.event, all, deps),
        project: () => projects.getProject(me, o.project, all, deps),
        task: () => tasks.getTask(me, o.task, all, deps),
        note: () => notes.getNote(me, o.note, all, deps),
        context: () => context.getContext(me, o.context, { ...all, includeSensitive: true }, deps),
        capture: () => captures.getCapture(me, o.capture, all, deps),
        proposal: () => proposals.getProposal(me, o.proposal, deps),
        conversation: () => conversations.getConversation(me, o.conversation, all, deps),
      };
      for (const [type, get] of Object.entries(gets))
        expect(await outcome(get()), type).toBe('not_found');
      expect(await insights.respondedKeys(me, [o.insightKey], deps)).toEqual({});
    },
  );
});

describe('sensitive context stays out of every default and automatic read', () => {
  it.each(ADULTS)(
    '%s: default reads never contain it; an explicit request by an authorised adult does',
    async (a) => {
      const me = actor(a);
      const { household, private: priv } = seed.sensitive;
      expect(await outcome(context.getContext(me, household, {}, deps))).toBe('not_found');
      expect(json(await context.listContext(me, { includeArchived: true }, deps))).not.toContain(
        SENSITIVE_MARK,
      );
      expect((await context.getContext(me, household, { includeSensitive: true }, deps)).id).toBe(
        household,
      );
      // The private sensitive record (Alex's) is Alex's alone, even when asked for.
      expect(await outcome(context.getContext(me, priv, { includeSensitive: true }, deps))).toBe(
        a === 'alex' ? 'resolved' : 'not_found',
      );
    },
  );

  it.each(ADULTS)('%s via Kev: can neither request nor receive it', async (a) => {
    const kev = actor(a, 'kev');
    expect(
      await outcome(
        context.getContext(kev, seed.sensitive.household, { includeSensitive: true }, deps),
      ),
    ).toBe('sensitive_context');
    expect(await outcome(context.listContext(kev, { includeSensitive: true }, deps))).toBe(
      'sensitive_context',
    );
    expect(json(await context.listContext(kev, {}, deps))).not.toContain(SENSITIVE_MARK);
  });
});

describe('archived records are excluded by default', () => {
  it('no default list of any service returns an archived record; asking for archived does', async () => {
    const sam = actor('sam');
    const defaults = json([
      await people.listPeople(sam, {}, deps),
      await events.listEvents(sam, {}, deps),
      await projects.listProjects(sam, {}, deps),
      await tasks.listTasks(sam, {}, deps),
      await notes.listNotes(sam, {}, deps),
      await context.listContext(sam, {}, deps),
      await captures.listCaptures(sam, {}, deps),
      await conversations.listConversations(sam, {}, deps),
    ]);
    expect(defaults).not.toContain(ARCHIVED_MARK);
    for (const [type, id] of Object.entries(seed.archived))
      expect(defaults, type).not.toContain(id);
    const all = { includeArchived: true };
    const archived = json([
      await people.listPeople(sam, all, deps),
      await events.listEvents(sam, all, deps),
      await projects.listProjects(sam, all, deps),
      await tasks.listTasks(sam, all, deps),
      await notes.listNotes(sam, all, deps),
      await context.listContext(sam, all, deps),
      await captures.listCaptures(sam, all, deps),
      await conversations.listConversations(sam, all, deps),
    ]);
    for (const [type, id] of Object.entries(seed.archived)) expect(archived, type).toContain(id);
  });

  it('a get of an archived record is NotFound unless archived records are asked for', async () => {
    const sam = actor('sam');
    const a = seed.archived;
    expect(await outcome(people.getPerson(sam, a.person!, {}, deps))).toBe('not_found');
    expect(await outcome(events.getEvent(sam, a.event!, {}, deps))).toBe('not_found');
    expect(await outcome(tasks.getTask(sam, a.task!, {}, deps))).toBe('not_found');
    expect(await outcome(context.getContext(sam, a.context!, {}, deps))).toBe('not_found');
    expect(await outcome(conversations.getConversation(sam, a.conversation!, {}, deps))).toBe(
      'not_found',
    );
    expect(await outcome(tasks.getTask(sam, a.task!, { includeArchived: true }, deps))).toBe(
      'resolved',
    );
  });
});

describe('Activity privacy across every visibility-bearing entity (P-1)', () => {
  it.each(ADULTS)(
    '%s sees no Activity row about the other adult’s private records, and sees their own',
    async (a) => {
      const o = seed.canaries[OTHER[a]];
      const mine = seed.canaries[a];
      const [theirInsight = '', myInsight = ''] = await Promise.all(
        [OTHER[a], a].map(async (x) => {
          const r = await admin.db.execute(
            sql`select id::text from insight_response where user_id = ${seed.actors[x].userId} and insight_key = ${seed.canaries[x].insightKey}`,
          );
          return r.rows[0]?.id as string;
        }),
      );
      const subjects = (c: typeof o, insight: string) => [
        c.person,
        c.event,
        c.project,
        c.task,
        c.note,
        c.context,
        c.capture,
        c.proposal,
        c.conversation,
        insight,
      ];
      const rows = await allAudit(actor(a));
      const seen = new Set(rows.map((r) => r.subjectId));
      for (const id of subjects(o, theirInsight)) expect(seen.has(id), id).toBe(false);
      for (const id of subjects(mine, myInsight)) expect(seen.has(id), id).toBe(true);
      // And no row about any other private record of the other adult's: every
      // private subject the other adult owns, from the database itself.
      const theirPrivate = await admin.db.execute(sql`
        select id::text from person where visibility = 'private' and created_by = ${seed.actors[OTHER[a]].userId}
        union all select id::text from event where visibility = 'private' and created_by = ${seed.actors[OTHER[a]].userId}
        union all select id::text from project where visibility = 'private' and created_by = ${seed.actors[OTHER[a]].userId}
        union all select id::text from task where visibility = 'private' and created_by = ${seed.actors[OTHER[a]].userId}
        union all select id::text from note where visibility = 'private' and created_by = ${seed.actors[OTHER[a]].userId}
        union all select id::text from context where visibility = 'private' and created_by = ${seed.actors[OTHER[a]].userId}
        union all select id::text from capture where created_by = ${seed.actors[OTHER[a]].userId}
        union all select id::text from proposal where requested_by_user_id = ${seed.actors[OTHER[a]].userId}
        union all select id::text from conversation where user_id = ${seed.actors[OTHER[a]].userId}
        union all select id::text from insight_response where user_id = ${seed.actors[OTHER[a]].userId}
        union all select id::text from kev_usage where user_id = ${seed.actors[OTHER[a]].userId}`);
      expect(theirPrivate.rows.length).toBeGreaterThan(10);
      for (const r of theirPrivate.rows)
        expect(seen.has(r.id as string), r.id as string).toBe(false);
    },
  );
});

describe('closeout hardening (ADR 0005 §43)', () => {
  it.each(
    ADULTS.flatMap(
      (a) =>
        [
          [a, 'ui'],
          [a, 'kev'],
        ] as const,
    ),
  )(
    '%s (via %s): Activity shows nothing about any sensitive context, household or private, theirs or not',
    async (a, via) => {
      const rows = await allAudit(actor(a, via));
      const ids = new Set(rows.map((r) => r.subjectId));
      expect(ids.has(seed.sensitive.household)).toBe(false);
      expect(ids.has(seed.sensitive.private)).toBe(false);
    },
  );

  it('the system actor’s Activity omits sensitive context too', async () => {
    const rows = await allAudit(sys as never);
    const ids = new Set(rows.map((r) => r.subjectId));
    expect(ids.has(seed.sensitive.household)).toBe(false);
    expect(ids.has(seed.sensitive.private)).toBe(false);
  });

  it.each(ADULTS)('%s: no context write returns sensitive content', async (a) => {
    const me = actor(a);
    const targets =
      a === 'alex'
        ? [seed.sensitive.household, seed.sensitive.private]
        : [seed.sensitive.household];
    for (const id of targets) {
      const out = json([
        await context.updateContext(me, id, {}, deps),
        await context.updateContext(me, id, { category: 'practical' }, deps),
        await context.confirmContext(me, id, deps),
      ]);
      expect(out).not.toContain(SENSITIVE_MARK);
    }
  });

  it.each(ADULTS)(
    '%s: cannot capture, or propose from, the other adult’s message or conversation',
    async (a) => {
      const o = seed.canaries[OTHER[a]];
      expect(
        await outcome(
          captures.captureVerbatim(actor(a, 'kev'), { messageId: o.userMessage }, deps),
        ),
      ).toBe('not_found');
      expect(
        await outcome(
          captures.captureVerbatim(actor(a), { text: 'x', messageId: o.userMessage }, deps),
        ),
      ).toBe('not_found');
      expect(
        await outcome(captures.captureVerbatim(actor(a, 'kev'), { text: 'Kev wrote this' }, deps)),
      ).toBe('kev_cannot_author');
      expect(
        await outcome(
          proposals.createProposal(
            actor(a, 'kev'),
            {
              action: 'task.create',
              payload: { title: 'x' },
              summary: 'x',
              conversationId: o.conversation,
            },
            deps,
          ),
        ),
      ).toBe('not_found');
    },
  );
});

describe('audit metadata carries no user-written content', () => {
  it('no audit row anywhere contains a canary, captured words, message text, context or any fixture content', async () => {
    const rows = await admin.db.execute(
      sql`select coalesce(summary, '') || ' ' || coalesce(meta::text, '') as t from audit_log`,
    );
    const text = rows.rows.map((r) => r.t).join('\n');
    expect(rows.rows.length).toBeGreaterThan(50);
    for (const needle of [
      CANARY_MARK.sam,
      CANARY_MARK.alex,
      ARCHIVED_MARK,
      SENSITIVE_MARK,
      'dinosaurs',
      'Bins go out',
      'Same green',
      'Paint the back fence',
      'Swimming',
      'Milo',
      'fixture-model',
      'remember the surprise',
    ])
      expect(text, needle).not.toContain(needle);
  });
});

// ---------------------------------------------------------------------------
// Kev and system write restrictions across the full M2 domain (CLAUDE.md
// rules 2–3, contract §5.3). Every exported write function is listed; a
// completeness check fails if a new one is added without being listed here.

type Call = (a: UserActor) => Promise<unknown>;
const KEV_MAY = new Set(['captures.captureVerbatim', 'proposals.createProposal']);
const READS = /^(get|list|respondedKeys|monthToDate|stalenessOf)/;
const INTERNAL = new Set(['captures.lockForProposal', 'captures.settleCapture']);
const MODULES = {
  people,
  events,
  projects,
  tasks,
  notes,
  captures,
  context,
  proposals,
  conversations,
  kevUsage,
  insights,
};

function writeCalls(own: Adult): Record<string, Call> {
  const c = seed.canaries[own];
  const id = crypto.randomUUID();
  const d = deps;
  return {
    'people.createPerson': (a) => people.createPerson(a, { name: 'x', role: 'other' }, d),
    'people.updatePerson': (a) => people.updatePerson(a, c.person, { stageNote: 'x' }, d),
    'people.archivePerson': (a) => people.archivePerson(a, c.person, d),
    'people.restorePerson': (a) => people.restorePerson(a, c.person, d),
    'people.linkSelf': (a) => people.linkSelf(a, c.person, d),
    'people.unlinkSelf': (a) => people.unlinkSelf(a, d),
    'events.createEvent': (a) =>
      events.createEvent(
        a,
        {
          title: 'x',
          kind: 'other',
          time: { allDay: true, startDate: '2026-10-20', endDate: '2026-10-21' },
        },
        d,
      ),
    'events.updateEvent': (a) => events.updateEvent(a, c.event, { title: 'x' }, d),
    'events.archiveEvent': (a) => events.archiveEvent(a, c.event, d),
    'events.restoreEvent': (a) => events.restoreEvent(a, c.event, d),
    'events.setEventPerson': (a) =>
      events.setEventPerson(a, { eventId: c.event, personId: c.person, role: 'responsible' }, d),
    'events.removeEventPerson': (a) =>
      events.removeEventPerson(a, { eventId: c.event, personId: c.person, role: 'attending' }, d),
    'projects.createProject': (a) => projects.createProject(a, { title: 'x' }, d),
    'projects.updateProject': (a) => projects.updateProject(a, c.project, { title: 'x' }, d),
    'projects.archiveProject': (a) => projects.archiveProject(a, c.project, d),
    'projects.restoreProject': (a) => projects.restoreProject(a, c.project, d),
    'tasks.createTask': (a) => tasks.createTask(a, { title: 'x' }, d),
    'tasks.updateTask': (a) => tasks.updateTask(a, c.task, { title: 'x' }, d),
    'tasks.archiveTask': (a) => tasks.archiveTask(a, c.task, d),
    'tasks.restoreTask': (a) => tasks.restoreTask(a, c.task, d),
    'notes.createNote': (a) => notes.createNote(a, { body: 'x' }, d),
    'notes.updateNote': (a) => notes.updateNote(a, c.note, { body: 'x' }, d),
    'notes.archiveNote': (a) => notes.archiveNote(a, c.note, d),
    'notes.restoreNote': (a) => notes.restoreNote(a, c.note, d),
    // Kev may capture only the person's own message (it never supplies words).
    'captures.captureVerbatim': (a) =>
      captures.captureVerbatim(
        a,
        a.via === 'kev' ? { messageId: c.userMessage } : { text: 'a person captures' },
        d,
      ),
    'captures.dismissCapture': (a) => captures.dismissCapture(a, c.capture, d),
    'captures.undismissCapture': (a) => captures.undismissCapture(a, c.capture, d),
    'captures.archiveCapture': (a) => captures.archiveCapture(a, c.capture, d),
    'captures.restoreCapture': (a) => captures.restoreCapture(a, c.capture, d),
    'context.createContext': (a) =>
      context.createContext(
        a,
        { subject: { type: 'household' }, content: 'x', category: 'other' },
        d,
      ),
    'context.updateContext': (a) => context.updateContext(a, c.context, { content: 'x' }, d),
    'context.confirmContext': (a) => context.confirmContext(a, c.context, d),
    'context.retireContext': (a) => context.retireContext(a, c.context, d),
    'context.reinstateContext': (a) => context.reinstateContext(a, c.context, d),
    'context.archiveContext': (a) => context.archiveContext(a, c.context, d),
    'context.restoreContext': (a) => context.restoreContext(a, c.context, d),
    'proposals.createProposal': (a) =>
      proposals.createProposal(
        a,
        { action: 'task.create', payload: { title: 'x' }, summary: 'Add x' },
        d,
      ),
    'proposals.approveProposal': (a) => proposals.approveProposal(a, c.proposal, d),
    'proposals.rejectProposal': (a) => proposals.rejectProposal(a, c.proposal, d),
    'proposals.expireOverdueProposals': (a) => proposals.expireOverdueProposals(a, d),
    'proposals.approveMany': (a) => proposals.approveMany(a, [c.proposal], d),
    'conversations.startConversation': (a) => conversations.startConversation(a, d),
    'conversations.addMessage': (a) =>
      conversations.addMessage(
        a,
        c.conversation,
        { role: 'user', content: { v: 1, text: 'x' } },
        d,
      ),
    'conversations.archiveConversation': (a) =>
      conversations.archiveConversation(a, c.conversation, d),
    'conversations.restoreConversation': (a) =>
      conversations.restoreConversation(a, c.conversation, d),
    'kevUsage.recordUsage': (a) =>
      kevUsage.recordUsage(a, { tier: 'fast', model: 'm', costUsdMicros: 1 }, d),
    'insights.respond': (a) => insights.respond(a, `k-${id}`, 'dismissed', d),
  };
}

describe('Kev and the system cannot write anywhere in the M2 domain', () => {
  it('every exported write function of every M2 service is covered here', () => {
    const exported = Object.entries(MODULES).flatMap(([m, mod]) =>
      Object.entries(mod)
        .filter(([name, f]) => typeof f === 'function' && !READS.test(name))
        .map(([name]) => `${m}.${name}`)
        .filter((n) => !INTERNAL.has(n)),
    );
    expect(Object.keys(writeCalls('sam')).sort()).toEqual(exported.sort());
  });

  it.each(ADULTS)(
    '%s via Kev: refused (kev_cannot_write) everywhere but capture and propose',
    async (a) => {
      const before = await admin.db.execute(sql`select count(*)::int as n from audit_log`);
      let allowedWrites = 0;
      for (const [name, call] of Object.entries(writeCalls(a))) {
        const r = await outcome(call(actor(a, 'kev')));
        if (KEV_MAY.has(name)) {
          expect(r, name).toBe('resolved');
          allowedWrites += 1;
        } else expect(r, name).toBe('kev_cannot_write');
      }
      const after = await admin.db.execute(sql`select count(*)::int as n from audit_log`);
      // Only the two approved Kev writes reached the log (a capture; a proposal).
      expect(Number(after.rows[0]?.n) - Number(before.rows[0]?.n)).toBe(allowedWrites);
    },
  );

  it('the system actor: refused (not_a_user) everywhere, including capture and propose', async () => {
    const before = await admin.db.execute(sql`select count(*)::int as n from audit_log`);
    for (const [name, call] of Object.entries(writeCalls('sam')))
      expect(await outcome(call(sys)), name).toBe('not_a_user');
    const after = await admin.db.execute(sql`select count(*)::int as n from audit_log`);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});

// ---------------------------------------------------------------------------
// The production real-data gate (ADR 0006 §2, M3 contract §6). With Vercel
// Production simulated, every exported family-domain write is refused before
// it writes anything, unless HOME_REAL_DATA is exactly `open`. Auth audit,
// Activity and audited reads keep working.

describe('the real-data gate in Production', () => {
  const saved = { VERCEL_ENV: process.env.VERCEL_ENV, HOME_REAL_DATA: process.env.HOME_REAL_DATA };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const production = (value: string | undefined) => {
    // Parse the validated environment first, as it is at boot, so simulating
    // Vercel here changes only what the gate reads (on every call).
    void env.HOME_TIMEZONE;
    process.env.VERCEL_ENV = 'production';
    if (value === undefined) delete process.env.HOME_REAL_DATA;
    else process.env.HOME_REAL_DATA = value;
  };
  const auditCount = async () =>
    Number((await admin.db.execute(sql`select count(*)::int as n from audit_log`)).rows[0]?.n);

  it.each([undefined, '', 'OPEN', ' open', 'open ', 'true', '1'])(
    'HOME_REAL_DATA=%j: every family-domain write is refused and nothing is written',
    async (value) => {
      const before = await auditCount();
      production(value);
      try {
        for (const a of ADULTS)
          for (const [name, call] of Object.entries(writeCalls(a)))
            expect(await outcome(call(actor(a))), name).toBe('real_data_closed');
        // The no-op context update is a write request too.
        expect(
          await outcome(context.updateContext(actor('sam'), seed.canaries.sam.context, {}, deps)),
        ).toBe('real_data_closed');
      } finally {
        restore();
      }
      expect(await auditCount()).toBe(before);
    },
  );

  it('auth audit, Activity and audited sensitive reads keep working while it is closed', async () => {
    production(undefined);
    try {
      const sam = actor('sam');
      const { id } = await recordAudit(sam, { event: 'auth.sign_in' }, { db });
      const page = await listAudit(sam, { limit: 5 }, { db });
      expect(page.rows.map((r) => r.id)).toContain(id);
      const read = await context.getContext(
        sam,
        seed.sensitive.household,
        { includeSensitive: true },
        deps,
      );
      expect(read.id).toBe(seed.sensitive.household);
    } finally {
      restore();
    }
  });

  it('opens only for the exact value `open`', async () => {
    production('open');
    try {
      const t = await tasks.createTask(
        actor('alex'),
        { title: 'gate open', visibility: 'private' },
        deps,
      );
      expect(t.id).toBeTruthy();
    } finally {
      restore();
    }
  });
});
