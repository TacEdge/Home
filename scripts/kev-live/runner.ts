import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb } from '@/db/create';
import { getSpendReport } from '@/domain/kev-bookkeeping/service';
import { createProbeGateway, type ProbeGateway } from '@/kev/providers/anthropic';
import { systemActor } from '@/trust/actor';
import { assertFixtureDatabase, fixtureAdult } from './db-checks';
import {
  assertBudgetCovers,
  assertBudgetWithinPlanCap,
  assertCapCovers,
  assertEnvironment,
  assertLedgerCovers,
  assertPlanHash,
  assertRunnerDatabase,
  capNzdFor,
  capUsdMicros,
  EVALUATION_RUN_CEILING_USD_MICROS,
  EXIT,
  LiveRefusal,
  parseBudgetUsd,
  parseLedger,
  readKey,
  SESSION_CEILING_USD_MICROS,
  usd,
  type Mode,
} from './guards.mts';
import { buildPlan, type Plan } from './plan';
import { applyState, buildEvalWorld } from '../../tests/integration/kev-eval-world';
import { WELLINGTON } from '../../tests/fixtures/weather';
import { paceTurn } from './eval';
import { executePlan, type RunContext } from './probes';
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
//               from KEV_EVAL_PROVIDER_KEY, the probes through the probe
//               gateway, the reconciliation and the report.
// Every refusal happens before any network call, with its own exit code.

export type RunnerOutcome = Readonly<{ exitCode: number; code: string }>;

/**
 * An evaluation run starts no new scenario after 35 minutes, so it stops
 * cleanly, its report written, inside the job's 45-minute limit (the
 * workflow's `timeout-minutes`); a scenario already started finishes.
 */
export const EVALUATION_WALL_CLOCK_MS = 35 * 60_000;

/**
 * The evaluation world's configuration for this process only: fresh random
 * keys for the synthetic calendar connections and the forecast's location
 * fingerprint, and a public synthetic point (Wellington's centre, the test
 * suites' own) for the forecast. Never a deployment's keys or home location,
 * never logged, gone when the job ends.
 */
export function setEvaluationEnvironment(target: Record<string, string | undefined>): void {
  const key = () => randomBytes(32).toString('base64');
  delete target.HOME_CREDENTIALS_KEY_PREVIOUS;
  target.HOME_CREDENTIALS_KEY = key();
  target.HOME_FINGERPRINT_KEY = key();
  target.HOME_WEATHER_LOCATION_KEY = key();
  target.HOME_LAT = WELLINGTON.lat;
  target.HOME_LON = WELLINGTON.lon;
}

export type RunnerOptions = {
  /** The campaign ledger's text (docs/m8/M8-LIVE-LEDGER.json). */
  ledgerText: string | null;
  /** Where the report is written (the job's artifact directory). */
  reportDir: string;
  log: (line: string) => void;
  /** Tests only: a gateway over a local stub in place of the provider's. */
  gatewayFor?: (key: string) => ProbeGateway;
  /**
   * Tests only: a plan in place of the session plan (an evaluation plan for
   * E12's preflight). Every guard still applies to it, the approved hash included.
   */
  plan?: Plan;
};

