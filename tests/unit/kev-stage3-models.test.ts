import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, MODELS, TIERS } from '@/kev/config';
import { REVIEW_SET } from '@/kev/evals/review-set';
import { SCENARIOS } from '@/kev/evals/scenarios';
import type {
  ProbeEvidence,
  ProbeOptions,
  ProviderRequest,
  RunOptions,
} from '@/kev/providers/types';
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
  PLANS,
  REVIEW_HAIKU_PROBES,
  REVIEW_SONNET_LOW_PROBES,
  scenarioProbes,
  scenarioTurnMaxUsdMicros,
  SESSION_PLAN,
  SESSION_PLANS,
  sessionPlan,
  type PlanDef,
  type ProbeSpec,
} from '../../scripts/kev-live/plan';
import { configurationReasons, configuredProvider } from '../../scripts/kev-live/probes';
import { runMode } from '../../scripts/kev-live/runner';

// Package 5E's Stage 3, the model comparison (ADR 0012 §72): the owner's
// review set started on fast with Sonnet 5.5 at `low`, then with Haiku 5.5,
// each its own plan, hash, budget and run. Only the fast attempt's calls
// change; an escalation is the deep tier as configured. No network, no key,
// no database: nothing here reaches a provider.

const LOW_HASH = '715085a9f8078a92fa59c2211ea4bfc76253f0d5d010f06ea6c3047eea2eee23';
const HAIKU_HASH = '1bc1126e20d1be818962d965b32eecce0f3eaaa1f8e3bb45e66ced4155364b3a';
const STAGE_1_HASH = '9854c0fe65b2fd4ec019f6df633e532f23ccd68d83b8fde58537a86d3930c5aa';
const STAGE_2_HASH = '235207b5b7f1a7efcdb72e5b6e29b49fc4bf8d14580e8c0673a47c3dd71f140c';
const LEDGER = readFileSync('docs/m8/M8-LIVE-LEDGER.json', 'utf8');

describe('the two comparison plans', () => {
  it('are the session plans, Sonnet `low` first; each the review set in its order, once, started on fast', () => {
    expect(SESSION_PLANS).toEqual(['review-sonnet-low', 'review-haiku']);
    expect(SESSION_PLAN).toBe('review-sonnet-low');
    const ids = REVIEW_SET.map((e) => e.scenario);
    for (const name of SESSION_PLANS) {
      const plan = buildPlan(name);
      expect(plan.kind).toBe('evaluation');
      expect(plan.probes.map((p) => p.kind === 'scenario' && p.scenario)).toEqual(ids);
      for (const p of plan.probes)
        expect(p).toMatchObject({ kind: 'scenario', tier: 'fast', repeat: 1, stopOnFail: false });
      expect(plan.probes.some((p) => 'smoke' in p)).toBe(false);
      const turns = plan.probes.reduce((n, p) => n + (p.kind === 'scenario' ? p.turns : 0), 0);
      expect(turns).toBe(21);
    }
    expect(REVIEW_SONNET_LOW_PROBES).toHaveLength(20);
    expect(REVIEW_HAIKU_PROBES).toHaveLength(20);
  });

  it('select their models explicitly: Sonnet 5.5 at `low`; Haiku 5.5 at the fast tier’s own effort; escalation on Opus 5.5 `medium`', () => {
    for (const p of buildPlan('review-sonnet-low').probes)
      expect(p).toMatchObject({ fast: { effort: 'low' } });
    for (const p of buildPlan('review-haiku').probes)
      expect(p).toMatchObject({ fast: { probeModel: 'haiku55' } });
    expect(buildPlan('review-sonnet-low').canonical.configuration).toEqual({
      fast: { model: MODELS.sonnet55.id, effort: 'low' },
      escalation: { model: MODELS.opus55.id, effort: 'medium' },
    });
    expect(buildPlan('review-haiku').canonical.configuration).toEqual({
      fast: { model: MODELS.haiku55.id, effort: 'medium' },
      escalation: { model: MODELS.opus55.id, effort: 'medium' },
    });
    // The tiers themselves are unchanged: production is Sonnet `medium` and Opus `medium`.
    expect(TIERS.fast).toMatchObject({
      model: MODELS.sonnet55,
      effort: 'medium',
      maxTokens: 4_096,
    });
    expect(TIERS.deep).toMatchObject({ model: MODELS.opus55, effort: 'medium' });
  });

  it('have deterministic hashes, distinct from each other and from the baselines, which stay as they ran', () => {
    expect(buildPlan('review-sonnet-low').hash).toBe(LOW_HASH);
    expect(buildPlan('review-haiku').hash).toBe(HAIKU_HASH);
    expect(buildPlan('review-sonnet-low').hash).toBe(buildPlan('review-sonnet-low').hash);
    expect(buildPlan().hash).toBe(LOW_HASH);
    expect(buildPlan('review-fast').hash).toBe(STAGE_1_HASH);
    expect(buildPlan('review-deep').hash).toBe(STAGE_2_HASH);
    // Production's request shape otherwise: no beta flag.
    expect(buildPlan('review-haiku').canonical).not.toHaveProperty('betas');
    expect(buildPlan('review-fast').canonical).not.toHaveProperty('configuration');
  });
});

