import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { user } from '@/db/schema';
import { createPerson } from '@/domain/people/service';
import type { UserActor } from '@/trust/actor';
import { TIERS, MODELS } from '@/kev/config';
import { buildProbeGateway } from '@/kev/providers/anthropic';
import { createProviderFetchForTests } from '@/kev/providers/fetch';
import { perCallMax } from '@/kev/router';
import { assertFixtureDatabase } from '../../scripts/kev-live/db-checks';
import { runG16 } from '../../scripts/kev-live/g16';
import { LiveRefusal } from '../../scripts/kev-live/guards.mts';
import {
  isolationPasses,
  isolationReport,
  type Queryable,
} from '../../scripts/kev-live/isolation-check.mts';
import { buildPlan } from '../../scripts/kev-live/plan';
import { evidenceChecks, executePlan } from '../../scripts/kev-live/probes';
import { reconcile } from '../../scripts/kev-live/reconcile';
import { buildReport } from '../../scripts/kev-live/report';
import { TEST_DATABASE_URL } from '../env';
import {
  ev,
  messageEnd,
  messageStart,
  startStub,
  textBlock,
  toolBlock,
  type Handler,
  type Stub,
} from '../unit/kev-stub';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { adminDb, testDb } from './db';
import { buildKevFixture, clearKevFixture, type KevFixture } from './kev-fixture';

// The live verification runner's live path, end to end against a local
// stub of the provider (never the provider): the approved plan's probes run
// through the real probe gateway, HOME's fetch and the real bookkeeping
// path (reservations under the run's cap, settlement), the turn probe
// through kev.handle() on the fixture database; then the reconciliation
// and the report, which must hold no body. Also the runner's database
// checks, the isolation check and G16's reservation script, against the
// local test database. Synthetic only.

const { db, close } = testDb();
const admin = adminDb();
const KEY = 'test-key-not-real-live-runner';
const CANARY = 'canary-live-report-55aa';
let stub: Stub;
let f: KevFixture;
/**
 * The adult the probes run as: a fresh synthetic account per run (a .test
 * address), so the other suites' turns today never rate-limit its turn.
 */
let runner: UserActor;
const savedEnv = { ...process.env };
const seenBodies = new Set<string>();
let ids = 0;

const thinking = (index: number) =>
  ev('content_block_start', {
    index,
    content_block: { type: 'thinking', thinking: '', signature: '' },
  }) +
  ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: CANARY } }) +
  ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig' } }) +
  ev('content_block_stop', { index });

/** One handler for every request: it answers by what the request is (synthetic). */
const smart: Handler = (req, res, raw) => {
  const id = `req_synthetic${++ids}`;
  if (req.method === 'GET') {
    const model = (req.url ?? '').split('/').pop();
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': id });
    return res.end(
      JSON.stringify({
        id: model,
        type: 'model',
        display_name: CANARY,
        created_at: '2026-01-01T00:00:00Z',
        capabilities: null,
        max_input_tokens: 1_000_000,
        max_tokens: 128_000,
      }),
    );
  }
  const body = JSON.parse(raw) as {
    model: string;
    tools?: unknown[];
    tool_choice?: { type: string };
    output_config?: { format?: unknown };
    messages: { role: string; content: unknown }[];
  };
  const key = createHash('sha256').update(raw).digest('hex');
  const cached = seenBodies.has(key);
  seenBodies.add(key);
  const usage = {
    input_tokens: 2_000,
    cache_creation_input_tokens: cached ? 0 : 3_000,
    cache_read_input_tokens: cached ? 3_000 : 0,
  };
  const last = body.messages.at(-1)!;
  const lastHasResult =
    Array.isArray(last.content) &&
    (last.content as { type: string }[]).some((b) => b.type === 'tool_result');
  res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': id });
  if (last.role === 'system')
    return res.end(
      messageStart(body.model, usage) + textBlock(0, 'ready') + messageEnd('end_turn'),
    );
  if (body.tools?.length && body.tool_choice?.type === 'auto' && !lastHasResult)
    return res.end(
      messageStart(body.model, usage) +
        thinking(0) +
        toolBlock(1, `toolu_${ids}`, 'get_agenda', { from: '2026-10-17', to: '2026-10-17' }) +
        messageEnd('tool_use', 60),
    );
  if (body.output_config?.format)
    return res.end(
      messageStart(body.model, usage) +
        textBlock(0, JSON.stringify({ lead: null, facts: [], view: null, decline: 'not_kept' })) +
        messageEnd('end_turn'),
    );
  return res.end(
    messageStart(body.model, usage) + textBlock(0, `${CANARY} hello`) + messageEnd('end_turn'),
  );
};

const gateway = () =>
  buildProbeGateway(KEY, createProviderFetchForTests(KEY, { stubPort: stub.port }), {});

beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  // Room for every probe whatever this month's other suites recorded (kev_usage
  // is append-only); the runner's own cap rule is tested in kev-live-guards.
  process.env.HOME_KEV_MONTHLY_CAP_NZD = '300';
  f = await buildKevFixture(db, admin.db);
  const id = `live-runner-${randomUUID()}`;
  const email = `${id}@example.test`;
  await admin.db.insert(user).values({ id, name: 'Synthetic runner adult', email });
  runner = { kind: 'user', userId: id, email, via: 'kev', channel: 'web' };
  stub = await startStub();
});
afterAll(async () => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await stub.close();
  await clearKevFixture(db, admin.db);
  await close();
  await admin.close();
});
beforeEach(async () => {
  stub.seen.length = 0;
  stub.counts.length = 0;
  stub.queue.length = 0;
  stub.countQueue.length = 0;
  for (let i = 0; i < 200; i++) stub.queue.push(smart);
  seenBodies.clear();
});

