import { createHash } from 'node:crypto';
import { z } from 'zod';

// Product quality (M8 Package 5C; ADR 0012 §58; docs/m8/M8-QUALITY-RUBRIC.md):
// the rubric, the owner's review sheet and its summary. The question it
// serves: would this answer genuinely help the family understand, organise
// or act on something?
//
// Three kinds of evidence, kept apart (contract §12.3):
// - deterministic requirements, proven by HOME's code in every CI run;
// - model measurements, finite live samples against §12.3's existing
//   targets (none added or changed here);
// - the owner's judgement of usefulness, clarity and tone, recorded by a
//   person and never by code or a model.
// The automated check never fills a human rating, and a human rating never
// changes the automated result. Nothing here judges usefulness itself.
//
// No imports but zod and node:crypto, so the review command
// (scripts/kev-live/quality-review.mts) runs under plain Node.

export type Evidence = Readonly<{
  /** What HOME's code guarantees in every run (layers 1–2), with the contract's rows. */
  deterministic: string;
  /** What live runs measure, against §12.3's existing targets (or "none"). */
  measured: string;
  /** What only the owner can judge, and the rating that records it. */
  human: string;
}>;

export type RubricDimension = Readonly<{
  id: string;
  name: string;
  /** The reviewer's question. */
  question: string;
  evidence: Evidence;
}>;

/** The seven dimensions. No threshold here is new: each cites the contract's own. */
export const RUBRIC: readonly RubricDimension[] = Object.freeze([
  {
    id: 'correct',
    name: 'Factual correctness',
    question: 'Is everything it says true to what HOME holds?',
    evidence: {
      deterministic:
        'Every fact is rendered by code from a record a tool returned this turn; times, dates, names and counts come from the records (V1–V18). A fabrication shown is a hard release gate: 0 observed (§12.3).',
      measured:
        'Factual correctness on the realistic scenarios ≥ 95% (E1): required records cited, nothing forbidden.',
      human: 'Usefulness, with feedback: anything misleading even though each fact is true.',
    },
  },
  {
    id: 'grounded',
    name: 'Grounding and citations',
    question: 'Does each fact point to the record it comes from, and only that?',
    evidence: {
      deterministic:
        'Every fact cites what a read returned; a citation no read returned is refused (V-rules; fabrication.forged_citation).',
      measured:
        'Required and forbidden citations, within factual correctness (E1); the relevance diagnostic (reported, no threshold).',
      human: 'Usefulness: are the cited records the ones the question is about?',
    },
  },
  {
    id: 'relevant',
    name: 'Relevance',
    question: 'Does it answer the question asked, and nothing else?',
    evidence: {
      deterministic: 'None: relevance is not provable by code.',
      measured:
        'Relevance diagnostic (records cited that the scenario neither requires nor allows; reported only) and tool selection ≥ 90% (a diagnostic, §12.3).',
      human: 'Usefulness.',
    },
  },
  {
    id: 'useful',
    name: 'Practical usefulness',
    question: 'Would this genuinely help the family understand, organise or act on something?',
    evidence: {
      deterministic: 'None.',
      measured:
        'None. Automated signals (a fallback, a salvage, no facts, extra citations) point the reviewer at candidates; they never decide.',
      human: 'Useful / Partly useful / Not useful.',
    },
  },
  {
    id: 'clear',
    name: 'Clarity and conciseness',
    question: 'Is it quick to read and easy to act on, with nothing padded?',
    evidence: {
      deterministic:
        'The lead is a catalogue sentence; at most ten facts and one view (§8.1); Kev’s view is only in its marked block (E2).',
      measured: 'None.',
      human: 'Clear / Needs refinement.',
    },
  },
  {
    id: 'tone',
    name: 'Natural, appropriate tone',
    question: 'Does it sound like Kev: warm, calm, plain NZ English, never pushy?',
    evidence: {
      deterministic:
        'Kev chooses catalogue leads; words the model writes itself are refused (owner decisions 6–8, ADR 0012 §46).',
      measured: 'None.',
      human: 'Natural / Awkward.',
    },
  },
  {
    id: 'honest',
    name: 'Honest uncertainty and limitations',
    question: 'Does it say plainly what HOME does not know, without hedging or overclaiming?',
    evidence: {
      deterministic:
        'Limit sentences, the forecast’s time and credit, HOME’s fixed “not sure” and the decline templates are code’s (§8.4); never availability (E2, E6).',
      measured:
        'Declines ≥ 95% (E7); old, missing and beyond-horizon forecasts said as such (E4); refusals investigated (a diagnostic).',
      human: 'Usefulness, with feedback.',
    },
  },
] satisfies RubricDimension[]);

