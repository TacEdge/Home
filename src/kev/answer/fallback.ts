import 'server-only';
import type { LIMIT_CODES } from '@/domain/kev-bookkeeping/schema';
import type { Ref, RefType } from '../tools/types';
import { FALLBACK_LEAD, FALLBACK_WITH_ROWS } from './language';
import { fullKeyOf, type Ledger } from './ledger';
import { forecastFetchedAt, pickEntry, renderRecord } from './render';
import { MAX_FACTS, type AnswerBlock } from './schema';
import type { RenderedAnswer, Shown } from './validate';

// The safe fallback and the sentences code adds (M8 contract §8.4, §8.5;
// owner amendment, ADR 0012 §46). Both are built by code from the ledger
// and closed codes, never by the model: the fallback's lead is fixed copy
// and its rows are the records the attempt's tools returned, each rendered
// by HOME's renderer from its own fields (at most ten); the code-added
// sentences are limit codes the screen renders as fixed text (LIMIT_TEXT).

export type LimitCode = (typeof LIMIT_CODES)[number];

/** Row kinds worth showing as "what HOME has that I looked at". */
const ROW_TYPES: ReadonlySet<RefType> = new Set([
  'event',
  'task',
  'project',
  'note',
  'conflict',
  'insight',
  'gap',
  'forecast',
  'context',
  'calendar',
]);

/**
 * The fallback (§8.5): "I can't answer that reliably right now. Here's what
 * HOME has that I looked at." with the ledger's records as rendered rows:
 * what this attempt's tools returned, or, when no tool ran, today's records
 * from the bundle; the lead sentence alone when there is nothing to show.
 * The rejected plan's words are never part of it.
 */
export function buildFallback(ledger: Ledger, now: Date): RenderedAnswer {
  const fromTools = ledger.toolRefs().filter((r) => ROW_TYPES.has(r.type));
  const rows =
    fromTools.length > 0
      ? fromTools
      : ledger.entries
          .filter((e) => e.source === 'bundle' && (e.ref.type === 'event' || e.ref.type === 'task'))
          .map((e) => e.ref);
  const seen = new Set<string>();
  const blocks: AnswerBlock[] = [];
  const types = new Set<RefType>();
  let gapsPartial = false;
  let forecastAt: string | undefined;
  for (const r of rows) {
    if (blocks.length === MAX_FACTS) break;
    const k = fullKeyOf(r);
    if (seen.has(k)) continue;
    seen.add(k);
    const out = renderRecord(
      { kind: r.type, ref: r, show: [] },
      { ledger, now, timeZone: ledger.timeZone },
    );
    if (!out.ok) continue;
    blocks.push({ kind: 'fact', text: out.text, cites: out.cites });
    types.add(r.type);
    if (r.type === 'gap' && ledger.resolve(r).some((e) => e.context.gapCoverage === 'partial'))
      gapsPartial = true;
    if (r.type === 'forecast' && !forecastAt) {
      const e = pickEntry(ledger.resolve(r), 'forecast');
      if (e && forecastFetchedAt(e)) forecastAt = e.context.fetchedAt!;
    }
  }
  const cites: Ref[] = blocks.flatMap((b) => b.cites);
  return {
    say: blocks.length > 0 ? FALLBACK_WITH_ROWS : FALLBACK_LEAD,
    blocks,
    cites,
    shown: { types, summaries: new Set(), gapsPartial, ...(forecastAt ? { forecastAt } : {}) },
  };
}

/** What code knows of the reader's calendars for §8.4 (from the bundle's freshness and the reads). */
export type Coverage = {
  /** A visible calendar is stale, failed or never refreshed. */
  calendarsUnhealthy: boolean;
  /** The reader can see no calendar at all. */
  noCalendars: boolean;
  /** A `get_gaps` read this attempt reported coverage `unknown`. */
  gapsUnknown: boolean;
};

/** Blocks that rest on calendar records (§8.4, amended). */
const CALENDAR_RECORDS: readonly RefType[] = ['event', 'conflict', 'gap', 'insight'];
/**
 * Statements over what calendars hold (final review, minors): an absence or
 * count over the agenda or overlaps, and a search's "nothing has a matching
 * title" (a search reads events' titles too). Each is qualified like a cited
 * event: "As far as HOME knows." with a stale calendar, the coverage
 * sentence with none at all.
 */
const CALENDAR_SUMMARIES = ['agenda', 'conflicts', 'search'] as const;

/**
 * The code's sentences for what an answer shows (§8.4), as limit codes. The
 * model neither chooses nor removes them (V16). Run on every outcome that
 * shows records, the safe fallback's rows included (I-15).
 * - any gap: M7's limit sentence;
 * - a record from a calendar (an event, a conflict, a gap, an insight) or an
 *   absence or count over the agenda or overlaps, while a visible calendar
 *   is stale, failed or never refreshed, or a gap from a partly covered
 *   read: "As far as HOME knows." (records do not carry their calendar, so
 *   this is said whenever such a calendar exists: conservative);
 * - the forecast: its time and credit;
 * - coverage `unknown` (no calendar at all, or a gap read that said so) with
 *   an event, a gap or an agenda absence or count: "HOME has no calendar
 *   connected…".
 */
export function limitsFor(shown: Shown, coverage: Coverage): LimitCode[] {
  const has = (t: RefType) => shown.types.has(t);
  const summaries = CALENDAR_SUMMARIES.some((k) => shown.summaries.has(k));
  const calendarFacts = CALENDAR_RECORDS.some(has) || summaries;
  const out: LimitCode[] = [];
  if (has('gap')) out.push('gap_limit');
  if ((calendarFacts && coverage.calendarsUnhealthy) || shown.gapsPartial)
    out.push('calendar_stale');
  if (has('forecast') || shown.forecastAt) out.push('forecast_credit');
  if (
    (has('event') || has('gap') || has('conflict') || summaries) &&
    (coverage.noCalendars || (has('gap') && coverage.gapsUnknown))
  )
    out.push('coverage_unknown');
  return out;
}
