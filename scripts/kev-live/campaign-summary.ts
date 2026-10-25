import { summarise, summaryMarkdown, type EvalRecord, type EvalSummary } from '@/kev/evals/summary';
import { CAMPAIGN_USD_MICROS, type Ledger, type LedgerSession, usdExact } from './guards.mts';
import { buildPlan, CAMPAIGN_NAME, CAMPAIGN_PLANS, type Plan } from './plan';

// The final acceptance campaign's summary (ADR 0012 §76;
// docs/m8/M8-FINAL-CAMPAIGN.md): every batch's downloaded report, read
// together, as one auditable result. Nothing is re-judged or rescored: the
// records are each run's own judge records, combined per tier through the
// same summary every report uses (summary.ts `summarise`), so §12.3's
// targets, scoring across repeats and safety gates are read over the whole
// campaign's samples. It refuses what would make the result untrustworthy
// (a report that is not a batch of this campaign as the code now computes
// it, a batch counted twice, a record outside its batch or counted twice)
// and reports, never hides, what is missing: a batch not run, a run that
// stopped, a probe with no record. It also checks each run's money: its
// approved budget and plan maximum, HOME's recorded cost, HOME's own
// reconciliation, its ledger row (present and equal, or proposed), and
// that no dispatch's declared unrecorded spend left the runner believing
// in more remainder than there was. Codes, counts and amounts only: the
// records hold no question or answer, and nothing here holds any.

/** A downloaded report: where it came from (for messages) and its parsed JSON. */
export type CampaignReportInput = Readonly<{ label: string; json: unknown }>;

export type CampaignRun = Readonly<{
  label: string;
  batch: number;
  plan: string;
  planHash: string;
  workflowRun: string | null;
  commit: string | null;
  startedAt: string;
  /** The plan's computed maximum and the budget the owner approved (µ$). */
  plannedMaxUsdMicros: bigint;
  approvedBudgetUsdMicros: bigint;
  /** HOME's recorded cost for the run (µ$); null when the run wrote no reconciliation. */
  recordedUsdMicros: bigint | null;
  atListPricesUsdMicros: bigint | null;
  /** HOME's own reconciliation: no open reservation, each attempt settled at its usage. */
  reconciled: boolean;
  stopped: string | null;
  /** What the dispatch declared, and the ledger's remainder when it ran (µ$). */
  declaredUnrecordedUsdMicros: bigint | null;
  ledgerRemainderUsdMicros: bigint | null;
  /** The runner's belief (ledger remainder less the declaration) never above the truth. */
  declaration: 'held' | 'understated' | 'unknown';
  /** The ledger row for its plan hash: equal to the report, different, or not yet there. */
  ledger: 'recorded' | 'differs' | 'not_recorded';
  probesExpected: number;
  probesRecorded: number;
  turnsExpected: number;
}>;

export type CampaignSummary = Readonly<{
  campaign: string;
  batches: number;
  runs: readonly CampaignRun[];
  notRun: readonly Readonly<{ batch: number; plan: string; planHash: string }>[];
  /** Expected probes (`scenario@tier#repeat`) with no record, run batches and missing batches alike. */
  missing: readonly string[];
  /** Of those, the ones in batches that ran (a stopped run, a lost record). */
  missingInRuns: readonly string[];
  /** Every batch run once, none stopped, every probe recorded, every run reconciled. */
  complete: boolean;
  commits: readonly string[];
  /** The campaign's remainder before its first batch (the ledger's, other sessions only). */
  startRemainderUsdMicros: bigint;
  recordedUsdMicros: bigint;
  /** Every run's ledger row present and equal, and every declaration held. */
  moneyHeld: boolean;
  records: readonly (EvalRecord & { batch: number })[];
  summary: EvalSummary;
  /** Ledger rows for the runs the ledger does not hold yet, for the consolidated evidence PR. */
  proposedLedgerRows: readonly LedgerSession[];
}>;

const fail = (why: string) => new Error(`campaign: ${why}`);
const probeId = (r: Pick<EvalRecord, 'scenario' | 'tier' | 'repeat'>) =>
  `${r.scenario}@${r.tier}#${r.repeat}`;
const micros = (v: unknown, what: string): bigint => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v)) throw fail(`${what} is not an amount`);
  return BigInt(v);
};
const maybeMicros = (v: unknown, what: string) =>
  v === null || v === undefined ? null : micros(v, what);

