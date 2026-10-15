import 'server-only';
import type { VALIDATOR_CODES } from '@/domain/kev-bookkeeping/schema';
import { capitalise } from '@/domain/engines/day-facts';
import { isoDateInZone, type IsoDate } from '@/lib/dates';
import type { Ref, RefType } from '../tools/types';
import { renderSummary } from './coverage';
import { SALVAGE_LEAD } from './language';
import { fullKeyOf, type Ledger } from './ledger';
import { normaliseProse, proseViolations } from './prose';
import { daysPhrase, renderRecord } from './render';
import {
  isSummary,
  MAX_CITES,
  parsePlan,
  WHEN,
  type AnswerBlock,
  type AnswerPlan,
  type PlanOf,
  type ScopeKind,
} from './schema';

// The checker (M8 contract §8.3; owner amendment of 2026-10-15, ADR 0012
// §46): pure and deterministic, run on every plan before anything is shown
// or stored as an answer. It no longer reads factual prose. It checks, in
// order:
//  1. the plan's strict schema (`answer.schema`);
//  2. every record block: its ref a member of this attempt's ledger
//     (`cite.unknown`), its kind the record's type and the record renderable
//     from what this attempt read (`fact.kind`), every field asked for
//     carried by that record (`fact.field`); then HOME renders it;
//  3. every absence and count: its scope covered by complete reads of its
//     kind, uncontradicted, `else` only with every record in scope shown
//     (`absence.unsupported`); then HOME renders it;
//  4. Kev's view refers to blocks that exist (`view.about`);
//  5. the lead and the view are fact-free (./prose.ts), `{when}` only when
//     the blocks are dated;
//  6. no sensitive string anywhere (defence in depth; Kev never reads
//     sensitive context, D7).
// What passes is returned rendered: the lead (normalised, `{when}` filled),
// the fact blocks HOME wrote, and the view, with their citations. A plan
// whose only failures are in its lead or view also carries the salvage:
// the same rendered facts with the fixed lead and no view (§8.5).

export type ValidatorCode = (typeof VALIDATOR_CODES)[number];
/** Where a check failed: the lead, the view, a fact block by index, or the plan as a whole. */
export type Where = 'answer' | 'lead' | 'view' | number;
export type Violation = { code: ValidatorCode; where: Where };

export type ValidateInput = {
  /** The model's final output: text (structured output) or the `answer` tool's input. */
  raw: unknown;
  ledger: Ledger;
  now: Date;
  timeZone: string;
  /** The adult's question (for "Yep" on an availability question). */
  question?: string;
  /** Strings that must never appear (Kev never receives sensitive context, D7). */
  sensitive?: readonly string[];
};

/** What a rendered answer shows, for the code's sentences (§8.4). */
export type Shown = {
  types: ReadonlySet<RefType>;
  summaries: ReadonlySet<ScopeKind>;
  /** A gap shown came from a read whose calendars were only partly covered. */
  gapsPartial: boolean;
};

export type RenderedAnswer = {
  say: string;
  blocks: AnswerBlock[];
  cites: Ref[];
  shown: Shown;
};

export type ValidateResult =
  | { ok: true; plan: AnswerPlan; rendered: RenderedAnswer | null }
  | {
      ok: false;
      plan: AnswerPlan | null;
      violations: Violation[];
      /** The rendered facts with the fixed lead and no view, when only the lead or view failed. */
      salvage: RenderedAnswer | null;
    };

const ORDER: readonly ValidatorCode[] = [
  'answer.schema',
  'cite.unknown',
  'fact.kind',
  'fact.field',
  'absence.unsupported',
  'view.about',
  'text.unsafe',
  'markup',
  'prose.time',
  'prose.number',
  'prose.person',
  'prose.record',
  'prose.claim',
  'availability.claim',
  'conflict.unsupported',
  'authority.claim',
  'phrase.forbidden',
  'tone.filler',
  'sensitive.leak',
];

const sortViolations = (v: Violation[]) =>
  v.sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));

/**
 * Checks and renders a plan (above). A decline passes (code renders it).
 * Returns the rendered answer when it passes, or every check it failed,
 * with where (and the salvage when only prose failed).
 */
export function validateAnswer(input: ValidateInput): ValidateResult {
  const plan = parsePlan(input.raw);
  if (!plan)
    return {
      ok: false,
      plan: null,
      violations: [{ code: 'answer.schema', where: 'answer' }],
      salvage: null,
    };
  if ('decline' in plan) return { ok: true, plan, rendered: null };
  return check(plan, input);
}

