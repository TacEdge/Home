// The live verification runner's guards (M8 live-verification plan §5;
// owner decisions 2–4 and 6, 2026-10-16). Pure TypeScript with no imports,
// so the Node launchers (run.mts, g16-pooled.mts, isolation-check.mts) and
// the runner itself share them, and every refusal is unit-tested
// (tests/unit/kev-live-guards.test.ts). Each refusal names its reason and
// exits with its own code; none ever echoes a URL, host, password, key or
// value.

/**
 * The approved maximum for the first live session (owner decision 4,
 * 2026-10-16): US$10, in micro-US-dollars. The runner refuses a budget above
 * it, whatever the dispatch says. Raising it needs a new owner decision and a
 * change here, reviewed. It is separate from the household's NZ$100 cap and
 * comes out of the Package 5 campaign's US$200.
 */
export const SESSION_CEILING_USD_MICROS = 10_000_000n;

/** The Package 5 live-evaluation campaign (contract §12.4, O7): US$200, in µ$. */
export const CAMPAIGN_USD_MICROS = 200_000_000n;

/** The runner's own throwaway database (owner decision 3): its name, on the job's own Postgres. */
export const RUNNER_DATABASE = 'home_live_verify';
export const RUNNER_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

/**
 * The runner's key variable: an evaluation-only key, never Preview's or
 * Production's. Deliberately not HOME_KEV_PROVIDER_KEY, so a deployment's
 * key can never be picked up; the runner reads no other key variable.
 */
export const KEY_VARIABLE = 'KEV_EVAL_PROVIDER_KEY';
/** The same rule as src/lib/env.ts's PROVIDER_KEY_FORMAT (a test holds them equal). */
export const KEY_FORMAT = /^[\x21-\x7e]{16,512}$/;

/** NZ$ per US$ (contract §13.1), as src/domain/kev-bookkeeping/constants.ts has it (tested equal). */
export const NZD_PER_USD = { num: 9n, den: 5n } as const;

export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  deployed: 10,
  real_data: 11,
  database: 12,
  no_key: 13,
  budget: 14,
  plan_hash: 15,
  ledger: 16,
  cap: 17,
  fixtures: 18,
  production_host: 19,
  isolation: 20,
} as const;
export type RefusalCode = Exclude<keyof typeof EXIT, 'ok' | 'failed'>;

export class LiveRefusal extends Error {
  readonly code: RefusalCode;
  readonly exitCode: number;
  constructor(code: RefusalCode, detail: string) {
    super(`Refusing to run: ${code}. ${detail}`);
    this.name = 'LiveRefusal';
    this.code = code;
    this.exitCode = EXIT[code];
  }
}

type Env = Record<string, string | undefined>;
const set = (v: string | undefined) => v !== undefined && v !== '';

/** Refuses on any deployed process: Vercel, or NODE_ENV=production. */
export function assertNotDeployed(env: Env): void {
  if (set(env.VERCEL) || set(env.VERCEL_ENV) || env.NODE_ENV === 'production')
    throw new LiveRefusal(
      'deployed',
      'The runner never runs on a deployment (VERCEL, VERCEL_ENV or NODE_ENV=production is set).',
    );
}

/** Refuses whenever HOME_REAL_DATA is set at all, to any value. */
export function assertNoRealData(env: Env): void {
  if (env.HOME_REAL_DATA !== undefined)
    throw new LiveRefusal(
      'real_data',
      'HOME_REAL_DATA is set; the runner holds synthetic data only.',
    );
}

function parsePostgres(url: string | undefined, code: RefusalCode, what: string): URL {
  if (!url) throw new LiveRefusal(code, `${what} is not set.`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LiveRefusal(code, `${what} could not be parsed.`);
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol))
    throw new LiveRefusal(code, `${what} is not a postgres:// URL.`);
  // `?host=` (or `hostaddr=`) would make the driver connect elsewhere.
  if (
    [...parsed.searchParams.keys()].some((k) =>
      ['host', 'hostaddr'].includes(k.trim().toLowerCase()),
    )
  )
    throw new LiveRefusal(code, `${what} overrides its host with a query parameter.`);
  return parsed;
}

