// Previous-schema compatibility check (M2 contract §2.1 rule 7, ADR 0005 §16).
//
// Migration-first means production runs the new application code only after
// the migration it needs is live, but every merge still deploys at once. So
// the code in a PR must work on the schema production has *before* this PR's
// migrations run: the base branch's migrations. This script builds the test
// database from exactly those migrations and runs the PR's integration suites
// (as home_app, through the normal harness) and, with --boot, the boot check.
// A PR whose application code needs schema that main does not yet have fails.
//
//   node scripts/check-previous-schema.mts [--base <git ref>] [--boot]
//   node scripts/check-previous-schema.mts --self-test
//
// --self-test proves the check can fail: it runs the same machinery against
// schemas that deliberately lack something the current code needs and
// requires those runs to fail for that reason, plus one control that must pass.
//
// Only ever touches the local *_test database (tests/db-guard.ts runs in the
// harness before any connection). Never prints a connection string.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIGRATIONS_DIR = 'src/db/migrations';
const JOURNAL = 'meta/_journal.json';

/**
 * Integration suites that assert the *new* schema itself (tables, columns,
 * grants a migration adds). They are expected to fail on the previous schema,
 * so the check leaves them out; every other suite must pass there. A
 * migration PR's own schema assertions belong in these files.
 */
export const SCHEMA_ASSERTION_SUITES = ['migrations.test.ts', 'app-role.test.ts'];

export type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};
export type Journal = { version: string; dialect: string; entries: JournalEntry[] };
export type MigrationSet = { journal: Journal; sql: Map<string, string> };

/** The integration suites to run against the previous schema. */
export function compatSuites(files: string[]): string[] {
  return files
    .filter((f) => f.endsWith('.test.ts') && !SCHEMA_ASSERTION_SUITES.includes(f))
    .sort()
    .map((f) => `tests/integration/${f}`);
}

/**
 * The base's migrations must be an unchanged prefix of the PR's: a PR may
 * only add migrations after the base's, never edit, remove or reorder one
 * that has reached it ("Never edit a migration that has reached main").
 * Returns the tags the PR adds.
 */
export function checkPrefix(base: MigrationSet, head: MigrationSet): string[] {
  const b = base.journal.entries;
  const h = head.journal.entries;
  if (b.length > h.length) {
    throw new Error(
      `the base has ${b.length} migrations and this checkout only ${h.length}: a migration was removed`,
    );
  }
  b.forEach((entry, i) => {
    const mine = h[i];
    if (!mine || mine.tag !== entry.tag) {
      throw new Error(`migration ${i} is "${entry.tag}" on the base but "${mine?.tag}" here`);
    }
    if (base.sql.get(entry.tag) !== head.sql.get(entry.tag)) {
      throw new Error(`migration "${entry.tag}" was changed after reaching the base`);
    }
  });
  return h.slice(b.length).map((e) => e.tag);
}

/** The migrations before `tag`: the schema state just before it ran. */
export function before(set: MigrationSet, tag: string): MigrationSet {
  const i = set.journal.entries.findIndex((e) => e.tag === tag);
  if (i < 0) throw new Error(`no migration "${tag}"`);
  const entries = set.journal.entries.slice(0, i);
  return {
    journal: { ...set.journal, entries },
    sql: new Map(entries.map((e) => [e.tag, set.sql.get(e.tag) ?? ''])),
  };
}

/** `set` plus one more migration, for the self-test's broken schemas. */
export function plus(set: MigrationSet, tag: string, sql: string): MigrationSet {
  const last = set.journal.entries.at(-1);
  const entry: JournalEntry = {
    idx: set.journal.entries.length,
    version: last?.version ?? '7',
    when: (last?.when ?? 0) + 1,
    tag,
    breakpoints: true,
  };
  return {
    journal: { ...set.journal, entries: [...set.journal.entries, entry] },
    sql: new Map([...set.sql, [tag, sql]]),
  };
}

/** Where the base is: an explicit ref, the PR's merge base, or the previous main. */
export function resolveBase(
  arg: string | undefined,
  env: Record<string, string | undefined>,
): string {
  if (arg) return arg;
  if (env.GITHUB_BASE_REF) return `merge-base:origin/${env.GITHUB_BASE_REF}`;
  if (env.GITHUB_EVENT_NAME === 'push') return 'HEAD^1';
  return 'merge-base:origin/main';
}

// ---- git and filesystem -------------------------------------------------

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function commitFor(base: string): string {
  return base.startsWith('merge-base:')
    ? git('merge-base', 'HEAD', base.slice(11))
    : git('rev-parse', base);
}

function readAtCommit(commit: string): MigrationSet {
  const journal = JSON.parse(git('show', `${commit}:${MIGRATIONS_DIR}/${JOURNAL}`)) as Journal;
  const sql = new Map(
    journal.entries.map((e) => [e.tag, git('show', `${commit}:${MIGRATIONS_DIR}/${e.tag}.sql`)]),
  );
  return { journal, sql };
}

