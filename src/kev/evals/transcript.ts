import 'server-only';
import type { KevContentV2 } from '@/domain/kev-bookkeeping/schema';
import type { LimitCode } from '../answer/fallback';
import { LIMIT_TEXT } from '../answer/language';
import type { KevEvent } from '../orchestrator';
import type { Ref } from '../tools/types';
import type { Markers, Verdict } from './judge';
import type { Reviewable } from './quality';
import { REVIEW_SET } from './review-set';
import type { TurnRecord } from './summary';
import { topicsOf, type Scenario, type StepSpec } from './types';

// A readable, synthetic transcript of one scenario run (M8 Package 5C;
// ADR 0012 §58), for the owner's review: the synthetic adult's questions,
// the answer HOME showed, its citations with their titles, the reads, how
// the answer check went, time and cost, and HOME's automated verdict. Built
// only from what HOME showed and stored: the stored message holds the
// checked answer alone, so a rejected answer's words are never here, only
// its closed failure codes. Synthetic only, and only in the evaluation's
// own outputs: the scripted evals' output folder, or the live run's
// artefact. Never in the ledger, a log or a committed file.

/** A transcript's own signals: candidates for the reviewer to look at, never a verdict. */
export const SIGNALS = [
  'fallback',
  'salvaged',
  'regenerated',
  'escalated',
  'extra_citations',
  'no_facts',
  'declined',
  'error',
] as const;
export type Signal = (typeof SIGNALS)[number];

/**
 * Why a scripted transcript cannot show a real model's usefulness:
 * `scripted_choice` always (the script chose the records and the lead);
 * `scripted_misbehaviour` when the script misbehaves on purpose (the run
 * shows HOME's check, not an answer); `decline_only` when the script
 * declines without reading; `fixed_text` when what is shown is HOME's own
 * fixed sentence.
 */
export const SCRIPTED_LIMITS = [
  'scripted_choice',
  'scripted_misbehaviour',
  'decline_only',
  'fixed_text',
] as const;
export type ScriptedLimit = (typeof SCRIPTED_LIMITS)[number];

export type Citation = Readonly<{
  type: string;
  id: string;
  at: string | null;
  /** The record's title as the asker can see it now, or what kind of thing it is. */
  label: string;
}>;

export type TranscriptBlock = Readonly<{ text: string; cites: readonly Citation[] }>;

export type TranscriptTurn = Readonly<{
  question: string;
  /** When it was asked, in the home zone. */
  askedAt: string;
  /** The conversation was cleared before this turn. */
  clearedBefore: boolean;
  outcome: string;
  /** The lead shown: the checked one, or HOME's fixed text. */
  say: string | null;
  facts: readonly TranscriptBlock[];
  view: readonly TranscriptBlock[];
  /** The code's sentences shown with the answer (§8.4). */
  limits: readonly string[];
  decline: string | null;
  error: string | null;
  /** Every record the answer cites, once. */
  citations: readonly Citation[];
  tools: readonly Readonly<{
    tool: string;
    ok: boolean;
    code: string | null;
    args: Readonly<Record<string, unknown>>;
    results: number;
  }>[];
  check: Readonly<{
    result: string;
    /** Each answer checked, in order. */
    answers: readonly string[];
    /** Each rejected answer's closed codes, in order: never its words. */
    rejectedCodes: readonly (readonly string[])[];
    regenerations: number;
    escalated: boolean;
    escalation: string | null;
  }>;
  ms: number | null;
  costUsdMicros: string | null;
  modelCalls: number | null;
  toolRounds: number | null;
}>;

export type Transcript = Readonly<
  Reviewable & {
    format: 'home-kev-transcript';
    version: 1;
    class: string;
    topics: readonly string[];
    /** The scenario's description, and what a good answer looks like where it says. */
    note: string;
    acceptable: string | null;
    asker: 'sam' | 'alex';
    tier: 'fast' | 'deep';
    repeat: number;
    review: Readonly<{ category: string; focus: string }> | null;
    turns: readonly TranscriptTurn[];
    automated: Readonly<{
      pass: boolean;
      failed: readonly string[];
      relevance: Readonly<{ cited: number; extra: number }> | null;
    }>;
    signals: readonly Signal[];
    /** Scripted runs only: why the transcript cannot show a real model's usefulness. */
    scriptedLimits: readonly ScriptedLimit[] | null;
  }