/**
 * The runner's database: the job's own Postgres (localhost or 127.0.0.1)
 * and the runner's own database name, nothing else. Never home-dev, never
 * Production, never the test database.
 */
export function assertRunnerDatabase(url: string | undefined): { database: string } {
  const parsed = parsePostgres(url, 'database', 'DATABASE_URL');
  if (!RUNNER_HOSTS.includes(parsed.hostname.toLowerCase()))
    throw new LiveRefusal('database', 'DATABASE_URL is not the job’s own local Postgres.');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (database !== RUNNER_DATABASE)
    throw new LiveRefusal(
      'database',
      `DATABASE_URL does not name the runner’s database (${RUNNER_DATABASE}).`,
    );
  return { database };
}

/**
 * The evaluation key, from KEV_EVAL_PROVIDER_KEY only, read at run time.
 * HOME_KEV_PROVIDER_KEY, ANTHROPIC_API_KEY and every other variable are
 * never read. Never echoed.
 */
export function readKey(env: Env): string {
  const key = env[KEY_VARIABLE];
  if (key === undefined || key.trim() === '')
    throw new LiveRefusal(
      'no_key',
      `${KEY_VARIABLE} is not set (a live run needs the evaluation key).`,
    );
  if (!KEY_FORMAT.test(key))
    throw new LiveRefusal('no_key', `${KEY_VARIABLE} is not a well-formed key.`);
  return key;
}

/** A key must never be present for a keyless mode (the dry run's preflight job holds none). */
export function assertNoKey(env: Env): void {
  if (env[KEY_VARIABLE] !== undefined)
    throw new LiveRefusal('no_key', `${KEY_VARIABLE} is set; the plan check runs without any key.`);
}

/**
 * The budget, in whole US dollars and cents ("10", "7.50"), as µ$: above
 * zero and at most the session ceiling (US$10, owner decision 4).
 */
export function parseBudgetUsd(raw: string | undefined): bigint {
  if (raw === undefined || !/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,2})?$/.test(raw))
    throw new LiveRefusal('budget', 'KEV_LIVE_BUDGET_USD must be US dollars, like 10 or 7.50.');
  const [whole, cents = ''] = raw.split('.');
  const micros = BigInt(whole!) * 1_000_000n + BigInt(cents.padEnd(2, '0')) * 10_000n;
  if (micros <= 0n) throw new LiveRefusal('budget', 'KEV_LIVE_BUDGET_USD must be above zero.');
  if (micros > SESSION_CEILING_USD_MICROS)
    throw new LiveRefusal(
      'budget',
      `KEV_LIVE_BUDGET_USD is above the approved first-session maximum of US$${usd(SESSION_CEILING_USD_MICROS)}.`,
    );
  return micros;
}

/**
 * The budget may not exceed the plan's own session cap (US$6 for live
 * verification #2, the owner's planning limit of 2026-10-17; never above
 * the US$10 ceiling, which parseBudgetUsd enforces).
 */
export function assertBudgetWithinPlanCap(budgetMicros: bigint, planCapMicros: bigint): void {
  if (budgetMicros > planCapMicros)
    throw new LiveRefusal(
      'budget',
      `KEV_LIVE_BUDGET_USD, US$${usd(budgetMicros)}, is above this plan's session cap of US$${usd(planCapMicros)}.`,
    );
}

/** The plan's computed maximum must fit the approved budget. */
export function assertBudgetCovers(budgetMicros: bigint, planMaxMicros: bigint): void {
  if (planMaxMicros > budgetMicros)
    throw new LiveRefusal(
      'budget',
      `The plan's maximum, US$${usd(planMaxMicros)}, is above the approved budget of US$${usd(budgetMicros)}.`,
    );
}