/**
 * The database-wide open and unreconciled counts before a session. The
 * runner's own database starts empty, so there both are 0; this shared test
 * database holds reservations other suites leave open on purpose (a fault
 * mid-settle, a far-future row), which the settle-only trigger keeps from
 * being removed, so a session here is measured against what was there.
 */
const leftOpen = async () => {
  const r = await reconcile(db, []);
  return r.openCount + r.unreconciledCount;
};
/** The session left nothing open or unreconciled, and `ok` says exactly that. */
const expectNothingLeftOpen = (rec: Awaited<ReturnType<typeof reconcile>>, before: number) => {
  expect(rec.openCount + rec.unreconciledCount).toBeLessThanOrEqual(before);
  expect(rec.ok).toBe(rec.openCount === 0 && rec.unreconciledCount === 0 && rec.mismatched === 0);
};

describe('the plan, live path, against a local stub', () => {
  it('live verification #2’s plan: the six probes pass through the real gateway; every model call counted first, in the US, its count compared with the reported input; reconciled', async () => {
    const plan = buildPlan('verification-2');
    expect(plan.name).toBe('verification-2');
    const before = await leftOpen();
    const run = await executePlan(plan, {
      gateway: gateway(),
      actor: runner,
      deps: { db },
      budgetMicros: plan.sessionCapUsdMicros,
    });
    expect(run.results.map((r) => r.id)).toEqual(plan.probes.map((p) => p.id));
    for (const r of run.results) expect(r.outcome, `${r.id}: ${r.reasons.join(',')}`).toBe('pass');
    expect(run.stopped).toBeNull();
    for (const r of run.results.filter((x) => x.id !== 'g1-models')) {
      expect(r.checks, r.id).toMatchObject({ countedFirst: true, usInference: true });
      // G22's comparison is recorded for every model probe (the stub's
      // count and its reported input differ on purpose).
      expect(typeof r.checks.maxCountDelta, r.id).toBe('number');
    }
    // Tools and the answer schema were sent, and counted, on the tool probes.
    const counted = stub.counts.map((c) => JSON.parse(c.body) as Record<string, unknown>);
    expect(counted.some((c) => Array.isArray(c.tools) && (c.tools as unknown[]).length > 0)).toBe(
      true,
    );
    const rec = await reconcile(
      db,
      run.results.flatMap((r) => r.attemptIds),
    );
    expect(rec.mismatched).toBe(0);
    expectNothingLeftOpen(rec, before);
    expect(rec.recordedUsdMicros <= plan.totalMaxUsdMicros).toBe(true);
  });

  it('every probe passes; every call counted first and in the US; reconciled; the report holds no body', async () => {
    const plan = buildPlan('full');
    const since = new Date(Date.now() - 1_000);
    const before = await leftOpen();
    const g = gateway();
    const run = await executePlan(plan, {
      gateway: g,
      actor: runner,
      deps: { db },
      budgetMicros: 10_000_000n,
    });
    const by = Object.fromEntries(run.results.map((r) => [r.id, r]));
    for (const r of run.results) expect(r.outcome, `${r.id}: ${r.reasons.join(',')}`).toBe('pass');
    expect(run.stopped).toBeNull();
    expect(run.committedMaxUsdMicros).toBe(plan.totalMaxUsdMicros);

    // G1: three ids, no count.
    expect(by['g1-models']!.evidence.map((e) => e.kind)).toEqual(['models', 'models', 'models']);
    // G7 on both tiers and Haiku: a tool round and an answer plan.
    for (const id of ['g7-fast', 'g7-deep', 'haiku-g7'])
      expect(by[id]!.checks).toMatchObject({ toolRound: true, answerParses: true, modelCalls: 2 });
    expect(
      by['haiku-g7']!.evidence.filter((e) => e.kind === 'message').map((e) => e.model),
    ).toEqual([MODELS.haiku55.id, MODELS.haiku55.id]);
    // G19: the second call read the cache.
    expect(by['g19-cache-fast']!.checks.secondCacheRead).toBe(3_000);
    // G20: aborted, partial, charged the per-call maximum.
    expect(by['g20-abort-fast']!.checks).toMatchObject({
      aborted: true,
      partial: true,
      chargedAtLeastMax: true,
    });
    // G8: accepted (and the stub's reply was lower case).
    expect(by['g8-deep']!.checks).toMatchObject({ accepted: true, followed: true });
    // G9, G21: a turn through kev.handle(), grow-only, thinking replayed.
    expect(by['g9-g21-turn']!.checks).toMatchObject({
      growOnly: true,
      countedFirst: true,
      usInference: true,
    });
    expect(by['g9-g21-turn']!.checks.modelCalls).toBeGreaterThanOrEqual(2);
    expect(by['g9-g21-turn']!.checks.thinkingBlocks).toBeGreaterThanOrEqual(1);
    // G22 and G10 over everything: one count before every first call.
    const all = run.results.flatMap((r) => r.evidence);
    expect(evidenceChecks(all)).toMatchObject({ countedFirst: true, usInference: true });
    const counts = all.filter((e) => e.kind === 'count').length;
    const calls = all.filter((e) => e.kind === 'message').length;
    expect(counts).toBe(calls);
    expect(stub.counts).toHaveLength(counts);

    // §9: nothing open or unreconciled; each attempt settled at Σ its usage.
    const rec = await reconcile(
      db,
      run.results.flatMap((r) => r.attemptIds),
    );
    expect(rec.mismatched).toBe(0);
    expectNothingLeftOpen(rec, before);
    expect(rec.usageRows).toBe(calls);
    expect(rec.attempts).toBe(run.results.reduce((a, r) => a + r.attemptIds.length, 0));
    // The aborted call is the one conservative charge; Haiku's four rows are
    // recorded at Haiku's prices (not conservative), and reserved at the fast
    // tier's. Reserved ≥ recorded > at list prices, the gap being the aborted
    // call's conservative charge only.
    expect(rec.conservativeRows).toBe(1);
    expect(rec.probeModelRows).toBe(4);
    const sessionIds = run.results.flatMap((r) => r.attemptIds);
    const reservedRows = await admin.db.execute<{ total: string }>(sql`
      select coalesce(sum(reserved_usd_micros), 0)::text as total from kev_budget_reservation
       where attempt_id in (${sql.join(
         sessionIds.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})`);
    expect(rec.reservedUsdMicros).toBe(BigInt(reservedRows.rows[0]!.total));
    // Each Haiku row: its tokens at Haiku's prices exactly.
    const haikuRows = await admin.db.execute<{ ok: boolean }>(sql`
      select (cost_usd_micros = ceil(((input_tokens * 100 + output_tokens * 500
              + cache_write_tokens * 125 + cache_read_tokens * 10) * 11)::numeric / 10000))::boolean as ok
        from kev_usage where model = ${MODELS.haiku55.id} and attempt_id in (${sql.join(
          sessionIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`);
    expect(haikuRows.rows.map((r) => r.ok)).toEqual([true, true, true, true]);
    expect(rec.reservedUsdMicros >= rec.recordedUsdMicros).toBe(true);
    expect(rec.atListPricesUsdMicros < rec.recordedUsdMicros).toBe(true);
    const charged = all.reduce(
      (a, e) => a + (e.kind === 'message' && e.costUsdMicros !== null ? e.costUsdMicros : 0n),
      0n,
    );
    expect(rec.recordedUsdMicros).toBe(charged);
    expect(rec.recordedUsdMicros <= plan.totalMaxUsdMicros).toBe(true);

    const report = buildReport({
      plan,
      budgetMicros: 10_000_000n,
      capNzd: 18,
      run,
      reconciliation: rec,
      startedAt: since,
      finishedAt: new Date(),
    });
    // Every probe passed, so the report passes exactly when the
    // reconciliation is clean. `rec.ok` is database-wide, and this shared
    // test database holds reservations other suites leave open on purpose
    // (see leftOpen), so it depends on which suites ran first; on the
    // runner's own empty database, a clean session reconciles to ok.
    expect(report.passed).toBe(rec.ok);
    const onItsOwnDatabase = buildReport({
      plan,
      budgetMicros: 10_000_000n,
      capNzd: 18,
      run,
      reconciliation: { ...rec, openCount: 0, unreconciledCount: 0, ok: true },
      startedAt: since,
      finishedAt: new Date(),
    });
    expect(onItsOwnDatabase.passed).toBe(true);
    expect(
      buildReport({
        plan,
        budgetMicros: 10_000_000n,
        capNzd: 18,
        run,
        reconciliation: { ...rec, openCount: 1, ok: false },
        startedAt: since,
        finishedAt: new Date(),
      }).passed,
    ).toBe(false);
    for (const text of [report.json, report.markdown]) {
      expect(text).not.toContain(CANARY);
      expect(text).not.toContain(KEY);
      for (const p of plan.probes)
        if (p.kind !== 'models' && p.kind !== 'turn')
          expect(text).not.toContain(p.request.question);
        else if (p.kind === 'turn') expect(text).not.toContain(p.question);
      expect(text).toContain('req_synthetic');
      expect(text).toContain(plan.hash);
    }
    const parsed = JSON.parse(report.json) as { probes: { calls: { inferenceGeo?: string }[] }[] };
    expect(
      parsed.probes
        .flatMap((p) => p.calls)
        .filter((c) => c.inferenceGeo !== undefined)
        .every((c) => c.inferenceGeo === 'us'),
    ).toBe(true);
  });

  it('the budget: no probe starts whose maximum would pass it; nothing is reserved for them', async () => {
    const plan = buildPlan('full');
    const g = gateway();
    const run = await executePlan(plan, {
      gateway: g,
      actor: runner,
      deps: { db },
      budgetMicros: 2_000_000n,
    });
    const ids = run.results.flatMap((r) => r.attemptIds);
    expect(ids).toHaveLength(2);
    expect(run.stopped).toBe('budget');
    expect(run.committedMaxUsdMicros <= 2_000_000n).toBe(true);
    const ran = run.results.filter((r) => r.outcome !== 'not_run');
    expect(ran.map((r) => r.id)).toEqual(['g1-models', 'g7-fast', 'g7-deep']);
    const [{ n }] = (
      await admin.db.execute<{ n: number }>(
        sql`select count(*)::int as n from kev_budget_reservation where attempt_id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )}) and status = 'settled'`,
      )
    ).rows as [{ n: number }];
    expect(n).toBe(2);
  });

  it('HOME’s own cap stops the run: a reservation the cap cannot hold is refused, and the session stops', async () => {
    process.env.HOME_KEV_MONTHLY_CAP_NZD = '1';
    try {
      const run = await executePlan(buildPlan('full'), {
        gateway: gateway(),
        actor: runner,
        deps: { db },
        budgetMicros: 10_000_000n,
      });
      expect(run.stopped).toBe('cap_reached');
      expect(run.results.find((r) => r.id === 'g7-fast')).toMatchObject({
        outcome: 'not_run',
        reasons: ['cap_reached'],
      });
      expect(stub.seen.filter((s) => s.method === 'POST')).toHaveLength(0);
    } finally {
      process.env.HOME_KEV_MONTHLY_CAP_NZD = '300';
    }
  });

  it('a refused key stops the session at G1, before any model call', async () => {
    stub.queue.length = 0;
    stub.queue.push((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'x' } }),
      );
    });
    for (let i = 0; i < 10; i++) stub.queue.push(smart);
    const run = await executePlan(buildPlan('full'), {
      gateway: gateway(),
      actor: runner,
      deps: { db },
      budgetMicros: 10_000_000n,
    });
    expect(run.stopped).toBe('g1-models_failed');
    expect(run.results[0]).toMatchObject({ outcome: 'fail' });
    expect(run.results.slice(1).every((r) => r.outcome === 'not_run')).toBe(true);
    expect(stub.counts).toHaveLength(0);
  });

  it('a refused key on a model call stops the session there; the attempt still settles', async () => {
    const before = await leftOpen();
    stub.countQueue.push((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'x' } }),
      );
    });
    const run = await executePlan(buildPlan('full'), {
      gateway: gateway(),
      actor: runner,
      deps: { db },
      budgetMicros: 10_000_000n,
    });
    expect(run.stopped).toBe('auth');
    expect(run.results.find((r) => r.id === 'g7-fast')).toMatchObject({ outcome: 'fail' });
    const rec = await reconcile(
      db,
      run.results.flatMap((r) => r.attemptIds),
    );
    expect(rec).toMatchObject({ attempts: 1, mismatched: 0, usageRows: 0 });
    expectNothingLeftOpen(rec, before);
    expect(perCallMax('fast')).toBe(133_056n);
    expect(TIERS.fast.maxTokens).toBe(4_096);
  });
});

