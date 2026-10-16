// node scripts/kev-live/isolation-check.mts
//   ISOLATION_DATABASE_URL  the database to check (home-dev's, for example)
//   PRODUCTION_DB_HOST      Production's database host, required, to refuse it
//
// The isolation evidence owner decision 6 needs (M8 live-verification plan
// §6; 2026-10-16): run by the owner on a trusted machine, read-only (one
// READ ONLY transaction, rolled back), never against Production. It prints
// the database's name and host (never the user or password), counts of
// people, events, tasks, notes, context and captures, how many person names
// are not the fixture family's (a count, never a name), how many accounts
// are not the fixture adults' .test addresses, the most recent `created_at`
// in each table, and how many calendar connections exist. It passes only
// when every person is the fixture family's. Exit codes as guards.mts.

import pg from 'pg';
import { assertNotDeployed, assertNotProduction, EXIT, LiveRefusal } from './guards.mts';
import { nonFixtureEmails, nonFixturePeople } from './fixture-names.mts';

/** What the check reads through: a pg client, or a test's. */
export type Queryable = {
  query: <R extends Record<string, unknown>>(text: string) => Promise<{ rows: R[] }>;
};

export const ISOLATION_TABLES = ['person', 'event', 'task', 'note', 'context', 'capture'] as const;

export type IsolationReport = {
  database: string;
  host: string;
  counts: Record<(typeof ISOLATION_TABLES)[number], number>;
  latestCreatedAt: Record<(typeof ISOLATION_TABLES)[number], string | null>;
  nonFixturePeople: number;
  accounts: number;
  nonFixtureAccounts: number;
  calendarConnections: number;
};

/** Reads the evidence in one read-only transaction, always rolled back. */
export async function isolationReport(client: Queryable, host: string): Promise<IsolationReport> {
  await client.query('begin transaction read only');
  try {
    await client.query("set local statement_timeout = '15s'");
    const [db] = (await client.query<{ db: string }>('select current_database() as db')).rows;
    const counts = {} as IsolationReport['counts'];
    const latestCreatedAt = {} as IsolationReport['latestCreatedAt'];
    for (const t of ISOLATION_TABLES) {
      const [row] = (
        await client.query<{ n: number | string; latest: Date | string | null }>(
          `select count(*)::int as n, max(created_at) as latest from ${t}`,
        )
      ).rows;
      counts[t] = Number(row?.n ?? 0);
      const latest = row?.latest ?? null;
      latestCreatedAt[t] =
        latest === null ? null : latest instanceof Date ? latest.toISOString() : String(latest);
    }
    const names = (await client.query<{ name: string }>('select name from person')).rows.map(
      (r) => r.name,
    );
    const emails = (await client.query<{ email: string }>('select email from "user"')).rows.map(
      (r) => r.email,
    );
    const [cal] = (
      await client.query<{ n: number | string }>(
        'select count(*)::int as n from calendar_connection',
      )
    ).rows;
    return {
      database: db?.db ?? '',
      host,
      counts,
      latestCreatedAt,
      nonFixturePeople: nonFixturePeople(names),
      accounts: emails.length,
      nonFixtureAccounts: nonFixtureEmails(emails),
      calendarConnections: Number(cal?.n ?? 0),
    };
  } finally {
    await client.query('rollback');
  }
}

/** Passes only when every person is the fixture family's; the rest is evidence for the owner. */
export function isolationPasses(r: IsolationReport): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.nonFixturePeople > 0)
    reasons.push(`${r.nonFixturePeople} person record(s) are not the fixture family’s`);
  return { ok: reasons.length === 0, reasons };
}

export function isolationLines(r: IsolationReport): string[] {
  return [
    `database: ${r.database} on ${r.host}`,
    ...ISOLATION_TABLES.map(
      (t) =>
        `  ${t.padEnd(8)} ${String(r.counts[t]).padStart(6)}  latest created_at: ${r.latestCreatedAt[t] ?? '—'}`,
    ),
    `person names not in the fixture family: ${r.nonFixturePeople}`,
    `accounts: ${r.accounts}, not a fixture .test address: ${r.nonFixtureAccounts} (the adults' own sign-in accounts appear here)`,
    `calendar connections: ${r.calendarConnections}`,
  ];
}

/** The guarded check for a URL: refuses Production, connects, reads, closes. */
export async function checkIsolation(
  url: string | undefined,
  productionHost: string | undefined,
  what: string,
): Promise<IsolationReport> {
  const host = assertNotProduction(url, productionHost, what);
  const client = new pg.Client({ connectionString: url });
  client.on('error', () => undefined);
  await client.connect();
  try {
    return await isolationReport(client as unknown as Queryable, host);
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('isolation-check.mts')) {
  try {
    assertNotDeployed(process.env);
    const r = await checkIsolation(
      process.env.ISOLATION_DATABASE_URL,
      process.env.PRODUCTION_DB_HOST,
      'ISOLATION_DATABASE_URL',
    );
    for (const l of isolationLines(r)) console.log(l);
    const verdict = isolationPasses(r);
    if (!verdict.ok) throw new LiveRefusal('isolation', verdict.reasons.join('; '));
    console.log(
      'isolation check: passed (synthetic people only). The owner records it with the date.',
    );
  } catch (e) {
    if (e instanceof LiveRefusal) {
      console.error(e.message);
      process.exit(e.exitCode);
    }
    // A connection or query failure: its class only, never its text (it can carry the URL).
    console.error(`isolation check failed: ${e instanceof Error ? e.name : 'error'}`);
    process.exit(EXIT.failed);
  }
}
