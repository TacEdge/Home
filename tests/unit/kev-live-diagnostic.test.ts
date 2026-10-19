import { describe, expect, it } from 'vitest';
import { ANSWER_JSON_SCHEMA } from '@/kev/answer/schema';
import { countParams, probeParams } from '@/kev/providers/anthropic';
import type { ProviderRequest } from '@/kev/providers/types';
import { attemptReservation, perCallMax } from '@/kev/router';
import { toolDefinitions } from '@/kev/tools/registry';
import {
  buildPlan,
  DIAGNOSTIC_PROBES,
  PLANS,
  planProbes,
  probeTools,
  reachablePaths,
  requestDigest,
  ruleHolds,
  systemFor,
  withoutFormats,
  type ProbeRequest,
  type ProbeSpec,
} from '../../scripts/kev-live/plan';
import { assertCapCovers, capNzdFor, capUsdMicros } from '../../scripts/kev-live/guards.mts';

// The tool-use diagnostic (ADR 0012 §53): what each probe sends, the rules
// that choose the next probe, the exact maximum they allow and the cap that
// holds it. Local only: nothing here says the provider will accept any of
// these requests.

const plan = buildPlan('tool-diagnostic');
const byId = (id: string) => plan.probes.find((p) => p.id === id)!;
const requestOf = (id: string) => (byId(id) as Extract<ProbeSpec, { request: unknown }>).request;
const KEV_TOOLS = toolDefinitions({ escalate: false }).map((t) => t.name);

/** The Messages API body a diagnostic probe sends, as the gateway builds it. */
function bodyOf(id: string) {
  const p = byId(id) as Extract<ProbeSpec, { request: unknown }>;
  const request: ProviderRequest = {
    tier: p.tier,
    system: systemFor(p.request),
    tools: probeTools(p.request),
    toolChoice: p.request.toolChoice,
    messages: [{ role: 'user', content: [{ type: 'text', text: p.request.question }] }],
    ...(p.request.outputFormat === 'answer' ? { outputFormat: ANSWER_JSON_SCHEMA } : {}),
  };
  return { request, params: probeParams(request, p.probe) };
}

