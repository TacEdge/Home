import 'server-only';
import type { LeadId, ViewPhraseId, ViewType } from '../answer/catalogue';
import type { FactSpec, RefSpec, StepSpec } from './types';

// The scenarios' shared building blocks (M8 contract §12.2): the scenario
// day's instants, the fixture's recurring occurrences, and the scripted
// model's answer plans (owner amendments, ADR 0012 §46). Pure data.

export const NOW = '2026-10-14T07:03:00+13:00';
export const SAT = '2026-10-17';
export const THU = '2026-10-15';

export const SUN = '2026-10-18';
export const swimming: RefSpec = { fixture: 'swimming', at: `2026-10-14T15:30:00+13:00` };
export const football: RefSpec = { fixture: 'football', at: `${SAT}T09:00:00+13:00` };
/** A scripted answer plan (owner amendment, ADR 0012 §46): a lead id, the facts chosen, a typed view. */
export const plan = (
  lead: LeadId,
  facts: FactSpec[],
  view?: { type: ViewType; phrase: ViewPhraseId; about: number[] },
): StepSpec => ({ plan: { lead, facts, ...(view ? { view } : {}) } });
export const rec = (record: RefSpec, show?: string[]): FactSpec => ({
  record,
  ...(show ? { show } : {}),
});
/** HOME's lead when only the model's words failed (src/kev/answer/language.ts SALVAGE_LEAD). */
export const SALVAGED = 'Here\u2019s what HOME has.';
/** A model that keeps choosing it: enough plans for a fast attempt, its regeneration and a deep attempt's two. */
export const obeys = (
  lead: LeadId,
  facts: FactSpec[],
  view?: { type: ViewType; phrase: ViewPhraseId; about: number[] },
): StepSpec[] => Array.from({ length: 4 }, () => plan(lead, facts, view));
/**
 * A model that keeps writing its own sentence where the lead goes: each
 * attempt reads, then fails twice (fast escalates on two failed answers;
 * the deep attempt reads again and fails twice), so the safe fallback shows
 * the last attempt's reads as rows.
 */
export const obeysInWords = (reads: StepSpec, words: string, facts: FactSpec[]): StepSpec[] => {
  const w: StepSpec = { plan: { lead: 'here_you_go', words, facts } };
  return [reads, w, w, reads, w, w];
};
