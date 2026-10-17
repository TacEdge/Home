import { diagnosticLine } from '@/kev/providers/diagnostics';
import { usd } from './guards.mts';
import type { Plan } from './plan';
import type { ProbeResult, RunOutcome } from './probes';
import type { Reconciliation } from './reconcile';

// The session's report (M8 live-verification plan §5, §9): per probe and per
// call, the gate, model, tokens, HOME's cost, stop reason, `inference_geo`,
// the provider's `request-id` and pass or fail against the plan; then the
// reconciliation. Built only from the probe gateway's evidence and the
// runner's own figures, so it holds no prompt, answer, tool content, header
// or key (tests/integration/kev-live-runner.test.ts searches it for canaries).
// Written to the job's artifact directory, never committed.

export type Report = Readonly<{
  json: string;
  markdown: string;
  passed: boolean;
}>;

const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

function callRows(r: ProbeResult) {
  return r.evidence.map((e) =>
    e.kind === 'models'
      ? {
          kind: e.kind,
          model: e.model,
          status: e.status,
          requestId: e.requestId,
          outcome: e.outcome,
          resolvedId: e.id,
          maxInputTokens: e.maxInputTokens,
          maxTokens: e.maxTokens,
          error: e.error,
          ms: e.ms,
        }
      : e.kind === 'count'
        ? {
            kind: e.kind,
            model: e.model,
            status: e.status,
            requestId: e.requestId,
            counted: e.counted,
            error: e.error,
            ms: e.ms,
          }
        : {
            kind: e.kind,
            model: e.model,
            status: e.status,
            requestId: e.requestId,
            outcome: e.outcome,
            stop: e.stop,
            inputTokens: e.usage?.inputTokens ?? null,
            outputTokens: e.usage?.outputTokens ?? null,
            cacheReadTokens: e.usage?.cacheReadTokens ?? null,
            cacheWriteTokens: e.usage?.cacheWriteTokens ?? null,
            inferenceGeo: e.usage?.inferenceGeo ?? null,
            costUsdMicros: e.costUsdMicros,
            blocks: e.blocks,
            growOnly: e.growOnly,
            retried: e.retried,
            error: e.error,
            ms: e.ms,
          },
  );
}

/** Gate by gate: pass when every probe naming it passed, else what failed. */
function gateSummary(results: readonly ProbeResult[]) {
  const gates = new Map<string, { probes: string[]; failed: string[]; notRun: string[] }>();
  for (const r of results)
    for (const g of r.gates) {
      const e = gates.get(g) ?? { probes: [], failed: [], notRun: [] };
      e.probes.push(r.id);
      if (r.outcome === 'fail') e.failed.push(r.id);
      if (r.outcome === 'not_run') e.notRun.push(r.id);
      gates.set(g, e);
    }
  return [...gates.entries()]
    .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))
    .map(([gate, e]) => ({
      gate,
      result: e.failed.length
        ? 'fail'
        : e.notRun.length
          ? 'incomplete'
          : 'pass (to be recorded by the owner)',
      ...e,
    }));
}