type ReportShape = {
  format?: unknown;
  version?: unknown;
  startedAt?: unknown;
  run?: { workflowRun?: unknown; commit?: unknown };
  plan?: { name?: unknown; hash?: unknown; totalMaxUsdMicros?: unknown };
  campaign?: {
    name?: unknown;
    batch?: unknown;
    declaredUnrecordedUsdMicros?: unknown;
    ledgerRemainderUsdMicros?: unknown;
  };
  budgetUsdMicros?: unknown;
  stopped?: unknown;
  evaluation?: { summary?: { mode?: unknown }; records?: unknown };
  reconciliation?: { ok?: unknown; recordedUsdMicros?: unknown; atListPricesUsdMicros?: unknown };
};

/** The campaign's batch plans as this code computes them. */
export function campaignPlans(): readonly Plan[] {
  return CAMPAIGN_PLANS.map((n) => buildPlan(n));
}

/** The campaign's remainder before its first batch: US$200 less every other session's recorded cost. */
export function startRemainder(ledger: Ledger, plans: readonly Plan[]): bigint {
  const batch = new Set(plans.map((p) => p.hash));
  return (
    CAMPAIGN_USD_MICROS -
    ledger.sessions
      .filter((s) => !batch.has(s.planHash))
      .reduce((a, s) => a + BigInt(s.recordedUsdMicros), 0n)
  );
}