describe('their financial limits', () => {
  it('each: 21 turns at the US$1.50 turn ceiling, US$31.50; the peak hold the same; one turn at a time', () => {
    // A fast turn's most: the fast attempt (reserved at Sonnet 5.5's
    // maximum, Haiku's included) and an escalation, held to the ceiling.
    expect(perCallMax('fast')).toBe(133_056n);
    expect(attemptReservation('fast')).toBe(665_280n);
    expect(scenarioTurnMaxUsdMicros('fast')).toBe(LIMITS.turnCeilingUsdMicros);
    for (const name of SESSION_PLANS) {
      const plan = buildPlan(name);
      expect(plan.totalMaxUsdMicros).toBe(31_500_000n);
      expect(plan.totalNoRetryUsdMicros).toBe(31_500_000n);
      expect(plan.peakHoldUsdMicros).toBe(31_500_000n);
      expect(plan.sessionCapUsdMicros).toBe(31_670_000n);
      expect(plan.sessionCapUsdMicros).toBeLessThan(EVALUATION_RUN_CEILING_USD_MICROS);
    }
  });

  it('US$31.67 is the smallest budget whose whole-NZ$ cap holds US$31.50; both runs fit the campaign remainder', () => {
    expect(capNzdFor(31_670_000n)).toBe(57);
    expect(capUsdMicros(57)).toBeGreaterThanOrEqual(31_500_000n);
    expect(capUsdMicros(capNzdFor(31_660_000n))).toBeLessThan(31_500_000n);
    const spent = parseLedger(LEDGER).sessions.reduce(
      (a, s) => a + BigInt(s.recordedUsdMicros),
      0n,
    );
    const remainder = CAMPAIGN_USD_MICROS - spent;
    expect(remainder).toBe(194_575_003n);
    // Both budgets at once, were each spent to its cap: US$131.235003 left.
    expect(remainder - 2n * 31_670_000n).toBe(131_235_003n);
  });
});

describe('the keyless preflight, the plan chosen by its approved hash', () => {
  const check = async (
    budget: string,
    hash: string,
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
        gatewayFor: () => {
          gateway = true;
          throw new Error('no gateway before a live run');
        },
      },
    );
    return { ...out, lines, gateway };
  };

  it('the dry run prints both plans, their configurations, maxima and hashes, and sends nothing', async () => {
    const r = await check('31.67', LOW_HASH, 'dry-run');
    expect(r).toMatchObject({ exitCode: EXIT.ok, code: 'dry_run', gateway: false });
    const text = r.lines.join('\n');
    expect(text).toContain('Kev live evaluation plan v6: review-sonnet-low');
    expect(text).toContain('Kev live evaluation plan v6: review-haiku');
    expect(text).toContain(`plan hash: ${LOW_HASH}`);
    expect(text).toContain(`plan hash: ${HAIKU_HASH}`);
    expect(text).toContain(
      'configuration: fast calls on claude-sonnet-5-5 at effort low; an escalation on claude-opus-5-5 at effort medium',
    );
    expect(text).toContain(
      'configuration: fast calls on claude-haiku-5-5 at effort medium; an escalation on claude-opus-5-5 at effort medium',
    );
    expect(text.match(/total maximum: US\$31\.50/g)).toHaveLength(2);
    for (const s of SCENARIOS) for (const t of s.turns) expect(text).not.toContain(t.question);
  });

  it('each hash selects its own plan, which passes at US$31.67 without a key or a gateway', async () => {
    for (const [hash, name] of [
      [LOW_HASH, 'review-sonnet-low'],
      [HAIKU_HASH, 'review-haiku'],
    ] as const) {
      expect(sessionPlan(hash).name).toBe(name);
      const r = await check('31.67', hash);
      expect(r, name).toMatchObject({ exitCode: EXIT.ok, code: 'plan_checked', gateway: false });
      expect(r.lines[0]).toContain(`plan v6: ${name}`);
    }
  });

  it('refuses a wrong hash: the baselines’, a changed one, none', async () => {
    for (const hash of [STAGE_1_HASH, STAGE_2_HASH, LOW_HASH.replace(/^7/, '8'), ''])
      expect((await check('31.67', hash)).exitCode, hash || 'none').toBe(EXIT.plan_hash);
    expect(sessionPlan('nope').name).toBe('review-sonnet-low');
  });

  it('refuses every budget but the plan’s own: above its cap or the run ceiling, below its maximum, or one its whole-NZ$ cap cannot hold', async () => {
    for (const hash of [LOW_HASH, HAIKU_HASH])
      for (const b of ['31.68', '32', '175', '175.01', '31.49', '30', '1.67'])
        expect((await check(b, hash)).exitCode, `${hash.slice(0, 6)} ${b}`).toBe(EXIT.budget);
    // At or above the maximum yet below US$31.67: its whole-NZ$ cap (NZ$56)
    // cannot hold the peak, refused before any database or key.
    for (const hash of [LOW_HASH, HAIKU_HASH])
      for (const b of ['31.50', '31.66'])
        expect((await check(b, hash)).exitCode, `${hash.slice(0, 6)} ${b}`).toBe(EXIT.cap);
  });
});