/** The approved plan hash must equal the plan this code computes, exactly. */
export function assertPlanHash(approved: string | undefined, computed: string): void {
  if (approved === undefined || !/^[0-9a-f]{64}$/.test(approved))
    throw new LiveRefusal(
      'plan_hash',
      'KEV_LIVE_APPROVED_PLAN_HASH must be the plan’s 64-character sha256.',
    );
  if (approved !== computed)
    throw new LiveRefusal(
      'plan_hash',
      'KEV_LIVE_APPROVED_PLAN_HASH is not this plan’s hash: the plan changed since it was approved, or the hash is wrong.',
    );
}

// ---------------------------------------------------------------------------
// The campaign ledger (docs/m8/M8-LIVE-LEDGER.json): committed, reviewed, one
// entry per live session, HOME's recorded cost (at least the provider's).

export type LedgerSession = {
  date: string;
  workflowRun: string;
  planHash: string;
  plannedMaxUsdMicros: string;
  recordedUsdMicros: string;
};
export type Ledger = {
  format: 'home-kev-live-ledger';
  version: 1;
  campaignUsdMicros: string;
  sessions: LedgerSession[];
};

const MICROS = /^(0|[1-9][0-9]{0,15})$/;

/** Parses the ledger strictly; anything unexpected refuses (fail closed). */
export function parseLedger(text: string): Ledger {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LiveRefusal('ledger', 'The campaign ledger is not readable JSON.');
  }
  const bad = (why: string) => new LiveRefusal('ledger', `The campaign ledger ${why}.`);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad('is not an object');
  const l = raw as Record<string, unknown>;
  if (l.format !== 'home-kev-live-ledger' || l.version !== 1) throw bad('has an unknown format');
  if (typeof l.campaignUsdMicros !== 'string' || !MICROS.test(l.campaignUsdMicros))
    throw bad('has no campaign amount');
  if (BigInt(l.campaignUsdMicros) !== CAMPAIGN_USD_MICROS)
    throw bad('names a campaign other than the approved US$200');
  if (!Array.isArray(l.sessions)) throw bad('has no sessions list');
  for (const s of l.sessions as unknown[]) {
    const e = s as Record<string, unknown>;
    if (
      typeof e !== 'object' ||
      e === null ||
      typeof e.date !== 'string' ||
      typeof e.workflowRun !== 'string' ||
      typeof e.planHash !== 'string' ||
      typeof e.plannedMaxUsdMicros !== 'string' ||
      !MICROS.test(e.plannedMaxUsdMicros) ||
      typeof e.recordedUsdMicros !== 'string' ||
      !MICROS.test(e.recordedUsdMicros)
    )
      throw bad('has a malformed session');
  }
  return raw as Ledger;
}

/** What the campaign has left: US$200 less every session's recorded cost. */
export function ledgerRemainder(ledger: Ledger): bigint {
  const spent = ledger.sessions.reduce((a, s) => a + BigInt(s.recordedUsdMicros), 0n);
  return BigInt(ledger.campaignUsdMicros) - spent;
}

export function assertLedgerCovers(ledger: Ledger, budgetMicros: bigint): void {
  const left = ledgerRemainder(ledger);
  if (budgetMicros > left)
    throw new LiveRefusal(
      'ledger',
      `The budget, US$${usd(budgetMicros)}, is above the campaign's recorded remainder of US$${usd(left < 0n ? 0n : left)}.`,
    );
}

// ---------------------------------------------------------------------------
// HOME's own reservation cap for the run (contract §13.6): the budget as whole
// NZ dollars (rounded down), so reserveAttempt hard-caps the run in its own
// ledger, never the household's.

/** The budget in whole NZ dollars at the fixed rate, rounded down (never above the budget). */
export function capNzdFor(budgetMicros: bigint): number {
  return Number((budgetMicros * NZD_PER_USD.num) / (NZD_PER_USD.den * 1_000_000n));
}