/** Every batch's report read together: refused where untrustworthy, incomplete where it is. */
export function summariseCampaign(
  inputs: readonly CampaignReportInput[],
  ledger: Ledger,
  plans: readonly Plan[] = campaignPlans(),
): CampaignSummary {
  const byHash = new Map(plans.map((p) => [p.hash, p]));
  const seenBatches = new Set<string>();
  const seenProbes = new Set<string>();
  const records: (EvalRecord & { batch: number })[] = [];
  const parsed = inputs.map(({ label, json }) => {
    const r = json as ReportShape;
    if (
      r === null ||
      typeof r !== 'object' ||
      r.format !== 'home-kev-live-report' ||
      r.version !== 1
    )
      throw fail(`${label} is not a live report`);
    const plan = typeof r.plan?.hash === 'string' ? byHash.get(r.plan.hash) : undefined;
    if (!plan || !plan.campaign)
      throw fail(
        `${label} is not a batch of this campaign as the code computes it (its plan hash names none)`,
      );
    if (r.plan?.name !== plan.name || r.campaign?.batch !== plan.campaign.batch)
      throw fail(`${label}'s plan name or batch does not match its hash`);
    if (seenBatches.has(plan.hash))
      throw fail(`${label}: batch ${plan.campaign.batch} appears twice; a batch counts once`);
    seenBatches.add(plan.hash);
    if (r.evaluation?.summary?.mode !== 'live' || !Array.isArray(r.evaluation.records))
      throw fail(`${label} is not a live evaluation`);
    const expected = new Set(plan.probes.map((p) => p.id));
    for (const rec of r.evaluation.records as EvalRecord[]) {
      const id = probeId(rec);
      if (!expected.has(id)) throw fail(`${label} holds ${id}, which is not in its batch`);
      if (seenProbes.has(id)) throw fail(`${id} is recorded twice; a run counts once`);
      seenProbes.add(id);
      records.push(Object.freeze({ ...rec, batch: plan.campaign.batch }));
    }
    const rec = r.reconciliation ?? null;
    return {
      label,
      plan,
      startedAt: typeof r.startedAt === 'string' ? r.startedAt : '',
      workflowRun: typeof r.run?.workflowRun === 'string' ? r.run.workflowRun : null,
      commit: typeof r.run?.commit === 'string' ? r.run.commit : null,
      approved: micros(r.budgetUsdMicros, `${label}'s budget`),
      recorded: rec ? micros(rec.recordedUsdMicros, `${label}'s recorded cost`) : null,
      atList: rec ? maybeMicros(rec.atListPricesUsdMicros, `${label}'s list-price cost`) : null,
      reconciled: rec?.ok === true,
      stopped: typeof r.stopped === 'string' ? r.stopped : null,
      declared: maybeMicros(r.campaign?.declaredUnrecordedUsdMicros, `${label}'s declaration`),
      ledgerLeft: maybeMicros(r.campaign?.ledgerRemainderUsdMicros, `${label}'s ledger remainder`),
      recordedProbes: (r.evaluation.records as EvalRecord[]).length,
    };
  });

  // In the order they ran: what the campaign had truly spent before each.
  const start = startRemainder(ledger, plans);
  const ordered = [...parsed].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  let spentBefore: bigint | null = 0n;
  const runs: CampaignRun[] = ordered.map((p) => {
    const believed =
      p.declared !== null && p.ledgerLeft !== null ? p.ledgerLeft - p.declared : null;
    const declaration =
      believed === null || spentBefore === null
        ? 'unknown'
        : believed <= start - spentBefore
          ? 'held'
          : 'understated';
    spentBefore = spentBefore === null || p.recorded === null ? null : spentBefore + p.recorded;
    const row = ledger.sessions.find((s) => s.planHash === p.plan.hash);
    return Object.freeze({
      label: p.label,
      batch: p.plan.campaign!.batch,
      plan: p.plan.name,
      planHash: p.plan.hash,
      workflowRun: p.workflowRun,
      commit: p.commit,
      startedAt: p.startedAt,
      plannedMaxUsdMicros: p.plan.totalMaxUsdMicros,
      approvedBudgetUsdMicros: p.approved,
      recordedUsdMicros: p.recorded,
      atListPricesUsdMicros: p.atList,
      reconciled: p.reconciled,
      stopped: p.stopped,
      declaredUnrecordedUsdMicros: p.declared,
      ledgerRemainderUsdMicros: p.ledgerLeft,
      declaration,
      ledger: !row
        ? 'not_recorded'
        : p.recorded !== null && BigInt(row.recordedUsdMicros) === p.recorded
          ? 'recorded'
          : 'differs',
      probesExpected: p.plan.probes.length,
      probesRecorded: p.recordedProbes,
      turnsExpected: p.plan.probes.reduce((n, x) => n + (x.kind === 'scenario' ? x.turns : 0), 0),
    });
  });

  const notRun = plans
    .filter((p) => !seenBatches.has(p.hash))
    .map((p) => Object.freeze({ batch: p.campaign!.batch, plan: p.name, planHash: p.hash }));
  const ranProbes = new Set(
    plans.filter((p) => seenBatches.has(p.hash)).flatMap((p) => p.probes.map((x) => x.id)),
  );
  const missing = plans
    .flatMap((p) => p.probes.map((x) => x.id))
    .filter((id) => !seenProbes.has(id));
  const complete =
    notRun.length === 0 &&
    missing.length === 0 &&
    runs.every((r) => r.stopped === null && r.reconciled);
  const recorded = runs.reduce((a, r) => a + (r.recordedUsdMicros ?? 0n), 0n);
  const proposedLedgerRows = runs
    .filter((r) => r.ledger === 'not_recorded' && r.recordedUsdMicros !== null)
    .sort((a, b) => a.batch - b.batch)
    .map((r): LedgerSession =>
      Object.freeze({
        date: r.startedAt.slice(0, 10),
        workflowRun: `M8 final campaign, batch ${r.batch} of ${plans.length} (run ${r.workflowRun ?? 'unknown'}, commit ${(r.commit ?? 'unknown').slice(0, 7)})`,
        planHash: r.planHash,
        plannedMaxUsdMicros: r.plannedMaxUsdMicros.toString(),
        recordedUsdMicros: r.recordedUsdMicros!.toString(),
      }),
    );
  return Object.freeze({
    campaign: CAMPAIGN_NAME,
    batches: plans.length,
    runs: Object.freeze(runs),
    notRun: Object.freeze(notRun),
    missing: Object.freeze(missing),
    missingInRuns: Object.freeze(missing.filter((id) => ranProbes.has(id))),
    complete,
    commits: Object.freeze([...new Set(runs.map((r) => r.commit ?? 'unknown'))].sort()),
    startRemainderUsdMicros: start,
    recordedUsdMicros: recorded,
    moneyHeld: runs.every((r) => r.declaration === 'held' && r.ledger !== 'differs'),
    records: Object.freeze(records),
    // Campaign plans run the fast tier as configured (Sonnet 5.5): its cost target.
    summary: summarise(records, { mode: 'live', fastModel: 'sonnet' }),
    proposedLedgerRows: Object.freeze(proposedLedgerRows),
  });
}

