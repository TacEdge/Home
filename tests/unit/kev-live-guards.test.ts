import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertBudgetCovers,
  assertBudgetWithinPlanCap,
  assertCapCovers,
  assertEnvironment,
  assertLedgerCovers,
  ledgerRemainder,
  assertNoKey,
  assertNoRealData,
  assertNotDeployed,
  assertNotLocal,
  assertNotProduction,
  assertPlanHash,
  assertRunnerDatabase,
  CAMPAIGN_USD_MICROS,
  capNzdFor,
  capUsdMicros,
  EXIT,
  KEY_FORMAT,
  LiveRefusal,
  NZD_PER_USD,
  parseBudgetUsd,
  parseLedger,
  parseMode,
  readKey,
  SESSION_CEILING_USD_MICROS,
  usd,
} from '../../scripts/kev-live/guards.mts';
import {
  isFixturePersonName,
  nonFixtureEmails,
  nonFixturePeople,
} from '../../scripts/kev-live/fixture-names.mts';
import { NZD_PER_USD as BOOKKEEPING_NZD_PER_USD } from '@/domain/kev-bookkeeping/constants';
import { PROVIDER_KEY_FORMAT } from '@/lib/env';
import { monthlyCapUsdMicros } from '@/trust/usage';

// The live verification runner's guards (M8 live-verification plan §5;
// owner decisions 2–4 and 6, 2026-10-16): every refusal, with its code and
// exit code, and never an echo of a URL, host, password or key.

const KEY = 'test-key-not-real-0000';
const refusal = (f: () => unknown): LiveRefusal => {
  try {
    f();
  } catch (e) {
    if (e instanceof LiveRefusal) return e;
    throw e;
  }
  throw new Error('expected a refusal');
};
const RUNNER_URL = 'postgres://home_app:pw-canary-77@localhost:5432/home_live_verify';

