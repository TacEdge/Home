import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, MODELS, TIERS } from '@/kev/config';
import { SCENARIOS } from '@/kev/evals/scenarios';
import { REVIEW_SET } from '@/kev/evals/review-set';
import type { ProbeEvidence } from '@/kev/providers/types';
import { attemptReservation, perCallMax } from '@/kev/router';
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
  DEEP_SMOKE_PROBES,
  PLAN_VERSION,
  PLANS,
  SESSION_PLAN,
} from '../../scripts/kev-live/plan';
import {
  scenarioOutcome,
  smokeAnswerReasons,
  smokeModelReasons,
} from '../../scripts/kev-live/probes';
import { runMode } from '../../scripts/kev-live/runner';

// Package 5D (ADR 0012 §59): the deep smoke plan's design, its exact
// maximum, its budget edges and the keyless preflight against the committed
// campaign ledger. No network, no key, no database. The plan runs end to
// end against a local stub in tests/integration/kev-deep-smoke.test.ts.

const HASH = '47710b79a8fff475c877d3ecbc79f93f634b314bb3db470294eca6ea856ec775';
const LEDGER = readFileSync('docs/m8/M8-LIVE-LEDGER.json', 'utf8');

describe('the deep smoke plan’s design', () => {
  it('one catalogue scenario, on deep, in the owner’s review set (no longer the session plan: G9’s is, ADR 0012 §63)', () => {
    expect(SESSION_PLAN).toBe('g9-binding');
    expect(PLAN_VERSION).toBe(6);
    const plan = buildPlan('deep-smoke');
    expect(plan.kind).toBe('evaluation');
    expect(plan.probes).toHaveLength(1);
    const p = plan.probes[0]!;
    expect(p).toMatchObject({
      kind: 'scenario',
      scenario: 'realistic.weekend_look',
      tier: 'deep',
      repeat: 1,
      turns: 1,
      smoke: true,
      stopOnFail: true,
    });
    expect(p.gates).toEqual(['G7', 'G9', 'G21', 'G22', 'G10', 'E1', 'E9']);
    const s = SCENARIOS.find((x) => x.id === 'realistic.weekend_look')!;
    // It needs a read (the weekend is not in the bundle) and a citation, and
    // it runs on deep (escalation scenarios are fast's alone).
    expect(s.expect.toolsCalled).toContain('get_agenda');
    expect(s.expect.mustCite?.length).toBeGreaterThan(0);
    expect(s.tiers ?? ['fast', 'deep']).toContain('deep');
    expect(REVIEW_SET.map((e) => e.scenario)).toContain(s.id);
    expect(TIERS.deep.model.id).toBe(MODELS.opus55.id);
  });

  it('has a deterministic hash for the owner to approve', () => {
    expect(buildPlan('deep-smoke').hash).toBe(HASH);
    // Any change to what it runs changes it.
    const edit = (over: object) =>
      buildPlan('deep-smoke', [{ ...DEEP_SMOKE_PROBES[0]!, ...over } as never], PLANS['deep-smoke'])
        .hash;
    expect(edit({ tier: 'fast', id: 'realistic.weekend_look@fast#1' })).not.toBe(HASH);
    expect(edit({ smoke: undefined })).not.toBe(HASH);
    expect(
      buildPlan('deep-smoke', DEEP_SMOKE_PROBES, {
        ...PLANS['deep-smoke'],
        sessionCapUsdMicros: 2_000_000n,
      }).hash,
    ).not.toBe(HASH);
  });
});

