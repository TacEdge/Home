import 'server-only';
import type { VALIDATOR_CODES } from '@/domain/kev-bookkeeping/schema';
import { capitalise } from '@/domain/engines/day-facts';
import { isoDateInZone, type IsoDate } from '@/lib/dates';
import type { Ref, RefType } from '../tools/types';
import {
  classifyMessage,
  LEADS,
  SALVAGE_LEAD_ID,
  supports,
  VIEW_PHRASES,
  type AboutBlock,
  type LeadId,
} from './catalogue';
import { renderSummary } from './coverage';
import { fullKeyOf, type Ledger, type LedgerEntry } from './ledger';
import { daysPhrase, isOpening, pickEntry, renderRecord } from './render';
import {
  DEFAULT_SHOW,
  isSummary,
  MAX_CITES,
  parsePlan,
  WHEN,
  type AnswerBlock,
  type AnswerPlan,
  type PlanOf,
  type ScopeKind,
} from './schema';

// The checker (M8 contract §8.3; owner amendments of 2026-10-15, ADR 0012
// §46): pure and deterministic, run on every plan before anything is shown
// or stored as an answer. The model writes no words: its lead and its view
// are identifiers from HOME's catalogue (./catalogue.ts). The checker
// checks, in order:
//  1. the plan's strict schema (`answer.schema`): a lead, type or phrase
//     outside the catalogue is a malformed plan;
//  2. every record block: its ref a member of this attempt's ledger
//     (`cite.unknown`), its kind the record's type and the record renderable
//     from what this attempt read (`fact.kind`), every field asked for
//     carried by that record (`fact.field`); then HOME renders it;
//  3. every absence and count: its scope covered by complete reads of its
//     kind, uncontradicted, `else` only with every record in scope shown
//     (`absence.unsupported`); then HOME renders it;
//  4. the lead is allowed here (`lead.unsupported`): a fact lead beside at
//     least one block (`{when}` only beside a dated one, "here it is" beside
//     exactly one record, "No worries." beside a record, "flagged" beside an
//     overlap or insight HOME flagged), an affirming lead only for a message
//     HOME clearly recognises as informational (deny by default); a response
//     with no blocks is a social lead to a message made only of greetings,
//     thanks, farewells and courtesies, or HOME's "not sure";
//  5. Kev's view refers to blocks that exist (`view.about`) and those
//     blocks support its phrase (`view.unsupported`); never with no blocks;
//  6. no sensitive string in a rendered fact (defence in depth; Kev never
//     reads sensitive context, D7).
// What passes is returned rendered. A plan whose only failures are its lead
// or view, and which shows at least one fact, also carries the salvage: the
// same rendered facts with HOME's fixed lead and no view (§8.5). A plan
// with no facts has no salvage.

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
  /** The adult's message (to withhold leads only; ./catalogue.ts `classifyMessage`). */
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
  /** An opening insight (M7's `open_window.*`) is shown: qualified like a gap (ADR 0012 §47). */
  openings?: boolean;
  /** The fetch time of the forecast shown (stored with the answer: the screen's "as of" time). */
  forecastAt?: string;
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
      /** The rendered facts with the fixed lead and no view, when only the lead or view failed and facts exist. */
      salvage: RenderedAnswer | null;
    };

const ORDER: readonly ValidatorCode[] = [
  'answer.schema',
  'cite.unknown',
  'fact.kind',
  'fact.field',
  'absence.unsupported',
  'lead.unsupported',
  'view.about',
  'view.unsupported',
  'sensitive.leak',
];

const sortViolations = (v: Violation[]) =>
  v.sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));

