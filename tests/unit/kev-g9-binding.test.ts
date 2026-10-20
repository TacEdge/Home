import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, TIERS, MODELS } from '@/kev/config';
import {
  allowedHeaders,
  createProviderFetch,
  createRunnerProviderFetch,
  THINKING_BINDING_BETA,
} from '@/kev/providers/fetch';
import { messagesParams, probeParams, transformationsOf } from '@/kev/providers/anthropic';
import type { ProbeEvidence, ProviderRequest } from '@/kev/providers/types';
import {
  CAMPAIGN_USD_MICROS,
  capNzdFor,
  capUsdMicros,
  EXIT,
  parseLedger,
} from '../../scripts/kev-live/guards.mts';
import {
  buildPlan,
  G9_BINDING_PROBES,
  PLAN_VERSION,
  PLANS,
  SESSION_PLAN,
} from '../../scripts/kev-live/plan';
import { bindingChecks } from '../../scripts/kev-live/probes';
import { runMode } from '../../scripts/kev-live/runner';

// G9's verification on a pre-cutoff organisation (ADR 0012 §63): the
// provider's prefix check is opted into per request (`block_binding` under
// the thinking-binding beta flag), on the runner's probe path only. The
// flag through HOME's fetch, the request body, the evidence, the coverage
// checks, the plan, its exact maximum and the keyless preflight. No
// network, no key, no database; the stub run is in kev-live-runner.

const HASH = 'baa9917077b28340f237530bd83ba0bd721eac147ab8d9f193e92d779cad33e3';
const STAGE_1_HASH = '29d5765739ae270f11cf7b3ed1354ca598c034da8479b88a07d855d4f223ceaa';
const LEDGER = readFileSync('docs/m8/M8-LIVE-LEDGER.json', 'utf8');
const KEY = 'test-only-not-a-key';

describe('the beta flag through HOME’s fetch: the runner’s only, and only its exact value', () => {
  const headers = (beta: string) => ({ 'x-api-key': KEY, 'anthropic-beta': beta });
  it('production’s fetch enables no flag: the header is dropped', () => {
    expect(allowedHeaders(headers(THINKING_BINDING_BETA), 'POST', KEY, 2)).not.toHaveProperty(
      'anthropic-beta',
    );
    // The production fetch still takes the key only.
    expect(createProviderFetch.length).toBe(1);
  });

  it('a fetch that enables it sends it; any other flag, or a list, is still dropped', () => {
    const on = [THINKING_BINDING_BETA] as const;
    expect(allowedHeaders(headers(THINKING_BINDING_BETA), 'POST', KEY, 2, on)).toMatchObject({
      'anthropic-beta': THINKING_BINDING_BETA,
    });
    for (const other of [
      'thinking-binding-controls-2026-08-02',
      `${THINKING_BINDING_BETA},files-api-2025-04-14`,
      'compact-2026-09-04',
    ])
      expect(allowedHeaders(headers(other), 'POST', KEY, 2, on)).not.toHaveProperty(
        'anthropic-beta',
      );
  });

  it('the flag is the one the provider documents', () => {
    expect(THINKING_BINDING_BETA).toBe('thinking-binding-controls-2026-08-01');
  });

  it('the runner’s fetch is refused on a deployed process and needs a well-formed key', () => {
    for (const source of [{ VERCEL: '1' }, { VERCEL_ENV: 'preview' }, { NODE_ENV: 'production' }])
      expect(() => createRunnerProviderFetch(KEY, source)).toThrow(/never built on a deployed/);
    expect(() => createRunnerProviderFetch('with a space', {})).toThrow(/well-formed/);
  });

  it('nothing in src/ but the adapter builds the runner’s fetch', () => {
    const adapter = readFileSync('src/kev/providers/anthropic.ts', 'utf8');
    expect(adapter.match(/createRunnerProviderFetch\(/g)).toHaveLength(1);
    // Inside createProbeGateway, never the production provider.
    const prod = adapter.slice(adapter.indexOf('export function createAnthropicProvider'));
    expect(prod.slice(0, prod.indexOf('\n}\n'))).not.toContain('createRunnerProviderFetch');
  });
});

describe('the request: production’s, with only the opt-in added', () => {
  const request = {
    tier: 'fast',
    system: 'You are a test.',
    tools: [],
    toolChoice: 'auto',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic question.' }] }],
  } as unknown as ProviderRequest;

  it('adaptive thinking (every tier’s default) with block_binding `error`; nothing else changes', () => {
    const base = messagesParams(request);
    expect(base).not.toHaveProperty('thinking');
    const p = probeParams(request, { prefixCheck: 'error' });
    expect(p.thinking).toEqual({
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'error' },
    });
    const { thinking: _t, ...rest } = p;
    void _t;
    expect(rest).toEqual(base);
  });

  it('`drop_block` or anything else is refused: the check must be able to fail', () => {
    for (const v of ['drop_block', 'off', ''])
      expect(() => probeParams(request, { prefixCheck: v as 'error' })).toThrow(/`error` only/);
  });
});