function readCheckout(): MigrationSet {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, JOURNAL), 'utf8')) as Journal;
  const sql = new Map(
    journal.entries.map((e) => [
      e.tag,
      readFileSync(join(MIGRATIONS_DIR, `${e.tag}.sql`), 'utf8').trim(),
    ]),
  );
  return { journal, sql };
}

function writeSet(set: MigrationSet): string {
  const dir = mkdtempSync(join(tmpdir(), 'home-previous-schema-'));
  mkdirSync(join(dir, 'meta'));
  writeFileSync(join(dir, JOURNAL), JSON.stringify(set.journal, null, 2));
  for (const [tag, sql] of set.sql) writeFileSync(join(dir, `${tag}.sql`), sql);
  return dir;
}

type Run = { ok: boolean; output: string };

function runSuites(set: MigrationSet, suites: string[], quiet = false): Run {
  const dir = writeSet(set);
  try {
    const r = spawnSync('pnpm', ['exec', 'vitest', 'run', '--project', 'integration', ...suites], {
      env: { ...process.env, HOME_TEST_MIGRATIONS_DIR: dir },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (!quiet) process.stdout.write(output);
    return { ok: r.status === 0, output };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runBoot(): Run {
  const url =
    process.env.TEST_APP_DATABASE_URL ?? 'postgres://home_app:home_app@localhost:5432/home_test';
  const r = spawnSync('node', ['scripts/check-boot-validation.mjs', url], { encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(output);
  return { ok: r.status === 0, output };
}

const say = (msg: string) => console.log(`check-previous-schema: ${msg}`);

function main(argv: string[]): number {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const head = readCheckout();
  const suites = compatSuites(readdirSync('tests/integration'));

  if (argv.includes('--self-test')) return selfTest(head);

  const base = resolveBase(arg('--base'), process.env);
  const commit = commitFor(base);
  const previous = readAtCommit(commit);
  const added = checkPrefix(previous, head);
  say(
    `base ${commit.slice(0, 7)} (${base}) has ${previous.journal.entries.length} migrations; ` +
      (added.length ? `this change adds ${added.join(', ')}.` : 'this change adds none.'),
  );
  say(`running ${suites.length} integration suites against the base schema.`);
  if (!runSuites(previous, suites).ok) {
    say('FAILED: this code does not work on the schema production has before its migrations run.');
    say(
      'Under migration-first, land the migration on its own first (docs/runbooks/MIGRATIONS.md).',
    );
    return 1;
  }
  if (argv.includes('--boot') && !runBoot().ok) {
    say('FAILED: the server does not boot on the base schema.');
    return 1;
  }
  say('the code works on the base schema.');
  return 0;
}

/**
 * Proves the check detects incompatibility rather than trusting its config:
 * two schemas that lack something today's code needs must fail, for that
 * reason, and an unchanged schema must pass with the same suites.
 */
function selfTest(head: MigrationSet): number {
  const suites = ['tests/integration/audit.test.ts', 'tests/integration/sign-in-gate.test.ts'];
  const cases: { name: string; set: MigrationSet; expect: 'pass' | 'fail'; because?: RegExp }[] = [
    { name: 'control: the checkout’s own schema', set: head, expect: 'pass' },
    {
      // A column the code writes and reads is not there yet: the PR #17 case.
      name: 'a column the code needs (audit_log.meta) does not exist yet',
      set: plus(
        head,
        '9999_self_test_missing_column',
        'ALTER TABLE "audit_log" DROP COLUMN "meta";',
      ),
      expect: 'fail',
      because: /column "meta" (of relation "audit_log" )?does not exist/,
    },
    {
      // Schema state the code needs (the runtime role's grants) is not there
      // yet. On a freshly created schema home_app cannot even see the tables,
      // so Postgres reports either error depending on the object.
      name: 'the schema before 0002_app_role (no runtime-role access)',
      set: before(head, '0002_app_role'),
      expect: 'fail',
      because: /permission denied|relation "[a-z_]+" does not exist/,
    },
  ];
  let ok = true;
  for (const c of cases) {
    const r = runSuites(c.set, suites, true);
    const passed = r.ok === (c.expect === 'pass') && (!c.because || c.because.test(r.output));
    say(
      `self-test ${passed ? 'ok  ' : 'FAIL'} ${c.name}: expected ${c.expect}, got ${r.ok ? 'pass' : 'fail'}`,
    );
    if (!passed) {
      ok = false;
      process.stdout.write(r.output.slice(-4000));
    }
  }
  return ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    say(`FAILED: ${(e as Error).message}`);
    process.exit(1);
  }
}
