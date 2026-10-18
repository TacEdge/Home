// node scripts/kev-live/quality-review.mts <review-fast.json> <review sheet.json>
//
// The owner's review summary (M8 Package 5C; ADR 0012 §58;
// docs/m8/M8-QUALITY-RUBRIC.md). Reads the review set's transcripts (the
// `review-<tier>.json` written beside the review page) and the review sheet
// the page downloaded, and prints the summary: HOME's automated result and
// the owner's ratings side by side, never mixed, with the answers that
// passed every check yet were rated partly or not useful. Ratings, counts
// and scenario keys only: no answer, question or feedback text is printed.
// Local files only: no database, key or network.

import { readFileSync } from 'node:fs';
import {
  aggregateReview,
  qualityReviewMarkdown,
  transcriptsDigest,
  type Reviewable,
} from '../../src/kev/evals/quality.ts';

const [transcriptsPath, sheetPath] = process.argv.slice(2);
if (!transcriptsPath || !sheetPath) {
  console.error(
    'usage: node scripts/kev-live/quality-review.mts <review-fast.json> <review sheet.json>',
  );
  process.exit(2);
}
try {
  const transcripts = JSON.parse(readFileSync(transcriptsPath, 'utf8')) as Reviewable[];
  const sheet: unknown = JSON.parse(readFileSync(sheetPath, 'utf8'));
  const review = aggregateReview(transcripts, transcriptsDigest(transcripts), sheet);
  process.stdout.write(qualityReviewMarkdown(review));
} catch (e) {
  console.error(e instanceof Error ? e.message : 'review: unreadable input');
  process.exit(1);
}
