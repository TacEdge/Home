import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EvalRecord, TurnRecord } from '@/kev/evals/summary';
import { SCENARIOS } from '@/kev/evals/scenarios';
import { TURNS_PER_DAY } from '@/domain/kev-bookkeeping/constants';
import {
  campaignJson,
  campaignMarkdown,
  campaignPlans,
  summariseCampaign,
} from '../../scripts/kev-live/campaign-summary';
import {
  assertCampaignBatchCovered,
  assertNoCampaignSpent,
  CAMPAIGN_USD_MICROS,
  capNzdFor,
  capUsdMicros,
  EVALUATION_RUN_CEILING_USD_MICROS,
  EXIT,
  ledgerRemainder,
  LiveRefusal,
  parseCampaignSpentUsd,
  parseLedger,
  type Ledger,
} from '../../scripts/kev-live/guards.mts';
import {
  buildPlan,
  CAMPAIGN_BATCHES,
  CAMPAIGN_FIVE_RUN_CLASSES,
  CAMPAIGN_PLANS,
  PLANS,
  SESSION_PLAN,
  SESSION_PLANS,
  sessionPlan,
  smallestPracticalCap,
  splitByTurns,
  turnsByAsker,
  type Plan,
} from '../../scripts/kev-live/plan';
import { buildReport } from '../../scripts/kev-live/report';
import { runMode } from '../../scripts/kev-live/runner';

// The final acceptance campaign (Option A, owner decision 2026-10-24; ADR
// 0012 §76; docs/m8/M8-FINAL-CAMPAIGN.md): §12.3's full suite as written,
// in fifteen batches, each its own plan, hash, budget, approval and run; the
// ledger consolidated at the end, with each dispatch held to the remainder
// after its declared unrecorded spend; and one summary over every batch's
// report. No network, no key, no database: nothing here reaches a provider.

const LEDGER = readFileSync('docs/m8/M8-LIVE-LEDGER.json', 'utf8');
const HASHES = [
  'e43e15b0518e9e3438b7c752999d5c4ec2ebfaf437bb1533e013f1c38ef838f5',
  'f1ff42692aed6f4eab821d28cbe25740e0285095c5e52475eec85dbaa847211e',
  'a8cd01b4860c67c20ca5f1e1b6af30e089f05fdd5823370e23dc713300e71f54',
  'fc1d85ee714888264423e0a2d3ec9291f38d168774bf184ee28fb491b16ea893',
  'd7c2692d4499e3666acdf96ea0f357935286c6bf6c8e490a13fe7dd70533dce7',
  '1d77d4e652e5fb140176e477763de1738fb7bda6e51b9d51b0c4c857923cf718',
  '907c0a98cc30869571e9d72f495a1a601c546d8f7921ba583c16845d58be3eda',
  '9312ee6e078755fed844e658ed86eb1283a91dc615bc3b56b5a73bea52cd59ee',
  '31e1f54b3f5c18a84f2378b51ca7441b05c57e46b52f39850aa7c19a9064e111',
  'e60e9f63b599b75b2e6a5e379d9803c1c5323b3d39e611ac04811a3e67e79698',
  'd75b282c919e31f8d7991687070260aa8682740d7fe8fc167be51405c3b24701',
  '0648f14205749f4f61891cde1e1b12a2152b93086c4ae5e4f7e4ee1300f16d4b',
  'a3564107450b34d1015e3ca1a74f3727e2ef87cb8344900ddb0052cbdf84815c',
  '2f49bf62353e1e63a616cca293104250d79d7e67cfa24b463acc81f0443b2919',
  '7353d9ce623060adbdc811704dd206a571bc5893b76335efdb57003d92f8c5dc',
];
const plans = campaignPlans();
const turns = (p: Plan) => p.probes.reduce((n, x) => n + (x.kind === 'scenario' ? x.turns : 0), 0);
const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;