describe('its exact maximum exposure', () => {
  it('is the US$1.50 turn ceiling: five Opus calls at their per-call maximum would be more', () => {
    // 32,000 input tokens at the 5-minute cache-write price (the dearest
    // input rate HOME's requests can incur) and 8,192 output tokens, × 1.1 (US).
    expect(perCallMax('deep')).toBe(356_224n);
    expect(perCallMax('deep')).toBe(((32_000n * 5_000n + 8_192n * 20_000n) * 11n) / 10n / 1_000n);
    expect(LIMITS.modelCallsPerAttempt).toBe(5);
    expect(BigInt(LIMITS.modelCallsPerAttempt) * perCallMax('deep')).toBe(1_781_120n);
    expect(attemptReservation('deep')).toBe(1_500_000n);
    const plan = buildPlan('deep-smoke');
    expect(plan.totalMaxUsdMicros).toBe(1_500_000n);
    expect(plan.totalNoRetryUsdMicros).toBe(1_500_000n);
    expect(plan.peakHoldUsdMicros).toBe(1_500_000n);
  });

  it('fits every limit: its cap, the run ceiling, the campaign remainder, apart from the household cap', () => {
    const plan = buildPlan('deep-smoke');
    expect(plan.sessionCapUsdMicros).toBe(1_670_000n);
    expect(plan.sessionCapUsdMicros).toBeLessThan(EVALUATION_RUN_CEILING_USD_MICROS);
    // US$1.67 is NZ$3 in HOME's whole-NZ$ cap (US$1.666667), which holds the
    // US$1.50 hold; US$1.66 is NZ$2 (US$1.111111), which cannot.
    expect(capNzdFor(1_670_000n)).toBe(3);
    expect(capUsdMicros(3)).toBe(1_666_667n);
    expect(capUsdMicros(capNzdFor(1_660_000n))).toBeLessThan(plan.peakHoldUsdMicros);
    const ledger = parseLedger(LEDGER);
    const spent = ledger.sessions.reduce((a, s) => a + BigInt(s.recordedUsdMicros), 0n);
    expect(CAMPAIGN_USD_MICROS - spent).toBe(198_578_930n);
    expect(plan.sessionCapUsdMicros).toBeLessThan(CAMPAIGN_USD_MICROS - spent);
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
        ledgerText: LEDGER,
        reportDir: '/nonexistent',
        log: (l) => lines.push(l),
        plan: buildPlan('deep-smoke'),
        gatewayFor: () => {
          gateway = true;
          throw new Error('no gateway before a live run');
        },
      },
    );
    return { ...out, lines, gateway };
  };

  it('the dry run prints the plan and its hash, and makes no model call', async () => {
    const r = await check('1.67', HASH, 'dry-run');
    expect(r).toMatchObject({ exitCode: EXIT.ok, code: 'dry_run', gateway: false });
    const text = r.lines.join('\n');
    expect(text).toContain('Kev live evaluation plan v6: deep-smoke');
    expect(text).toContain(`plan hash: ${HASH}`);
    expect(text).toContain('total maximum: US$1.50');
  });

  it('accepts US$1.67 with the approved hash; refuses another hash, a budget above the cap or the run ceiling, and one below what the cap must hold', async () => {
    expect(await check('1.67')).toMatchObject({
      exitCode: EXIT.ok,
      code: 'plan_checked',
      gateway: false,
    });
    expect((await check('1.67', 'f'.repeat(64))).exitCode).toBe(EXIT.plan_hash);
    // The two-phase acceptance plan's hash (live verification #4) is not this plan's.
    expect(
      (await check('1.67', '58f666f80764cba32ae665e2eb4ca15568f0fe0f68e8d0f244ef0ff95ca35b7e'))
        .exitCode,
    ).toBe(EXIT.plan_hash);
    for (const above of ['1.68', '2', '10', '175'])
      expect((await check(above)).exitCode).toBe(EXIT.budget);
    expect((await check('175.01')).exitCode).toBe(EXIT.budget);
    expect((await check('1.66')).exitCode).toBe(EXIT.cap);
    expect((await check('1.49')).exitCode).toBe(EXIT.budget);
  });
});

describe('the smoke checks', () => {
  const msg = (model: string): ProbeEvidence =>
    ({ kind: 'message', model, attemptId: 'a' }) as unknown as ProbeEvidence;

  it('every call on the tier’s model, at least one', () => {
    expect(smokeModelReasons([msg(MODELS.opus55.id), msg(MODELS.opus55.id)], 'deep')).toEqual([]);
    expect(smokeModelReasons([msg(MODELS.opus55.id), msg(MODELS.sonnet55.id)], 'deep')).toEqual([
      'not_deep_model',
    ]);
    expect(smokeModelReasons([msg(MODELS.sonnet55.id)], 'deep')).toEqual(['not_deep_model']);
    expect(smokeModelReasons([], 'deep')).toEqual(['no_model_call']);
  });

  it('an answer accepted by HOME’s checker, with a citation', () => {
    expect(smokeAnswerReasons('first_pass', 2)).toEqual([]);
    expect(smokeAnswerReasons('after_regeneration', 1)).toEqual([]);
    expect(smokeAnswerReasons('salvaged', 1)).toEqual(['answer_salvaged']);
    expect(smokeAnswerReasons('fallback', 0)).toEqual(['answer_fallback', 'no_citation']);
    expect(smokeAnswerReasons(null, 0)).toEqual(['answer_none', 'no_citation']);
    expect(smokeAnswerReasons('first_pass', 0)).toEqual(['no_citation']);
  });

  it('a smoke check that fails fails the run, even when the scenario’s checker passed it', () => {
    expect(scenarioOutcome({ pass: true, failed: [] }, false, ['answer_salvaged'])).toEqual({
      outcome: 'fail',
      reasons: ['answer_salvaged'],
    });
    expect(scenarioOutcome({ pass: true, failed: [] }, false, [])).toEqual({
      outcome: 'pass',
      reasons: [],
    });
  });
});