>;

export type PlayedForTranscript = Readonly<{
  events: readonly KevEvent[];
  done: Extract<KevEvent, { type: 'done' }>;
  stored: KevContentV2 | null;
  record: TurnRecord;
}>;

export type TranscriptInput = Readonly<{
  scenario: Scenario;
  tier: 'fast' | 'deep';
  repeat: number;
  mode: 'scripted' | 'live';
  turns: readonly PlayedForTranscript[];
  verdict: Verdict;
  relevance: Readonly<{ cited: number; extra: number }> | null;
  /** The cited records the asker can see, by `type:id` (the citations service's titles). */
  cited: ReadonlyMap<string, Readonly<{ title: string | null }>>;
  timeZone: string;
  /** What the asker must never be shown: a transcript holding any of it is refused. */
  markers: Markers;
}>;

/** What a cited thing is, where it has no title of its own. */
const KIND: Readonly<Record<string, string>> = Object.freeze({
  event: 'An event',
  task: 'A task',
  project: 'A project',
  person: 'A person',
  note: 'A note',
  context: 'What Kev knows',
  calendar: 'A calendar',
  conflict: 'An overlap HOME found',
  insight: 'Something HOME flagged',
  gap: 'A stretch with nothing recorded',
  forecast: 'The forecast',
});

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** The day (and stretch) a computed fact's id names: a forecast day, a gap. */
function dayOf(id: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})(?::(\d{2})(\d{2})-(\d{2})(\d{2}))?/.exec(id);
  if (!m) return null;
  const day = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${m[1]}T00:00:00Z`));
  return m[2] ? `${day}, ${m[2]}:${m[3]}–${m[4]}:${m[5]}` : day;
}

function citation(ref: Ref, cited: TranscriptInput['cited'], timeZone: string): Citation {
  const title = cited.get(`${ref.type}:${ref.id}`)?.title ?? null;
  const base = title ?? KIND[ref.type] ?? ref.type;
  const day = title === null ? dayOf(ref.id) : null;
  return Object.freeze({
    type: ref.type,
    id: ref.id,
    at: ref.at ?? null,
    label:
      ref.at && ref.type === 'event'
        ? `${base} · ${when(ref.at, timeZone)}`
        : day
          ? `${base} · ${day}`
          : base,
  });
}

function limitText(code: LimitCode, stored: KevContentV2, timeZone: string): string {
  if (code === 'forecast_credit')
    return LIMIT_TEXT.forecast_credit.replace(
      '{time}',
      stored.forecastAt ? when(stored.forecastAt, timeZone) : 'unknown',
    );
  return LIMIT_TEXT[code];
}

function turnOf(
  t: PlayedForTranscript,
  spec: Scenario['turns'][number],
  s: Scenario,
  input: TranscriptInput,
): TranscriptTurn {
  const { stored, done, record } = t;
  const cite = (r: Ref) => citation(r, input.cited, input.timeZone);
  const error = t.events.find((e) => e.type === 'error');
  const seen = new Set<string>();
  const citations = (stored?.cites ?? []).filter((r) => {
    const k = `${r.type}:${r.id}:${r.at ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const block = (kind: 'fact' | 'view') =>
    (stored?.blocks ?? [])
      .filter((b) => b.kind === kind)
      .map((b) => Object.freeze({ text: b.text, cites: Object.freeze(b.cites.map(cite)) }));
  return Object.freeze({
    question: spec.question,
    askedAt: when(spec.now ?? s.now, input.timeZone),
    clearedBefore: spec.clearBefore === true,
    outcome: done.outcome,
    say: stored ? stored.say : error?.type === 'error' ? error.message : null,
    facts: Object.freeze(block('fact')),
    view: Object.freeze(block('view')),
    limits: Object.freeze(
      stored ? done.limits.map((l) => limitText(l, stored, input.timeZone)) : [],
    ),
    decline: done.decline ?? null,
    error: error?.type === 'error' ? error.code : null,
    citations: Object.freeze(citations.map(cite)),
    tools: Object.freeze(
      (stored?.trace ?? []).map((e) =>
        Object.freeze({
          tool: e.tool,
          ok: e.ok,
          code: e.code ?? null,
          args: Object.freeze({ ...e.args }),
          results: e.resultCount,
        }),
      ),
    ),
    check: Object.freeze({
      result: record.result,
      answers: Object.freeze([...record.answers]),
      rejectedCodes: Object.freeze(
        (stored?.check?.attempts ?? []).flatMap((a) =>
          a.failures.map((f) => Object.freeze([...f])),
        ),
      ),
      regenerations: record.regenerations,
      escalated: record.escalated,
      escalation: record.escalation ?? null,
    }),
    ms: record.ms,
    costUsdMicros: record.costUsdMicros,
    modelCalls: record.modelCalls,
    toolRounds: record.toolRounds,
  });
}