describe('the campaign: §12.3’s full suite as written', () => {
  it('runs every scenario on its tiers: fast × 5 for the safety, out-of-scope and routing classes, × 3 for the rest; deep × 3', () => {
    const expected = new Set<string>();
    for (const s of SCENARIOS)
      for (const tier of s.tiers ?? (['fast', 'deep'] as const)) {
        const n = tier === 'fast' && CAMPAIGN_FIVE_RUN_CLASSES.includes(s.class) ? 5 : 3;
        for (let r = 1; r <= n; r++) expected.add(`${s.id}@${tier}#${r}`);
      }
    const ids = plans.flatMap((p) => p.probes.map((x) => x.id));
    // Every probe once: nothing missing, nothing twice, nothing else.
    expect(ids).toHaveLength(new Set(ids).size);
    expect(new Set(ids)).toEqual(expected);
    expect(CAMPAIGN_FIVE_RUN_CLASSES).toEqual([
      'privacy',
      'sensitive',
      'injection',
      'fabrication',
      'out_of_scope',
      'routing',
    ]);
  });

  it('878 turns: fast 509, deep 369; the routing scenarios that are fast-only never run on deep', () => {
    const all = plans.flatMap((p) => p.probes);
    const sum = (tier: string) =>
      all.reduce((n, x) => n + (x.kind === 'scenario' && x.tier === tier ? x.turns : 0), 0);
    expect(sum('fast')).toBe(509);
    expect(sum('deep')).toBe(369);
    expect(plans.reduce((n, p) => n + turns(p), 0)).toBe(878);
    for (const x of all)
      if (x.kind === 'scenario')
        expect(scenario(x.scenario).tiers ?? ['fast', 'deep'], x.id).toContain(x.tier);
  });

  it('fifteen batches in a fixed order: fast and deep alternating by repeat in halves, then fast’s fourth and fifth repeats in three', () => {
    expect(CAMPAIGN_PLANS).toHaveLength(15);
    expect(CAMPAIGN_BATCHES).toHaveLength(15);
    const shape = plans.map((p) => [
      [...new Set(p.probes.map((x) => ('tier' in x ? x.tier : '')))].join('+'),
      [...new Set(p.probes.map((x) => (x.kind === 'scenario' ? x.repeat : 0)))].sort().join(','),
      turns(p),
    ]);
    expect(shape).toEqual([
      ['fast', '1', 63],
      ['fast', '1', 62],
      ['deep', '1', 62],
      ['deep', '1', 61],
      ['fast', '2', 63],
      ['fast', '2', 62],
      ['deep', '2', 62],
      ['deep', '2', 61],
      ['fast', '3', 63],
      ['fast', '3', 62],
      ['deep', '3', 62],
      ['deep', '3', 61],
      ['fast', '4,5', 45],
      ['fast', '4,5', 45],
      ['fast', '4,5', 44],
    ]);
    // A scenario's turns are never split: each probe is a whole scenario.
    for (const p of plans)
      for (const x of p.probes)
        if (x.kind === 'scenario') expect(x.turns).toBe(scenario(x.scenario).turns.length);
  });

  it('splits by turns, in order, never inside a probe', () => {
    const probes = CAMPAIGN_BATCHES[12]!;
    const parts = splitByTurns(probes, 3);
    expect(parts.flat()).toEqual([...probes]);
    expect(parts.every((p) => p.length > 0)).toBe(true);
  });

  it('are the session plans, campaign-01 first; each an evaluation plan bound to its place in the campaign', () => {
    expect(SESSION_PLANS).toEqual(CAMPAIGN_PLANS);
    expect(SESSION_PLAN).toBe('campaign-01');
    for (const [i, p] of plans.entries()) {
      expect(p.name).toBe(CAMPAIGN_PLANS[i]);
      expect(p.kind).toBe('evaluation');
      expect(p.campaign).toEqual({ name: 'm8-final-acceptance', batch: i + 1, of: 15, judge: 2 });
      expect(p.canonical.campaign).toEqual(p.campaign);
      // Production's configuration: no comparison configuration, no beta flag.
      expect(p.canonical).not.toHaveProperty('configuration');
      expect(p.canonical).not.toHaveProperty('betas');
      for (const x of p.probes) {
        expect(x).toMatchObject({ kind: 'scenario', stopOnFail: false });
        expect(x).not.toHaveProperty('fast');
        expect(x).not.toHaveProperty('smoke');
      }
    }
  });

  it('have deterministic hashes, each selecting its own batch; other plans’ hashes are unchanged and select none', () => {
    expect(plans.map((p) => p.hash)).toEqual(HASHES);
    for (const [i, h] of HASHES.entries()) expect(sessionPlan(h).name).toBe(CAMPAIGN_PLANS[i]);
    expect(buildPlan('campaign-03').hash).toBe(HASHES[2]);
    for (const other of ['review-fast', 'review-deep', 'review-haiku'] as const) {
      expect(buildPlan(other).canonical).not.toHaveProperty('campaign');
      expect(sessionPlan(buildPlan(other).hash).name).toBe('campaign-01');
    }
    expect(Object.keys(PLANS)).toEqual(expect.arrayContaining([...CAMPAIGN_PLANS]));
  });

  it('never gives one adult more than HOME’s sixty turns a day in a run', () => {
    for (const p of plans)
      for (const [asker, n] of turnsByAsker(p.probes))
        expect(n, `${p.name} ${asker}`).toBeLessThanOrEqual(TURNS_PER_DAY);
  });
});

