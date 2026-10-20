import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSpendReport } from '@/domain/kev-bookkeeping/service';
import { systemActor } from '@/trust/actor';
import {
  assertKeylessCap,
  assertLiveCap,
  capNzdFor,
  capUsdMicros,
  EXIT,
  LiveRefusal,
} from '../../scripts/kev-live/guards.mts';
import { buildPlan } from '../../scripts/kev-live/plan';
import { FIXTURE_USAGE_USD_MICROS, seedFixtureFamily } from '../fixtures/seed';
import { testDb } from './db';
import { clearDomainRows } from './fixtures';

// Live verification #9 (2026-10-20; ADR 0012 §69), reproduced on a synthetic
// database. The live runner's throwaway database is seeded with the fixture
// family; the seed recorded one synthetic usage row per adult (2,400 µ$
// each), and HOME's cap counts every usage row in the month. The keyless
// check assumes nothing is counted, so review-deep's exact US$30.00 cap
// (NZ$54) passed it, and the live check refused: 4,800 µ$ + US$30.00 >
// US$30.00, printed as "US$0.00".
//
// The runner's database is fresh; this one is shared with the other suites,
// whose usage in the real month is not the runner's. So each case measures
// what the seed adds to HOME's own count (files run one at a time; nothing
// else records here) and gives the live check exactly that, as a fresh
// runner database would count it. No provider, no key. Synthetic only.

const { db, close } = testDb();
const savedCap = process.env.HOME_KEV_MONTHLY_CAP_NZD;
const deep = buildPlan('review-deep');
const BUDGET = 30_000_000n;

/** HOME's own count for the month, and the cap it reads, through the bookkeeping path. */
const spend = () => getSpendReport(systemActor, { db });

/** What seeding the fixture family adds to HOME's count, and the live check on a fresh database that holds just that. */
async function seededAndChecked(
  opts?: Parameters<typeof seedFixtureFamily>[1],
): Promise<{ added: bigint; refusal: LiveRefusal | null }> {
  await clearDomainRows(db);
  const before = await spend();
  expect((await seedFixtureFamily(db, opts)).status).toBe('seeded');
  const after = await spend();
  const added = after.count.countedUsdMicros - before.count.countedUsdMicros;
  try {
    assertLiveCap(
      capNzdFor(BUDGET),
      { capUsdMicros: after.capUsdMicros, countedUsdMicros: added },
      deep.peakHoldUsdMicros,
    );
    return { added, refusal: null };
  } catch (e) {
    if (e instanceof LiveRefusal) return { added, refusal: e };
    throw e;
  }
}

beforeAll(() => {
  // The run's own cap, as the runner sets it: the budget in whole NZ$.
  process.env.HOME_KEV_MONTHLY_CAP_NZD = String(capNzdFor(BUDGET));
});
afterAll(async () => {
  if (savedCap === undefined) delete process.env.HOME_KEV_MONTHLY_CAP_NZD;
  else process.env.HOME_KEV_MONTHLY_CAP_NZD = savedCap;
  await clearDomainRows(db);
  await close();
});

describe('the runner database’s starting count against review-deep’s exact US$30.00 cap', () => {
  it('the keyless check passes US$30.00, assuming nothing counted, and HOME’s bookkeeping reads the same cap', async () => {
    expect(capUsdMicros(capNzdFor(BUDGET))).toBe(30_000_000n);
    expect((await spend()).capUsdMicros).toBe(30_000_000n);
    expect(() => assertKeylessCap(BUDGET, deep.peakHoldUsdMicros)).not.toThrow();
  });

  it('reproduced: the seed with its usage rows adds 4,800 µ$ to HOME’s count, and the live check refuses (exit 17), stating it exactly', async () => {
    const { added, refusal } = await seededAndChecked();
    expect(added).toBe(2n * BigInt(FIXTURE_USAGE_USD_MICROS));
    expect(added).toBe(4_800n);
    expect(refusal?.exitCode).toBe(EXIT.cap);
    expect(refusal?.message).toContain('US$0.004800');
  });

  it('corrected: seeded without usage, nothing is added, and the exact US$30.00 cap is accepted', async () => {
    const { added, refusal } = await seededAndChecked({ usage: false });
    expect(added).toBe(0n);
    expect(refusal).toBeNull();
  });
});