describe('provider refusals are diagnosable from the job log, and nothing else leaks (ADR 0012 §52)', () => {
  const MESSAGE_TEXT = 'canary-provider-free-text';
  /** Every Messages API call refused as run #2's were, the message carrying the key, a prompt and free text. */
  const refuse: Handler = (_req, res, raw) => {
    const id = `req_refused${++ids}`;
    const body = JSON.parse(raw) as { messages: { content: unknown }[] };
    res.writeHead(400, { 'content-type': 'application/json', 'request-id': id });
    res.end(
      JSON.stringify({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            `tools.3.custom.input_schema.properties.assignee.anyOf.0: Schema is too complex for compilation; ` +
            `tools.3.custom.input_schema.properties.${MESSAGE_TEXT}: ${KEY} ${CANARY} ${JSON.stringify(body.messages[0]?.content)}`,
        },
        request_id: id,
      }),
    );
  };

  it('each refused call prints its status, category, request id, paths and signals; the report keeps them; no secret, prompt or provider text anywhere', async () => {
    const plan = buildPlan('verification-2');
    stub.queue.length = 0;
    for (let i = 0; i < 50; i++)
      stub.queue.push((req, res, raw) =>
        req.method === 'GET' ? smart(req, res, raw) : refuse(req, res, raw),
      );
    const logged: string[] = [];
    const out: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    const since = new Date(Date.now() - 1_000);
    let run: Awaited<ReturnType<typeof executePlan>>;
    try {
      run = await executePlan(plan, {
        gateway: gateway(),
        actor: runner,
        deps: { db },
        budgetMicros: plan.sessionCapUsdMicros,
        log: (l) => logged.push(l),
      });
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
    // The closed codes are unchanged.
    const by = Object.fromEntries(run.results.map((r) => [r.id, r]));
    for (const id of ['g7-fast', 'g7-deep', 'g19-cache-fast', 'haiku-g7'])
      expect(by[id]!.reasons, id).toContain('bad_response');
    expect(by['g9-g21-turn']!.reasons).toContain('turn_bad_response');

    // The job log: one diagnostic line under each refused call.
    const diag = logged.filter((l) => l.startsWith('  message '));
    expect(diag.length).toBe(5);
    for (const l of diag)
      expect(l).toMatch(
        /^ {2}message \S+: status 400; type invalid_request_error; request-id req_refused\d+; paths tools\.3\.custom\.input_schema\.properties\.assignee\.anyOf\.0 tools\.3\.custom\.input_schema\.properties\.\*; signals [^;]*schema_too_complex[^;]*; message \d+ chars \(not kept\)$/,
      );

    // The production turn's one log line: structural fields only.
    const turnLine = out.find((l) => l.includes('"event":"kev_turn"'));
    expect(turnLine).toBeDefined();
    expect(JSON.parse(turnLine!)).toMatchObject({
      outcome: 'error',
      errorCode: 'bad_response',
      providerStatus: 400,
      providerErrorType: 'invalid_request_error',
      providerRequestId: expect.stringMatching(/^req_refused\d+$/),
    });

    const rec = await reconcile(
      db,
      run.results.flatMap((r) => r.attemptIds),
    );
    const report = buildReport({
      plan,
      budgetMicros: plan.sessionCapUsdMicros,
      capNzd: 10,
      run,
      reconciliation: rec,
      startedAt: since,
      finishedAt: new Date(),
    });
    expect(report.markdown).toContain('## Provider errors');
    expect(report.json).toContain('schema_too_complex');
    expect(report.json).toContain('tools.3.custom.input_schema.properties.assignee.anyOf.0');

    // What the family's records hold: no provider text, no request id.
    const stored = await db.execute(
      sql`select content::text as c from message where created_at >= ${since.toISOString()}::timestamptz`,
    );
    const storedText = JSON.stringify(stored.rows);
    expect(storedText).not.toContain('req_refused');

    const question = plan.probes.find((p) => p.kind === 'turn');
    for (const text of [
      report.json,
      report.markdown,
      logged.join('\n'),
      out.join(''),
      storedText,
    ]) {
      for (const s of [KEY, CANARY, MESSAGE_TEXT, 'too complex for compilation'])
        expect(text, s).not.toContain(s);
      for (const p of plan.probes)
        if (p.kind !== 'models' && p.kind !== 'turn')
          expect(text).not.toContain(p.request.question);
    }
    for (const text of [report.json, report.markdown, logged.join('\n'), out.join('')])
      if (question?.kind === 'turn') expect(text).not.toContain(question.question);
  });
});