describe('the diagnostic’s probes: one call each, Sonnet 5.5, Kev’s prompt, tool_choice auto', () => {
  it('the diagnostic plan: C, D, E, then F1–F4, each with a shape and a hypothesis', () => {
    // Run #3's plan (live verification #3, 2026-10-18); the session plan is now Package 5E's Stage 1 (ADR 0012 §62).
    expect(buildPlan().name).toBe('review-fast');
    expect(plan.probes.map((p) => p.id)).toEqual([
      'dx-c-one-tool',
      'dx-d-all-tools',
      'dx-e-tools-format',
      'dx-f1-no-unions',
      'dx-f2-no-formats',
      'dx-f3-no-empty',
      'dx-f4-not-strict',
    ]);
    for (const p of DIAGNOSTIC_PROBES) {
      expect(p.kind, p.id).toBe('single');
      expect(p.tier, p.id).toBe('fast');
      expect(p.request.system, p.id).toBe('kev');
      expect(p.request.toolChoice, p.id).toBe('auto');
      expect(p.shape.length, p.id).toBeGreaterThan(10);
      expect(p.hypothesis.length, p.id).toBeGreaterThan(40);
      expect(p.gates, p.id).toContain('G22');
    }
    // Not part of run #1's plan or run #2's.
    for (const name of ['full', 'verification-2'] as const)
      for (const p of DIAGNOSTIC_PROBES) expect(PLANS[name].probes).not.toContain(p.id);
  });

  it('C sends one strict tool, `search`; D every read tool, no escalate; only E the answer format', () => {
    const c = bodyOf('dx-c-one-tool').params;
    expect(c.tools!.map((t) => (t as { name: string }).name)).toEqual(['search']);
    expect(c.tool_choice).toEqual({ type: 'auto' });
    expect(c.model).toBe('claude-sonnet-5-5');
    expect(c.inference_geo).toBe('us');
    const d = bodyOf('dx-d-all-tools').params;
    expect(d.tools!.map((t) => (t as { name: string }).name)).toEqual(KEV_TOOLS);
    expect(KEV_TOOLS).toHaveLength(12);
    expect(KEV_TOOLS).not.toContain('escalate');
    for (const t of d.tools!) expect((t as { strict?: boolean }).strict).toBe(true);
    for (const id of plan.probes.map((p) => p.id)) {
      const format = (bodyOf(id).params.output_config as { format?: unknown } | undefined)?.format;
      if (id === 'dx-e-tools-format') expect(format, id).toBeTruthy();
      else expect(format, id).toBeUndefined();
    }
  });

  it('F1 omits the two union tools; F3 the two empty ones; F2 strips every string format and nothing else', () => {
    const names = (id: string) => bodyOf(id).params.tools!.map((t) => (t as { name: string }).name);
    expect(names('dx-f1-no-unions')).toEqual(
      KEV_TOOLS.filter((n) => n !== 'get_tasks' && n !== 'get_gaps'),
    );
    expect(names('dx-f3-no-empty')).toEqual(
      KEV_TOOLS.filter((n) => n !== 'get_today' && n !== 'get_calendar_health'),
    );
    // The union and empty tools are what F1 and F3 claim they are.
    const schema = (n: string) =>
      JSON.stringify(toolDefinitions({ escalate: false }).find((t) => t.name === n)!.inputSchema);
    for (const n of ['get_tasks', 'get_gaps']) expect(schema(n)).toContain('"anyOf"');
    for (const n of KEV_TOOLS.filter((n) => n !== 'get_tasks' && n !== 'get_gaps'))
      expect(schema(n), n).not.toContain('"anyOf"');
    for (const n of ['get_today', 'get_calendar_health'])
      expect(JSON.parse(schema(n)).properties).toEqual({});
    // F2: every tool, no `format` keyword left, every other keyword kept.
    const f2 = bodyOf('dx-f2-no-formats').params.tools!;
    expect(f2.map((t) => (t as { name: string }).name)).toEqual(KEV_TOOLS);
    const all = JSON.stringify(bodyOf('dx-d-all-tools').params.tools);
    expect(all.match(/"format":"(?:date|uuid)"/g)!.length).toBeGreaterThan(10);
    expect(JSON.stringify(f2)).not.toMatch(/"format"/);
    expect(JSON.stringify(f2)).toBe(all.replace(/,?"format":"(?:date|uuid)"/g, ''));
  });

  it('F4 sends every read tool without `strict`; the count (G22) counts exactly that body', () => {
    const { request, params } = bodyOf('dx-f4-not-strict');
    expect(params.tools!.map((t) => (t as { name: string }).name)).toEqual(KEV_TOOLS);
    for (const t of params.tools!) expect('strict' in (t as object)).toBe(false);
    // Only `strict` differs from D's body.
    const d = bodyOf('dx-d-all-tools').params;
    expect(params.tools).toEqual(
      d.tools!.map((t) => {
        const { strict: _s, ...rest } = t as { strict?: boolean };
        void _s;
        return rest;
      }),
    );
    // The production count of the same request is strict: the probe's body is not.
    expect(
      (countParams(request).tools as { strict?: boolean }[]).every((t) => t.strict === true),
    ).toBe(true);
  });

  it('probeParams: strictTools is `false` only, and only with tools; HOME’s own schemas are untouched', () => {
    const { request } = bodyOf('dx-c-one-tool');
    expect(() => probeParams(request, { strictTools: true as unknown as false })).toThrow(/false/);
    expect(() => probeParams({ ...request, tools: [] }, { strictTools: false })).toThrow(
      /without tools/,
    );
    const before = JSON.stringify(toolDefinitions({ escalate: false }));
    probeTools({ ...requestOf('dx-f2-no-formats') });
    probeParams(bodyOf('dx-f4-not-strict').request, { strictTools: false });
    expect(JSON.stringify(toolDefinitions({ escalate: false }))).toBe(before);
  });

  it('a selection naming a tool Kev lacks, or leaving none, is refused', () => {
    const base: ProbeRequest = requestOf('dx-c-one-tool');
    expect(() => probeTools({ ...base, tools: { only: ['escalate'] } })).toThrow(/escalate/);
    expect(() => probeTools({ ...base, tools: { omit: ['get_nothing'] } })).toThrow(/get_nothing/);
    expect(() => probeTools({ ...base, tools: { omit: KEV_TOOLS } })).toThrow(/no tool/);
    expect(probeTools({ ...base, tools: 'none' })).toEqual([]);
  });

  it('withoutFormats: only a string `format` keyword goes; a property named format stays', () => {
    expect(
      withoutFormats({
        type: 'object',
        properties: {
          format: { type: 'string', format: 'date' },
          when: { anyOf: [{ const: 'me' }, { type: 'string', format: 'uuid' }] },
        },
        required: ['format'],
      }),
    ).toEqual({
      type: 'object',
      properties: {
        format: { type: 'string' },
        when: { anyOf: [{ const: 'me' }, { type: 'string' }] },
      },
      required: ['format'],
    });
  });

  it('each probe’s request digest is its own, and the hash binds it', () => {
    const digests = plan.probes.map((p) => p.requestDigest);
    expect(new Set(digests).size).toBe(digests.length);
    // D and F4 differ only in strictness.
    expect(requestOf('dx-d-all-tools')).toEqual(requestOf('dx-f4-not-strict'));
    expect(byId('dx-d-all-tools').requestDigest).not.toBe(byId('dx-f4-not-strict').requestDigest);
    expect(requestDigest(requestOf('dx-d-all-tools'), { strictTools: false })).toBe(
      byId('dx-f4-not-strict').requestDigest,
    );
    expect(
      (plan.canonical.probes as { requestDigest?: string }[]).map((p) => p.requestDigest),
    ).toEqual(digests);
  });
});