describe('the evidence: input_transformations, counted by type', () => {
  it('present and empty; absent; counted by type', () => {
    expect(transformationsOf({ input_transformations: [] })).toEqual({
      dropped: 0,
      allowed: 0,
      other: 0,
    });
    expect(transformationsOf({})).toBeNull();
    expect(transformationsOf(null)).toBeNull();
    expect(transformationsOf({ input_transformations: 'x' })).toBeNull();
    expect(
      transformationsOf({
        input_transformations: [
          { type: 'thinking_dropped' },
          { type: 'thinking_dropped' },
          { type: 'thinking_mismatch_allowed' },
          { type: 'something_new' },
          null,
        ],
      }),
    ).toEqual({ dropped: 2, allowed: 1, other: 2 });
  });
});

describe('the coverage checks (bindingChecks)', () => {
  const none = { dropped: 0, allowed: 0, other: 0 };
  let n = 0;
  const call = (
    attemptId: string,
    stop: string,
    o: { format?: boolean; thinking?: number; transformations?: typeof none | null } = {},
  ) =>
    ({
      kind: 'message',
      attemptId,
      requestId: `r${++n}`,
      model: MODELS.sonnet55.id,
      outcome: 'ok',
      stop,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inferenceGeo: 'us',
      },
      costUsdMicros: 1n,
      toolChoice: o.format ? 'none' : 'auto',
      answerFormat: o.format ?? false,
      blocks: o.thinking ? { thinking: o.thinking } : { text: 1 },
      growOnly: true,
      transformations: o.transformations === undefined ? none : o.transformations,
      retried: false,
      error: null,
      ms: 1,
    }) as unknown as ProbeEvidence;
  const covered = (a = 'a', t?: typeof none | null) => [
    call(a, 'tool_use', { thinking: 1, transformations: t }),
    call(a, 'tool_use', { thinking: 1, transformations: t }),
    call(a, 'end_turn', { transformations: t }),
    call(a, 'end_turn', { format: true, transformations: t }),
    call(a, 'end_turn', { format: true, transformations: t }),
  ];

  it('two tool rounds and a regeneration in one attempt, thinking replayed, every call untransformed: pass', () => {
    expect(bindingChecks(covered())).toEqual({
      covered: true,
      transformationsSeen: true,
      transformed: 0,
      reasons: [],
    });
  });

  it('one round, or no regeneration, or no thinking, is not covered', () => {
    const c = covered();
    expect(bindingChecks(c.filter((_, i) => i !== 1)).reasons).toEqual(['g9_not_covered']);
    expect(bindingChecks(c.slice(0, 4)).reasons).toEqual(['g9_not_covered']);
    expect(
      bindingChecks([
        call('a', 'tool_use'),
        call('a', 'tool_use'),
        call('a', 'end_turn', { format: true }),
        call('a', 'end_turn', { format: true }),
      ]).reasons,
    ).toEqual(['g9_not_covered']);
  });

  it('a fast answer and an escalation’s answer are not a regeneration: coverage is per attempt', () => {
    const split = [
      call('fast', 'tool_use', { thinking: 1 }),
      call('fast', 'tool_use', { thinking: 1 }),
      call('fast', 'end_turn', { format: true }),
      call('deep', 'end_turn', { format: true }),
    ];
    expect(bindingChecks(split).covered).toBe(false);
  });

  it('a call without input_transformations means the flag did not apply; any entry is a failure', () => {
    const missing = covered();
    missing[2] = call('a', 'end_turn', { transformations: null });
    expect(bindingChecks(missing).reasons).toEqual(['g9_no_transformations']);
    const moved = covered('a', { dropped: 1, allowed: 0, other: 0 });
    expect(bindingChecks(moved)).toMatchObject({ transformed: 5, reasons: ['g9_transformed'] });
    expect(bindingChecks([]).reasons).toEqual(['g9_not_covered', 'g9_no_transformations']);
  });
});

