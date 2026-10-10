// The risk classifier (ADR 0010): one source of truth, used by GitHub CI
// (`node scripts/ci-select.mts --ci`) and by `pnpm verify:focused`, for how
// much verification a change needs. Each changed path takes the highest tier
// any rule gives it; a path no rule names is high (fail closed); the change
// takes the highest tier of its paths. Labels can only raise verification:
// `ci:full` forces the full browser regression, and no label lowers a tier.
//
//   low       docs, Markdown, unit and integration tests: no browser tests
//   medium    established screens and the one engine no shared code imports:
//             the specs of every screen that uses them, plus the smoke suite
//   high      domain services, the shared agenda and recurrence and the
//             engines they import, integrations, shared UI, the shell, form
//             and capture helpers, a deleted or renamed spec, anything
//             unmapped: full browser regression
//   critical  auth, trust and privacy infrastructure, the database and its
//             migrations, CI, the test harness, environment controls,
//             dependencies and milestone acceptance: full browser regression
//
// Pushes to main, the nightly run and manual runs are always full. Anything
// unexpected (an unreadable diff, an empty diff, a missing output file, a
// rule naming a spec that does not exist) throws, and the CI step fails: a classifier
// defect can never turn into a green, untested result.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export const TIERS = ['low', 'medium', 'high', 'critical'] as const;
export type Tier = (typeof TIERS)[number];
export type Mode = 'none' | 'targeted' | 'full';

/** The smoke suite, run beside the mapped specs for every medium change. */
export const SMOKE = 'smoke';
/** The label that forces full regression. Labels only ever raise verification. */
export const FULL_LABEL = 'ci:full';

type Rule = { re: RegExp; tier: Tier; reason: string; specs?: string[] };

/**
 * Every rule that matches a path applies: the path's tier is the highest of
 * them, and its specs are the union of theirs. Order does not matter.
 */