/** The plan as a table: ids, gates, tiers, calls and maxima. Never a prompt. */
export function planLines(plan: Plan): string[] {
  const lines = [
    `Kev live ${plan.kind} plan v${String(plan.canonical.version)}: ${plan.name} (session cap US$${usd(plan.sessionCapUsdMicros)}; ceiling US$${usd(plan.ceilingUsdMicros)})`,
    '',
    'probe                  gates                tier  max US$ (with retry)  max US$ (no retry)',
  ];
  for (const p of plan.probes)
    lines.push(
      `${p.id.padEnd(22)} ${p.gates.join(' ').padEnd(20)} ${('tier' in p ? p.tier : '—').padEnd(5)} ${usd(p.maxUsdMicros).padStart(20)}  ${usd(p.maxNoRetryUsdMicros).padStart(18)}`,
    );
  const matrix = plan.probes.filter((p) => 'shape' in p && p.shape);
  if (matrix.length > 0) {
    lines.push(
      '',
      'diagnostic matrix (Sonnet 5.5 unless named; tool_choice auto; each probe one call):',
    );
    for (const p of matrix) {
      if (!('shape' in p)) continue;
      const when = p.runIf
        ? [
            ...(p.runIf.passed ?? []).map((id) => `${id} passed`),
            ...(p.runIf.failed ?? []).map((id) => `${id} failed`),
          ].join(' and ')
        : 'always';
      const stops = [
        p.stopOnPass ? 'on pass' : null,
        p.stopOnFail ? 'on fail' : null,
        p.stopWhenNamed ? 'when the provider names a path' : null,
      ].filter(Boolean);
      lines.push(
        `  ${p.id}: ${p.shape}`,
        `    runs if: ${when}; stops: ${stops.length ? stops.join(', ') : 'never'}`,
      );
    }
  }
  lines.push(
    '',
    `total maximum: US$${usd(plan.totalMaxUsdMicros)} (no retries: US$${usd(plan.totalNoRetryUsdMicros)})`,
    ...(plan.listedMaxUsdMicros !== plan.totalMaxUsdMicros
      ? [
          `  exactly ${plan.totalMaxUsdMicros} µ$ on the costliest sequence the rules allow; every listed probe would be US$${usd(plan.listedMaxUsdMicros)}, which no sequence runs`,
        ]
      : []),
    `peak reservation hold: US$${usd(plan.peakHoldUsdMicros)} (HOME's whole-NZ$ cap must hold it)`,
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
    const plan = opts.plan ?? buildPlan();
    for (const l of planLines(plan)) opts.log(l);
    if (mode === 'dry-run') {
      opts.log('');
      opts.log('Dry run: nothing was sent. Approve the hash above to run this plan.');
      return { exitCode: EXIT.ok, code: 'dry_run' };
    }
    // The plan kind's ceiling (§12.4 rule 2): US$175 for an evaluation run,
    // the US$10 session ceiling for verification.
    const budget = parseBudgetUsd(
      env.KEV_LIVE_BUDGET_USD,
      plan.kind === 'evaluation' ? EVALUATION_RUN_CEILING_USD_MICROS : SESSION_CEILING_USD_MICROS,
    );
    assertBudgetWithinPlanCap(budget, plan.sessionCapUsdMicros);
    assertBudgetCovers(budget, plan.totalMaxUsdMicros);
    // HOME's whole-NZ$ reservation cap for this budget must hold the plan's
    // peak hold, checked here without a database (ADR 0012 §53).
    assertCapCovers(capUsdMicros(capNzdFor(budget)), 0n, plan.peakHoldUsdMicros);
    assertPlanHash(env.KEV_LIVE_APPROVED_PLAN_HASH, plan.hash);
    if (opts.ledgerText === null)
      throw new LiveRefusal('ledger', 'The campaign ledger is missing.');
    const ledger = parseLedger(opts.ledgerText);
    assertLedgerCovers(ledger, budget);
    opts.log(
      `budget US$${usd(budget)} holds the plan; the hash matches; the campaign ledger holds the budget`,
    );
    if (mode === 'check-plan') return { exitCode: EXIT.ok, code: 'plan_checked' };
    // Live: the runner's own database, then the cap, then the key. An
    // evaluation also needs the owner's connection to the same throwaway
    // database, to build its world (Package 5B).
    assertRunnerDatabase(env.DATABASE_URL);
    if (plan.kind === 'evaluation') assertRunnerDatabase(env.ADMIN_DATABASE_URL);
    const { db, close } = createDb(env.DATABASE_URL as string);
    const admin = plan.kind === 'evaluation' ? createDb(env.ADMIN_DATABASE_URL as string) : null;
    try {
      const fixtures = await assertFixtureDatabase(db);
      opts.log(
        `runner database: fixture family only (${fixtures.people} people, ${fixtures.users} accounts, no calendar connection)`,
      );
      // An evaluation's world (Package 5B): the evaluation fixture, both
      // adults' private records and the injected records, built in this
      // throwaway database with this process's own synthetic keys and
      // synthetic weather point (never a deployment's), after the check above.
      let evaluation: RunContext['evaluation'];
      if (admin) {
        setEvaluationEnvironment(process.env);
        const world = await buildEvalWorld(db, admin.db);
        evaluation = {
          adults: world.f.kev,
          ids: world.ids,
          markers: world.markersFor,
          db,
          reader: admin.db,
          beforeTurn: (actor) => paceTurn(admin.db, actor.userId).then(() => undefined),
          prepare: (s) => applyState(s.state, admin.db),
        };
        opts.log(
          'evaluation world built: the fixture family, both adults’ private records, the injected records',
        );
      }
      // HOME's own reservation cap for this run: the budget in whole NZ$,
      // read by the bookkeeping path on every reservation (never the household's).
      const capNzd = capNzdFor(budget);
      process.env.HOME_KEV_MONTHLY_CAP_NZD = String(capNzd);
      env.HOME_KEV_MONTHLY_CAP_NZD = String(capNzd);
      const spend = await getSpendReport(systemActor, { db });
      if (spend.capUsdMicros !== capUsdMicros(capNzd))
        throw new LiveRefusal('cap', 'HOME’s bookkeeping does not see the run’s cap.');
      assertCapCovers(spend.capUsdMicros, spend.count.countedUsdMicros, plan.peakHoldUsdMicros);
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
        ...(evaluation
          ? { evaluation, stopStartingAt: startedAt.getTime() + EVALUATION_WALL_CLOCK_MS }
          : {}),
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
        identity: { workflowRun: env.GITHUB_RUN_ID ?? null, commit: env.GITHUB_SHA ?? null },
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
      await admin?.close();
    }
  } catch (e) {
    if (e instanceof LiveRefusal) {
      opts.log(e.message);
      return { exitCode: e.exitCode, code: e.code };
    }
    throw e;
  }
}