function check(plan: PlanOf, input: ValidateInput): ValidateResult {
  const { ledger, now, timeZone } = input;
  const out: Violation[] = [];
  const add = (code: ValidatorCode, where: Where) => {
    if (!out.some((v) => v.code === code && v.where === where)) out.push({ code, where });
  };
  const today = isoDateInZone(now, timeZone);
  const ctx = { ledger, now, timeZone };

  // 2. Records first: what they show is what `else` must cover.
  const facts: ({ text: string; cites: Ref[]; dates: IsoDate[] } | null)[] = plan.facts.map(
    () => null,
  );
  const shown = new Set<string>();
  const types = new Set<RefType>();
  let gapsPartial = false;
  plan.facts.forEach((b, i) => {
    if (isSummary(b)) return;
    const r = renderRecord(b, ctx);
    if (!r.ok) return add(r.code, i);
    facts[i] = { text: r.text, cites: r.cites, dates: r.dates };
    for (const c of r.cites) shown.add(fullKeyOf(c));
    types.add(b.kind);
    if (b.kind === 'gap' && ledger.resolve(b.ref).some((e) => e.context.gapCoverage === 'partial'))
      gapsPartial = true;
  });
  // 3. Absence and counts.
  const summaries = new Set<ScopeKind>();
  plan.facts.forEach((b, i) => {
    if (!isSummary(b)) return;
    const r = renderSummary(b, ledger, now, shown);
    if (!r.ok) return add(r.code, i);
    facts[i] = { text: r.text, cites: [], dates: r.dates };
    summaries.add(b.scope.of);
  });
  // 4. The view's blocks.
  const view = plan.view;
  if (
    view &&
    (new Set(view.about).size !== view.about.length ||
      view.about.some((i) => i >= plan.facts.length))
  )
    add('view.about', 'view');

  // 5. The lead and the view, fact-free.
  const showsRecord = plan.facts.some((b) => !isSummary(b));
  const proseOf = (text: string, where: 'lead' | 'view') =>
    proseViolations({
      text,
      ledger,
      where,
      showsRecord,
      ...(input.question !== undefined ? { question: input.question } : {}),
    }).forEach((c) => add(c, where));
  proseOf(plan.lead, 'lead');
  if (view) proseOf(view.text, 'view');
  const days = facts.flatMap((f) => f?.dates ?? []);
  if (plan.lead.includes(WHEN) && days.length === 0) add('prose.time', 'lead');

  // 6. Sensitive strings, anywhere.
  const sensitive = (input.sensitive ?? [])
    .map((s) => s.normalize('NFKC').toLowerCase().trim())
    .filter((s) => s.length >= 4);
  const leaks = (t: string) => sensitive.some((s) => t.normalize('NFKC').toLowerCase().includes(s));
  if (leaks(plan.lead)) add('sensitive.leak', 'lead');
  if (view && leaks(view.text)) add('sensitive.leak', 'view');
  facts.forEach((f, i) => {
    if (f && leaks(f.text)) add('sensitive.leak', i);
  });

  const factsOk = !out.some((v) => typeof v.where === 'number' || v.where === 'answer');
  const render = (lead: string, withView: boolean): RenderedAnswer => {
    const blocks: AnswerBlock[] = facts.map((f) => ({
      kind: 'fact' as const,
      text: f!.text,
      cites: f!.cites,
    }));
    if (withView && view)
      blocks.push({
        kind: 'view',
        text: normaliseProse(view.text),
        cites: uniqueRefs(view.about.flatMap((i) => facts[i]?.cites ?? [])),
      });
    return {
      say: lead,
      blocks,
      cites: uniqueRefs(blocks.flatMap((b) => b.cites)).slice(0, MAX_CITES),
      shown: { types, summaries, gapsPartial },
    };
  };
  if (out.length > 0)
    return {
      ok: false,
      plan,
      violations: sortViolations(out),
      salvage: factsOk ? render(SALVAGE_LEAD, false) : null,
    };
  const lead = normaliseProse(plan.lead);
  const filled = lead.includes(WHEN) ? lead.replace(WHEN, daysPhrase(days, today, 'bare')) : lead;
  const say = lead.startsWith(WHEN) ? capitalise(filled) : filled;
  return { ok: true, plan, rendered: render(say, true) };
}

/** Refs in order, each once. */
export function uniqueRefs(refs: readonly Ref[]): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const r of refs) {
    const k = fullKeyOf(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(
      r.at === undefined ? { type: r.type, id: r.id } : { type: r.type, id: r.id, at: r.at },
    );
  }
  return out;
}

/** The distinct codes of a set of violations, in check order (content v2's `violations`). */
export function codesOf(violations: readonly Violation[]): ValidatorCode[] {
  return ORDER.filter((c) => violations.some((v) => v.code === c));
}

/** Codes a salvage may drop with the lead and view: only ever about the model's own words. */
export const PROSE_CODES: ReadonlySet<ValidatorCode> = new Set<ValidatorCode>([
  'text.unsafe',
  'markup',
  'prose.time',
  'prose.number',
  'prose.person',
  'prose.record',
  'prose.claim',
  'availability.claim',
  'conflict.unsupported',
  'authority.claim',
  'phrase.forbidden',
  'tone.filler',
  'sensitive.leak',
  'view.about',
]);