describe('the environment guards', () => {
  it('refuse a deployed process: VERCEL, VERCEL_ENV or NODE_ENV=production', () => {
    for (const env of [{ VERCEL: '1' }, { VERCEL_ENV: 'preview' }, { NODE_ENV: 'production' }]) {
      const r = refusal(() => assertNotDeployed(env));
      expect(r.code).toBe('deployed');
      expect(r.exitCode).toBe(EXIT.deployed);
    }
    expect(() => assertNotDeployed({ NODE_ENV: 'test', VERCEL: '' })).not.toThrow();
  });

  it('refuse HOME_REAL_DATA set to anything, even empty', () => {
    for (const v of ['open', 'closed', ''])
      expect(refusal(() => assertNoRealData({ HOME_REAL_DATA: v })).exitCode).toBe(EXIT.real_data);
    expect(() => assertNoRealData({})).not.toThrow();
  });

  it('refuse any database but the job’s own home_live_verify on localhost, never echoing the URL', () => {
    expect(assertRunnerDatabase(RUNNER_URL)).toEqual({ database: 'home_live_verify' });
    expect(() =>
      assertRunnerDatabase('postgres://home:home@127.0.0.1:5432/home_live_verify'),
    ).not.toThrow();
    for (const url of [
      undefined,
      'not a url',
      'mysql://localhost/home_live_verify',
      'postgres://u:pw-canary-77@ep-x.neon.tech/home_live_verify',
      'postgres://u:pw-canary-77@localhost:5432/home_test',
      'postgres://u:pw-canary-77@localhost:5432/home',
      'postgres://u:pw-canary-77@localhost:5432/home_live_verify?host=ep-x.neon.tech',
      'postgres://u:pw-canary-77@localhost:5432/home_live_verify?HostAddr=10.0.0.1',
    ]) {
      const r = refusal(() => assertRunnerDatabase(url));
      expect(r.exitCode, String(url)).toBe(EXIT.database);
      expect(r.message).not.toContain('pw-canary-77');
      expect(r.message).not.toContain('neon');
    }
  });

  it('read the key from KEV_EVAL_PROVIDER_KEY only: HOME_KEV_PROVIDER_KEY and ANTHROPIC_API_KEY are ignored', () => {
    expect(readKey({ KEV_EVAL_PROVIDER_KEY: KEY })).toBe(KEY);
    for (const env of [
      {},
      { HOME_KEV_PROVIDER_KEY: KEY },
      { ANTHROPIC_API_KEY: KEY },
      // The runner's earlier name (before the owner's decision of 2026-10-16) is not read.
      { KEV_LIVE_PROVIDER_KEY: KEY },
      { KEV_EVAL_PROVIDER_KEY: '   ' },
      { KEV_EVAL_PROVIDER_KEY: 'short' },
      { KEV_EVAL_PROVIDER_KEY: `${KEY} with space` },
    ]) {
      const r = refusal(() => readKey(env));
      expect(r.exitCode).toBe(EXIT.no_key);
      expect(r.message).not.toContain(KEY);
    }
  });

  it('the key format is env.ts’s exactly', () => {
    expect(KEY_FORMAT.source).toBe(PROVIDER_KEY_FORMAT.source);
    expect(KEY_FORMAT.flags).toBe(PROVIDER_KEY_FORMAT.flags);
  });

  it('the keyless plan check refuses when a key is present', () => {
    expect(refusal(() => assertNoKey({ KEV_EVAL_PROVIDER_KEY: KEY })).exitCode).toBe(EXIT.no_key);
    expect(() => assertNoKey({ HOME_KEV_PROVIDER_KEY: KEY })).not.toThrow();
  });

  it('assertEnvironment: a dry run needs no key or database; live needs both; deployed is refused in every mode', () => {
    expect(() => assertEnvironment('dry-run', {})).not.toThrow();
    expect(() => assertEnvironment('dry-run', { KEV_EVAL_PROVIDER_KEY: KEY })).not.toThrow();
    expect(() => assertEnvironment('check-plan', {})).not.toThrow();
    expect(refusal(() => assertEnvironment('live', { KEV_EVAL_PROVIDER_KEY: KEY })).code).toBe(
      'database',
    );
    expect(refusal(() => assertEnvironment('live', { DATABASE_URL: RUNNER_URL })).code).toBe(
      'no_key',
    );
    expect(() =>
      assertEnvironment('live', { DATABASE_URL: RUNNER_URL, KEV_EVAL_PROVIDER_KEY: KEY }),
    ).not.toThrow();
    for (const mode of ['dry-run', 'check-plan', 'live'] as const) {
      expect(refusal(() => assertEnvironment(mode, { VERCEL_ENV: 'production' })).code).toBe(
        'deployed',
      );
      expect(refusal(() => assertEnvironment(mode, { HOME_REAL_DATA: 'open' })).code).toBe(
        'real_data',
      );
    }
  });

  it('parseMode: the dry run is the default; --live and --check-plan are explicit; nothing else', () => {
    expect(parseMode([])).toBe('dry-run');
    expect(parseMode(['--dry-run'])).toBe('dry-run');
    expect(parseMode(['--live'])).toBe('live');
    expect(parseMode(['--check-plan'])).toBe('check-plan');
    for (const a of [['--live', '--check-plan'], ['--live', '--dry-run'], ['--force']])
      expect(refusal(() => parseMode(a)).exitCode).toBe(EXIT.usage);
  });
});