export const RULES: Rule[] = [
  // ---- critical ---------------------------------------------------------
  { re: /^src\/trust\//, tier: 'critical', reason: 'trust: auth, visibility, audit, gate' },
  { re: /^src\/app\/\(auth\)\//, tier: 'critical', reason: 'sign-in screens' },
  { re: /^src\/app\/api\//, tier: 'critical', reason: 'API and auth routes' },
  {
    re: /^src\/(proxy|middleware|instrumentation)[^/]*\.ts$/,
    tier: 'critical',
    reason: 'proxy, CSP, start-up',
  },
  { re: /^next\.config\.ts$/, tier: 'critical', reason: 'Next config and headers' },
  {
    re: /^src\/lib\/env\.ts$/,
    tier: 'critical',
    reason: 'environment controls and the real-data gate',
  },
  { re: /^src\/db\//, tier: 'critical', reason: 'database schema, client or migrations' },
  { re: /(^|\/)migrations?\//, tier: 'critical', reason: 'migrations' },
  { re: /\.sql$/, tier: 'critical', reason: 'SQL' },
  { re: /^drizzle(\/|\.config\.)/, tier: 'critical', reason: 'migration tooling' },
  { re: /^\.github\//, tier: 'critical', reason: 'CI workflows and repository automation' },
  { re: /^scripts\//, tier: 'critical', reason: 'verification, seeding and check scripts' },
  {
    re: /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.nvmrc|\.npmrc)$/,
    tier: 'critical',
    reason: 'dependencies and runtime',
  },
  {
    re: /^(tsconfig[^/]*\.json|eslint\.config\.[a-z]+|\.prettier(rc[^/]*|ignore)|vitest\.config\.[a-z]+|playwright\.config\.ts)$/,
    tier: 'critical',
    reason: 'toolchain and test configuration',
  },
  {
    re: /^(\.vercelignore|vercel\.json|docker-compose\.ya?ml|\.env[^/]*)$/,
    tier: 'critical',
    reason: 'deployment and environment',
  },
  {
    re: /^tests\/(env\.ts|db-guard\.ts|setup\.ts|fixtures\/|seed\/|stubs\/|integration\/(db|fixtures|global-setup)\.ts)/,
    tier: 'critical',
    reason: 'test harness and fixtures',
  },
  { re: /^tests\/e2e\/(?!.*\.spec\.ts$)/, tier: 'critical', reason: 'browser test harness' },
  {
    re: /^docs\/(m\d+\/[^/]*ACCEPTANCE[^/]*\.md|runbooks\/DEPLOY\.md)$/,
    tier: 'critical',
    reason: 'milestone acceptance and the production gate',
  },

  // ---- high ---------------------------------------------------------------
  {
    re: /^src\/domain\/(?!engines\/)/,
    tier: 'high',
    reason: 'domain services (where privacy is enforced)',
  },
  {
    re: /^src\/domain\/engines\/(agenda|recurrence)\.ts$/,
    tier: 'high',
    reason: 'shared agenda and recurrence',
  },
  { re: /^src\/integrations\//, tier: 'high', reason: 'integrations' },
  { re: /^src\/kev\//, tier: 'high', reason: 'Kev' },
  { re: /^src\/lib\//, tier: 'high', reason: 'shared library' },
  { re: /^src\/ui\//, tier: 'high', reason: 'shared UI and design tokens' },
  {
    re: /^src\/app\/(layout|globals|not-found|error|global-error)[^/]*$/,
    tier: 'high',
    reason: 'the app shell',
  },
  { re: /^src\/app\/\(home\)\/layout[^/]*$/, tier: 'high', reason: 'the app shell' },
  { re: /^src\/app\/_agenda\//, tier: 'high', reason: 'the shared agenda loader' },
  // Shared by every screen, through the shell's capture bar and every form:
  // no subset of specs covers them (ADR 0010 §8).
  { re: /^src\/app\/_forms\//, tier: 'high', reason: 'form helpers every screen uses' },
  { re: /^src\/app\/_capture\//, tier: 'high', reason: 'the capture bar in the shell' },
  // Engines the shared agenda, its loader or a domain service imports: a
  // change reaches every screen those reach (ADR 0010 §8).
  {
    re: /^src\/domain\/engines\/(today|day-facts|profile|staleness)\.ts$|^src\/domain\/engines\/insights\//,
    tier: 'high',
    reason: 'an engine the shared agenda or a domain service imports',
  },

  // ---- medium: established screens and isolated pure engines --------------
  // Each rule names every spec of every screen that imports its files, directly
  // or through other screen code; tests/unit/ci-import-coverage.test.ts checks
  // that against the source on every run, and a screen whose importers are
  // high-tier code is high instead (ADR 0010 §8).
  {
    re: /^src\/app\/\(home\)\/events\//,
    tier: 'medium',
    reason: 'events screens (also used by People, the regular week and To sort)',
    specs: [
      'capture-sort',
      'events',
      'occurrence-changes',
      'people',
      'regular-week',
      'synced-events',
      'today',
      'today-conflicts',
      'today-screen',
    ],
  },
  {
    re: /^src\/app\/\(home\)\/today\//,
    tier: 'medium',
    reason: 'Today',
    specs: ['today', 'today-conflicts', 'today-screen'],
  },
  {
    re: /^src\/app\/\(home\)\/forward\//,
    tier: 'medium',
    reason: 'Forward',
    specs: ['events', 'synced-events'],
  },
  {
    re: /^src\/app\/\(home\)\/people\//,
    tier: 'medium',
    reason: 'people screens (also used by To sort)',
    specs: ['capture-sort', 'people', 'regular-week', 'today', 'today-conflicts', 'today-screen'],
  },
  {
    re: /^src\/app\/\(home\)\/(home|tasks)\//,
    tier: 'medium',
    reason: 'projects and tasks (also used by To sort)',
    specs: ['capture-sort', 'home-tasks', 'today', 'today-conflicts', 'today-screen'],
  },
  {
    re: /^src\/app\/\(home\)\/sort\//,
    tier: 'medium',
    reason: 'To sort (also used by Today)',
    specs: ['capture-sort', 'today', 'today-conflicts', 'today-screen'],
  },
  {
    re: /^src\/app\/\(home\)\/(calendars|settings\/calendars)\/|^src\/app\/_calendar\//,
    tier: 'medium',
    reason: 'calendar screens and refresh on use (Today, Forward, a person’s page)',
    specs: [
      'calendar-refresh',
      'calendars',
      'capture-sort',
      'events',
      'people',
      'regular-week',
      'synced-events',
      'today',
      'today-conflicts',
      'today-screen',
    ],
  },
  {
    re: /^src\/app\/\(home\)\/settings\/(?!calendars\/)/,
    tier: 'medium',
    reason: 'settings screens',
    specs: ['settings-knows-archived', 'export'],
  },
  {
    re: /^src\/app\/_notes\//,
    tier: 'medium',
    reason: 'notes (events, projects, people)',
    specs: [
      'capture-sort',
      'events',
      'home-tasks',
      'occurrence-changes',
      'people',
      'regular-week',
      'synced-events',
      'today',
      'today-conflicts',
      'today-screen',
    ],
  },
  {
    re: /^src\/app\/_profile\//,
    tier: 'medium',
    reason: 'profile pieces (a person’s page)',
    specs: ['capture-sort', 'people', 'regular-week', 'today', 'today-conflicts', 'today-screen'],
  },
  {
    re: /^src\/domain\/engines\/forward\.ts$/,
    tier: 'medium',
    reason: 'the Forward engine',
    specs: ['events'],
  },

  // ---- low ----------------------------------------------------------------
  { re: /^docs\//, tier: 'low', reason: 'documentation' },
  { re: /\.md$/, tier: 'low', reason: 'Markdown' },
  { re: /^tests\/unit\//, tier: 'low', reason: 'unit tests' },
  { re: /^tests\/integration\/.+\.test\.ts$/, tier: 'low', reason: 'integration tests' },
  { re: /^(\.gitignore|\.gitattributes|LICENSE)$/, tier: 'low', reason: 'repository metadata' },
];

const SPEC_FILE = /^tests\/e2e\/([a-z0-9-]+)\.spec\.ts$/;
const rank = (t: Tier) => TIERS.indexOf(t);
const max = (a: Tier, b: Tier): Tier => (rank(a) >= rank(b) ? a : b);

export type PathClass = { path: string; tier: Tier; reason: string; specs: string[] };

/** One path's tier, the reasons for it and the specs it maps to. */
export function classifyPath(path: string): PathClass {
  if (typeof path !== 'string' || path.trim() === '' || path !== path.trim())
    throw new Error(`ci-select: not a path: ${JSON.stringify(path)}`);
  const own = SPEC_FILE.exec(path);
  // A spec the change deletes (or renames: --no-renames lists the old path as
  // deleted) cannot run itself, and what it covered is unknown: full regression.
  if (own && !existsSync(path))
    return {
      path,
      tier: 'high',
      reason: 'a browser spec this change deletes or renames: full regression',
      specs: [],
    };
  if (own)
    return { path, tier: 'medium', reason: 'a changed browser spec runs itself', specs: [own[1]!] };
  const hits = RULES.filter((r) => r.re.test(path));
  if (hits.length === 0)
    return { path, tier: 'high', reason: 'no rule names this path: fail closed', specs: [] };
  const tier = hits.map((h) => h.tier).reduce(max);
  const top = hits.filter((h) => h.tier === tier);
  return {
    path,
    tier,
    reason: top.map((h) => h.reason).join('; '),
    specs: [...new Set(hits.flatMap((h) => h.specs ?? []))].sort(),
  };
}

export type Selection = {
  tier: Tier;
  mode: Mode;
  /** Spec names (`tests/e2e/<name>.spec.ts`), for a targeted run only. */
  specs: string[];
  /** Why the run is full when it is full because of the event or a label. */
  forced: string | null;
  paths: PathClass[];
};

/**
 * What a change needs. `event` is the GitHub event name (`pull_request`,
 * `push`, `schedule`, `workflow_dispatch`, or `local` for verify:focused).
 */
export function select(input: {
  paths: readonly string[];
  labels?: readonly string[];
  event: string;
}): Selection {
  const paths = [...new Set(input.paths)].sort().map(classifyPath);
  const forced =
    input.event === 'push' || input.event === 'schedule' || input.event === 'workflow_dispatch'
      ? `${input.event}: always full`
      : (input.labels ?? []).includes(FULL_LABEL)
        ? `label ${FULL_LABEL}`
        : null;
  if (input.event !== 'local' && input.event !== 'pull_request' && !forced)
    throw new Error(`ci-select: unexpected event ${JSON.stringify(input.event)}`);
  // An empty diff is not "nothing changed": something is wrong. Fail closed.
  const tier: Tier =
    paths.length === 0 ? 'high' : paths.map((p) => p.tier).reduce(max, 'low' as Tier);
  if (forced || tier === 'high' || tier === 'critical')
    return { tier, mode: 'full', specs: [], forced, paths };
  if (tier === 'low') return { tier, mode: 'none', specs: [], forced, paths };
  const specs = [...new Set([SMOKE, ...paths.flatMap((p) => p.specs)])].sort();
  for (const s of specs)
    if (!/^[a-z0-9-]+$/.test(s) || !existsSync(`tests/e2e/${s}.spec.ts`))
      throw new Error(`ci-select: no such browser spec: ${s}`);
  return { tier, mode: 'targeted', specs, forced, paths };
}

/** The job summary: the tier, the mode, the specs and every path's reason. */
export function summary(s: Selection): string {
  const what =
    s.mode === 'full'
      ? 'Full browser regression'
      : s.mode === 'targeted'
        ? `Selected browser specs: ${s.specs.map((x) => `\`${x}\``).join(', ')}`
        : 'No browser tests: no changed path needs them';
  const rows = s.paths
    .map(
      (p) =>
        `| \`${p.path}\` | ${p.tier} | ${p.reason}${p.specs.length ? ` (${p.specs.join(', ')})` : ''} |`,
    )
    .join('\n');
  return [
    `## Risk tier: **${s.tier}**${s.forced ? ` — full regression forced (${s.forced})` : ''}`,
    '',
    what,
    '',
    s.paths.length
      ? `| Changed path | Tier | Why |\n|---|---|---|\n${rows}`
      : '_No changed paths read._',
    '',
  ].join('\n');
}

const git = (...a: string[]) =>
  execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter(Boolean);

/** Paths a pull request changes: its merge result against the base it targets. */
export function changedSince(base: string): string[] {
  if (!/^[0-9a-f]{40}$/.test(base))
    throw new Error(`ci-select: not a commit: ${JSON.stringify(base)}`);
  return git('diff', '--name-only', '--no-renames', base, 'HEAD');
}

function ci(): void {
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  const out = process.env.GITHUB_OUTPUT;
  if (!out) throw new Error('ci-select: GITHUB_OUTPUT is not set');
  let paths: string[] = [];
  let labels: string[] = [];
  if (event === 'pull_request') {
    const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')) as {
      pull_request?: { base?: { sha?: string }; labels?: { name?: string }[] };
    };
    labels = (payload.pull_request?.labels ?? []).map((l) => String(l.name ?? ''));
    paths = changedSince(String(payload.pull_request?.base?.sha ?? ''));
  }
  const s = select({ paths, labels, event });
  appendFileSync(
    out,
    `tier=${s.tier}\nmode=${s.mode}\nspecs=${s.specs.map((x) => `tests/e2e/${x}.spec.ts`).join(' ')}\n`,
  );
  const text = summary(s);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
}

if (process.argv[1]?.endsWith('ci-select.mts')) {
  try {
    if (process.argv.includes('--ci')) ci();
    else {
      // Local: `node scripts/ci-select.mts <path>…` prints what CI would do for those paths.
      const s = select({ paths: process.argv.slice(2), event: 'pull_request' });
      console.log(summary(s));
    }
  } catch (e) {
    console.error(`::error::risk classification failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