describe('each batch’s money', () => {
  const remainder = ledgerRemainder(parseLedger(LEDGER));

  it('its maximum is every turn at the US$1.50 ceiling; its cap and budget the smallest whose whole-NZ$ cap holds it', () => {
    for (const p of plans) {
      expect(p.totalMaxUsdMicros).toBe(BigInt(turns(p)) * 1_500_000n);
      expect(p.peakHoldUsdMicros).toBe(p.totalMaxUsdMicros);
      expect(p.sessionCapUsdMicros).toBe(smallestPracticalCap(p.totalMaxUsdMicros));
      expect(capUsdMicros(capNzdFor(p.sessionCapUsdMicros))).toBeGreaterThanOrEqual(
        p.peakHoldUsdMicros,
      );
      expect(capUsdMicros(capNzdFor(p.sessionCapUsdMicros - 10_000n))).toBeLessThan(
        p.peakHoldUsdMicros,
      );
      expect(p.sessionCapUsdMicros).toBeLessThan(EVALUATION_RUN_CEILING_USD_MICROS);
    }
    expect(plans.map((p) => p.sessionCapUsdMicros)).toEqual([
      95_000_000n,
      93_340_000n,
      93_340_000n,
      91_670_000n,
      95_000_000n,
      93_340_000n,
      93_340_000n,
      91_670_000n,
      95_000_000n,
      93_340_000n,
      93_340_000n,
      91_670_000n,
      67_780_000n,
      67_780_000n,
      66_120_000n,
    ]);
    // Stage 1's figure, from the same rule.
    expect(smallestPracticalCap(31_500_000n)).toBe(31_670_000n);
  });

  it('every batch fits the campaign’s present remainder; the whole campaign at once never could, so each is held to what is left', () => {
    expect(remainder).toBe(191_101_177n);
    for (const p of plans) expect(p.sessionCapUsdMicros).toBeLessThan(remainder);
    const all = plans.reduce((a, p) => a + p.totalMaxUsdMicros, 0n);
    expect(all).toBe(1_317_000_000n);
    expect(all).toBeGreaterThan(remainder);
  });

  it('at the planning figures, and at 1.5 times them, every batch still fits what the earlier batches leave', () => {
    // Measured means (runs #8 and #10): fast US$0.0831, deep US$0.1087 a turn.
    const perTurn = (p: Plan) =>
      p.probes.reduce(
        (a, x) =>
          a +
          (x.kind === 'scenario' ? BigInt(x.turns) * (x.tier === 'fast' ? 83_100n : 108_700n) : 0n),
        0n,
      );
    expect(plans.reduce((a, p) => a + perTurn(p), 0n)).toBe(82_408_200n);
    for (const scale of [10n, 15n]) {
      let spent = 0n;
      for (const p of plans) {
        expect(p.sessionCapUsdMicros, `${p.name} at ${scale}/10`).toBeLessThanOrEqual(
          remainder - spent,
        );
        spent += (perTurn(p) * scale) / 10n;
      }
    }
  });
});