describe('the tool-use diagnostic (ADR 0012 §53): adaptive, one call a probe, counted first', () => {
  type Sent = {
    tools?: { name: string; strict?: boolean }[];
    output_config?: { format?: unknown };
    tool_choice?: { type: string };
  };
  /** Which diagnostic row a body is, from what it carries (never its text). */
  const rowOf = (raw: string): string => {
    const b = JSON.parse(raw) as Sent;
    const names = (b.tools ?? []).map((t) => t.name);
    if (b.output_config?.format) return 'E';
    if (names.length === 1) return 'C';
    if (names.length === 10 && !names.includes('get_tasks')) return 'F1';
    if (names.length === 10 && !names.includes('get_today')) return 'F3';
    if (names.length === 12 && (b.tools ?? []).every((t) => t.strict === undefined)) return 'F4';
    if (names.length === 12 && !/"format":"(?:date|uuid)"/.test(raw)) return 'F2';
    if (names.length === 12) return 'D';
    return '?';
  };
  const MESSAGE_TEXT = 'canary-diagnostic-free-text';
  /** A Messages call refused as run #2's were; `named` puts a request path in the message. */
  const refused =
    (named: boolean): Handler =>
    (_req, res) => {
      const id = `req_dxrefused${++ids}`;
      res.writeHead(400, { 'content-type': 'application/json', 'request-id': id });
      res.end(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: named
              ? `tools.4.custom.input_schema.properties.assignee: ${MESSAGE_TEXT} ${KEY}`
              : `${MESSAGE_TEXT} ${KEY} ${CANARY}`,
          },
          request_id: id,
        }),
      );
    };
  /** The stub answers each row as `outcomes` says: accepted unless named. */
  const answer = (outcomes: Record<string, 'refuse' | 'named'>) => {
    stub.queue.length = 0;
    for (let i = 0; i < 50; i++)
      stub.queue.push((req, res, raw) => {
        const o = req.method === 'POST' ? outcomes[rowOf(raw)] : undefined;
        return o ? refused(o === 'named')(req, res, raw) : smart(req, res, raw);
      });
  };
  const run = async (budgetMicros = buildPlan('tool-diagnostic').sessionCapUsdMicros) => {
    const plan = buildPlan('tool-diagnostic');
    const logged: string[] = [];
    const before = await leftOpen();
    const out = await executePlan(plan, {
      gateway: gateway(),
      actor: runner,
      deps: { db },
      budgetMicros,
      log: (l) => logged.push(l),
    });
    const rec = await reconcile(
      db,
      out.results.flatMap((r) => r.attemptIds),
    );
    expectNothingLeftOpen(rec, before);
    expect(rec.mismatched).toBe(0);
    const ran = out.results.filter((r) => r.outcome !== 'not_run').map((r) => r.id);
    const rows = stub.seen.filter((x) => x.method === 'POST').map((x) => rowOf(x.body));
    const counted = stub.counts.map((x) => rowOf(x.body));
    return { plan, out, rec, ran, rows, counted, logged };
  };
  /** G22: every Messages call is counted first, each count the same row as its call. */
  const countedFirst = (r: Awaited<ReturnType<typeof run>>) => {
    expect(r.counted).toEqual(r.rows);
    for (const res of r.out.results)
      if (res.outcome !== 'not_run') {
        const kinds = res.evidence.map((e) => e.kind);
        expect(kinds, res.id).toEqual(['count', 'message']);
        expect(res.checks, res.id).toMatchObject({ countedFirst: true, modelCalls: 1 });
      }
  };
  /** Not run and never reserved: its rule did not hold, or (`reason`) the session had stopped. */
  const skipped = (r: Awaited<ReturnType<typeof run>>, ids: string[], reason = 'rule_skipped') => {
    for (const id of ids)
      expect(
        r.out.results.find((x) => x.id === id),
        id,
      ).toMatchObject({
        outcome: 'not_run',
        reasons: [reason],
        attemptIds: [],
        evidence: [],
      });
  };

  it('everything accepted: C, D, then E, which stops the session; no F row runs or reserves', async () => {
    answer({});
    const r = await run();
    expect(r.ran).toEqual(['dx-c-one-tool', 'dx-d-all-tools', 'dx-e-tools-format']);
    expect(r.rows).toEqual(['C', 'D', 'E']);
    expect(r.out.stopped).toBe('dx-e-tools-format_passed');
    skipped(
      r,
      ['dx-f1-no-unions', 'dx-f2-no-formats', 'dx-f3-no-empty', 'dx-f4-not-strict'],
      'dx-e-tools-format_passed',
    );
    countedFirst(r);
    // Only what ran was committed: three probes' maxima.
    expect(r.out.committedMaxUsdMicros).toBe(3n * 266_112n);
    expect(r.rec.attempts).toBe(3);
  });

  it('C refused: the session stops at once, one count and one call', async () => {
    answer({ C: 'refuse' });
    const r = await run();
    expect(r.ran).toEqual(['dx-c-one-tool']);
    expect(r.out.stopped).toBe('dx-c-one-tool_failed');
    expect(r.rows).toEqual(['C']);
    countedFirst(r);
    for (const res of r.out.results.slice(1)) expect(res.outcome).toBe('not_run');
  });

  it('D refused with no path: F1, F2 in turn; F2 accepted stops it; E, F3 and F4 never run', async () => {
    answer({ D: 'refuse', F1: 'refuse' });
    const r = await run();
    expect(r.ran).toEqual([
      'dx-c-one-tool',
      'dx-d-all-tools',
      'dx-f1-no-unions',
      'dx-f2-no-formats',
    ]);
    expect(r.rows).toEqual(['C', 'D', 'F1', 'F2']);
    expect(r.out.stopped).toBe('dx-f2-no-formats_passed');
    skipped(r, ['dx-e-tools-format']);
    skipped(r, ['dx-f3-no-empty', 'dx-f4-not-strict'], 'dx-f2-no-formats_passed');
    countedFirst(r);
    // The refused call is never retried (a 400), and is charged conservatively.
    const d = r.out.results.find((x) => x.id === 'dx-d-all-tools')!;
    expect(d.reasons).toContain('bad_response');
    const msg = d.evidence.find((e) => e.kind === 'message')!;
    expect(msg).toMatchObject({ status: 400, usage: null, retried: false });
    expect(msg.kind === 'message' && msg.costUsdMicros).toBe(133_056n);
  });

  it('D refused naming a path: the session stops there; no F row runs', async () => {
    answer({ D: 'named' });
    const r = await run();
    expect(r.ran).toEqual(['dx-c-one-tool', 'dx-d-all-tools']);
    expect(r.out.stopped).toBe('dx-d-all-tools_named');
    countedFirst(r);
    expect(r.logged.join('\n')).toContain('paths tools.4.custom.input_schema.properties.assignee');
  });

  it('every row refused: six probes, F4 last, sent without strict and counted as sent; exactly the plan’s maximum committed', async () => {
    answer({ D: 'refuse', F1: 'refuse', F2: 'refuse', F3: 'refuse', F4: 'refuse' });
    // The budget is the plan's exact maximum: the costliest sequence fits it.
    const r = await run(buildPlan('tool-diagnostic').totalMaxUsdMicros);
    expect(r.rows).toEqual(['C', 'D', 'F1', 'F2', 'F3', 'F4']);
    expect(r.out.stopped).toBe('dx-f4-not-strict_failed');
    expect(r.out.committedMaxUsdMicros).toBe(r.plan.totalMaxUsdMicros);
    skipped(r, ['dx-e-tools-format']);
    countedFirst(r);
    const f4 = JSON.parse(stub.seen.filter((x) => x.method === 'POST').at(-1)!.body) as Sent;
    const f4count = JSON.parse(stub.counts.at(-1)!.body) as Sent;
    for (const t of [...f4.tools!, ...f4count.tools!]) expect('strict' in t).toBe(false);
    expect(f4count.tools).toEqual(f4.tools);
    // Every refused call charged at the per-call maximum: none assumed free.
    expect(r.rec.recordedUsdMicros >= 5n * 133_056n).toBe(true);
    const charged = r.out.results.flatMap((x) =>
      x.evidence.filter((e) => e.kind === 'message' && e.status === 400),
    );
    expect(charged).toHaveLength(5);
    for (const e of charged) expect(e.kind === 'message' && e.costUsdMicros).toBe(133_056n);
  });

  it('a budget below the next probe’s maximum stops the session before it; nothing reserved for it', async () => {
    answer({ D: 'refuse', F1: 'refuse', F2: 'refuse', F3: 'refuse', F4: 'refuse' });
    const r = await run(5n * 266_112n);
    expect(r.rows).toEqual(['C', 'D', 'F1', 'F2', 'F3']);
    expect(r.out.stopped).toBe('budget');
    expect(r.out.results.find((x) => x.id === 'dx-f4-not-strict')!.attemptIds).toEqual([]);
  });

  it('the report’s matrix: one row a probe, the shape, the refusal’s fields and charges; no key, prompt or provider text', async () => {
    answer({ D: 'refuse', F1: 'named' });
    const since = new Date(Date.now() - 1_000);
    const r = await run();
    expect(r.out.stopped).toBe('dx-f1-no-unions_named');
    const report = buildReport({
      plan: r.plan,
      budgetMicros: r.plan.sessionCapUsdMicros,
      capNzd: 4,
      run: r.out,
      reconciliation: r.rec,
      startedAt: since,
      finishedAt: new Date(),
    });
    const json = JSON.parse(report.json) as {
      diagnostic: {
        id: string;
        shape: string;
        model: string | null;
        toolChoice: string;
        strictTools: boolean;
        answerFormat: boolean;
        outcome: string;
        countPassed: boolean | null;
        messageAttempted: boolean;
        status: number | null;
        category: string | null;
        paths: string[];
        requestId: string | null;
        conservative: boolean;
        chargedUsdMicros: string;
      }[];
      stoppedBecause: string;
    };
    expect(json.stoppedBecause).toBe('dx-f1-no-unions_named');
    expect(json.diagnostic.map((d) => d.id)).toEqual(r.plan.probes.map((p) => p.id));
    const row = (id: string) => json.diagnostic.find((d) => d.id === id)!;
    expect(row('dx-c-one-tool')).toMatchObject({
      model: MODELS.sonnet55.id,
      toolChoice: 'auto',
      strictTools: true,
      answerFormat: false,
      outcome: 'pass',
      countPassed: true,
      messageAttempted: true,
      status: 200,
      category: null,
      conservative: false,
    });
    expect(row('dx-d-all-tools')).toMatchObject({
      outcome: 'fail',
      countPassed: true,
      messageAttempted: true,
      status: 400,
      category: 'invalid_request_error',
      paths: [],
      requestId: expect.stringMatching(/^req_dxrefused\d+$/),
      conservative: true,
      chargedUsdMicros: '133056',
    });
    // F1 does not send get_tasks, so `assignee` is not a name this request
    // sent: the path keeps it as `*` (diagnostics.ts, per request).
    expect(row('dx-f1-no-unions').paths).toEqual(['tools.4.custom.input_schema.properties.*']);
    expect(row('dx-e-tools-format')).toMatchObject({
      outcome: 'not_run',
      answerFormat: true,
      countPassed: null,
      messageAttempted: false,
      chargedUsdMicros: '0',
    });
    expect(row('dx-f4-not-strict').strictTools).toBe(false);
    expect(report.markdown).toContain('## Diagnostic matrix (ADR 0012 §53)');
    expect(report.markdown).toContain('Stopped: dx-f1-no-unions_named.');
    expect(report.markdown).toMatch(
      /\| dx-d-all-tools \| D: [^|]+\| claude-sonnet-5-5 \| auto \| yes \| no \| fail \(bad_response\) \| passed \| yes \| 400 \| invalid_request_error \|/,
    );
    for (const text of [report.json, report.markdown, r.logged.join('\n')]) {
      for (const s of [KEY, CANARY, MESSAGE_TEXT]) expect(text, s).not.toContain(s);
      for (const p of r.plan.probes)
        if (p.kind !== 'models' && p.kind !== 'turn')
          expect(text).not.toContain(p.request.question);
    }
  });
});

