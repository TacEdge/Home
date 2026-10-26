import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, MODELS, TIERS } from '@/kev/config';
import { REVIEW_SET } from '@/kev/evals/review-set';
import { SCENARIOS } from '@/kev/evals/scenarios';
import {
  CAMPAIGN_USD_MICROS,
  capNzdFor,
  capUsdMicros,
  EVALUATION_RUN_CEILING_USD_MICROS,
  EXIT,
  parseLedger,
} from '../../scripts/kev-live/guards.mts';
import {
  buildPlan,
  PLAN_VERSION,
  REVIEW_DEEP_PROBES,
  scenarioTurnMaxUsdMicros,
  SESSION_PLAN,
} from '../../scripts/kev-live/plan';
import { runMode } from '../../scripts/kev-live/runner';

// The review set on deep (ADR 0012 §68): the owner's review set once on the
// deep tier, as configured, after Stage 1 (§67). Its design, its exact
// maximum, its budget edges and the keyless check against the committed
// campaign ledger. No network, no key, no database. Stage 1's plan and its
// approved hash are unchanged.

const HASH = '235207b5b7f1a7efcdb72e5b6e29b49fc4bf8d14580e8c0673a47c3dd71f140c';
const STAGE_1_HASH = '9854c0fe65b2fd4ec019f6df633e532f23ccd68d83b8fde58537a86d3930c5aa';
const LEDGER = readFileSync('docs/m8/M8-LIVE-LEDGER.json', 'utf8');

describe('the deep review run’s design', () => {
  it('the review set, in its order, once each, on deep as configured, without the fast-only scenario (ran as live verification #10; the session plans are now the final campaign’s batches, ADR 0012 §76)', () => {
    expect(SESSION_PLAN).toBe('campaign-01');
    expect(PLAN_VERSION).toBe(6);
    const plan = buildPlan('review-deep');
    expect(plan.name).toBe('review-deep');
    expect(plan.kind).toBe('evaluation');
    const deepOnes = REVIEW_SET.map((e) => e.scenario).filter((id) =>
      (SCENARIOS.find((s) => s.id === id)!.tiers ?? ['fast', 'deep']).includes('deep'),
    );
    expect(deepOnes).toHaveLength(19);
    expect(REVIEW_SET.map((e) => e.scenario).filter((id) => !deepOnes.includes(id))).toEqual([
      'routing.weekend_plan_escalates',
    ]);
    expect(plan.probes.map((p) => p.kind === 'scenario' && p.scenario)).toEqual(deepOnes);
    for (const p of plan.probes)
      expect(p).toMatchObject({ kind: 'scenario', tier: 'deep', repeat: 1, stopOnFail: false });
    // No smoke checks: the catalogue's own checker and its thresholds, unchanged.
    expect(plan.probes.some((p) => 'smoke' in p)).toBe(false);
    // 20 turns: one scenario is a follow-up.
    const turns = plan.probes.reduce((n, p) => n + (p.kind === 'scenario' ? p.turns : 0), 0);
    expect(turns).toBe(20);
    // The deep tier is Opus 5.5.
    expect(TIERS.deep.model.id).toBe(MODELS.opus55.id);
    expect(REVIEW_DEEP_PROBES).toHaveLength(19);
  });

  it('has a deterministic hash for the owner to approve, and leaves Stage 1’s hash unchanged', () => {
    expect(buildPlan('review-deep').hash).toBe(HASH);
    expect(buildPlan('review-fast').hash).toBe(STAGE_1_HASH);
    // Production's request shape: no beta flag (G9's opt-in is its own plan's).
    expect(buildPlan('review-deep').canonical).not.toHaveProperty('betas');
  });
});

describe('its exact maximum exposure', () => {
  it('20 turns at the US$1.50 turn ceiling: US$30.00, and the cap must hold all of it', () => {
    // A deep attempt's reservation is held to the turn ceiling.
    expect(scenarioTurnMaxUsdMicros('deep')).toBe(LIMITS.turnCeilingUsdMicros);
    const plan = buildPlan('review-deep');
    expect(plan.totalMaxUsdMicros).toBe(30_000_000n);
    expect(plan.totalNoRetryUsdMicros).toBe(30_000_000n);
    expect(plan.peakHoldUsdMicros).toBe(30_000_000n);
    expect(plan.sessionCapUsdMicros).toBe(30_000_000n);
    expect(plan.sessionCapUsdMicros).toBeLessThan(EVALUATION_RUN_CEILING_USD_MICROS);
  });

  it('US$30.00 is the smallest budget whose whole-NZ$ cap holds it; within the campaign remainder', () => {
    expect(capNzdFor(30_000_000n)).toBe(54);
    expect(capUsdMicros(54)).toBe(30_000_000n);
    expect(capUsdMicros(capNzdFor(29_990_000n))).toBeLessThan(30_000_000n);
    const ledger = parseLedger(LEDGER);
    const spent = ledger.sessions.reduce((a, s) => a + BigInt(s.recordedUsdMicros), 0n);
    // Runs #13 and #14 recorded (ADR 0012 §79).
    expect(CAMPAIGN_USD_MICROS - spent).toBe(183_864_203n);
    expect(buildPlan('review-deep').sessionCapUsdMicros).toBeLessThan(CAMPAIGN_USD_MICROS - spent);
  });
});

describe('the keyless preflight against the committed ledger', () => {
  const check = async (
    budget: string,
    hash = HASH,
    mode: 'check-plan' | 'dry-run' = 'check-plan',
  ) => {
    const lines: string[] = [];
    let gateway = false;
    const out = await runMode(
      mode,
      { KEV_LIVE_BUDGET_USD: budget, KEV_LIVE_APPROVED_PLAN_HASH: hash },
      {
        plan: buildPlan('review-deep'),
        ledgerText: LEDGER,
        reportDir: '/nonexistent',
        log: (l) => lines.push(l),
        gatewayFor: () => {
          gateway = true;
          throw new Error('no gateway before a live run');
        },
      },
    );
    return { ...out, lines, gateway };
  };

  it('the dry run prints the plan and its hash, and makes no model call', async () => {
    const r = await check('30', HASH, 'dry-run');
    expect(r).toMatchObject({ exitCode: EXIT.ok, code: 'dry_run', gateway: false });
    const text = r.lines.join('\n');
    expect(text).toContain('Kev live evaluation plan v6: review-deep');
    expect(text).toContain(`plan hash: ${HASH}`);
    expect(text).toContain('total maximum: US$30.00');
    // No question is printed.
    for (const s of SCENARIOS) for (const t of s.turns) expect(text).not.toContain(t.question);
  });

  it('accepts US$30.00 with the approved hash; refuses Stage 1’s hash and every budget edge', async () => {
    expect(await check('30')).toMatchObject({
      exitCode: EXIT.ok,
      code: 'plan_checked',
      gateway: false,
    });
    expect((await check('30.00')).exitCode).toBe(EXIT.ok);
    expect((await check('30', STAGE_1_HASH)).exitCode).toBe(EXIT.plan_hash);
    // Below the maximum, a budget is refused before the cap is read.
    for (const b of ['29.99', '30.01', '31.67', '175', '175.01', '29.49', '1.67'])
      expect((await check(b)).exitCode, b).toBe(EXIT.budget);
  });
});
