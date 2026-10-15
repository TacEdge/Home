import 'server-only';
import type { LIMIT_CODES } from '@/domain/kev-bookkeeping/schema';
import type { Ref } from '../tools/types';
import { FALLBACK_LEAD, FALLBACK_WITH_ROWS } from './language';
import type { Ledger } from './ledger';
import { MAX_CITES } from './schema';

// The safe fallback and the sentences code adds (M8 contract §8.4, §8.5).
// Both are built by code from the ledger and closed codes, never by the
// model: the fallback's lead is fixed copy and its rows are the records the
// attempt's tools returned (the screen renders each as its title and time,
// by template, from HOME's own records); the code-added sentences are
// limit codes the screen renders as fixed text (LIMIT_TEXT).

export type LimitCode = (typeof LIMIT_CODES)[number];

/** Row kinds worth showing as "what HOME has that I looked at". */
const ROW_TYPES: ReadonlySet<Ref['type']> = new Set([
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
 * HOME has that I looked at." with the ledger's records as cited rows: what
 * this attempt's tools returned, or, when no tool ran, today's records from
 * the bundle; the lead sentence alone when there is nothing to show. The
 * rejected answer's text is never part of it.
 */
export function buildFallback(ledger: Ledger): { say: string; cites: Ref[] } {
  const fromTools = ledger.toolRefs().filter((r) => ROW_TYPES.has(r.type));
  const rows =
    fromTools.length > 0
      ? fromTools
      : ledger.entries
          .filter((e) => e.source === 'bundle' && (e.ref.type === 'event' || e.ref.type === 'task'))
          .map((e) => e.ref);
  const seen = new Set<string>();
  const cites: Ref[] = [];
  for (const r of rows) {
    const k = `${r.type}|${r.id}|${r.at ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    cites.push(r);
    if (cites.length === MAX_CITES) break;
  }
  return { say: cites.length > 0 ? FALLBACK_WITH_ROWS : FALLBACK_LEAD, cites };
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

/**
 * The code's sentences for what an answer cites (§8.4), as limit codes. The
 * model neither writes nor removes them: an answer that omits or rewords
 * them changes nothing (V16). Run on every outcome that shows records,
 * the safe fallback's rows included (I-15).
 * - any gap: M7's limit sentence;
 * - an event, or a statement that nothing is recorded, while a visible
 *   calendar is stale, failed or never refreshed: "As far as HOME knows."
 *   (records do not carry their calendar, so this is said whenever such a
 *   calendar exists: conservative);
 * - the forecast: its time and credit;
 * - coverage `unknown` (no calendar at all, or a gap read that said so) with
 *   an event, a gap or a statement of absence: "HOME has no calendar
 *   connected…".
 */
export function limitsFor(
  cites: readonly Ref[],
  coverage: Coverage,
  claims: { absence?: boolean } = {},
): LimitCode[] {
  const has = (t: Ref['type']) => cites.some((c) => c.type === t);
  const absence = claims.absence === true;
  const out: LimitCode[] = [];
  if (has('gap')) out.push('gap_limit');
  if ((has('event') || absence) && coverage.calendarsUnhealthy) out.push('calendar_stale');
  if (has('forecast')) out.push('forecast_credit');
  if (
    (has('event') || has('gap') || absence) &&
    (coverage.noCalendars || (has('gap') && coverage.gapsUnknown))
  )
    out.push('coverage_unknown');
  return out;
}
