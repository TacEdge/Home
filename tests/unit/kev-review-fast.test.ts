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
  PLANS,
  REVIEW_FAST_PROBES,
  scenarioTurnMaxUsdMicros,
  SESSION_PLAN,
} from '../../scripts/kev-live/plan';
import { runMode } from '../../scripts/kev-live/runner';

// Package 5E's Stage 1 (M8-PACKAGE-5E-READINESS.md §8; ADR 0012 §62): the
// owner's review set once on the fast tier, as configured. Its design, its
// exact maximum, its budget edges and the keyless check against the
// committed campaign ledger. No network, no key, no database. G9's
// prefix-check plan ran first (live verification #7, ADR 0012 §64) and left
// this plan, and its approved hash, exactly as they were; it is the session
// plan again (ADR 0012 §65).

const HASH = '9854c0fe65b2fd4ec019f6df633e532f23ccd68d83b8fde58537a86d3930c5aa';
const LEDGER = readFileSync('docs/m8/M8-LIVE-LEDGER.json', 'utf8');

describe('Stage 1’s design', () => {
  it('the review set, in its order, once each, on fast as configured (ran as live verification #8; the session plan is now the deep review, ADR 0012 §68)', () => {
    expect(SESSION_PLAN).toBe('review-sonnet-low');
    expect(PLAN_VERSION).toBe(6);
    const plan = buildPlan('review-fast');
    expect(plan.name).toBe('review-fast');
    expect(plan.kind).toBe('evaluation');
    expect(plan.probes.map((p) => p.kind === 'scenario' && p.scenario)).toEqual(
      REVIEW_SET.map((e) => e.scenario),
    );
    for (const p of plan.probes)
      expect(p).toMatchObject({ kind: 'scenario', tier: 'fast', repeat: 1, stopOnFail: false });
    // No smoke checks: the catalogue's own checker and its thresholds, unchanged.
    expect(plan.probes.some((p) => 'smoke' in p)).toBe(false);
    // 21 turns: one scenario is a follow-up.
    const turns = plan.probes.reduce((n, p) => n + (p.kind === 'scenario' ? p.turns : 0), 0);
    expect(turns).toBe(21);
    for (const p of plan.probes)
      if (p.kind === 'scenario')
        expect(p.turns).toBe(SCENARIOS.find((s) => s.id === p.scenario)!.turns.length);
    // The fast tier is Sonnet 5.5 at medium effort.
    expect(TIERS.fast.model.id).toBe(MODELS.sonnet55.id);
    expect(TIERS.fast.effort).toBe('medium');
    expect(REVIEW_FAST_PROBES).toHaveLength(20);
  });

  it('has a deterministic hash for the owner to approve, unchanged by G9’s plan', () => {
    expect(buildPlan('review-fast').hash).toBe(HASH);
    expect(buildPlan().hash).not.toBe(HASH);
    expect(buildPlan('g9-binding').hash).not.toBe(HASH);
    expect(buildPlan('deep-smoke').hash).not.toBe(HASH);
    expect(
      buildPlan('review-fast', REVIEW_FAST_PROBES.slice(1), PLANS['review-fast']).hash,
    ).not.toBe(HASH);
  });
});

describe('its exact maximum exposure', () => {
  it('21 turns at the US$1.50 turn ceiling: US$31.50, and the cap must hold all of it', () => {
    // A fast turn's attempt (US$0.66528) and an escalation (US$1.50) are held
    // together to the turn ceiling.
    expect(scenarioTurnMaxUsdMicros('fast')).toBe(LIMITS.turnCeilingUsdMicros);
    const plan = buildPlan('review-fast');
    expect(plan.totalMaxUsdMicros).toBe(31_500_000n);
    expect(plan.totalNoRetryUsdMicros).toBe(31_500_000n);
    expect(plan.peakHoldUsdMicros).toBe(31_500_000n);
    expect(plan.sessionCapUsdMicros).toBe(31_670_000n);
    expect(plan.sessionCapUsdMicros).toBeLessThan(EVALUATION_RUN_CEILING_USD_MICROS);
  });

  it('US$31.67 is the smallest budget whose whole-NZ$ cap holds it; within the campaign remainder', () => {
    expect(capNzdFor(31_670_000n)).toBe(57);
    expect(capUsdMicros(57)).toBe(31_666_667n);
    expect(capUsdMicros(capNzdFor(31_660_000n))).toBeLessThan(31_500_000n);
    const ledger = parseLedger(LEDGER);
    const spent = ledger.sessions.reduce((a, s) => a + BigInt(s.recordedUsdMicros), 0n);
    expect(CAMPAIGN_USD_MICROS - spent).toBe(191_101_177n);
    expect(buildPlan('review-fast').sessionCapUsdMicros).toBeLessThan(CAMPAIGN_USD_MICROS - spent);
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
        plan: buildPlan('review-fast'),
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
    const r = await check('31.67', HASH, 'dry-run');
    expect(r).toMatchObject({ exitCode: EXIT.ok, code: 'dry_run', gateway: false });
    const text = r.lines.join('\n');
    expect(text).toContain('Kev live evaluation plan v6: review-fast');
    expect(text).toContain(`plan hash: ${HASH}`);
    expect(text).toContain('total maximum: US$31.50');
    // No question is printed.
    for (const s of SCENARIOS) for (const t of s.turns) expect(text).not.toContain(t.question);
  });

  it('accepts US$31.67 with the approved hash; refuses another hash and every budget edge', async () => {
    expect(await check('31.67')).toMatchObject({
      exitCode: EXIT.ok,
      code: 'plan_checked',
      gateway: false,
    });
    expect((await check('31.67', buildPlan('deep-smoke').hash)).exitCode).toBe(EXIT.plan_hash);
    expect((await check('31.66')).exitCode).toBe(EXIT.cap);
    for (const b of ['31.68', '32', '175', '175.01', '31.49', '1.67'])
      expect((await check(b)).exitCode, b).toBe(EXIT.budget);
  });
});
