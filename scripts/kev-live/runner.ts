import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb } from '@/db/create';
import { getSpendReport } from '@/domain/kev-bookkeeping/service';
import { createProbeGateway, type ProbeGateway } from '@/kev/providers/anthropic';
import { systemActor } from '@/trust/actor';
import { assertFixtureDatabase, fixtureAdult } from './db-checks';
import {
  assertBudgetCovers,
  assertCapCovers,
  assertEnvironment,
  assertLedgerCovers,
  assertPlanHash,
  assertRunnerDatabase,
  capNzdFor,
  capUsdMicros,
  EXIT,
  LiveRefusal,
  parseBudgetUsd,
  parseLedger,
  readKey,
  usd,
  type Mode,
} from './guards.mts';
import { buildPlan, type Plan } from './plan';
import { executePlan } from './probes';
import { reconcile } from './reconcile';
import { buildReport } from './report';

// The live verification runner (M8 live-verification plan §5, §7, §9;
// owner decisions 2–4 and 6, 2026-10-16). Three modes:
//   dry-run     (the default) prints the plan, each probe's maximum, the
//               total and the plan hash. No key, no database, no network.
//   check-plan  the workflow's keyless first job: the plan hash must be
//               the approved one, the budget must hold the plan and stay
//               within US$10, and the campaign ledger must hold the budget.
//   live        all of that, then the runner's own database (fixture family
//               only), HOME's reservation cap set to the budget, the key
//               from KEV_LIVE_PROVIDER_KEY, the probes through the probe
//               gateway, the reconciliation and the report.
// Every refusal happens before any network call, with its own exit code.

export type RunnerOutcome = Readonly<{ exitCode: number; code: string }>;

export type RunnerOptions = {
  /** The campaign ledger's text (docs/m8/M8-LIVE-LEDGER.json). */
  ledgerText: string | null;
  /** Where the report is written (the job's artifact directory). */
  reportDir: string;
  log: (line: string) => void;
  /** Tests only: a gateway over a local stub in place of the provider's. */
  gatewayFor?: (key: string) => ProbeGateway;
};

/** The plan as a table: ids, gates, tiers, calls and maxima. Never a prompt. */
export function planLines(plan: Plan): string[] {
  const lines = [
    `Kev live verification plan v${String(plan.canonical.version)}`,
    '',
    'probe                  gates                tier  max US$ (with retry)  max US$ (no retry)',
  ];
  for (const p of plan.probes)
    lines.push(
      `${p.id.padEnd(22)} ${p.gates.join(' ').padEnd(20)} ${('tier' in p ? p.tier : '—').padEnd(5)} ${usd(p.maxUsdMicros).padStart(20)}  ${usd(p.maxNoRetryUsdMicros).padStart(18)}`,
    );
  lines.push(
    '',
    `total maximum: US$${usd(plan.totalMaxUsdMicros)} (no retries: US$${usd(plan.totalNoRetryUsdMicros)})`,
    `plan hash: ${plan.hash}`,
  );
  return lines;
}

export async function runMode(
  mode: Mode,
  env: Record<string, string | undefined>,
  opts: RunnerOptions,
): Promise<RunnerOutcome> {
  try {
    assertEnvironment(mode, env);
    const plan = buildPlan();
    for (const l of planLines(plan)) opts.log(l);
    if (mode === 'dry-run') {
      opts.log('');
      opts.log('Dry run: nothing was sent. Approve the hash above to run this plan.');
      return { exitCode: EXIT.ok, code: 'dry_run' };
    }
    const budget = parseBudgetUsd(env.KEV_LIVE_BUDGET_USD);
    assertBudgetCovers(budget, plan.totalMaxUsdMicros);
    assertPlanHash(env.KEV_LIVE_APPROVED_PLAN_HASH, plan.hash);
    if (opts.ledgerText === null)
      throw new LiveRefusal('ledger', 'The campaign ledger is missing.');
    const ledger = parseLedger(opts.ledgerText);
    assertLedgerCovers(ledger, budget);
    opts.log(
      `budget US$${usd(budget)} holds the plan; the hash matches; the campaign ledger holds the budget`,
    );
    if (mode === 'check-plan') return { exitCode: EXIT.ok, code: 'plan_checked' };

    // Live: the runner's own database, then the cap, then the key.
    assertRunnerDatabase(env.DATABASE_URL);
    const { db, close } = createDb(env.DATABASE_URL as string);
    try {
      const fixtures = await assertFixtureDatabase(db);
      opts.log(
        `runner database: fixture family only (${fixtures.people} people, ${fixtures.users} accounts, no calendar connection)`,
      );
      // HOME's own reservation cap for this run: the budget in whole NZ$,
      // read by the bookkeeping path on every reservation (never the household's).
      const capNzd = capNzdFor(budget);
      process.env.HOME_KEV_MONTHLY_CAP_NZD = String(capNzd);
      env.HOME_KEV_MONTHLY_CAP_NZD = String(capNzd);
      const spend = await getSpendReport(systemActor, { db });
      if (spend.capUsdMicros !== capUsdMicros(capNzd))
        throw new LiveRefusal('cap', 'HOME’s bookkeeping does not see the run’s cap.');
      assertCapCovers(spend.capUsdMicros, spend.count.countedUsdMicros, plan.totalMaxUsdMicros);
      opts.log(`HOME reservation cap NZ$${capNzd} (US$${usd(spend.capUsdMicros)})`);
      const key = readKey(env);
      const gateway = opts.gatewayFor ? opts.gatewayFor(key) : createProbeGateway({ apiKey: key });
      const actor = await fixtureAdult(db);
      const startedAt = new Date();
      const run = await executePlan(plan, {
        gateway,
        actor,
        deps: { db },
        budgetMicros: budget,
        log: opts.log,
      });
      const reconciliation = await reconcile(
        db,
        run.results.flatMap((r) => r.attemptIds),
      );
      const report = buildReport({
        plan,
        budgetMicros: budget,
        capNzd,
        run,
        reconciliation,
        startedAt,
        finishedAt: new Date(),
      });
      mkdirSync(opts.reportDir, { recursive: true });
      writeFileSync(join(opts.reportDir, 'report.json'), report.json);
      writeFileSync(join(opts.reportDir, 'report.md'), report.markdown);
      opts.log(`report written; HOME recorded US$${usd(reconciliation.recordedUsdMicros)}`);
      return report.passed
        ? { exitCode: EXIT.ok, code: 'passed' }
        : { exitCode: EXIT.failed, code: run.stopped ? `stopped_${run.stopped}` : 'probes_failed' };
    } finally {
      await close();
    }
  } catch (e) {
    if (e instanceof LiveRefusal) {
      opts.log(e.message);
      return { exitCode: e.exitCode, code: e.code };
    }
    throw e;
  }
}
