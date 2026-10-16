import { sql } from 'drizzle-orm';
import type { ProviderRequest, NeutralToolResult } from '@/kev/providers/types';
import {
  createScriptedProvider,
  type ScriptEntry,
  type ScriptedCount,
  type ScriptStep,
} from '@/kev/providers/scripted';
import { BUNDLE_LEAD, handle, type KevDeps, type KevEvent } from '@/kev/orchestrator';
import { LEAD_IDS, LEADS } from '@/kev/answer/catalogue';
import type { Ref } from '@/kev/tools/types';
import type { UserActor } from '@/trust/actor';
import type { adminDb } from './db';

// Helpers for driving kev.handle() with the scripted provider as home_app
// (M8 contract §12.1 layer 2; §15.3 "the turn"). A database clock that
// ticks (unlike ./clock.ts's frozen one): `now()` on the clocked pool is the
// real transaction time plus an offset the test sets, so each turn's
// messages, usage rows and reservations fall in a month of the test's own,
// in order, and the per-adult limits are paced by moving the offset. Each
// Package 3 suite uses months no other suite uses (2040–2042).

type Admin = ReturnType<typeof adminDb>;

export async function createTickingClock(admin: Admin): Promise<void> {
  await admin.db.execute(
    sql.raw(`
    drop schema if exists home_test_clock cascade;
    create schema home_test_clock;
    create table home_test_clock.clock (off interval not null default '0');
    insert into home_test_clock.clock values (default);
    create function home_test_clock.now() returns timestamptz language sql stable
      as $$ select pg_catalog.now() + (select c.off from home_test_clock.clock c) $$;
    grant usage on schema home_test_clock to home_app;
    grant select on home_test_clock.clock to home_app;
    grant execute on function home_test_clock.now() to home_app;
  `),
  );
}

/** Moves the clocked pool's `now()` to this instant (it then ticks on in real time). Tests only ever move it forward. */
export async function clockTo(admin: Admin, instant: string): Promise<void> {
  await admin.db.execute(
    sql`update home_test_clock.clock set off = ${instant}::timestamptz - pg_catalog.now()`,
  );
}

/** Moves the clock forward (never back: rows are ordered by the clock). */
export async function clockForward(admin: Admin, minutes: number): Promise<void> {
  await admin.db.execute(
    sql`update home_test_clock.clock set off = off + make_interval(secs => ${Math.round(minutes * 60)})`,
  );
}

/** The clocked now, as an ISO string, read through the admin connection. */
export async function clockNow(admin: Admin): Promise<string> {
  const r = await admin.db.execute<{ t: string }>(
    sql`select to_char((pg_catalog.now() + (select off from home_test_clock.clock)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t`,
  );
  return r.rows[0]!.t;
}

// ---------------------------------------------------------------------------
// Scripted steps.

const wireRef = (r: Ref) => ({ type: r.type, id: r.id, at: r.at ?? null });

/** An absence's or count's scope, as the plan carries it (owner amendment, ADR 0012 §46). */
export type ScopeIn = {
  of?: 'agenda' | 'conflicts' | 'forecast' | 'search';
  from?: string | null;
  to?: string | null;
  people?: string[];
  part?: 'morning' | 'afternoon' | 'evening' | null;
  else?: boolean;
};
/** A fact block: a record by its ref (its usual fields), with `show`, or an absence or count. */
export type FactIn = Ref | { ref: Ref; show: string[] } | { absence: ScopeIn } | { count: ScopeIn };

const scopeOf = (s: ScopeIn) => ({
  of: s.of ?? 'agenda',
  from: s.from ?? null,
  to: s.to ?? null,
  people: s.people ?? [],
  part: s.part ?? null,
  else: s.else ?? false,
});
function factOf(f: FactIn): Record<string, unknown> {
  if ('absence' in f) return { kind: 'absence', ref: null, show: [], scope: scopeOf(f.absence) };
  if ('count' in f) return { kind: 'count', ref: null, show: [], scope: scopeOf(f.count) };
  if ('show' in f) return { kind: f.ref.type, ref: wireRef(f.ref), show: f.show, scope: null };
  return { kind: f.type, ref: wireRef(f), show: [], scope: null };
}

/** Kev's view as the plan carries it: a type, a phrase id and the blocks it is about. */
export type ViewIn = { type: string; phrase: string; about: number[] };

/**
 * A lead as the plan carries it: HOME's catalogue id, given by id or by its
 * words (so a test reads as the adult sees it: 'Here’s {when}.' is `when`).
 * Any other string is a model writing its own words, which the schema
 * refuses (`answer.schema`).
 */
