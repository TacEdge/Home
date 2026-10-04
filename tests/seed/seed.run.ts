import { expect, it } from 'vitest';
import { createDb } from '@/db/create';
import { assertSeedTarget } from '../../scripts/seed-guard.mts';
import { seedFixtureFamily } from '../fixtures/seed';

// Run only by `pnpm db:seed:fixtures` (scripts/seed-fixtures.mts), which sets
// HOME_SEED_FIXTURES after its own guard. Guarded again here before any
// connection. Writes as the runtime role, through the domain services.

it('seeds the synthetic fixture family into the local database', async () => {
  if (process.env.HOME_SEED_FIXTURES !== 'confirmed') {
    throw new Error('Run the seed with `pnpm db:seed:fixtures`.');
  }
  assertSeedTarget(process.env.DATABASE_URL, process.env);
  const { db, close } = createDb(process.env.DATABASE_URL as string);
  try {
    const result = await seedFixtureFamily(db);
    expect(['seeded', 'already_seeded']).toContain(result.status);
    console.info(`fixture seed: ${result.status}`);
  } finally {
    await close();
  }
});