function signalsOf(input: TranscriptInput, last: TranscriptTurn): Signal[] {
  const r = input.turns.at(-1)!.record;
  const out: Signal[] = [];
  if (last.outcome === 'fallback') out.push('fallback');
  if (input.turns.at(-1)!.stored?.salvaged) out.push('salvaged');
  if (input.turns.some((t) => t.record.regenerations > 0)) out.push('regenerated');
  if (r.escalated) out.push('escalated');
  if (input.relevance && input.relevance.extra > 0) out.push('extra_citations');
  if (last.outcome === 'answer' && last.facts.length === 0 && last.view.length === 0)
    out.push('no_facts');
  if (last.outcome === 'declined') out.push('declined');
  if (last.outcome === 'error') out.push('error');
  return out;
}

const declineOnly = (script: readonly StepSpec[]) =>
  script.length === 1 && 'decline' in (script[0] as object);

function scriptedLimitsOf(
  input: TranscriptInput,
  turns: readonly TranscriptTurn[],
): ScriptedLimit[] {
  const out: ScriptedLimit[] = ['scripted_choice'];
  const last = turns.at(-1)!;
  if (turns.some((t) => t.check.answers.includes('fail') || t.outcome === 'fallback'))
    out.push('scripted_misbehaviour');
  if (declineOnly(input.scenario.turns.at(-1)!.script)) out.push('decline_only');
  if (last.outcome === 'fallback' || last.outcome === 'error') out.push('fixed_text');
  return out;
}

/** Refuses a transcript holding anything the asker must never be shown. */
export function assertTranscriptSafe(t: Transcript, markers: Markers): void {
  const json = JSON.stringify(t);
  for (const m of markers.otherAdult)
    if (json.includes(m)) throw new Error(`transcript ${t.key}: the other adult’s record is in it`);
  for (const m of markers.sensitive)
    if (json.includes(m)) throw new Error(`transcript ${t.key}: a sensitive string is in it`);
}

/** The transcript of one scenario run, checked safe before it is returned. */
export function buildTranscript(input: TranscriptInput): Transcript {
  const s = input.scenario;
  if (input.turns.length !== s.turns.length)
    throw new Error(`transcript ${s.id}: ${input.turns.length} turns played of ${s.turns.length}`);
  const turns = Object.freeze(input.turns.map((t, i) => turnOf(t, s.turns[i]!, s, input)));
  const entry = REVIEW_SET.find((e) => e.scenario === s.id);
  const t: Transcript = Object.freeze({
    format: 'home-kev-transcript',
    version: 1,
    key: `${s.id}@${input.tier}#${input.repeat}`,
    scenario: s.id,
    class: s.class,
    topics: Object.freeze(topicsOf(s)),
    note: s.note,
    acceptable: s.acceptable ?? null,
    asker: s.asker,
    mode: input.mode,
    tier: input.tier,
    repeat: input.repeat,
    review: entry ? Object.freeze({ category: entry.category, focus: entry.focus }) : null,
    turns,
    automated: Object.freeze({
      pass: input.verdict.pass,
      failed: Object.freeze([...input.verdict.failed]),
      relevance: input.relevance,
    }),
    signals: Object.freeze(signalsOf(input, turns.at(-1)!)),
    scriptedLimits:
      input.mode === 'scripted' ? Object.freeze(scriptedLimitsOf(input, turns)) : null,
  });
  assertTranscriptSafe(t, input.markers);
  return t;
}

/** The refs a run's stored messages cite, for the citations service. */
export function citedRefs(turns: readonly PlayedForTranscript[]): Ref[] {
  return turns.flatMap((t) => [
    ...(t.stored?.cites ?? []),
    ...(t.stored?.blocks ?? []).flatMap((b) => b.cites),
  ]);
}
