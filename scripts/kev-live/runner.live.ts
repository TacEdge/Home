import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseMode } from './guards.mts';
import { runMode } from './runner';

// Run only by `node scripts/kev-live/run.mts` (its launcher), which applies
// the environment guards first and sets KEV_LIVE_LAUNCHED. Every guard runs
// again here, before any connection or network call. The outcome's exit
// code goes to the status file the launcher reads.

const LEDGER = 'docs/m8/M8-LIVE-LEDGER.json';

it(
  'the Kev live verification runner',
  async () => {
    if (process.env.KEV_LIVE_LAUNCHED !== 'confirmed')
      throw new Error('Run the live verification runner with `node scripts/kev-live/run.mts`.');
    const mode = parseMode([`--${process.env.KEV_LIVE_MODE ?? 'dry-run'}`]);
    let ledgerText: string | null = null;
    try {
      ledgerText = readFileSync(LEDGER, 'utf8');
    } catch {
      ledgerText = null;
    }
    const out = await runMode(mode, process.env, {
      ledgerText,
      reportDir: process.env.KEV_LIVE_REPORT_DIR || 'kev-live-report',
      log: (l) => process.stdout.write(`${l}\n`),
    });
    if (process.env.KEV_LIVE_STATUS_FILE)
      writeFileSync(process.env.KEV_LIVE_STATUS_FILE, JSON.stringify(out));
    expect(out.code).toBeTypeOf('string');
  },
  60 * 60_000,
);