/**
 * Checks and renders a plan (above). A decline passes (code renders it).
 * Returns the rendered answer when it passes, or every check it failed,
 * with where (and the salvage when only the lead or view failed).
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

/** The lead's words for these blocks: `{when}` filled from their days. */
export function leadText(lead: LeadId, days: readonly IsoDate[], today: IsoDate): string {
  const text = LEADS[lead].text;
  if (!text.includes(WHEN)) return text;
  const filled = text.replace(WHEN, daysPhrase(days, today, 'bare'));
  return text.startsWith(WHEN) ? capitalise(filled) : filled;
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
  const used: (LedgerEntry | null)[] = plan.facts.map(() => null);
  const shown = new Set<string>();
  const types = new Set<RefType>();
  let gapsPartial = false;
  let openings = false;
  let forecastAt: string | undefined;
  plan.facts.forEach((b, i) => {
    if (isSummary(b)) return;
    const r = renderRecord(b, ctx);
    if (!r.ok) return add(r.code, i);
    facts[i] = { text: r.text, cites: r.cites, dates: r.dates };
    used[i] = pickEntry(ledger.resolve(b.ref), b.kind);
    for (const c of r.cites) shown.add(fullKeyOf(c));
    types.add(b.kind);
    if (b.kind === 'gap' && ledger.resolve(b.ref).some((e) => e.context.gapCoverage === 'partial'))
      gapsPartial = true;
    if (isOpening(used[i])) openings = true;
    // The first forecast words shown, from whichever block (a forecast day, a
    // gap's band, an opening's clause), carry the read they are attributed to.
    if (r.forecastAt && !forecastAt) forecastAt = r.forecastAt;
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
  const days = facts.flatMap((f) => f?.dates ?? []);

  // 4. The lead: allowed for these blocks and this message.
  const lead = LEADS[plan.lead];
  const message = classifyMessage(input.question);
  const records = plan.facts.filter((b) => !isSummary(b));
  const n = plan.facts.length;
  const leadOk = (() => {
    if (lead.kind === 'social') return n === 0 && !plan.view && message.social;
    if (lead.kind === 'uncertain') return n === 0 && !plan.view;
    if (n === 0) return false;
    if (lead.when && days.length === 0) return false;
    if (lead.one && !(n === 1 && records.length === 1)) return false;
    if (lead.record && records.length === 0) return false;
    if (lead.flagged && !records.some((b) => b.kind === 'conflict' || b.kind === 'insight'))
      return false;
    if (lead.affirming && !message.informational) return false;
    return true;
  })();
  if (!leadOk) add('lead.unsupported', 'lead');

  // 5. Kev's view: its blocks exist and support its phrase.
  const view = plan.view;
  if (view) {
    if (
      new Set(view.about).size !== view.about.length ||
      view.about.some((i) => i >= plan.facts.length)
    )
      add('view.about', 'view');
    else {
      const about: AboutBlock[] = view.about.map((i) => {
        const block = plan.facts[i]!;
        return {
          block,
          entry: used[i] ?? null,
          show: isSummary(block)
            ? []
            : block.show.length > 0
              ? block.show
              : DEFAULT_SHOW[block.kind],
        };
      });
      const needs = VIEW_PHRASES[view.phrase].support;
      if (
        n === 0 ||
        (needs !== 'none' && view.about.length === 0) ||
        view.about.some((i) => facts[i] === null) ||
        !supports(view.phrase, about, ledger.readerId)
      )
        add('view.unsupported', 'view');
    }
  }

  // 6. Sensitive strings, in what HOME rendered.
  const sensitive = (input.sensitive ?? [])
    .map((s) => s.normalize('NFKC').toLowerCase().trim())
    .filter((s) => s.length >= 4);
  facts.forEach((f, i) => {
    if (f && sensitive.some((s) => f.text.normalize('NFKC').toLowerCase().includes(s)))
      add('sensitive.leak', i);
  });

  const factsOk = !out.some((v) => typeof v.where === 'number' || v.where === 'answer');
  const render = (say: string, withView: boolean): RenderedAnswer => {
    const blocks: AnswerBlock[] = facts.map((f) => ({
      kind: 'fact' as const,
      text: f!.text,
      cites: f!.cites,
    }));
    if (withView && view)
      blocks.push({
        kind: 'view',
        text: VIEW_PHRASES[view.phrase].text,
        cites: uniqueRefs(view.about.flatMap((i) => facts[i]?.cites ?? [])),
      });
    return {
      say,
      blocks,
      cites: uniqueRefs(blocks.flatMap((b) => b.cites)).slice(0, MAX_CITES),
      shown: {
        types,
        summaries,
        gapsPartial,
        openings,
        ...(forecastAt ? { forecastAt } : {}),
      },
    };
  };
  if (out.length > 0)
    return {
      ok: false,
      plan,
      violations: sortViolations(out),
      salvage: factsOk && n > 0 ? render(leadText(SALVAGE_LEAD_ID, days, today), false) : null,
    };
  return { ok: true, plan, rendered: render(leadText(plan.lead, days, today), true) };
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

/** Codes a salvage may drop with the lead and view: only ever about the model's selections of HOME's words. */
export const SALVAGE_CODES: ReadonlySet<ValidatorCode> = new Set<ValidatorCode>([
  'lead.unsupported',
  'view.about',
  'view.unsupported',
]);
