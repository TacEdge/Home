// node scripts/kev-live/campaign.mts <out-dir> <report.json>...
//
// The final acceptance campaign's summary (ADR 0012 §76;
// docs/m8/M8-FINAL-CAMPAIGN.md): every batch's downloaded report (each
// run's `kev-live-report` artifact, unzipped), read with the committed
// ledger, docs/m8/M8-LIVE-LEDGER.json. Writes campaign-summary.md and
// campaign-summary.json to <out-dir> and prints the Markdown: which
// batches ran, what each cost and how it was approved, what is missing,
// the proposed ledger rows for the consolidated evidence PR, and §12.3's
// summary over every run. A report that is not a batch of this campaign as
// the code now computes it, a batch counted twice or a record counted
// twice is refused. Local files only: no database, key or network.
//
// It runs under Vitest (scripts/kev-live/campaign.live.ts), which resolves
// the app's path aliases, as the runner does. Exit 0 when the campaign is
// complete and its money checks hold, 1 when it is not (the summary says
// why), 2 on a refused or unreadable input.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [out, ...reports] = process.argv.slice(2);
if (!out || reports.length === 0) {
  console.error('usage: node scripts/kev-live/campaign.mts <out-dir> <report.json>...');
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), 'kev-campaign-'));
const statusFile = join(dir, 'status.json');
try {
  spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--project', 'kev-live', 'scripts/kev-live/campaign.live.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        KEV_CAMPAIGN_LAUNCHED: 'confirmed',
        KEV_CAMPAIGN_OUT: resolve(out),
        KEV_CAMPAIGN_REPORTS: JSON.stringify(reports.map((r) => resolve(r))),
        KEV_CAMPAIGN_STATUS_FILE: statusFile,
      },
    },
  );
  let code = 2;
  try {
    const status = JSON.parse(readFileSync(statusFile, 'utf8')) as { exitCode?: unknown };
    if (typeof status.exitCode === 'number') code = status.exitCode;
  } catch {
    code = 2;
  }
  process.exitCode = code;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