describe('a comparison run’s calls', () => {
  type Seen = { tier: string; probe: ProbeOptions | undefined };
  const stub = () => {
    const seen: Seen[] = [];
    const gateway = {
      provider: () => ({
        kind: 'anthropic' as const,
        run: async () => {
          seen.push({ tier: 'provider', probe: undefined });
          return null as never;
        },
      }),
      run: async (request: ProviderRequest, _o: RunOptions, probe?: ProbeOptions) => {
        seen.push({ tier: request.tier, probe });
        return null as never;
      },
    };
    return { gateway, seen };
  };
  const req = (tier: 'fast' | 'deep') => ({ tier }) as unknown as ProviderRequest;

  it('carry the configuration on the fast attempt only: an escalated deep attempt is the deep tier as configured', async () => {
    for (const fast of [{ effort: 'low' as const }, { probeModel: 'haiku55' as const }]) {
      const { gateway, seen } = stub();
      const p = configuredProvider(gateway, fast);
      await p.run(req('fast'), {} as RunOptions);
      await p.run(req('deep'), {} as RunOptions);
      expect(seen).toEqual([
        { tier: 'fast', probe: fast },
        { tier: 'deep', probe: undefined },
      ]);
    }
  });

  it('without a configuration, are the gateway’s production requests (Stages 1 and 2 unchanged)', async () => {
    const { gateway, seen } = stub();
    await configuredProvider(gateway, undefined).run(req('fast'), {} as RunOptions);
    expect(seen).toEqual([{ tier: 'provider', probe: undefined }]);
  });

  const msg = (model: string, effort: string | null) =>
    ({ kind: 'message', model, effort }) as unknown as ProbeEvidence;

  it('must each be on the configured model and effort, or the deep tier’s once escalated', () => {
    const low = { effort: 'low' as const };
    const haiku = { probeModel: 'haiku55' as const };
    expect(
      configurationReasons([msg(MODELS.sonnet55.id, 'low'), msg(MODELS.opus55.id, 'medium')], low),
    ).toEqual([]);
    expect(
      configurationReasons(
        [msg(MODELS.haiku55.id, 'medium'), msg(MODELS.opus55.id, 'medium')],
        haiku,
      ),
    ).toEqual([]);
    // The tier's own effort where `low` was configured; Sonnet where Haiku was.
    expect(configurationReasons([msg(MODELS.sonnet55.id, 'medium')], low)).toEqual([
      'not_configured_effort',
    ]);
    expect(configurationReasons([msg(MODELS.sonnet55.id, 'medium')], haiku)).toEqual([
      'not_configured_model',
    ]);
    // An escalation is never `low`; no effort sent is not the configuration.
    expect(configurationReasons([msg(MODELS.opus55.id, 'low')], low)).toEqual([
      'not_configured_effort',
    ]);
    expect(configurationReasons([msg(MODELS.haiku55.id, null)], haiku)).toEqual([
      'not_configured_effort',
    ]);
  });
});

describe('a comparison plan is refused unless it is one configuration, on fast, as the gateway allows', () => {
  const def = (specs: readonly ProbeSpec[]): PlanDef => ({
    kind: 'evaluation',
    probes: specs.map((p) => p.id),
    specs,
    sessionCapUsdMicros: 31_670_000n,
  });
  const one = (fast: unknown, tier: 'fast' | 'deep' = 'fast') =>
    ({ ...REVIEW_SONNET_LOW_PROBES[0]!, tier, fast }) as ProbeSpec;
  const build = (specs: ProbeSpec[]) => buildPlan('x', specs, def(specs));

  it('refuses a configuration on deep, an unknown option or value, or two configurations in one plan', () => {
    expect(() =>
      scenarioProbes({
        scenarios: ['realistic.tomorrow'],
        tiers: ['deep'],
        repeats: 1,
        fast: { effort: 'low' },
      }),
    ).toThrow(/fast only/);
    expect(() => build([one({ effort: 'low' }, 'deep')])).toThrow(/fast only/);
    expect(() => build([one({ effort: 'high' })])).toThrow(/Haiku 5.5 or `low`/);
    expect(() => build([one({ probeModel: 'opus55' })])).toThrow(/Haiku 5.5 or `low`/);
    expect(() => build([one({ strictTools: false })])).toThrow(/Haiku 5.5 or `low`/);
    expect(() => build([one({})])).toThrow(/Haiku 5.5 or `low`/);
    const [a, b] = REVIEW_HAIKU_PROBES;
    expect(() =>
      build([a!, { ...(b as ProbeSpec), fast: { effort: 'low' } } as ProbeSpec]),
    ).toThrow(/one fast configuration/);
    expect(() => build([a!, { ...(b as ProbeSpec), fast: undefined } as ProbeSpec])).toThrow(
      /one fast configuration/,
    );
    expect(Object.keys(PLANS)).toEqual(
      expect.arrayContaining(['review-sonnet-low', 'review-haiku']),
    );
  });
});