export const leadOf = (lead: string): string =>
  LEAD_IDS.find((id) => id === lead || LEADS[id].text === lead) ?? lead;

/** A final answer plan (the flat, structured-output shape): a lead, the facts chosen, a typed view. */
export function answerInput(
  lead: string,
  facts: FactIn[] = [],
  view: ViewIn | null = null,
): Record<string, unknown> {
  return { lead: leadOf(lead), facts: facts.map(factOf), view, decline: null };
}

/** The same plan as the structured-output text. */
export function answer(lead: string, facts: FactIn[] = [], view: ViewIn | null = null): ScriptStep {
  return { kind: 'answer', text: [JSON.stringify(answerInput(lead, facts, view))] };
}

export const decline = (code: string): ScriptStep => ({
  kind: 'answer',
  text: [JSON.stringify({ lead: null, facts: [], view: null, decline: code })],
});

export const plain = (text: string): ScriptStep => ({ kind: 'answer', text: [text] });

export const tools = (...calls: [string, unknown][]): ScriptStep => ({
  kind: 'answer',
  toolUses: calls.map(([name, input]) => ({ name, input })),
});

/** The tool results of the request's last message, parsed (in order). */
export function lastResults(req: ProviderRequest): unknown[] {
  const m = req.messages.at(-1);
  if (!m || m.role !== 'user') return [];
  return m.content
    .filter((b): b is NeutralToolResult => b.type === 'tool_result')
    .map((b) => JSON.parse(b.content) as unknown);
}

/** The bundle the request carried, parsed. */
export function bundleOf(req: ProviderRequest): Record<string, unknown> {
  for (const m of req.messages)
    if (m.role === 'user')
      for (const b of m.content)
        if (b.type === 'text' && b.text.startsWith(BUNDLE_LEAD))
          return JSON.parse(b.text.slice(BUNDLE_LEAD.length)) as Record<string, unknown>;
  throw new Error('no bundle in the request');
}

/**
 * A request as bytes, for comparisons: the system prompt, tools, answer
 * schema, tool choice and every message's text and tool results; a
 * replayed assistant turn (sealed: never serialisable) as a marker.
 */
export function requestBytes(req: ProviderRequest): string {
  return JSON.stringify({
    tier: req.tier,
    system: req.system,
    tools: req.tools,
    toolChoice: req.toolChoice,
    outputFormat: req.outputFormat ?? null,
    messages: req.messages.map((m) =>
      'replay' in m
        ? { role: 'assistant', replay: true }
        : {
            role: m.role,
            content: m.content.map((b) =>
              b.type === 'text'
                ? { text: b.text }
                : { result: b.content, error: (b as NeutralToolResult).isError === true },
            ),
          },
    ),
  });
}

// ---------------------------------------------------------------------------
// A turn.

export type Turn = {
  events: KevEvent[];
  provider: ReturnType<typeof createScriptedProvider>;
  done: Extract<KevEvent, { type: 'done' }>;
};

export async function runTurn(
  actor: UserActor,
  text: string,
  script: ScriptEntry[],
  opts: {
    now: Date;
    db: KevDeps['db'];
    deps?: Omit<KevDeps, 'db' | 'provider'>;
    count?: (r: ProviderRequest, i: number) => ScriptedCount;
    onCall?: () => void | Promise<void>;
    focus?: 'today';
  },
): Promise<Turn> {
  const provider = createScriptedProvider(script, {
    ...(opts.count ? { count: opts.count } : {}),
    ...(opts.onCall ? { onCall: opts.onCall } : {}),
  });
  const events: KevEvent[] = [];
  for await (const e of handle(
    {
      actor,
      channel: 'web',
      input: { text },
      now: opts.now,
      ...(opts.focus ? { focus: { kind: opts.focus } } : {}),
    },
    { db: opts.db, provider, ...opts.deps },
  ))
    events.push(e);
  const done = events.at(-1);
  if (!done || done.type !== 'done') throw new Error('a turn always ends with done');
  return { events, provider, done };
}

export type StoredRow = {
  role: 'user' | 'kev';
  content: Record<string, unknown>;
  tier: string | null;
  model: string | null;
  created_at: string;
};

/** An adult's messages in their active conversation, oldest first (admin read). */
export async function messagesOf(admin: Admin, userId: string): Promise<StoredRow[]> {
  const r = await admin.db.execute<StoredRow>(sql`
    select m.role, m.content, m.tier, m.model, m.created_at::text as created_at
      from message m join conversation c on c.id = m.conversation_id
     where c.user_id = ${userId} and c.archived_at is null
     order by m.created_at, m.id`);
  return r.rows;
}
