import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { campaignJson, campaignMarkdown, summariseCampaign } from './campaign-summary';
import { parseLedger } from './guards.mts';

// Run only by `node scripts/kev-live/campaign.mts` (its launcher), which sets
// KEV_CAMPAIGN_LAUNCHED. Local files only. The outcome's exit code goes to
// the status file the launcher reads.

it('the final acceptance campaign’s summary', () => {
  if (process.env.KEV_CAMPAIGN_LAUNCHED !== 'confirmed')
    throw new Error('Run the campaign summary with `node scripts/kev-live/campaign.mts`.');
  let exitCode = 2;
  try {
    const paths = JSON.parse(process.env.KEV_CAMPAIGN_REPORTS ?? '[]') as string[];
    const summary = summariseCampaign(
      paths.map((p) => ({ label: p, json: JSON.parse(readFileSync(p, 'utf8')) as unknown })),
      parseLedger(readFileSync('docs/m8/M8-LIVE-LEDGER.json', 'utf8')),
    );
    const out = process.env.KEV_CAMPAIGN_OUT ?? 'kev-campaign';
    mkdirSync(out, { recursive: true });
    const markdown = campaignMarkdown(summary);
    writeFileSync(join(out, 'campaign-summary.md'), markdown);
    writeFileSync(join(out, 'campaign-summary.json'), campaignJson(summary));
    process.stdout.write(markdown);
    exitCode = summary.complete && summary.moneyHeld ? 0 : 1;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : 'campaign: unreadable input'}\n`);
    exitCode = 2;
  }
  if (process.env.KEV_CAMPAIGN_STATUS_FILE)
    writeFileSync(process.env.KEV_CAMPAIGN_STATUS_FILE, JSON.stringify({ exitCode }));
  expect(exitCode).toBeTypeOf('number');
});