describe('the plan: one fast turn, the prefix check on', () => {
  it('ran as live verification #7; Stage 1’s approved hash unchanged (the session plan is now the deep review, ADR 0012 §68)', () => {
    expect(SESSION_PLAN).toBe('review-deep');
    expect(PLAN_VERSION).toBe(6);
    const plan = buildPlan('g9-binding');
    expect(plan.name).toBe('g9-binding');
    expect(plan.kind).toBe('verification');
    expect(plan.probes).toHaveLength(1);
    expect(plan.probes[0]).toMatchObject({
      id: 'g9-binding-turn',
      kind: 'turn',
      probe: { prefixCheck: 'error' },
      stopOnFail: true,
    });
    // The question that gave two rounds and a regeneration on fast (LV#4).
    expect(plan.probes[0]).toMatchObject({
      question: 'What’s on this Saturday, and what’s left to do on the back fence?',
    });
    expect(plan.canonical).toMatchObject({ betas: [THINKING_BINDING_BETA] });
    expect(buildPlan('review-fast').hash).toBe(STAGE_1_HASH);
    expect(buildPlan('review-fast').canonical).not.toHaveProperty('betas');
    expect(TIERS.fast.model.id).toBe(MODELS.sonnet55.id);
  });

  it('has a deterministic hash that binds the opt-in', () => {
    expect(buildPlan('g9-binding').hash).toBe(HASH);
    expect(buildPlan('review-fast').hash).toBe(STAGE_1_HASH);
    const { probe: _p, ...without } = G9_BINDING_PROBES[0] as Extract<
      (typeof G9_BINDING_PROBES)[number],
      { kind: 'turn' }
    >;
    void _p;
    expect(buildPlan('g9-binding', [without], PLANS['g9-binding']).hash).not.toBe(HASH);
  });

  it('its maximum is the US$1.50 turn ceiling; US$1.67 is the smallest budget whose whole-NZ$ cap holds it', () => {
    const plan = buildPlan('g9-binding');
    expect(plan.totalMaxUsdMicros).toBe(LIMITS.turnCeilingUsdMicros);
    expect(plan.totalMaxUsdMicros).toBe(1_500_000n);
    expect(plan.peakHoldUsdMicros).toBe(1_500_000n);
    expect(plan.sessionCapUsdMicros).toBe(1_670_000n);
    expect(capNzdFor(1_670_000n)).toBe(3);
    expect(capUsdMicros(3)).toBe(1_666_667n);
    expect(capUsdMicros(capNzdFor(1_660_000n))).toBeLessThan(1_500_000n);
    const ledger = parseLedger(LEDGER);
    const spent = ledger.sessions.reduce((a, s) => a + BigInt(s.recordedUsdMicros), 0n);
    expect(CAMPAIGN_USD_MICROS - spent).toBe(196_748_930n);
    // Within the US$10 workspace month limit with Stage 1 still to come.
    expect(plan.sessionCapUsdMicros).toBeLessThan(10_000_000n);
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
        plan: buildPlan('g9-binding'),
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
    const r = await check('1.67', HASH, 'dry-run');
    expect(r).toMatchObject({ exitCode: EXIT.ok, code: 'dry_run', gateway: false });
    const text = r.lines.join('\n');
    expect(text).toContain('Kev live verification plan v6: g9-binding');
    expect(text).toContain(`plan hash: ${HASH}`);
    expect(text).toContain('total maximum: US$1.50');
  });

  it('accepts US$1.67 with the approved hash; refuses another hash and every budget edge', async () => {
    expect(await check('1.67')).toMatchObject({
      exitCode: EXIT.ok,
      code: 'plan_checked',
      gateway: false,
    });
    expect((await check('1.67', STAGE_1_HASH)).exitCode).toBe(EXIT.plan_hash);
    expect((await check('1.66')).exitCode).toBe(EXIT.cap);
    for (const b of ['1.68', '2', '1.49', '31.67'])
      expect((await check(b)).exitCode, b).toBe(EXIT.budget);
  });
});