describe('the live probes’ request shapes (a regression snapshot)', () => {
  const SNAPSHOT = join('tests', 'integration', 'kev-live-request-shapes.json');
  const sha = (v: unknown) =>
    createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
  type Body = {
    model?: string;
    max_tokens?: number;
    stream?: boolean;
    inference_geo?: string;
    thinking?: unknown;
    tool_choice?: unknown;
    output_config?: { effort?: string; format?: { type?: string; schema?: unknown } };
    system?: { type: string; cache_control?: unknown }[];
    tools?: { name: string; strict?: boolean; input_schema?: unknown }[];
    messages?: { role: string; content: unknown }[];
  };
  /** A body's shape: every request setting, the schemas by hash, the messages by role and block type; no text. */
  const shapeOf = (b: Body) => ({
    model: b.model ?? null,
    max_tokens: b.max_tokens ?? null,
    stream: b.stream ?? null,
    inference_geo: b.inference_geo ?? null,
    thinking: b.thinking ?? null,
    tool_choice: b.tool_choice ?? null,
    output_config: b.output_config
      ? {
          effort: b.output_config.effort ?? null,
          format: b.output_config.format
            ? { type: b.output_config.format.type, schema: sha(b.output_config.format.schema) }
            : null,
        }
      : null,
    system: (b.system ?? []).map((s) => ({ type: s.type, cache_control: s.cache_control ?? null })),
    tools: (b.tools ?? []).map((t) => ({
      name: t.name,
      strict: t.strict ?? null,
      schema: sha(t.input_schema),
    })),
    messages: (b.messages ?? []).map((m) => ({
      role: m.role,
      blocks: Array.isArray(m.content)
        ? (m.content as { type: string }[]).map((c) => c.type)
        : [typeof m.content],
    })),
    keys: Object.keys(b).sort(),
  });

  it('every Messages API body and count body the verification-2 plan sends, as sent on the wire', async () => {
    const plan = buildPlan('verification-2');
    // A fresh synthetic adult, so the turn starts with no history whatever ran before.
    const id = `live-shapes-${randomUUID()}`;
    const email = `${id}@example.test`;
    await admin.db.insert(user).values({ id, name: 'Synthetic shapes adult', email });
    const fresh: UserActor = { kind: 'user', userId: id, email, via: 'kev', channel: 'web' };
    await executePlan(plan, {
      gateway: gateway(),
      actor: fresh,
      deps: { db },
      budgetMicros: plan.sessionCapUsdMicros,
    });
    const shapes = {
      plan: plan.name,
      messages: stub.seen
        .filter((x) => x.method === 'POST')
        .map((x) => shapeOf(JSON.parse(x.body) as Body)),
      counts: stub.counts.map((x) => shapeOf(JSON.parse(x.body) as Body)),
    };
    const text = JSON.stringify(shapes);
    if (process.env.KEV_SCHEMA_SNAPSHOT === 'write') writeFileSync(SNAPSHOT, `${text}\n`);
    expect(existsSync(SNAPSHOT)).toBe(true);
    expect(JSON.stringify(JSON.parse(readFileSync(SNAPSHOT, 'utf8')))).toBe(text);
    // What run #2 established, held here so a change is deliberate: the
    // tool probes send every strict tool and the answer format together
    // with tool_choice auto (G7, refused live); G19 the same with none
    // (accepted live).
    const first = (n: number) => shapes.messages[n]!;
    expect(first(0)).toMatchObject({
      tool_choice: { type: 'auto' },
      output_config: { format: { type: 'json_schema' } },
    });
    expect(first(0).tools.every((t) => t.strict === true)).toBe(true);
    expect(
      shapes.messages.some((m) => (m.tool_choice as { type?: string } | null)?.type === 'none'),
    ).toBe(true);
    // A count is the body without max_tokens, inference_geo and stream.
    for (const c of shapes.counts)
      for (const k of ['max_tokens', 'inference_geo', 'stream']) expect(c.keys).not.toContain(k);
  });
});

