import { and, desc, eq, exists, not, or, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '@/db/schema';
import { systemActor, type Actor } from '@/trust/actor';
import { listAudit, listAuditQuery, type AuditCursor } from '@/trust/audit';
import { auditSubjects } from '@/trust/audit-subjects';
import { visibleTo, type VisibilityColumns } from '@/trust/visibility';
import { testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// Issue #77: the Activity query (listAudit → auditVisibleTo) tests each row's
// subject with uncorrelated, hashed `in (select …)` lookups instead of
// correlated EXISTS subqueries that Postgres costed per row, which pushed the
// plan over the JIT thresholds as the log grew. These tests prove that
// (1) every actor lists exactly what the old predicate listed, in the same
// order, across pages; (2) a two-adult dataset with every registered subject
// type lists what P-1 says each adult may see; (3) on a 5,000-row log the plan
// tests every subject with a hashed lookup and stays far below the cost at
// which Postgres would JIT-compile it. Structural, not wall-clock: nothing
// here depends on the machine's speed.
//
// Everything is written inside a transaction that is rolled back, so the
// shared test log does not grow for the suites that run after this one.

const { db, close } = testDb();
let h: Household;
beforeAll(async () => {
  h = await ensureFixtureUsers(db);
});
afterAll(async () => {
  await close();
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back. */
async function rolledBack<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: { value: T } | undefined;
  await db
    .transaction(async (tx) => {
      out = { value: await fn(tx) };
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
  if (!out) throw new Error('transaction produced no result');
  return out.value;
}

// ---- The predicate as it was before issue #77, kept as the reference ----
// A verbatim copy of auditVisibleTo and aboutSensitive from before the
// change (correlated EXISTS, `id::text = subject_id`), over the same
// registry. Only for comparison: never use it in application code.

function referenceVisibleTo(actor: Actor): SQL {
  const everSensitive = sql`exists (select 1 from ${auditLog} prior
    where prior.subject_type = ${auditLog.subjectType} and prior.subject_id = ${auditLog.subjectId}
      and prior.meta ->> 'sensitivity' = 'sensitive')`;
  const sensitiveParts = Object.entries(auditSubjects)
    .filter(([, s]) => s.sensitivity)
    .map(([type, s]) => {
      const same = sql`${s.table.id}::text = ${auditLog.subjectId}`;
      const sensitiveNow = exists(
        sql`(select 1 from ${s.table} where ${same} and ${s.sensitivity} = 'sensitive')`,
      );
      const gone = not(exists(sql`(select 1 from ${s.table} where ${same})`));
      return and(eq(auditLog.subjectType, type), or(sensitiveNow, and(gone, everSensitive))) as SQL;
    });
  const notSensitive = not(sensitiveParts.length ? (or(...sensitiveParts) as SQL) : sql`false`);
  if (actor.kind === 'system') return notSensitive;
  const snapshot = or(
    eq(auditLog.visibility, 'household'),
    eq(auditLog.visibleToUserId, actor.userId),
  ) as SQL;
  const types = Object.keys(auditSubjects);
  const notADomainSubject = or(
    sql`${auditLog.subjectType} is null`,
    not(
      sql`${auditLog.subjectType} in (${sql.join(
        types.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    ),
  ) as SQL;
  const domain = Object.entries(auditSubjects).map(([type, s]) => {
    const same = sql`${s.table.id}::text = ${auditLog.subjectId}`;
    const rule = s.visible
      ? s.visible(actor)
      : visibleTo(actor, s.table as PgTable & VisibilityColumns);
    const canSeeNow = exists(sql`(select 1 from ${s.table} where ${same} and ${rule})`);
    const gone = not(exists(sql`(select 1 from ${s.table} where ${same})`));
    return and(eq(auditLog.subjectType, type), or(canSeeNow, and(gone, snapshot))) as SQL;
  });
  return and(or(and(notADomainSubject, snapshot), ...domain), notSensitive) as SQL;
}

/** Every row the reference predicate lists for `actor`, newest first. Run last in a transaction: it turns JIT off. */
async function referenceIds(tx: Tx, actor: Actor): Promise<string[]> {
  // The old predicate's estimate is what invoked JIT; off, the reference
  // answers in milliseconds. It changes the plan's cost, never its rows.
  await tx.execute(sql`set local jit = off`);
  const rows = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(referenceVisibleTo(actor))
    .orderBy(desc(auditLog.at), desc(auditLog.id));
  return rows.map((r) => r.id);
}

/** Pages listAudit from the top, `limit` rows a page, for at most `maxPages` pages. */
async function walk(tx: Tx, actor: Actor, limit: number, maxPages = 100_000): Promise<string[]> {
  const ids: string[] = [];
  let cursor: AuditCursor | undefined;
  for (let p = 0; p < maxPages; p++) {
    const page = await listAudit(actor, { limit, before: cursor }, { db: tx });
    ids.push(...page.rows.map((r) => r.id));
    if (!page.next) break;
    cursor = page.next;
  }
  return ids;
}

// ---- A two-adult dataset with every registered subject type ----

type Who = 'sam' | 'alex' | 'system';
type Spec = {
  label: string;
  subjectType: string | null;
  subjectId: string | null;
  visibility: 'household' | 'private';
  owner: 'sam' | 'alex' | null;
  meta?: Record<string, unknown>;
  actorVia?: 'system';
  /** Who P-1 lets list this row. */
  sees: Who[];
};

const ALL: Who[] = ['sam', 'alex', 'system'];
const SAM_ONLY: Who[] = ['sam', 'system'];
const ALEX_ONLY: Who[] = ['alex', 'system'];
const NOBODY: Who[] = [];

async function insertId(tx: Tx, q: SQL): Promise<string> {
  const r = await tx.execute<{ id: string }>(q);
  const id = r.rows[0]?.id;
  if (!id) throw new Error('insert returned no id');
  return id;
}

/** Records of every registered subject type, and audit rows about them, newest in the log. */
async function seedDataset(tx: Tx): Promise<Spec[]> {
  const sam = h.sam.userId;
  const alex = h.alex.userId;
  const specs: Spec[] = [];
  const uid = (o: 'sam' | 'alex') => (o === 'sam' ? sam : alex);
  const add = (s: Spec) => specs.push(s);

  // Visibility tables: a household record and each adult's private one. Each
  // audit row carries the opposite snapshot, so only the record's own rule
  // can decide it.
  const connection = async (o: string) =>
    insertId(
      tx,
      sql`insert into calendar_connection (owner_user_id, provider, credentials_encrypted, credentials_key_id, address_fingerprint)
        values (${o}, 'ics', ${`hc1.0123456789abcdef.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`}, '0123456789abcdef', ${`fp1.${crypto.randomUUID().replace(/-/g, '')}`}) returning id`,
    );
  const visibilityTables: Record<string, (o: string, v: string) => Promise<SQL>> = {
    person: async (o, v) =>
      sql`insert into person (created_via, created_by, visibility, name, role) values ('ui', ${o}, ${v}, 'Synthetic person', 'other') returning id`,
    event: async (o, v) =>
      sql`insert into event (created_via, created_by, visibility, title, kind, all_day, start_date, end_date) values ('ui', ${o}, ${v}, 'Synthetic event', 'other', true, '2099-01-01', '2099-01-02') returning id`,
    calendar_source: async (o, v) =>
      sql`insert into calendar_source (created_by, created_via, visibility, connection_id, external_calendar_id, name) values (${o}, 'ui', ${v}, ${await connection(o)}::uuid, 'primary', 'Synthetic calendar') returning id`,
    project: async (o, v) =>
      sql`insert into project (created_via, created_by, visibility, title) values ('ui', ${o}, ${v}, 'Synthetic project') returning id`,
    task: async (o, v) =>
      sql`insert into task (created_via, created_by, visibility, title) values ('ui', ${o}, ${v}, 'Synthetic task') returning id`,
    note: async (o, v) =>
      sql`insert into note (created_via, created_by, visibility, body) values ('ui', ${o}, ${v}, 'Synthetic note') returning id`,
    context: async (o, v) =>
      sql`insert into context (created_via, created_by, visibility, subject_type, content, category, source_type, source_user_id) values ('ui', ${o}, ${v}, 'household', 'Synthetic context', 'other', 'manual', ${o}) returning id`,
  };
  for (const [type, insert] of Object.entries(visibilityTables)) {
    for (const [owner, visibility] of [
      ['sam', 'household'],
      ['sam', 'private'],
      ['alex', 'private'],
    ] as const) {
      const id = await insertId(tx, await insert(uid(owner), visibility));
      const other = owner === 'sam' ? 'alex' : 'sam';
      add({
        label: `${type}.${owner}.${visibility}`,
        subjectType: type,
        subjectId: id,
        // The opposite snapshot: household for a private record, the other
        // adult's for a household one.
        visibility: visibility === 'private' ? 'household' : 'private',
        owner: visibility === 'private' ? null : other,
        sees: visibility === 'household' ? ALL : owner === 'sam' ? SAM_ONLY : ALEX_ONLY,
      });
    }
  }

  // Always-private records (P-1 b): captures and proposals.
  for (const owner of ['sam', 'alex'] as const) {
    const o = uid(owner);
    const captureId = await insertId(
      tx,
      sql`insert into capture (created_via, created_by, visibility, text, channel) values ('ui', ${o}, 'private', 'Synthetic capture', 'web') returning id`,
    );
    const proposalId = await insertId(
      tx,
      sql`insert into proposal (created_via, created_by, requested_by_user_id, action, payload, summary) values ('ui', ${o}, ${o}, 'task.create', '{}'::jsonb, 'Synthetic proposal') returning id`,
    );
    for (const [type, id] of [
      ['capture', captureId],
      ['proposal', proposalId],
    ] as const)
      add({
        label: `${type}.${owner}`,
        subjectType: type,
        subjectId: id,
        visibility: 'household',
        owner: null,
        sees: owner === 'sam' ? SAM_ONLY : ALEX_ONLY,
      });
  }

  // Owner-only tables with no visibility column.
  for (const owner of ['sam', 'alex'] as const) {
    const o = uid(owner);
    const owned: Record<string, string> = {
      calendar_connection: await connection(o),
      conversation: await insertId(
        tx,
        sql`insert into conversation (user_id) values (${o}) returning id`,
      ),
      insight_response: await insertId(
        tx,
        sql`insert into insight_response (user_id, insight_key, response) values (${o}, ${`aq-${crypto.randomUUID()}`}, 'dismissed') returning id`,
      ),
      kev_usage: await insertId(
        tx,
        sql`insert into kev_usage (user_id, tier, model, cost_usd_micros) values (${o}, 'fast', 'synthetic-model', 1) returning id`,
      ),
      kev_budget_reservation: await insertId(
        tx,
        sql`insert into kev_budget_reservation (attempt_id, user_id, tier, period, reserved_usd_micros) values (${crypto.randomUUID()}::uuid, ${o}, 'fast', '2099-01-01', 1) returning id`,
      ),
    };
    for (const [type, id] of Object.entries(owned))
      add({
        label: `${type}.${owner}`,
        subjectType: type,
        subjectId: id,
        visibility: 'household',
        owner: null,
        sees: owner === 'sam' ? SAM_ONLY : ALEX_ONLY,
      });
  }

  // Every registered type, once its record is gone: the snapshot decides.
  for (const type of Object.keys(auditSubjects)) {
    add({ label: `${type}.gone.household`, subjectType: type, subjectId: crypto.randomUUID(), visibility: 'household', owner: null, sees: ALL }); // prettier-ignore
    add({ label: `${type}.gone.sam`, subjectType: type, subjectId: crypto.randomUUID(), visibility: 'private', owner: 'sam', sees: SAM_ONLY }); // prettier-ignore
    add({ label: `${type}.gone.alex`, subjectType: type, subjectId: crypto.randomUUID(), visibility: 'private', owner: 'alex', sees: ALEX_ONLY }); // prettier-ignore
  }

  // subject_ids that can never name a record: uppercase or braced spellings
  // of a real id, free text, null. Neither form ever matched them by id, so
  // they fall back to their snapshot.
  const samPrivateEvent = specs.find((s) => s.label === 'event.sam.private')?.subjectId ?? '';
  add({ label: 'event.uppercase', subjectType: 'event', subjectId: samPrivateEvent.toUpperCase(), visibility: 'private', owner: 'sam', sees: SAM_ONLY }); // prettier-ignore
  add({ label: 'event.braced', subjectType: 'event', subjectId: `{${samPrivateEvent}}`, visibility: 'private', owner: 'alex', sees: ALEX_ONLY }); // prettier-ignore
  add({ label: 'event.free-text', subjectType: 'event', subjectId: 'not-a-uuid', visibility: 'household', owner: null, sees: ALL }); // prettier-ignore
  add({ label: 'task.null-id', subjectType: 'task', subjectId: null, visibility: 'private', owner: 'alex', sees: ALEX_ONLY }); // prettier-ignore

  // Sensitive context (ADR 0005 §37, §43): never listed while sensitive, nor
  // once gone if any row ever recorded it as sensitive, for anyone.
  const sensitiveNow = await insertId(
    tx,
    sql`insert into context (created_via, created_by, visibility, subject_type, content, category, source_type, source_user_id, sensitivity) values ('ui', ${sam}, 'household', 'household', 'Synthetic context', 'other', 'manual', ${sam}, 'sensitive') returning id`,
  );
  add({ label: 'context.sensitive-now', subjectType: 'context', subjectId: sensitiveNow, visibility: 'household', owner: null, meta: { sensitivity: 'sensitive' }, sees: NOBODY }); // prettier-ignore
  add({ label: 'context.sensitive-now.normal-row', subjectType: 'context', subjectId: sensitiveNow, visibility: 'household', owner: null, meta: { sensitivity: 'normal' }, sees: NOBODY }); // prettier-ignore
  const formerlyGone = crypto.randomUUID();
  add({ label: 'context.gone.was-sensitive', subjectType: 'context', subjectId: formerlyGone, visibility: 'household', owner: null, meta: { sensitivity: 'sensitive' }, sees: NOBODY }); // prettier-ignore
  add({ label: 'context.gone.was-sensitive.later-normal', subjectType: 'context', subjectId: formerlyGone, visibility: 'household', owner: null, meta: { sensitivity: 'normal' }, sees: NOBODY }); // prettier-ignore
  add({ label: 'context.gone.never-sensitive', subjectType: 'context', subjectId: crypto.randomUUID(), visibility: 'household', owner: null, meta: { sensitivity: 'normal' }, sees: ALL }); // prettier-ignore
  // A record that was sensitive once and is normal now is listed by its rule.
  const nowNormal = specs.find((s) => s.label === 'context.sam.household')?.subjectId ?? '';
  add({ label: 'context.now-normal.was-sensitive', subjectType: 'context', subjectId: nowNormal, visibility: 'household', owner: null, meta: { sensitivity: 'sensitive' }, sees: ALL }); // prettier-ignore
  add({ label: 'context.free-text.was-sensitive', subjectType: 'context', subjectId: 'x', visibility: 'household', owner: null, meta: { sensitivity: 'sensitive' }, sees: NOBODY }); // prettier-ignore
  add({ label: 'context.free-text.normal', subjectType: 'context', subjectId: 'x', visibility: 'household', owner: null, sees: NOBODY }); // prettier-ignore

  // Rows with no domain subject: their snapshot decides.
  add({ label: 'auth', subjectType: null, subjectId: null, visibility: 'household', owner: null, sees: ALL }); // prettier-ignore
  add({ label: 'system', subjectType: null, subjectId: null, visibility: 'household', owner: null, actorVia: 'system', sees: ALL }); // prettier-ignore
  add({ label: 'export.sam', subjectType: 'export', subjectId: sam, visibility: 'private', owner: 'sam', sees: SAM_ONLY }); // prettier-ignore
  add({ label: 'unregistered.alex', subjectType: 'future_entity', subjectId: crypto.randomUUID(), visibility: 'private', owner: 'alex', sees: ALEX_ONLY }); // prettier-ignore

  // Newest in the log, far in the future; every third shares its
  // predecessor's instant, so only the id orders them.
  let second = 0;
  for (const [i, s] of specs.entries()) {
    if (i % 3 !== 2) second++;
    const at = new Date(Date.UTC(2099, 0, 1, 0, 0, second)).toISOString();
    await tx.execute(sql`insert into audit_log
        (at, actor_user_id, actor_via, actor_channel, event, subject_type, subject_id, meta, visibility, visible_to_user_id)
      values (${at}::timestamptz, ${s.actorVia ? null : sam}, ${s.actorVia ?? 'ui'}, ${s.actorVia ? null : 'web'},
        ${`aq.${s.label}`}, ${s.subjectType}, ${s.subjectId},
        ${s.meta ? JSON.stringify(s.meta) : null}::jsonb, ${s.visibility}, ${s.owner ? uid(s.owner) : null})`);
  }
  return specs;
}

const actors = (): [string, Actor][] => [
  ['Sam', h.sam],
  ['Alex', h.alex],
  ['Sam through Kev', h.samViaKev],
  ['the system', systemActor],
];

describe('the Activity query (issue #77)', () => {
  it('lists exactly what the correlated predicate listed, in the same order, for every actor and page size', async () => {
    await rolledBack(async (tx) => {
      const specs = await seedDataset(tx);
      for (const [name, actor] of actors()) {
        const whole = await walk(tx, actor, 200);
        // Small pages across the dataset (newest in the log), ties included.
        const small = await walk(tx, actor, 3, Math.ceil(specs.length / 3) + 2);
        const seven = await walk(tx, actor, 7, Math.ceil(specs.length / 7) + 2);
        const expected = await referenceIds(tx, actor);
        expect(whole, name).toEqual(expected);
        expect(new Set(whole).size, name).toBe(whole.length);
        expect(small, name).toEqual(expected.slice(0, small.length));
        expect(seven, name).toEqual(expected.slice(0, seven.length));
        expect(small.length, name).toBeGreaterThan(specs.length / 2);
      }
    });
  });

  it('shows each adult what P-1 allows: household rows to both, private rows to their owner, sensitive rows to nobody', async () => {
    await rolledBack(async (tx) => {
      const specs = await seedDataset(tx);
      // The dataset covers every registered subject type, current and gone.
      const types = new Set(specs.map((s) => s.subjectType));
      for (const t of Object.keys(auditSubjects)) expect(types, t).toContain(t);
      for (const [who, actor] of [
        ['sam', h.sam],
        ['alex', h.alex],
        ['system', systemActor],
      ] as [Who, Actor][]) {
        const page = await listAudit(actor, { limit: 200 }, { db: tx });
        const listed = page.rows.map((r) => r.event).filter((e) => e.startsWith('aq.'));
        const expected = specs.filter((s) => s.sees.includes(who)).map((s) => `aq.${s.label}`);
        expect([...listed].sort(), who).toEqual([...expected].sort());
      }
    });
  });

  it('on a 5,000-row log, tests every subject with a hashed lookup and stays far below the JIT threshold', async () => {
    await rolledBack(async (tx) => {
      await seedDataset(tx);
      // 5,000 more rows across every registered type, current and gone, with
      // sensitive history on some context rows and a few free-text ids.
      const types = Object.keys(auditSubjects);
      await tx.execute(sql`insert into audit_log
          (at, actor_user_id, actor_via, event, subject_type, subject_id, meta, visibility, visible_to_user_id)
        select timestamptz '2098-01-01' + g * interval '1 minute', ${h.sam.userId}, 'ui', 'aq.scale',
          (array[${sql.join(
            types.map((t) => sql`${t}`),
            sql`, `,
          )}])[1 + g % ${types.length}],
          case when g % 97 = 0 then 'not-a-uuid' else gen_random_uuid()::text end,
          case when g % 7 = 0 then '{"sensitivity":"sensitive"}'::jsonb end,
          case when g % 2 = 0 then 'household' else 'private' end,
          case when g % 2 = 0 then null else ${h.alex.userId} end
        from generate_series(1, 5000) g`);
      const jitAbove = Number(
        (await tx.execute<{ v: string }>(sql`select current_setting('jit_above_cost') as v`))
          .rows[0]?.v,
      );
      // Postgres's default; a server with JIT disabled (-1) is held to it too.
      const threshold = jitAbove > 0 ? jitAbove : 100_000;
      const first = await listAudit(h.alex, { limit: 50 }, { db: tx });
      for (const [actor, opts] of [
        [h.sam, { limit: 200 }],
        [h.alex, { limit: 200, before: first.next ?? undefined }],
        [systemActor, { limit: 1 }],
      ] as [Actor, { limit: number; before?: AuditCursor }][]) {
        const query = listAuditQuery(actor, opts, { db: tx });
        const json = await tx.execute<{ 'QUERY PLAN': [{ Plan: { 'Total Cost': number } }] }>(
          sql`explain (format json) ${query}`,
        );
        const cost = json.rows[0]?.['QUERY PLAN'][0].Plan['Total Cost'] ?? Infinity;
        // Measured at 5,000 to 30,000 rows the new plan costs under 3,000.
        // The correlated form cost 500,000 and more: JIT with inlining and
        // optimisation, seconds a page.
        expect(cost).toBeLessThan(threshold / 10);
        const text = (await tx.execute<{ 'QUERY PLAN': string }>(sql`explain ${query}`)).rows
          .map((r) => r['QUERY PLAN'])
          .join('\n');
        const filters = text
          .split('\n')
          .filter((l) => /^\s*(Filter|Index Cond|Join Filter):/.test(l))
          .join('\n');
        const referenced = [...filters.matchAll(/(hashed )?SubPlan (\d+)/g)];
        expect(referenced.length).toBeGreaterThan(0);
        // No subject is tested by a subquery run once per audit row.
        expect(referenced.filter((m) => !m[1]).map((m) => m[0])).toEqual([]);
        expect(text).not.toMatch(/::text = audit_log\.subject_id/);
      }
    });
  });
});