/** The campaign summary as JSON (bigints as decimal strings). */
export function campaignJson(c: CampaignSummary): string {
  return JSON.stringify(c, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

/** The campaign summary for the owner: completeness and money first, then §12.3 over every run. */
export function campaignMarkdown(c: CampaignSummary): string {
  const $ = (m: bigint | null) => (m === null ? '—' : `US$${usdExact(m)}`);
  const out = [
    `# Kev final acceptance campaign: ${c.campaign}`,
    '',
    c.complete
      ? `**Complete:** all ${c.batches} batches ran once, none stopped, every probe has a record and every run reconciled in HOME.`
      : `**INCOMPLETE:** ${c.notRun.length} batch(es) not run, ${c.runs.filter((r) => r.stopped !== null).length} stopped, ${c.runs.filter((r) => !r.reconciled).length} not reconciled in HOME, ${c.missing.length} probe(s) with no record. §12.3's samples are not met; the rates below are over what ran.`,
    '',
    c.moneyHeld
      ? `**Money:** every declaration held and no ledger row differs from its report. Recorded by HOME: ${$(c.recordedUsdMicros)} of the campaign's ${$(c.startRemainderUsdMicros)}; left ${$(c.startRemainderUsdMicros - c.recordedUsdMicros)}. The provider's bill is reconciled by the owner, not here.`
      : `**Money: CHECK.** A declaration was understated, could not be checked, or a ledger row differs from its report (rows below). Recorded by HOME: ${$(c.recordedUsdMicros)} of ${$(c.startRemainderUsdMicros)}.`,
    '',
    c.commits.length === 1
      ? `Every run ran commit ${c.commits[0]}.`
      : `Runs ran ${c.commits.length} commits (${c.commits.join(', ')}): the plan hash binds the prompt, tools, answer schema, scenarios and models, not the rest of the code, so the owner confirms nothing Kev runs changed between them.`,
    '',
    '| Batch | Plan | Workflow run | Commit | Plan hash | Max | Approved | Recorded | HOME reconciled | Stopped | Declared unrecorded | Declaration | Ledger | Probes |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...[...c.runs]
      .sort((a, b) => a.batch - b.batch)
      .map(
        (r) =>
          `| ${r.batch} | ${r.plan} | ${r.workflowRun ?? '—'} | ${(r.commit ?? '—').slice(0, 7)} | \`${r.planHash.slice(0, 8)}…\` | ${$(r.plannedMaxUsdMicros)} | ${$(r.approvedBudgetUsdMicros)} | ${$(r.recordedUsdMicros)} | ${r.reconciled ? 'yes' : 'NO'} | ${r.stopped ?? 'no'} | ${$(r.declaredUnrecordedUsdMicros)} | ${r.declaration} | ${r.ledger} | ${r.probesRecorded}/${r.probesExpected} |`,
      ),
    ...c.notRun.map(
      (n) =>
        `| ${n.batch} | ${n.plan} | not run | — | \`${n.planHash.slice(0, 8)}…\` | — | — | — | — | — | — | — | — | 0 |`,
    ),
    '',
    c.missing.length === 0
      ? 'Probes with no record: none.'
      : `Probes with no record: ${c.missing.length}, of which ${c.missing.length - c.missingInRuns.length} in batches not run${c.missingInRuns.length === 0 ? '' : `, and in batches that ran: ${c.missingInRuns.join(', ')}`}. Every id is in the JSON.`,
    '',
    `Proposed ledger rows (the runs the ledger does not hold yet): ${c.proposedLedgerRows.length}, in the JSON.`,
    '',
    '## Every failed run',
    '',
    ...(() => {
      const failed = c.records.filter((r) => !r.pass);
      return failed.length === 0
        ? ['None.']
        : failed.map(
            (r) =>
              `- batch ${r.batch}: ${r.scenario} on ${r.tier} #${r.repeat} (${r.class}): ${r.failed.join(', ')}`,
          );
    })(),
    '',
    summaryMarkdown(c.summary)
      .trimEnd()
      .split('\n')
      .slice(2)
      .map((l) => (l.startsWith('## ') ? `#${l}` : l))
      .join('\n'),
    '',
  ];
  return out.join('\n');
}
