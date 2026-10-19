import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, MODELS, TIERS } from '@/kev/config';
import { probeParams } from '@/kev/providers/anthropic';
import type { ProbeEvidence } from '@/kev/providers/types';
import { attemptReservation, perCallMax } from '@/kev/router';
import {
  buildPlan,
  canonicalJson,
  plannedCalls,
  PLANS,
  planProbes,
  PROBES,
  probeMaxUsdMicros,
  probeTools,
  systemFor,
  TURN_NOW,
  type PlanDef,
  type ProbeSpec,
} from '../../scripts/kev-live/plan';
import { phaseChecks } from '../../scripts/kev-live/probes';
import { planLines, runMode } from '../../scripts/kev-live/runner';
import {
  assertCapCovers,
  capNzdFor,
  capUsdMicros,
  EVALUATION_RUN_CEILING_USD_MICROS,
  EXIT,
  SESSION_CEILING_USD_MICROS,
} from '../../scripts/kev-live/guards.mts';

// The live verification plan (M8 live-verification plan §4, §7; owner
// decisions 2 and 4): its maxima are the gateway's own, its total fits the
// approved US$10, its hash is stable and changes with anything it sends,
// and the dry run makes no network call at all.

describe('the plan’s maxima are the gateway’s', () => {
  it('per-call maxima: Sonnet 5.5 US$0.133056, Opus 5.5 US$0.356224 (32k input at the cache-write price + max_tokens, × 1.1)', () => {
    expect(perCallMax('fast')).toBe(133_056n);
    expect(perCallMax('deep')).toBe(356_224n);
  });

  it('each probe: planned calls × 2 (HOME’s one retry) × its tier’s per-call maximum, never above its reservation; a turn at the US$1.50 ceiling', () => {
    for (const p of PROBES) {
      const m = probeMaxUsdMicros(p);
      if (p.kind === 'models') expect(m).toBe(0n);
      else if (p.kind === 'turn') expect(m).toBe(LIMITS.turnCeilingUsdMicros);
      else {
        const raw = BigInt(plannedCalls(p) * 2) * perCallMax(p.tier);
        const cap = attemptReservation(p.tier);
        expect(m, p.id).toBe(raw < cap ? raw : cap);
      }
    }
  });

  it('live verification #2: only G1, G7 on the three models, G19 and the turn; its maximum within its US$6 cap; G1 first', () => {
    const plan = buildPlan('verification-2');
    expect(plan.name).toBe('verification-2');
    expect(plan.probes.map((p) => p.id)).toEqual([
      'g1-models',
      'g7-fast',
      'g7-deep',
      'g19-cache-fast',
      'haiku-g7',
      'g9-g21-turn',
    ]);
    // 4 × 133,056 (G7 fast, G19, Haiku G7) + 4 × 356,224 (G7 deep) + 1,500,000 (the turn).
    expect(plan.totalMaxUsdMicros).toBe(4_521_568n);
    expect(plan.probes[0]).toMatchObject({ id: 'g1-models', stopOnFail: true });
    // Run #1's passes are not repeated.
    for (const id of ['g8-fast', 'g8-deep', 'haiku-g8', 'g20-abort-fast', 'g1-effort-low-fast'])
      expect(plan.probes.map((p) => p.id)).not.toContain(id);
    expect(plan.totalMaxUsdMicros).toBe(plan.probes.reduce((a, p) => a + p.maxUsdMicros, 0n));
    expect(plan.sessionCapUsdMicros).toBe(6_000_000n);
    expect(plan.totalMaxUsdMicros <= plan.sessionCapUsdMicros).toBe(true);
    expect(plan.sessionCapUsdMicros <= SESSION_CEILING_USD_MICROS).toBe(true);
    // The turn alone is held at the US$1.50 ceiling.
    expect(plan.probes.at(-1)!.maxUsdMicros).toBe(1_500_000n);
  });

  it('a US$6 budget: HOME’s own cap (whole NZ$) holds the plan, and every reservation fits even if each earlier probe settled at its maximum', () => {
    const plan = buildPlan('verification-2');
    const cap = capUsdMicros(capNzdFor(plan.sessionCapUsdMicros));
    expect(capNzdFor(plan.sessionCapUsdMicros)).toBe(10);
    expect(cap).toBe(5_555_556n);
    expect(() => assertCapCovers(cap, 0n, plan.totalMaxUsdMicros)).not.toThrow();
    let settled = 0n;
    for (const p of plan.probes) {
      // The largest hold the probe can take at once: an attempt's reservation
      // (a turn: its fast attempt, then an escalation within US$1.50 together).
      const hold =
        p.kind === 'models'
          ? 0n
          : p.kind === 'turn'
            ? LIMITS.turnCeilingUsdMicros
            : attemptReservation(p.tier);
      expect(settled + hold <= cap, p.id).toBe(true);
      settled += p.maxUsdMicros;
    }
    expect(settled).toBe(plan.totalMaxUsdMicros);
  });

  it('every named plan names only probes that exist, each once, with a cap no higher than its kind’s ceiling (US$10 to verify, US$175 for an evaluation run)', () => {
    for (const [name, p] of Object.entries(PLANS)) {
      expect(new Set(p.probes).size, name).toBe(p.probes.length);
      expect(planProbes(name as keyof typeof PLANS).length, name).toBe(p.probes.length);
      const def: PlanDef = p;
      const ceiling =
        def.kind === 'evaluation' ? EVALUATION_RUN_CEILING_USD_MICROS : SESSION_CEILING_USD_MICROS;
      expect(def.sessionCapUsdMicros <= ceiling, name).toBe(true);
    }
  });

  it('the full plan (run #1): US$7.277024, within the approved US$10, and the sum of the probes', () => {
    const plan = buildPlan('full');
    expect(plan.totalMaxUsdMicros).toBe(plan.probes.reduce((a, p) => a + p.maxUsdMicros, 0n));
    expect(plan.totalMaxUsdMicros).toBe(7_277_024n);
    expect(plan.totalMaxUsdMicros <= SESSION_CEILING_USD_MICROS).toBe(true);
  });

  it('every probe the gateway can express: Haiku and every probe option on a fast budget where needed', () => {
    for (const p of PROBES) {
      if (p.kind === 'models') {
        expect([...p.models].sort()).toEqual(
          Object.values(MODELS)
            .map((m) => m.id)
            .sort(),
        );
        continue;
      }
      if (!('request' in p)) continue;
      const request = {
        tier: p.tier,
        system: systemFor(p.request),
        tools: probeTools(p.request),
        toolChoice: p.request.toolChoice,
        messages: [
          { role: 'user' as const, content: [{ type: 'text' as const, text: p.request.question }] },
        ],
      };
      const params = probeParams(request, p.probe);
      expect(params.model, p.id).toBe(
        p.probe.probeModel === 'haiku55' ? MODELS.haiku55.id : TIERS[p.tier].model.id,
      );
      expect(params.inference_geo).toBe('us');
    }
  });

  it('synthetic prompts only: no address or link, and the turn reads the fixture family’s scenario instant', () => {
    // tests/integration/kev-fixture.ts's NOW: Wednesday 14 October 2026, 07:03 in Auckland.
    expect(new Date(TURN_NOW).getTime()).toBe(new Date('2026-10-14T07:03:00+13:00').getTime());
    expect(canonicalJson(PROBES)).not.toMatch(/@|https?:\/\/|\d{6,}/);
  });
});