describe('the budget', () => {
  it('the session ceiling is the owner’s US$10 (decision 4) and the campaign US$200', () => {
    expect(SESSION_CEILING_USD_MICROS).toBe(10_000_000n);
    expect(CAMPAIGN_USD_MICROS).toBe(200_000_000n);
  });

  it('parses dollars and cents; refuses above US$10, zero and malformed values', () => {
    expect(parseBudgetUsd('10')).toBe(10_000_000n);
    expect(parseBudgetUsd('7.5')).toBe(7_500_000n);
    expect(parseBudgetUsd('7.28')).toBe(7_280_000n);
    expect(parseBudgetUsd('0.01')).toBe(10_000n);
    for (const raw of [
      undefined,
      '',
      '10.01',
      '11',
      '200',
      '0',
      '0.00',
      '-1',
      '1e1',
      '7.555',
      ' 7',
      'ten',
    ])
      expect(refusal(() => parseBudgetUsd(raw)).exitCode, String(raw)).toBe(EXIT.budget);
  });

  it('the budget must hold the plan’s maximum', () => {
    expect(() => assertBudgetCovers(7_277_024n, 7_277_024n)).not.toThrow();
    expect(refusal(() => assertBudgetCovers(7_277_023n, 7_277_024n)).exitCode).toBe(EXIT.budget);
  });

  it('HOME’s cap for the run is the budget in whole NZ$ (rounded down), priced as the bookkeeping path does', () => {
    expect(NZD_PER_USD).toEqual(BOOKKEEPING_NZD_PER_USD);
    expect(capNzdFor(10_000_000n)).toBe(18);
    expect(capNzdFor(7_500_000n)).toBe(13);
    expect(capNzdFor(7_777_778n)).toBe(14);
    for (const nzd of [0, 1, 13, 14, 18, 100, 300])
      expect(capUsdMicros(nzd)).toBe(monthlyCapUsdMicros(nzd, BOOKKEEPING_NZD_PER_USD));
    // Never above the budget.
    for (const b of [10_000n, 1_234_567n, 7_500_000n, 10_000_000n])
      expect(capUsdMicros(capNzdFor(b)) <= b).toBe(true);
    expect(capUsdMicros(18)).toBe(10_000_000n);
  });

  it('the cap, less what the database counts, must hold the plan', () => {
    expect(() => assertCapCovers(10_000_000n, 4_800n, 7_277_024n)).not.toThrow();
    expect(refusal(() => assertCapCovers(7_222_222n, 0n, 7_277_024n)).exitCode).toBe(EXIT.cap);
    expect(refusal(() => assertCapCovers(10_000_000n, 3_000_000n, 7_277_024n)).exitCode).toBe(
      EXIT.cap,
    );
  });

  it('usd() rounds to the cent', () => {
    expect(usd(7_277_024n)).toBe('7.28');
    expect(usd(133_056n)).toBe('0.13');
    expect(usd(0n)).toBe('0.00');
    expect(usd(10_000_000n)).toBe('10.00');
  });
});

describe('the plan hash', () => {
  const H = 'a'.repeat(64);
  it('must be given, well-formed and equal', () => {
    expect(() => assertPlanHash(H, H)).not.toThrow();
    for (const approved of [undefined, '', 'A'.repeat(64), 'a'.repeat(63), `${H} `])
      expect(refusal(() => assertPlanHash(approved, H)).exitCode).toBe(EXIT.plan_hash);
    expect(refusal(() => assertPlanHash('b'.repeat(64), H)).exitCode).toBe(EXIT.plan_hash);
  });
});