describe('the declared unrecorded spend (consolidating the ledger)', () => {
  const ledger = parseLedger(LEDGER);

  it('is US dollars to the micro-dollar, required, and never above the campaign', () => {
    expect(parseCampaignSpentUsd('0')).toBe(0n);
    expect(parseCampaignSpentUsd('5.746233')).toBe(5_746_233n);
    expect(parseCampaignSpentUsd('12.5')).toBe(12_500_000n);
    expect(parseCampaignSpentUsd('200')).toBe(CAMPAIGN_USD_MICROS);
    for (const bad of [undefined, '', '-1', '01', '1.2345678', '1e3', 'US$5', ' 5', '200.000001'])
      expect(() => parseCampaignSpentUsd(bad), String(bad)).toThrow(LiveRefusal);
  });

  it('holds the budget to the remainder after it, refuses a batch the ledger already records, and is refused for any other plan', () => {
    expect(assertCampaignBatchCovered(ledger, HASHES[0]!, 95_000_000n, 0n)).toBe(191_101_177n);
    expect(assertCampaignBatchCovered(ledger, HASHES[1]!, 93_340_000n, 97_761_177n)).toBe(
      93_340_000n,
    );
    expect(() => assertCampaignBatchCovered(ledger, HASHES[1]!, 93_340_000n, 97_761_178n)).toThrow(
      /declared unrecorded spend: US\$93\.339999/,
    );
    const recorded: Ledger = {
      ...ledger,
      sessions: [...ledger.sessions, { ...ledger.sessions[0]!, planHash: HASHES[0]! }],
    };
    expect(() => assertCampaignBatchCovered(recorded, HASHES[0]!, 1n, 0n)).toThrow(/runs once/);
    expect(() => assertNoCampaignSpent({ KEV_LIVE_CAMPAIGN_SPENT_USD: '0' })).toThrow(
      /not a campaign batch/,
    );
    expect(() => assertNoCampaignSpent({ KEV_LIVE_CAMPAIGN_SPENT_USD: '' })).not.toThrow();
    expect(() => assertNoCampaignSpent({})).not.toThrow();
  });

  const check = async (env: Record<string, string>, plan?: Plan) => {
    const lines: string[] = [];
    let gateway = false;
    const out = await runMode('check-plan', env, {
      ledgerText: LEDGER,
      reportDir: '/nonexistent',
      log: (l) => lines.push(l),
      gatewayFor: () => {
        gateway = true;
        throw new Error('no gateway before a live run');
      },
      ...(plan ? { plan } : {}),
    });
    return { ...out, lines, gateway };
  };

  it('the keyless check passes each batch at its own budget with a declaration, and says what is left', async () => {
    const r = await check({
      KEV_LIVE_APPROVED_PLAN_HASH: HASHES[0]!,
      KEV_LIVE_BUDGET_USD: '95',
      KEV_LIVE_CAMPAIGN_SPENT_USD: '0',
    });
    expect(r).toMatchObject({ exitCode: EXIT.ok, code: 'plan_checked', gateway: false });
    expect(r.lines).toContain(
      'campaign m8-final-acceptance, batch 1 of 15: ledger remainder US$191.101177, declared unrecorded spend US$0.000000, left US$191.101177',
    );
    const last = await check({
      KEV_LIVE_APPROVED_PLAN_HASH: HASHES[14]!,
      KEV_LIVE_BUDGET_USD: '66.12',
      KEV_LIVE_CAMPAIGN_SPENT_USD: '82.408200',
    });
    expect(last).toMatchObject({ exitCode: EXIT.ok, code: 'plan_checked' });
  });

  it('refuses a batch with no declaration, or one that leaves less than its budget, before any key or gateway', async () => {
    const base = { KEV_LIVE_APPROVED_PLAN_HASH: HASHES[0]!, KEV_LIVE_BUDGET_USD: '95' };
    for (const spent of [undefined, '', 'none', '96.101178'])
      expect(
        await check(spent === undefined ? base : { ...base, KEV_LIVE_CAMPAIGN_SPENT_USD: spent }),
        String(spent),
      ).toMatchObject({ exitCode: EXIT.ledger, gateway: false });
    expect((await check({ ...base, KEV_LIVE_CAMPAIGN_SPENT_USD: '96.101177' })).exitCode).toBe(
      EXIT.ok,
    );
  });

  it('refuses a declaration given to a plan that is not a campaign batch', async () => {
    const plan = buildPlan('review-fast');
    const env = { KEV_LIVE_APPROVED_PLAN_HASH: plan.hash, KEV_LIVE_BUDGET_USD: '31.67' };
    expect((await check(env, plan)).exitCode).toBe(EXIT.ok);
    expect((await check({ ...env, KEV_LIVE_CAMPAIGN_SPENT_USD: '0' }, plan)).exitCode).toBe(
      EXIT.ledger,
    );
  });

  it('the dry run lists the fifteen batches with their turns, maxima, budgets and hashes, and sends nothing', async () => {
    const lines: string[] = [];
    const out = await runMode(
      'dry-run',
      {},
      {
        ledgerText: LEDGER,
        reportDir: '/nonexistent',
        log: (l) => lines.push(l),
      },
    );
    expect(out).toMatchObject({ exitCode: EXIT.ok, code: 'dry_run' });
    const text = lines.join('\n');
    expect(text).toContain('campaign m8-final-acceptance: 15 batches, 878 turns');
    expect(text).toContain(
      ` 1/15  campaign-01  fast  #1          63    94.50       95.00  ${HASHES[0]}`,
    );
    expect(text).toContain(
      `15/15  campaign-15  fast  #4 #5       44    66.00       66.12  ${HASHES[14]}`,
    );
    for (const s of SCENARIOS) for (const t of s.turns) expect(text).not.toContain(t.question);
  });

  it('a batch’s report carries its place and the money it was dispatched with', () => {
    const plan = plans[1]!;
    const report = buildReport({
      plan,
      budgetMicros: 93_340_000n,
      capNzd: 168,
      run: { results: [], stopped: null, committedMaxUsdMicros: 0n },
      reconciliation: null,
      startedAt: new Date('2026-11-02T01:00:00Z'),
      finishedAt: new Date('2026-11-02T01:20:00Z'),
      campaign: { ledgerRemainderUsdMicros: 191_101_177n, declaredUnrecordedUsdMicros: 5_200_000n },
    });
    expect(JSON.parse(report.json).campaign).toEqual({
      name: 'm8-final-acceptance',
      batch: 2,
      of: 15,
      judge: 2,
      ledgerRemainderUsdMicros: '191101177',
      declaredUnrecordedUsdMicros: '5200000',
    });
    expect(report.markdown).toContain(
      '- Campaign m8-final-acceptance, batch 2 of 15; declared unrecorded spend of earlier batches US$5.200000',
    );
  });
});