describe('the plan hash', () => {
  it('is stable: the same plan, the same hash', () => {
    expect(buildPlan().hash).toBe(buildPlan().hash);
    expect(buildPlan().hash).toMatch(/^[0-9a-f]{64}$/);
    // Key order never matters.
    expect(canonicalJson({ b: 1, a: { d: 2n, c: [3] } })).toBe('{"a":{"c":[3],"d":"2"},"b":1}');
  });

  it('changes with any probe: its question, its options, its tier, its order or its removal', () => {
    const base = buildPlan('full').hash;
    const edit = (i: number, f: (p: ProbeSpec) => ProbeSpec) =>
      buildPlan(
        'full',
        PROBES.map((p, j) => (j === i ? f(p) : p)),
      ).hash;
    const g7 = PROBES.findIndex((p) => p.id === 'g7-fast');
    const g8 = PROBES.findIndex((p) => p.id === 'g8-fast');
    const changed = [
      edit(
        g7,
        (p) =>
          ({
            ...p,
            request: { ...(p as { request: object }).request, question: 'Something else?' },
          }) as ProbeSpec,
      ),
      edit(
        g8,
        (p) => ({ ...p, probe: { systemMessage: 'Reply in upper case only.' } }) as ProbeSpec,
      ),
      edit(g8, (p) => ({ ...p, tier: 'deep' }) as ProbeSpec),
      edit(g7, (p) => ({ ...p, expect: 'changed' })),
      buildPlan('full', [...PROBES].reverse()).hash,
      buildPlan('full', PROBES.slice(1)).hash,
    ];
    // The plan's name and session cap are part of what is approved.
    changed.push(buildPlan('verification-2', planProbes('full')).hash);
    expect(buildPlan().hash).not.toBe(base);
    expect(buildPlan().hash).not.toBe(
      'f7f82b9ab622b2cc096e93837850c4cd67e787cbc17d9ed3aa95201944c3f8e8',
    );
    expect(buildPlan('deep-smoke').canonical).toMatchObject({
      plan: 'deep-smoke',
      sessionCapUsdMicros: 1_670_000n,
    });
    // The diagnostic's rules are part of the approved plan: a changed
    // selection, rule or stop changes the hash.
    const dx = buildPlan('tool-diagnostic').hash;
    const dxEdit = (id: string, f: (p: ProbeSpec) => ProbeSpec) =>
      buildPlan(
        'tool-diagnostic',
        planProbes('tool-diagnostic').map((p) => (p.id === id ? f(p) : p)),
      ).hash;
    const dxChanged = [
      dxEdit(
        'dx-f1-no-unions',
        (p) =>
          ({
            ...p,
            request: { ...(p as { request: object }).request, tools: { omit: ['get_tasks'] } },
          }) as unknown as ProbeSpec,
      ),
      dxEdit('dx-d-all-tools', (p) => ({ ...p, stopWhenNamed: undefined }) as ProbeSpec),
      dxEdit('dx-e-tools-format', (p) => ({ ...p, runIf: undefined }) as ProbeSpec),
      dxEdit('dx-f4-not-strict', (p) => ({ ...p, probe: {} }) as ProbeSpec),
      dxEdit('dx-c-one-tool', (p) => ({ ...p, stopOnFail: false })),
    ];
    for (const h of dxChanged) expect(h).not.toBe(dx);
    expect(new Set(dxChanged).size).toBe(dxChanged.length);
    for (const h of changed) expect(h).not.toBe(base);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it('covers Kev’s configuration and what the probes send: models, prices, tiers, the system prompt, tools and answer schema', () => {
    const c = buildPlan().canonical as Record<string, unknown>;
    expect(Object.keys(c)).toEqual(
      expect.arrayContaining([
        'models',
        'tiers',
        'limits',
        'perCallMaxUsdMicros',
        'digests',
        'probes',
      ]),
    );
    expect(Object.keys(c.digests as object).sort()).toEqual(
      ['answerSchema', 'syntheticSystem', 'systemPrompt', 'toolResult', 'tools'].sort(),
    );
  });
});

describe('the dry run', () => {
  const realFetch = globalThis.fetch;
  let globalCalls = 0;
  beforeEach(() => {
    globalCalls = 0;
    globalThis.fetch = (() => {
      globalCalls += 1;
      throw new Error('no network in a dry run');
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('prints the plan, every probe’s maximum, the total and the hash, and makes no network call at all', async () => {
    const spies = [
      vi.spyOn(http, 'request'),
      vi.spyOn(https, 'request'),
      vi.spyOn(net, 'connect'),
      vi.spyOn(net, 'createConnection'),
      vi.spyOn(tls, 'connect'),
    ];
    const lines: string[] = [];
    const KEY = 'test-key-not-real-dry-run';
    const out = await runMode(
      'dry-run',
      { KEV_EVAL_PROVIDER_KEY: KEY, DATABASE_URL: 'postgres://u:p@localhost/home_live_verify' },
      {
        ledgerText: null,
        reportDir: '/nonexistent',
        log: (l) => lines.push(l),
        plan: buildPlan('deep-smoke'),
      },
    );
    expect(out).toEqual({ exitCode: EXIT.ok, code: 'dry_run' });
    const plan = buildPlan('deep-smoke');
    const text = lines.join('\n');
    expect(plan.name).toBe('deep-smoke');
    expect(text).toContain(`plan hash: ${plan.hash}`);
    expect(text).toContain(
      'Kev live evaluation plan v6: deep-smoke (session cap US$1.67; ceiling US$175.00)',
    );
    expect(text).toContain('total maximum: US$1.50 (no retries: US$1.50)');
    expect(text).toContain('peak reservation hold: US$1.50');
    // One probe, no rules: no diagnostic matrix and no listed-versus-reachable line.
    expect(text).not.toContain('diagnostic matrix');
    expect(text).not.toContain('exactly');
    expect(text).toContain('realistic.weekend_look@deep#1');
    for (const p of PROBES) expect(text).not.toContain(`${p.id} `);
    expect(text).not.toContain(KEY);
    // No prompt is printed: not the scenario's question, nor any probe's.
    expect(text).not.toContain('What does our weekend look like?');
    for (const p of PROBES)
      expect(text).not.toContain(
        p.kind === 'turn' ? p.question : 'request' in p ? p.request.question : '\u0000',
      );
    expect(globalCalls).toBe(0);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(planLines(plan)).toEqual(lines.slice(0, planLines(plan).length));
  });

  it('the keyless plan check: the hash, the budget and the ledger, each refused with its code, and no network', async () => {
    const httpSpy = vi.spyOn(http, 'request');
    const httpsSpy = vi.spyOn(https, 'request');
    const plan = buildPlan('deep-smoke');
    const ledgerText = JSON.stringify({
      format: 'home-kev-live-ledger',
      version: 1,
      campaignUsdMicros: '200000000',
      sessions: [],
    });
    const run = (env: Record<string, string | undefined>, ledger: string | null = ledgerText) =>
      runMode('check-plan', env, {
        ledgerText: ledger,
        reportDir: '/nonexistent',
        log: () => undefined,
        plan,
      });
    expect(
      await run({ KEV_LIVE_BUDGET_USD: '1.67', KEV_LIVE_APPROVED_PLAN_HASH: plan.hash }),
    ).toEqual({
      exitCode: EXIT.ok,
      code: 'plan_checked',
    });
    // The deep smoke plan's cap is US$1.67 (Package 5D): anything above it is
    // refused, the acceptance plan's US$2, the diagnostic's US$2.50, run #2's
    // US$6 and run #1's US$10 included; so is a budget below the plan's
    // maximum (US$1.50), and one whose whole-NZ$ cap cannot hold the turn's
    // US$1.50 (US$1.66 is NZ$2, US$1.111111), with no database. US$1.67 is
    // NZ$3 (US$1.666667), the smallest that works.
    expect(
      (await run({ KEV_LIVE_BUDGET_USD: '1.67', KEV_LIVE_APPROVED_PLAN_HASH: plan.hash })).exitCode,
    ).toBe(EXIT.ok);
    expect(
      (await run({ KEV_LIVE_BUDGET_USD: '1.66', KEV_LIVE_APPROVED_PLAN_HASH: plan.hash })).exitCode,
    ).toBe(EXIT.cap);
    for (const above of ['1.68', '2', '2.50', '3', '6', '7', '10', '175'])
      expect(
        (await run({ KEV_LIVE_BUDGET_USD: above, KEV_LIVE_APPROVED_PLAN_HASH: plan.hash }))
          .exitCode,
        above,
      ).toBe(EXIT.budget);
    expect(
      (await run({ KEV_LIVE_BUDGET_USD: '1.49', KEV_LIVE_APPROVED_PLAN_HASH: plan.hash })).exitCode,
    ).toBe(EXIT.budget);
    // The diagnostic's approved hash is not this plan's.
    expect(
      (
        await run({
          KEV_LIVE_BUDGET_USD: '1.67',
          KEV_LIVE_APPROVED_PLAN_HASH: buildPlan('tool-diagnostic').hash,
        })
      ).exitCode,
    ).toBe(EXIT.plan_hash);
    // Run #2's plan's hash is not this plan's.
    expect(
      (
        await run({
          KEV_LIVE_BUDGET_USD: '1.67',
          KEV_LIVE_APPROVED_PLAN_HASH: buildPlan('verification-2').hash,
        })
      ).exitCode,
    ).toBe(EXIT.plan_hash);
    expect(
      (await run({ KEV_LIVE_BUDGET_USD: '1.67', KEV_LIVE_APPROVED_PLAN_HASH: 'a'.repeat(64) }))
        .exitCode,
    ).toBe(EXIT.plan_hash);
    expect(
      (await run({ KEV_LIVE_BUDGET_USD: '7', KEV_LIVE_APPROVED_PLAN_HASH: plan.hash })).exitCode,
    ).toBe(EXIT.budget);
    expect(
      (await run({ KEV_LIVE_BUDGET_USD: '175.01', KEV_LIVE_APPROVED_PLAN_HASH: plan.hash }))
        .exitCode,
    ).toBe(EXIT.budget);
    expect(
      (await run({ KEV_LIVE_BUDGET_USD: '1.67', KEV_LIVE_APPROVED_PLAN_HASH: plan.hash }, null))
        .exitCode,
    ).toBe(EXIT.ledger);
    expect(
      (
        await run({
          KEV_LIVE_BUDGET_USD: '1.67',
          KEV_LIVE_APPROVED_PLAN_HASH: plan.hash,
          KEV_EVAL_PROVIDER_KEY: 'test-key-not-real-0000',
        })
      ).exitCode,
    ).toBe(EXIT.no_key);
    expect(
      (
        await run({
          KEV_LIVE_BUDGET_USD: '1.67',
          KEV_LIVE_APPROVED_PLAN_HASH: plan.hash,
          VERCEL: '1',
        })
      ).exitCode,
    ).toBe(EXIT.deployed);
    expect(globalCalls).toBe(0);
    expect(httpSpy).not.toHaveBeenCalled();
    expect(httpsSpy).not.toHaveBeenCalled();
  });

  it('live refuses before any network or database when the key is under the wrong name', async () => {
    const httpsSpy = vi.spyOn(https, 'request');
    const plan = buildPlan();
    const out = await runMode(
      'live',
      {
        KEV_LIVE_BUDGET_USD: '10',
        KEV_LIVE_APPROVED_PLAN_HASH: plan.hash,
        DATABASE_URL: 'postgres://u:p@localhost:5432/home_live_verify',
        HOME_KEV_PROVIDER_KEY: 'test-key-not-real-0000',
      },
      { ledgerText: null, reportDir: '/nonexistent', log: () => undefined },
    );
    expect(out.exitCode).toBe(EXIT.no_key);
    expect(httpsSpy).not.toHaveBeenCalled();
    expect(globalCalls).toBe(0);
  });
});

describe('the two-phase acceptance plan (ADR 0012 §54)', () => {
  it('one orchestrated fast turn: G7 as revised, G9, G21, G22, G10; US$1.50 at most; cap US$2', () => {
    const plan = buildPlan('two-phase-acceptance');
    expect(plan.probes.map((p) => [p.id, p.kind])).toEqual([['g9-g21-turn', 'turn']]);
    expect(plan.probes[0]!.gates).toEqual(['G7', 'G9', 'G21', 'G22', 'G10']);
    expect(plan.totalMaxUsdMicros).toBe(LIMITS.turnCeilingUsdMicros);
    expect(plan.totalMaxUsdMicros).toBe(1_500_000n);
    expect(plan.peakHoldUsdMicros).toBe(1_500_000n);
    expect(plan.sessionCapUsdMicros).toBe(2_000_000n);
    // US$2 is NZ$3 (US$1.666667), which holds the turn; US$1.66 is NZ$2 and cannot.
    expect(capNzdFor(2_000_000n)).toBe(3);
    expect(capUsdMicros(3)).toBe(1_666_667n);
    expect(() => assertCapCovers(capUsdMicros(3), 0n, plan.peakHoldUsdMicros)).not.toThrow();
    expect(capNzdFor(1_660_000n)).toBe(2);
    expect(() => assertCapCovers(capUsdMicros(2), 0n, plan.peakHoldUsdMicros)).toThrow();
    expect(capNzdFor(1_670_000n)).toBe(3);
  });

  it('the turn’s phase checks: a tool round, the answer phase (the format under none), never the format under auto', () => {
    const call = (toolChoice: string | null, answerFormat: boolean, stop = 'end_turn') =>
      ({ kind: 'message', toolChoice, answerFormat, stop }) as unknown as ProbeEvidence;
    const count = { kind: 'count' } as unknown as ProbeEvidence;
    const read = call('auto', false, 'tool_use');
    expect(
      phaseChecks([count, read, count, call('auto', false), count, call('none', true)]),
    ).toEqual({ toolRounds: 1, answerPhase: true, formatWithAuto: false, reasons: [] });
    // No tool round.
    expect(phaseChecks([call('auto', false), call('none', true)]).reasons).toEqual([
      'no_tool_round',
    ]);
    // No answer phase: the format never sent, or sent only under auto.
    expect(phaseChecks([read, call('auto', false)]).reasons).toEqual(['no_answer_phase']);
    expect(phaseChecks([read, call('none', false)]).reasons).toEqual(['no_answer_phase']);
    expect(phaseChecks([read, call('auto', true)]).reasons).toEqual([
      'no_answer_phase',
      'format_with_auto',
    ]);
    // The format under auto fails the turn even beside a proper answer phase.
    expect(phaseChecks([read, call('auto', true), call('none', true)]).reasons).toEqual([
      'format_with_auto',
    ]);
    expect(phaseChecks([]).reasons).toEqual(['no_tool_round', 'no_answer_phase']);
  });
});