// ---------------------------------------------------------------------------
// The owner's ratings.

export const USEFULNESS = ['useful', 'partly_useful', 'not_useful'] as const;
export const CLARITY = ['clear', 'needs_refinement'] as const;
export const TONE = ['natural', 'awkward'] as const;
export type Usefulness = (typeof USEFULNESS)[number];

export const RATING_LABELS: Readonly<Record<string, string>> = Object.freeze({
  useful: 'Useful',
  partly_useful: 'Partly useful',
  not_useful: 'Not useful',
  clear: 'Clear',
  needs_refinement: 'Needs refinement',
  natural: 'Natural',
  awkward: 'Awkward',
});

/** A transcript's key: scenario, tier configuration and repeat. */
export const TRANSCRIPT_KEY = /^[a-z_]+\.[a-z0-9_]+@(fast|deep)#[1-9][0-9]?$/;
export const FEEDBACK_MAX = 500;

const score = z
  .object({
    key: z.string().regex(TRANSCRIPT_KEY),
    usefulness: z.enum(USEFULNESS).optional(),
    clarity: z.enum(CLARITY).optional(),
    tone: z.enum(TONE).optional(),
    feedback: z.string().trim().min(1).max(FEEDBACK_MAX).optional(),
  })
  .strict();

/**
 * The review sheet the review page downloads: the owner's ratings for one
 * set of transcripts (bound to it by digest). Human judgement only: it has
 * no field for an automated result.
 */
export const reviewSheetSchema = z
  .object({
    format: z.literal('home-kev-quality-review'),
    version: z.literal(1),
    mode: z.enum(['scripted', 'live']),
    transcripts: z.string().regex(/^[0-9a-f]{64}$/),
    scores: z.array(score).max(500),
  })
  .strict();
export type ReviewSheet = z.output<typeof reviewSheetSchema>;
export type Score = z.output<typeof score>;

/** What the summary needs of a transcript (src/kev/evals/transcript.ts). */
export type Reviewable = Readonly<{
  key: string;
  scenario: string;
  mode: 'scripted' | 'live';
  review: Readonly<{ category: string }> | null;
  automated: Readonly<{ pass: boolean; failed: readonly string[] }>;
  signals: readonly string[];
}>;

/** The digest that binds a review sheet to its transcripts. */
export function transcriptsDigest(transcripts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(transcripts)).digest('hex');
}

type Counts<K extends string> = Readonly<Record<K | 'unrated', number>>;

export type QualityReview = Readonly<{
  mode: 'scripted' | 'live';
  transcripts: number;
  reviewed: number;
  /** HOME's checker, from the transcripts alone: never from a rating. */
  automated: Readonly<{ n: number; passed: number; failed: number }>;
  /** The owner's ratings, from the sheet alone: never from the checker. */
  human: Readonly<{
    usefulness: Counts<Usefulness>;
    clarity: Counts<(typeof CLARITY)[number]>;
    tone: Counts<(typeof TONE)[number]>;
    feedback: number;
  }>;
  /** Usefulness by the review set's category. */
  byCategory: Readonly<Record<string, Counts<Usefulness>>>;
  /** Correct but not useful: the checker passed, the owner rated it partly or not useful. */
  correctButNotUseful: readonly string[];
  /** The checker failed it, yet the owner found it useful: worth a look at the expectations. */
  failedButUseful: readonly string[];
  /** Automated signals on answers the owner rated, by signal: how often each went with "useful". */
  signals: Readonly<Record<string, Readonly<{ rated: number; useful: number }>>>;
}>;

function count<K extends string>(keys: readonly K[], values: (K | undefined)[]): Counts<K> {
  const out = Object.fromEntries([...keys, 'unrated'].map((k) => [k, 0])) as Record<
    K | 'unrated',
    number
  >;
  for (const v of values) out[v ?? 'unrated'] += 1;
  return Object.freeze(out);
}

/**
 * The owner's sheet against its transcripts. Refuses a sheet for other
 * transcripts (digest or mode), a key not among them, or a key rated twice.
 * The automated and human columns are computed from separate inputs.
 */