export function buildReport(input: {
  plan: Plan;
  budgetMicros: bigint;
  capNzd: number;
  run: RunOutcome;
  reconciliation: Reconciliation | null;
  startedAt: Date;
  finishedAt: Date;
}): Report {
  const { plan, run, reconciliation: rec } = input;
  const probes = run.results.map((r) => ({
    id: r.id,
    gates: r.gates,
    kind: r.kind,
    tier: r.tier,
    outcome: r.outcome,
    reasons: r.reasons,
    checks: r.checks,
    maxUsdMicros: r.maxUsdMicros,
    chargedUsdMicros: r.evidence.reduce(
      (a, e) => a + (e.kind === 'message' && e.costUsdMicros !== null ? e.costUsdMicros : 0n),
      0n,
    ),
    attempts: r.attemptIds.length,
    calls: callRows(r),
  }));
  const gates = gateSummary(run.results);
  const passed =
    run.stopped === null && run.results.every((r) => r.outcome === 'pass') && (rec?.ok ?? false);
  const doc = {
    format: 'home-kev-live-report',
    version: 1,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    plan: {
      version: plan.canonical.version,
      hash: plan.hash,
      totalMaxUsdMicros: plan.totalMaxUsdMicros,
    },
    budgetUsdMicros: input.budgetMicros,
    homeCapNzd: input.capNzd,
    stopped: run.stopped,
    passed,
    gates,
    probes,
    reconciliation: rec,
    note: 'Synthetic data only. No prompt, answer, tool content, header or key is recorded here. No gate is PASS until the owner records it in the contract’s register.',
  };
  const json = JSON.stringify(doc, big, 2);

  const md: string[] = [];
  md.push('# Kev live verification: session report', '');
  md.push(`- Plan v${String(plan.canonical.version)}, hash \`${plan.hash}\``);
  md.push(
    `- Budget US$${usd(input.budgetMicros)}; HOME's reservation cap NZ$${input.capNzd}; plan maximum US$${usd(plan.totalMaxUsdMicros)}`,
  );
  md.push(`- ${input.startedAt.toISOString()} to ${input.finishedAt.toISOString()}`);
  md.push(
    `- Stopped early: ${run.stopped ?? 'no'}; all probes passed and reconciled: ${passed ? 'yes' : 'no'}`,
  );
  md.push('', '## Gates (for the owner to record; nothing here marks a gate PASS)', '');
  md.push('| Gate | Result | Probes | Failed | Not run |', '|---|---|---|---|---|');
  for (const g of gates)
    md.push(
      `| ${g.gate} | ${g.result} | ${g.probes.join(', ')} | ${g.failed.join(', ') || '—'} | ${g.notRun.join(', ') || '—'} |`,
    );
  md.push('', '## Probes', '');
  md.push(
    '| Probe | Gates | Tier | Outcome | Reasons | Max US$ | Charged US$ |',
    '|---|---|---|---|---|---|---|',
  );
  for (const p of probes)
    md.push(
      `| ${p.id} | ${p.gates.join(' ')} | ${p.tier ?? '—'} | ${p.outcome} | ${p.reasons.join(', ') || '—'} | ${usd(p.maxUsdMicros)} | ${usd(p.chargedUsdMicros)} |`,
    );
  md.push('', '## Calls', '');
  md.push(
    '| Probe | Kind | Model | Status | request-id | Counted | Stop | In | Out | Cache read | Cache write | Geo | HOME µ$ |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const p of probes)
    for (const c of p.calls) {
      const x = c as Record<string, unknown>;
      const v = (k: string) => (x[k] === undefined || x[k] === null ? '—' : String(x[k]));
      md.push(
        `| ${p.id} | ${c.kind} | ${c.model} | ${v('status')} | ${v('requestId')} | ${v('counted')} | ${v('stop')} | ${v('inputTokens')} | ${v('outputTokens')} | ${v('cacheReadTokens')} | ${v('cacheWriteTokens')} | ${v('inferenceGeo')} | ${v('costUsdMicros')} |`,
      );
    }
  md.push('', '## Provider errors', '');
  const refused = probes.flatMap((p) =>
    p.calls.flatMap((c) =>
      c.error ? [{ id: p.id, kind: c.kind, model: c.model, e: c.error }] : [],
    ),
  );
  if (refused.length === 0) md.push('None.');
  else {
    md.push(
      'Structural fields and recognised detail only (src/kev/providers/diagnostics.ts): the provider’s message is never kept.',
      '',
      '| Probe | Kind | Model | Diagnostic |',
      '|---|---|---|---|',
    );
    for (const r of refused)
      md.push(`| ${r.id} | ${r.kind} | ${r.model} | ${diagnosticLine(r.e, r.e.message)} |`);
  }
  md.push('', '## Reconciliation (§9)', '');
  if (!rec) md.push('Not run.');
  else {
    md.push(
      `- Open reservations: ${rec.openCount}; unreconciled: ${rec.unreconciledCount}; late-settled: ${rec.lateSettledCount}`,
    );
    md.push(`- Attempts: ${rec.attempts}; settled ≠ Σ usage: ${rec.mismatched}`);
    md.push(
      `- Usage rows: ${rec.usageRows}; conservative charges: ${rec.conservativeRows}; Haiku rows (at Haiku's prices): ${rec.probeModelRows}`,
    );
    md.push(
      `- Reserved (maximum exposure): US$${usd(rec.reservedUsdMicros)}`,
      `- Recorded by HOME (each model's prices; conservative where usage was unknown or partial): US$${usd(rec.recordedUsdMicros)}`,
      `- At list prices (reported tokens at each model's prices; the provider's bill should match): US$${usd(rec.atListPricesUsdMicros)}`,
    );
    md.push(
      '',
      '| UTC day | Model | Calls | In | Out | Cache read | Cache write | HOME US$ |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const g of rec.byModelDay)
      md.push(
        `| ${g.day} | ${g.model} | ${g.calls} | ${g.inputTokens} | ${g.outputTokens} | ${g.cacheReadTokens} | ${g.cacheWriteTokens} | ${usd(g.recordedUsdMicros)} |`,
      );
    md.push(
      '',
      "Compare with the evaluation workspace's Usage and Cost in the Console: HOME's figure must be at least the provider's.",
    );
  }
  md.push(
    '',
    '_Synthetic data only. No prompt, answer, tool content, header or key is recorded here._',
    '',
  );
  return Object.freeze({ json, markdown: md.join('\n'), passed });
}