describe('the adaptive rules and the exact maximum', () => {
  it('reaches six sequences: C refused; C, D, E; or C, D refused, then F1… until one is accepted', () => {
    const ids = reachablePaths(planProbes('tool-diagnostic')).map((path) =>
      path.map((p) => p.id.split('-')[1]).join(' '),
    );
    expect(ids.sort()).toEqual(
      [
        'c',
        'c d e',
        'c d e',
        'c d f1',
        'c d f1 f2',
        'c d f1 f2 f3',
        'c d f1 f2 f3 f4',
        'c d f1 f2 f3 f4',
      ].sort(),
    );
    // No sequence runs E and an F row, or all seven.
    for (const path of reachablePaths(planProbes('tool-diagnostic'))) {
      const set = path.map((p) => p.id);
      expect(set.includes('dx-e-tools-format') && set.some((i) => i.startsWith('dx-f'))).toBe(
        false,
      );
      expect(set.length).toBeLessThanOrEqual(6);
    }
  });

  it('a run rule: every named probe failed and every other passed; not run is neither', () => {
    const outcomes: Record<string, string> = { a: 'fail', b: 'pass', c: 'not_run' };
    const of = (id: string) => outcomes[id];
    expect(ruleHolds({}, of)).toBe(true);
    expect(ruleHolds({ failed: ['a'] }, of)).toBe(true);
    expect(ruleHolds({ failed: ['a'], passed: ['b'] }, of)).toBe(true);
    expect(ruleHolds({ failed: ['b'] }, of)).toBe(false);
    expect(ruleHolds({ passed: ['a'] }, of)).toBe(false);
    expect(ruleHolds({ failed: ['a', 'b'] }, of)).toBe(false);
    for (const rule of [{ failed: ['c'] }, { passed: ['c'] }, { failed: ['x'] }, { passed: ['x'] }])
      expect(ruleHolds(rule, of), JSON.stringify(rule)).toBe(false);
    // Where no stop implies them, the rules alone choose the sequence.
    const free = (id: string, runIf?: { failed?: string[]; passed?: string[] }) =>
      ({
        ...DIAGNOSTIC_PROBES[0],
        id,
        stopOnFail: false,
        ...(runIf ? { runIf } : {}),
      }) as ProbeSpec;
    const seqs = reachablePaths([
      free('x'),
      free('y', { failed: ['x'] }),
      free('z', { passed: ['x'] }),
    ])
      .map((path) => path.map((p) => p.id).join(''))
      .sort();
    expect([...new Set(seqs)]).toEqual(['xy', 'xz']);
  });

  it('a plan without rules reaches every probe: run #1’s and run #2’s maxima are the sum', () => {
    for (const name of ['full', 'verification-2'] as const) {
      const p = buildPlan(name);
      expect(p.totalMaxUsdMicros, name).toBe(p.listedMaxUsdMicros);
    }
  });

  it('maximum exposure: six probes × 2 calls × US$0.133056 = US$1.596672 (no retries US$0.798336); listed US$1.862784', () => {
    const probe = 2n * perCallMax('fast');
    expect(probe).toBe(266_112n);
    for (const p of plan.probes) expect(p.maxUsdMicros, p.id).toBe(probe);
    expect(plan.totalMaxUsdMicros).toBe(6n * probe);
    expect(plan.totalMaxUsdMicros).toBe(1_596_672n);
    expect(plan.totalNoRetryUsdMicros).toBe(798_336n);
    expect(plan.listedMaxUsdMicros).toBe(1_862_784n);
    // The peak hold: five probes settled at their maxima and the sixth's reservation.
    expect(attemptReservation('fast')).toBe(665_280n);
    expect(plan.peakHoldUsdMicros).toBe(5n * probe + 665_280n);
    expect(plan.peakHoldUsdMicros).toBe(1_995_840n);
  });

  it('the cap: US$2.50 (NZ$4, US$2.222222) holds the peak; US$2.20 (NZ$3) cannot; within the US$10 ceiling', () => {
    expect(plan.sessionCapUsdMicros).toBe(2_500_000n);
    expect(capNzdFor(2_500_000n)).toBe(4);
    expect(capUsdMicros(4)).toBe(2_222_222n);
    expect(() => assertCapCovers(capUsdMicros(4), 0n, plan.peakHoldUsdMicros)).not.toThrow();
    expect(capNzdFor(2_200_000n)).toBe(3);
    expect(() => assertCapCovers(capUsdMicros(3), 0n, plan.peakHoldUsdMicros)).toThrow();
    // The smallest budget that works is US$2.23 (NZ$4.014 → NZ$4).
    expect(capNzdFor(2_220_000n)).toBe(3);
    expect(capNzdFor(2_230_000n)).toBe(4);
    expect(plan.totalMaxUsdMicros <= plan.sessionCapUsdMicros).toBe(true);
  });
});
