import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createDb } from '@/db/create';
import { assertNotDeployed, assertNotLocal, assertNotProduction } from './guards.mts';
import { runG16 } from './g16';

// Run only by `node scripts/kev-live/g16-pooled.mts`, which checks the
// target and its isolation first and sets KEV_G16_LAUNCHED. The target
// guards run again here, before any connection.

it(
  'G16: reservations through the pooled connection',
  async () => {
    if (process.env.KEV_G16_LAUNCHED !== 'confirmed')
      throw new Error('Run G16 with `node scripts/kev-live/g16-pooled.mts`.');
    assertNotDeployed(process.env);
    assertNotLocal(process.env.G16_DATABASE_URL, 'G16_DATABASE_URL');
    assertNotProduction(
      process.env.G16_DATABASE_URL,
      process.env.PRODUCTION_DB_HOST,
      'G16_DATABASE_URL',
    );
    const { db, close } = createDb(process.env.G16_DATABASE_URL as string);
    try {
      const report = await runG16(db);
      const lines = [
        `rounds: ${report.rounds}; reservations taken: ${report.reservationsTaken}; settled: ${report.settled}`,
        `serialised on the budget lock: ${report.serialisedOnLock} (lock held ${report.lockHeldMs} ms)`,
        `round ms: ${report.roundMs.join(', ')}`,
        `left open or unreconciled: ${report.leftOpenOrUnreconciled}`,
        `G16 (pooled): ${report.passed ? 'passed' : 'FAILED'}. The owner records it with the date.`,
      ];
      for (const l of lines) process.stdout.write(`${l}\n`);
      if (process.env.KEV_LIVE_STATUS_FILE)
        writeFileSync(
          process.env.KEV_LIVE_STATUS_FILE,
          JSON.stringify({
            exitCode: report.passed ? 0 : 1,
            code: report.passed ? 'passed' : 'failed',
          }),
        );
      expect(report.passed).toBe(true);
    } finally {
      await close();
    }
  },
  10 * 60_000,
);