describe('the campaign ledger', () => {
  const ledger = (sessions: unknown[], campaign = '200000000') =>
    JSON.stringify({
      format: 'home-kev-live-ledger',
      version: 1,
      campaignUsdMicros: campaign,
      sessions,
    });
  const session = (recorded: string) => ({
    date: '2026-10-20',
    workflowRun: '1',
    planHash: 'a'.repeat(64),
    plannedMaxUsdMicros: '7277024',
    recordedUsdMicros: recorded,
  });

  it('a budget above the plan’s session cap is refused; at or below it, not', () => {
    expect(() => assertBudgetWithinPlanCap(6_000_000n, 6_000_000n)).not.toThrow();
    expect(() => assertBudgetWithinPlanCap(5_000_000n, 6_000_000n)).not.toThrow();
    expect(refusal(() => assertBudgetWithinPlanCap(6_000_001n, 6_000_000n)).exitCode).toBe(
      EXIT.budget,
    );
    expect(refusal(() => assertBudgetWithinPlanCap(10_000_000n, 6_000_000n)).exitCode).toBe(
      EXIT.budget,
    );
  });

  it('the committed ledger: live verification #1 at its upper bound, #2 at its exact figure and #3 at the owner’s reported figure, the remainder covering a US$10 session', () => {
    const l = parseLedger(readFileSync('docs/m8/M8-LIVE-LEDGER.json', 'utf8'));
    expect(l.sessions.map((s) => [s.date, s.planHash, s.recordedUsdMicros])).toEqual([
      ['2026-10-17', 'f7f82b9ab622b2cc096e93837850c4cd67e787cbc17d9ed3aa95201944c3f8e8', '145000'],
      ['2026-10-17', 'fbc4a53624226bc5a057d6f59c3a57738480c26a3b81939bd4f9bd2de95e55fd', '778283'],
      ['2026-10-18', '2033f85e8ec7e043c177700eb1ea0c973ae9a09a0edb3199107bbd80d04af0ad', '160675'],
    ]);
    // 200,000,000 − 145,000 − 778,283 − 160,675.
    expect(ledgerRemainder(l)).toBe(198_916_042n);
    expect(() => assertLedgerCovers(l, SESSION_CEILING_USD_MICROS)).not.toThrow();
  });

  it('the remainder is US$200 less every session’s recorded cost; a budget above it is refused', () => {
    const l = parseLedger(ledger([session('150000000'), session('45000000')]));
    expect(() => assertLedgerCovers(l, 5_000_000n)).not.toThrow();
    expect(refusal(() => assertLedgerCovers(l, 5_000_001n)).exitCode).toBe(EXIT.ledger);
    const over = parseLedger(ledger([session('201000000')]));
    expect(refusal(() => assertLedgerCovers(over, 1n)).exitCode).toBe(EXIT.ledger);
  });

  it('anything unexpected in the ledger refuses (fail closed)', () => {
    for (const text of [
      'not json',
      '[]',
      JSON.stringify({ format: 'x', version: 1, campaignUsdMicros: '200000000', sessions: [] }),
      ledger([], '300000000'),
      ledger([], '2e8'),
      ledger([{ ...session('1'), recordedUsdMicros: '-1' }]),
      ledger([{ ...session('1'), recordedUsdMicros: 1 }]),
      ledger([null]),
      JSON.stringify({
        format: 'home-kev-live-ledger',
        version: 1,
        campaignUsdMicros: '200000000',
      }),
    ])
      expect(refusal(() => parseLedger(text)).exitCode, text).toBe(EXIT.ledger);
  });
});

describe('the hosted targets (G16, the isolation check)', () => {
  const PROD = 'ep-prod-123.ap-southeast-2.aws.neon.tech';
  const devPooled =
    'postgres://app:pw-canary-77@ep-dev-456-pooler.ap-southeast-2.aws.neon.tech/home';
  it('Production’s host is required, and the target must not be it or its endpoint', () => {
    expect(assertNotProduction(devPooled, PROD, 'G16_DATABASE_URL')).toBe(
      'ep-dev-456-pooler.ap-southeast-2.aws.neon.tech',
    );
    for (const prodHost of [undefined, '', '  '])
      expect(refusal(() => assertNotProduction(devPooled, prodHost, 'X')).exitCode).toBe(
        EXIT.production_host,
      );
    for (const url of [
      `postgres://app:pw@${PROD}/home`,
      'postgres://app:pw@ep-prod-123-pooler.ap-southeast-2.aws.neon.tech/home',
      `postgres://app:pw@${PROD.toUpperCase()}/home`,
    ]) {
      const r = refusal(() => assertNotProduction(url, PROD, 'G16_DATABASE_URL'));
      expect(r.exitCode).toBe(EXIT.production_host);
      expect(r.message).not.toContain('ep-prod');
    }
  });

  it('G16 refuses a local database', () => {
    for (const url of [
      'postgres://u:p@localhost/home_test',
      'postgres://u:p@127.0.0.1/x',
      'postgres://u:p@[::1]/x',
    ])
      expect(refusal(() => assertNotLocal(url, 'G16_DATABASE_URL')).exitCode).toBe(EXIT.database);
    expect(() => assertNotLocal(devPooled, 'G16_DATABASE_URL')).not.toThrow();
  });
});

describe('the fixture family’s names', () => {
  it('the family, the canaries and the seed’s marked records are fixture names; anything else is not', () => {
    for (const n of [
      'Sam',
      'Alex',
      'Milo',
      'Isla',
      'Nana Jo',
      'canary-sam-person-7f3a',
      'canary-archived-person',
    ])
      expect(isFixturePersonName(n), n).toBe(true);
    expect(nonFixturePeople(['Sam', 'Someone Else', 'sam', 'Milo'])).toBe(2);
    expect(nonFixtureEmails(['sam@example.test', 'ALEX@EXAMPLE.TEST', 'person@example.com'])).toBe(
      1,
    );
  });
});