describe('the campaign summary across every batch’s report', () => {
  const ledger = parseLedger(LEDGER);
  const turnRecord = (cost: string): TurnRecord => ({
    outcome: 'answered',
    result: 'first_pass',
    answers: ['pass'],
    firstCodes: null,
    regenerations: 0,
    escalated: false,
    escalation: null,
    modelCalls: 2,
    toolRounds: 1,
    toolCalls: 2,
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsdMicros: cost,
    ms: 4000,
  });
  const recordsOf = (p: Plan, fail: (id: string) => readonly string[] = () => []): EvalRecord[] =>
    p.probes.flatMap((x) => {
      if (x.kind !== 'scenario') return [];
      const s = scenario(x.scenario);
      const failed = fail(x.id);
      return [
        {
          scenario: s.id,
          class: s.class,
          tier: x.tier,
          repeat: x.repeat,
          followUp: s.turns.length > 1,
          expectEscalated: null,
          pass: failed.length === 0,
          failed,
          turns: s.turns.map(() => turnRecord('80000')),
        },
      ];
    });
  const report = (
    p: Plan,
    o: {
      at: string;
      recorded?: bigint;
      declared?: bigint;
      left?: bigint;
      records?: EvalRecord[];
      stopped?: string | null;
      ok?: boolean;
    },
  ) => ({
    label: p.name,
    json: JSON.parse(
      JSON.stringify(
        {
          format: 'home-kev-live-report',
          version: 1,
          startedAt: o.at,
          run: { workflowRun: `9${p.campaign!.batch}`, commit: 'abcdef0123' },
          plan: { name: p.name, hash: p.hash, totalMaxUsdMicros: p.totalMaxUsdMicros },
          campaign: {
            ...p.campaign,
            ledgerRemainderUsdMicros: o.left ?? 191_101_177n,
            declaredUnrecordedUsdMicros: o.declared ?? 0n,
          },
          budgetUsdMicros: p.sessionCapUsdMicros,
          stopped: o.stopped ?? null,
          evaluation: { summary: { mode: 'live' }, records: o.records ?? recordsOf(p) },
          reconciliation: {
            ok: o.ok ?? true,
            recordedUsdMicros: o.recorded ?? 5_000_000n,
            atListPricesUsdMicros: o.recorded ?? 5_000_000n,
          },
        },
        (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
      ),
    ) as unknown,
  });
  // Every batch, in order, each declaring exactly what the earlier ones recorded.
  const all = () =>
    plans.map((p, i) =>
      report(p, {
        at: `2026-11-${String(i + 1).padStart(2, '0')}T01:00:00Z`,
        declared: BigInt(i) * 5_000_000n,
      }),
    );

  it('a complete campaign: every probe once, every rate over all 878 turns, money held, ledger rows proposed', () => {
    const c = summariseCampaign(all(), ledger);
    expect(c.complete).toBe(true);
    expect(c.moneyHeld).toBe(true);
    expect(c.notRun).toEqual([]);
    expect(c.missing).toEqual([]);
    expect(c.runs.every((r) => r.declaration === 'held' && r.ledger === 'not_recorded')).toBe(true);
    expect(c.recordedUsdMicros).toBe(75_000_000n);
    expect(c.startRemainderUsdMicros).toBe(191_101_177n);
    expect(c.commits).toEqual(['abcdef0123']);
    const fast = c.summary.tiers.find((t) => t.tier === 'fast')!;
    const deep = c.summary.tiers.find((t) => t.tier === 'deep')!;
    expect(fast.validator.turns + deep.validator.turns).toBe(878);
    expect(fast.runs + deep.runs).toBe(c.records.length);
    expect(fast.safety.failures + deep.safety.failures).toBe(0);
    expect(c.proposedLedgerRows).toHaveLength(15);
    expect(c.proposedLedgerRows[0]).toEqual({
      date: '2026-11-01',
      workflowRun: 'M8 final campaign, batch 1 of 15 (run 91, commit abcdef0)',
      planHash: HASHES[0],
      plannedMaxUsdMicros: '94500000',
      recordedUsdMicros: '5000000',
    });
    const md = campaignMarkdown(c);
    expect(md).toContain('**Complete:** all 15 batches ran once');
    expect(md).toContain('Every run ran commit abcdef0123.');
    expect(JSON.parse(campaignJson(c)).recordedUsdMicros).toBe('75000000');
  });

  it('the consolidated ledger: rows appended from the proposal parse, then match their reports, and the start is unchanged', () => {
    const c = summariseCampaign(all(), ledger);
    const consolidated = parseLedger(
      JSON.stringify({ ...ledger, sessions: [...ledger.sessions, ...c.proposedLedgerRows] }),
    );
    expect(ledgerRemainder(consolidated)).toBe(191_101_177n - 75_000_000n);
    const after = summariseCampaign(all(), consolidated);
    expect(after.startRemainderUsdMicros).toBe(191_101_177n);
    expect(after.runs.every((r) => r.ledger === 'recorded')).toBe(true);
    expect(after.proposedLedgerRows).toEqual([]);
    expect(after.moneyHeld).toBe(true);
    // A row that differs from its report is shown, never hidden.
    const wrong = parseLedger(
      JSON.stringify({
        ...ledger,
        sessions: [...ledger.sessions, { ...c.proposedLedgerRows[0]!, recordedUsdMicros: '1' }],
      }),
    );
    const w = summariseCampaign(all(), wrong);
    expect(w.runs.find((r) => r.batch === 1)!.ledger).toBe('differs');
    expect(w.moneyHeld).toBe(false);
  });

  it('an understated declaration is found: the runner believed in more remainder than there was', () => {
    const reports = all();
    reports[1] = report(plans[1]!, { at: '2026-11-02T01:00:00Z', declared: 4_999_999n });
    const c = summariseCampaign(reports, ledger);
    expect(c.runs.find((r) => r.batch === 2)!.declaration).toBe('understated');
    expect(c.runs.find((r) => r.batch === 3)!.declaration).toBe('held');
    expect(c.moneyHeld).toBe(false);
    expect(campaignMarkdown(c)).toContain('**Money: CHECK.**');
    // Over-declaring is safe: it only ever held a budget to less.
    reports[1] = report(plans[1]!, { at: '2026-11-02T01:00:00Z', declared: 9_000_000n });
    expect(summariseCampaign(reports, ledger).moneyHeld).toBe(true);
  });

  it('what is missing is reported, never hidden: a batch not run, a stopped run, a probe without a record, an unreconciled run', () => {
    const reports = all();
    reports.splice(14, 1);
    const shortRecords = recordsOf(plans[0]!).slice(1);
    reports[0] = report(plans[0]!, {
      at: '2026-11-01T01:00:00Z',
      records: shortRecords,
      stopped: 'wall_clock',
    });
    reports[2] = report(plans[2]!, {
      at: '2026-11-03T01:00:00Z',
      declared: 10_000_000n,
      ok: false,
    });
    const c = summariseCampaign(reports, ledger);
    expect(c.complete).toBe(false);
    expect(c.notRun).toEqual([{ batch: 15, plan: 'campaign-15', planHash: HASHES[14] }]);
    expect(c.missing).toContain(plans[0]!.probes[0]!.id);
    expect(c.missing).toEqual(expect.arrayContaining(plans[14]!.probes.map((p) => p.id)));
    expect(c.missingInRuns).toEqual([plans[0]!.probes[0]!.id]);
    const md = campaignMarkdown(c);
    expect(md).toContain(
      '**INCOMPLETE:** 1 batch(es) not run, 1 stopped, 1 not reconciled in HOME',
    );
    expect(md).toContain('| 15 | campaign-15 | not run |');
    expect(md).toContain(
      `Probes with no record: ${c.missing.length}, of which ${plans[14]!.probes.length} in batches not run, and in batches that ran: ${plans[0]!.probes[0]!.id}.`,
    );
  });

  it('every probe recorded is still incomplete when a run stopped or did not reconcile in HOME', () => {
    for (const o of [{ stopped: 'cap' }, { ok: false }]) {
      const reports = all();
      reports[4] = report(plans[4]!, { at: '2026-11-05T01:00:00Z', declared: 20_000_000n, ...o });
      const c = summariseCampaign(reports, ledger);
      expect(c.missing, JSON.stringify(o)).toEqual([]);
      expect(c.complete, JSON.stringify(o)).toBe(false);
    }
  });

  it('every failed run is listed by batch, with its closed codes; a privacy disclosure counts against the safety gate', () => {
    const reports = all();
    const target = plans[0]!.probes.find(
      (x) => x.kind === 'scenario' && scenario(x.scenario).class === 'privacy',
    )!;
    reports[0] = report(plans[0]!, {
      at: '2026-11-01T01:00:00Z',
      records: recordsOf(plans[0]!, (id) => (id === target.id ? ['private_shown'] : [])),
    });
    const c = summariseCampaign(reports, ledger);
    expect(c.summary.tiers.find((t) => t.tier === 'fast')!.safety.failures).toBe(1);
    expect(campaignMarkdown(c)).toContain(`private_shown`);
  });

  it('refuses what would make it untrustworthy: a foreign plan, a batch twice, a record outside its batch or twice, a scripted run', () => {
    const reports = all();
    const stage1 = buildPlan('review-fast');
    expect(() =>
      summariseCampaign(
        [
          ...reports,
          {
            label: 'x',
            json: {
              ...(reports[0]!.json as object),
              plan: { name: 'review-fast', hash: stage1.hash },
            },
          },
        ],
        ledger,
      ),
    ).toThrow(/not a batch of this campaign/);
    expect(() => summariseCampaign([...reports, reports[3]!], ledger)).toThrow(/appears twice/);
    const stray = recordsOf(plans[1]!).slice(0, 1);
    expect(() =>
      summariseCampaign(
        [
          report(plans[0]!, {
            at: '2026-11-01T01:00:00Z',
            records: [...recordsOf(plans[0]!), ...stray],
          }),
        ],
        ledger,
      ),
    ).toThrow(/not in its batch/);
    const twice = recordsOf(plans[0]!);
    expect(() =>
      summariseCampaign(
        [report(plans[0]!, { at: '2026-11-01T01:00:00Z', records: [...twice, twice[0]!] })],
        ledger,
      ),
    ).toThrow(/recorded twice/);
    const scripted = report(plans[0]!, { at: '2026-11-01T01:00:00Z' });
    (scripted.json as { evaluation: { summary: { mode: string } } }).evaluation.summary.mode =
      'scripted';
    expect(() => summariseCampaign([scripted], ledger)).toThrow(/not a live evaluation/);
    const renamed = report(plans[0]!, { at: '2026-11-01T01:00:00Z' });
    (renamed.json as { campaign: { batch: number } }).campaign.batch = 2;
    expect(() => summariseCampaign([renamed], ledger)).toThrow(/does not match its hash/);
  });
});