/** Whole NZ dollars as µ$, to the nearest micro-dollar, as src/trust/usage.ts does (tested equal). */
export function capUsdMicros(nzd: number): bigint {
  const numerator = BigInt(nzd) * 1_000_000n * NZD_PER_USD.den;
  return (2n * numerator + NZD_PER_USD.num) / (2n * NZD_PER_USD.num);
}

/** The run's cap, less what the runner's database already counts, must hold the plan's peak hold (or maximum). */
export function assertCapCovers(
  capMicros: bigint,
  countedMicros: bigint,
  planMaxMicros: bigint,
): void {
  if (countedMicros + planMaxMicros > capMicros)
    throw new LiveRefusal(
      'cap',
      `HOME's reservation cap for the run (US$${usd(capMicros)}) less what its database already counts (US$${usd(countedMicros)}) cannot hold the plan's peak (US$${usd(planMaxMicros)}).`,
    );
}

// ---------------------------------------------------------------------------
// The other database targets: G16 and the isolation check run against
// home-dev (owner decisions 5 and 6), never against Production.

/** The host part of a postgres URL, lower case (never printed with a password). */
export function hostOf(url: string | undefined, what: string): string {
  return parsePostgres(url, 'database', what).hostname.toLowerCase();
}

/**
 * The owner-supplied Production host must be given, and the target's host
 * must differ from it. Compares hosts exactly, and also refuses a target
 * that shares Production's Neon endpoint id (the pooled and direct hosts
 * differ only by `-pooler`).
 */
export function assertNotProduction(
  targetUrl: string | undefined,
  productionHost: string | undefined,
  what: string,
): string {
  if (!productionHost || productionHost.trim() === '')
    throw new LiveRefusal(
      'production_host',
      'PRODUCTION_DB_HOST (Production’s database host) is required, to refuse it.',
    );
  const target = hostOf(targetUrl, what);
  const prod = productionHost.trim().toLowerCase();
  const endpoint = (h: string) => h.split('.')[0]!.replace(/-pooler$/, '');
  if (target === prod || endpoint(target) === endpoint(prod))
    throw new LiveRefusal('production_host', `${what} points at Production’s database.`);
  return target;
}

/** G16 runs only against a hosted (pooled) database, never a local one. */
export function assertNotLocal(targetUrl: string | undefined, what: string): void {
  const host = hostOf(targetUrl, what);
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host))
    throw new LiveRefusal(
      'database',
      `${what} is a local database; G16 is for home-dev’s pooled connection.`,
    );
}

/** US$ with two decimals, from µ$, for messages and the report. */
export function usd(micros: bigint): string {
  const cents = (micros + 5_000n) / 10_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export type Mode = 'dry-run' | 'check-plan' | 'live';

/** `--live` runs live; `--check-plan` is the keyless plan check; anything else is a dry run. */
export function parseMode(argv: readonly string[]): Mode {
  const flags = argv.filter((a) => a.startsWith('--'));
  for (const f of flags)
    if (!['--live', '--check-plan', '--dry-run'].includes(f))
      throw new LiveRefusal('usage', `Unknown option ${JSON.stringify(f).slice(0, 40)}.`);
  if (flags.includes('--live') && flags.includes('--check-plan'))
    throw new LiveRefusal('usage', 'Choose one of --live and --check-plan.');
  if (flags.includes('--live') && flags.includes('--dry-run'))
    throw new LiveRefusal('usage', 'Choose one of --live and --dry-run.');
  if (flags.includes('--live')) return 'live';
  if (flags.includes('--check-plan')) return 'check-plan';
  return 'dry-run';
}

/** The guards every mode applies before anything else, from the environment alone. */
export function assertEnvironment(mode: Mode, env: Env): void {
  assertNotDeployed(env);
  assertNoRealData(env);
  if (mode === 'check-plan') assertNoKey(env);
  if (mode === 'live') {
    assertRunnerDatabase(env.DATABASE_URL);
    readKey(env);
  }
}