export function aggregateReview(
  transcripts: readonly Reviewable[],
  digest: string,
  input: unknown,
): QualityReview {
  const sheet = reviewSheetSchema.parse(input);
  if (sheet.transcripts !== digest)
    throw new Error('review: the sheet is for a different set of transcripts');
  const byKey = new Map(transcripts.map((t) => [t.key, t]));
  const scores = new Map<string, Score>();
  for (const s of sheet.scores) {
    const t = byKey.get(s.key);
    if (!t) throw new Error(`review: ${s.key} is not one of the transcripts`);
    if (t.mode !== sheet.mode) throw new Error('review: the sheet’s mode is not the transcripts’');
    if (scores.has(s.key)) throw new Error(`review: ${s.key} is rated twice`);
    scores.set(s.key, s);
  }
  const rated = transcripts.map((t) => ({ t, s: scores.get(t.key) }));
  const usefulOf = (k: string) => scores.get(k)?.usefulness;
  const byCategory: Record<string, Counts<Usefulness>> = {};
  for (const c of [...new Set(transcripts.flatMap((t) => (t.review ? [t.review.category] : [])))])
    byCategory[c] = count(
      USEFULNESS,
      transcripts.filter((t) => t.review?.category === c).map((t) => usefulOf(t.key)),
    );
  const signals: Record<string, { rated: number; useful: number }> = {};
  for (const { t, s } of rated)
    if (s?.usefulness)
      for (const g of t.signals) {
        const e = (signals[g] ??= { rated: 0, useful: 0 });
        e.rated += 1;
        if (s.usefulness === 'useful') e.useful += 1;
      }
  return Object.freeze({
    mode: sheet.mode,
    transcripts: transcripts.length,
    reviewed: rated.filter(({ s }) => s && (s.usefulness || s.clarity || s.tone)).length,
    automated: Object.freeze({
      n: transcripts.length,
      passed: transcripts.filter((t) => t.automated.pass).length,
      failed: transcripts.filter((t) => !t.automated.pass).length,
    }),
    human: Object.freeze({
      usefulness: count(
        USEFULNESS,
        rated.map(({ s }) => s?.usefulness),
      ),
      clarity: count(
        CLARITY,
        rated.map(({ s }) => s?.clarity),
      ),
      tone: count(
        TONE,
        rated.map(({ s }) => s?.tone),
      ),
      feedback: rated.filter(({ s }) => s?.feedback).length,
    }),
    byCategory: Object.freeze(byCategory),
    correctButNotUseful: Object.freeze(
      rated
        .filter(
          ({ t, s }) =>
            t.automated.pass &&
            (s?.usefulness === 'partly_useful' || s?.usefulness === 'not_useful'),
        )
        .map(({ t }) => t.key),
    ),
    failedButUseful: Object.freeze(
      rated
        .filter(({ t, s }) => !t.automated.pass && s?.usefulness === 'useful')
        .map(({ t }) => t.key),
    ),
    signals: Object.freeze(signals),
  });
}

const row = (counts: Readonly<Record<string, number>>) =>
  Object.entries(counts)
    .map(([k, v]) => `${RATING_LABELS[k] ?? 'Not rated'} ${v}`)
    .join(' · ');

/** The review's summary, for the owner. Ratings and keys only: no answer, question or feedback text. */
export function qualityReviewMarkdown(q: QualityReview): string {
  return [
    `# Kev answer quality: owner review (${q.mode})`,
    '',
    q.mode === 'scripted'
      ? '_Scripted transcripts: the answers were chosen by hand-written scripts. These ratings judge HOME’s rendering and the scripts, not a model’s quality._'
      : '_Live transcripts: synthetic scenarios answered by the real model on the evaluation key._',
    '',
    `${q.reviewed} of ${q.transcripts} transcripts rated.`,
    '',
    '## Automated correctness (HOME’s checker)',
    '',
    `${q.automated.passed} passed, ${q.automated.failed} failed, of ${q.automated.n}. Computed from the transcripts; no rating changes it.`,
    '',
    '## The owner’s judgement',
    '',
    `- Usefulness: ${row(q.human.usefulness)}`,
    `- Clarity: ${row(q.human.clarity)}`,
    `- Tone: ${row(q.human.tone)}`,
    `- Written feedback on ${q.human.feedback} transcript(s) (kept in the sheet, not repeated here).`,
    '',
    '| Category | Usefulness |',
    '|---|---|',
    ...Object.entries(q.byCategory).map(([c, v]) => `| ${c} | ${row(v)} |`),
    '',
    '## Where the two disagree',
    '',
    `- **Correct but not useful** (passed every check; rated partly or not useful): ${q.correctButNotUseful.length === 0 ? 'none' : q.correctButNotUseful.join(', ')}.`,
    `- **Failed a check, yet rated useful** (look at the expectations): ${q.failedButUseful.length === 0 ? 'none' : q.failedButUseful.join(', ')}.`,
    '',
    '| Signal | Rated | Rated useful |',
    '|---|---|---|',
    ...Object.entries(q.signals).map(([g, v]) => `| ${g} | ${v.rated} | ${v.useful} |`),
    '',
  ].join('\n');
}