describe('the runner’s database checks', () => {
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (e instanceof LiveRefusal) return e;
      throw e;
    }
    throw new Error('expected a refusal');
  };

  it('refuse any database but the runner’s own by name', async () => {
    expect((await refusal(assertFixtureDatabase(db))).code).toBe('database');
  });

  it('refuse a calendar connection, and a person who is not the fixture family’s (counted, never named)', async () => {
    // The Kev fixture holds a synthetic calendar connection.
    const cal = await refusal(assertFixtureDatabase(db, 'home_test'));
    expect(cal.code).toBe('fixtures');
    expect(cal.message).toMatch(/calendar connection/);
    await createPerson(
      f.h.sam,
      { name: 'Synthetic Stranger', role: 'other', inHousehold: false },
      { db },
    );
    try {
      const r = await refusal(assertFixtureDatabase(db, 'home_test'));
      expect(r.message).toMatch(/1 person record/);
      expect(r.message).not.toContain('Synthetic Stranger');
    } finally {
      await admin.db.execute(sql`delete from person where name = 'Synthetic Stranger'`);
    }
  });
});

describe('the isolation check (read-only)', () => {
  it('reports counts, latest times and non-fixture names as a count, in one read-only transaction rolled back', async () => {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    const statements: string[] = [];
    const q: Queryable = {
      query: async (text) => {
        statements.push(text);
        return (await client.query(text)) as never;
      },
    };
    try {
      const r = await isolationReport(q, 'localhost');
      expect(r.database).toBe('home_test');
      expect(r.counts.person).toBeGreaterThanOrEqual(5);
      expect(r.counts.event).toBeGreaterThan(0);
      expect(r.latestCreatedAt.person).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(r.nonFixturePeople).toBe(0);
      expect(r.calendarConnections).toBeGreaterThan(0);
      expect(isolationPasses(r).ok).toBe(true);
      expect(statements[0]).toBe('begin transaction read only');
      expect(statements.at(-1)).toBe('rollback');
      expect(statements.some((s) => /^\s*(insert|update|delete|create|drop|alter)/i.test(s))).toBe(
        false,
      );
      await createPerson(
        f.h.alex,
        { name: 'Synthetic Outsider', role: 'other', inHousehold: false },
        { db },
      );
      const r2 = await isolationReport(q, 'localhost');
      expect(r2.nonFixturePeople).toBe(1);
      expect(isolationPasses(r2)).toEqual({
        ok: false,
        reasons: [expect.stringMatching(/^1 person/)],
      });
      expect(JSON.stringify(r2)).not.toContain('Synthetic Outsider');
      // A write inside its transaction mode is refused by the database.
      await client.query('begin transaction read only');
      await expect(client.query(`update person set name = name`)).rejects.toThrow();
      await client.query('rollback');
    } finally {
      await admin.db.execute(sql`delete from person where name = 'Synthetic Outsider'`);
      await client.end();
    }
  });
});

describe('G16: reservations only, through HOME’s bookkeeping path', () => {
  it('two adults reserve concurrently and settle with no calls; both wait for a held budget lock; nothing left open', async () => {
    process.env.HOME_KEV_MONTHLY_CAP_NZD = '300';
    try {
      const r = await runG16(db, { rounds: 3, holdMs: 300 });
      expect(r).toMatchObject({
        rounds: 3,
        reservationsTaken: 8,
        settled: 8,
        serialisedOnLock: true,
        leftOpenOrUnreconciled: 0,
        passed: true,
      });
      expect(r.lockHeldMs).toBeGreaterThanOrEqual(300);
    } finally {
      process.env.HOME_KEV_MONTHLY_CAP_NZD = '300';
    }
  });
});
