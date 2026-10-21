import 'server-only';

// The scenario dataset's format (M8 contract §12.1, §12.2; D18). Synthetic
// only: the fixture family on Wednesday 14 October 2026, 07:03 (§15.6).
//
// A scenario names its asker, `now`, the question (and any follow-ups), and
// what must and must not happen: the outcome and decline code, the tools
// called and not called, the records that must and must not be cited, and
// strings that must never appear. Those expectations are the same for every
// layer. The `script` is layer 2's alone: what the scripted model does on
// each call, so the orchestrator, tools, validator and stores can be
// exercised deterministically in every CI run, including a model that
// misbehaves (follows an injected instruction, claims availability,
// fabricates) so that the code-enforced checks are what is tested. Package
// 5's live runner ignores `script` and asks the real models.
//
// Pure data and types: no imports from the database, the app or a provider
// (lead and phrase identifiers are strings here; the checker holds them).

export const SCENARIO_CLASSES = [
  'realistic',
  'injection',
  'privacy',
  'sensitive',
  'availability',
  'fabrication',
  'out_of_scope',
  'routing',
] as const;
export type ScenarioClass = (typeof SCENARIO_CLASSES)[number];

/** Records of the fixture a scenario may name (resolved by the harness to ids). */
export const FIXTURE_KEYS = [
  'sam',
  'alex',
  'milo',
  'isla',
  'nana',
  'swimming',
  'football',
  'board',
  'interviews',
  'birthday',
  'fence',
  'garage',
  'paint',
  'light',
  'note',
  'dinosaurs',
  'bins',
  // Package 5B: the injected projects, read by id so their summaries reach the model.
  'shed',
  'garden',
] as const;
export type FixtureKey = (typeof FIXTURE_KEYS)[number];

/**
 * A citation, symbolically: a fixture record (an occurrence with its `at`),
 * a forecast day, or the first record in this call's tool results whose
 * JSON contains `find` (for records whose ids are keys only a tool knows:
 * conflicts, insights, gaps).
 */
export type RefSpec =
  | { fixture: FixtureKey; at?: string }
  | { forecast: string }
  /** The first returned record whose JSON holds the text (or every text given), optionally of a type. */
  | { find: string | string[]; type?: string };

/**
 * An absence's or count's scope (contract §8.1, as amended by the owner,
 * ADR 0012 §46): people by fixture key.
 */
export type ScopeSpec = {
  of: 'agenda' | 'conflicts' | 'forecast';
  from?: string;
  to?: string;
  people?: FixtureKey[];
  part?: 'morning' | 'afternoon' | 'evening';
  else?: boolean;
};

/** A fact block of a scripted plan: a record (by RefSpec) with fields to show, or an absence or count. */
export type FactSpec =
  { record: RefSpec; show?: string[] } | { absence: ScopeSpec } | { count: ScopeSpec };

/**
 * A scripted answer plan: the model's lead and view, by HOME's catalogue
 * identifiers (src/kev/answer/catalogue.ts), and its selections. `words`:
 * a misbehaving model that writes its own sentence in the lead's place (the
 * provider's schema forbids it; the checker refuses it as `answer.schema`).
 */
export type PlanSpec = {
  lead: string;
  words?: string;
  facts: FactSpec[];
  view?: { type: string; phrase: string; about: number[] };
};

/**
 * One scripted model call. Tool inputs may name a fixture id as `$key`
 * (`{ project_id: '$fence' }`).
 */
export type StepSpec =
  | { tools: [string, Record<string, unknown>][] }
  | { plan: PlanSpec }
  | { decline: string }
  | { text: string }
  | { refusal: true };

export type TurnSpec = {
  question: string;
  script: StepSpec[];
  /** This turn's instant, when it differs from the scenario's (a follow-up across midnight). */
  now?: string;
  /** The adult cleared the conversation before this turn (a follow-up after Clear). */
  clearBefore?: true;
};

/**
 * The family questions the evaluation covers (the owner's Package 5B brief):
 * each scenario names the ones it exercises, so coverage is counted from the
 * dataset. `failure_recovery` is covered by layer 2's orchestrator suite
 * (contract §12.3: provider errors, timeouts, refusals and drops are
 * scripted, never induced live).
 */
export const TOPICS = [
  'everyday',
  'agenda',
  'conflicts',
  'tasks_projects',
  'people',
  'weather_calendars',
  'availability_language',
  'continuity',
  'ambiguous',
  'missing_information',
  'privacy',
  'injection',
  'fabrication',
  'authority',
  'escalation',
  'failure_recovery',
] as const;
export type Topic = (typeof TOPICS)[number];

/**
 * A starting state other than the fixture's default, applied before the
 * scenario and undone after it: the forecast fetched 30 hours earlier
 * (`old_forecast`), or no home location configured (`no_location`).
 */
export const SCENARIO_STATES = ['old_forecast', 'no_location'] as const;
export type ScenarioState = (typeof SCENARIO_STATES)[number];

export type Expectations = {
  outcome: 'answer' | 'declined' | 'fallback' | 'refused' | 'error';
  decline?: string;
  /** Tools the final turn called (each at least once). */
  toolsCalled?: string[];
  toolsNotCalled?: string[];
  mustCite?: RefSpec[];
  mustNotCite?: RefSpec[];
  /** Never in anything shown or stored (events, Kev's stored message). */
  neverShown?: string[];
  /** The code's sentences the answer must carry (§8.4). */
  limits?: string[];
  /**
   * The answer showed its validated facts with HOME's lead because the
   * model's own words failed (§8.5, as amended): true or false when it matters.
   */
  salvaged?: boolean;
  /** Text that must be shown (in the lead or a rendered block). */
  shows?: string[];
  /**
   * The answer cites this one conflict, by the conflict engine's own key
   * (`{rule}:{person}:{eventA}.{eventB}:{span}`): as a conflict block or as
   * HOME's insight about it, which carries the same key. Any other conflict
   * or insight does not count (ADR 0012 §71).
   */
  citesConflict?: { person: FixtureKey; between: [FixtureKey, FixtureKey] };
  /**
   * Records the answer may cite besides `mustCite` (Package 5B's relevance
   * diagnostic): a cited record in neither is counted as not asked for. A
   * diagnostic only, never a pass condition.
   */
  mayCite?: RefSpec[];
  /** On the fast configuration only: whether the turn moved to deep. */
  escalated?: boolean;
  /**
   * Record text that reaches the last turn's requests only inside an
   * `untrusted_text` value: in tool results, the bundle and replayed earlier
   * answers alike (I-7). Each must appear there at least once.
   */
  onlyLabelled?: string[];
};

export type Scenario = {
  id: string;
  class: ScenarioClass;
  /** The adversarial class it exercises, or what it shows. */
  note: string;
  /**
   * What an acceptable answer looks like, in words, for the owner's
   * transcript review (layer 4). Never checked by code: the checks are the
   * expectations.
   */
  acceptable?: string;
  asker: 'sam' | 'alex';
  /** An instant with the home offset; the fixture's `now` unless stated. */
  now: string;
  /** Earlier turns, then the scored question last. */
  turns: TurnSpec[];
  expect: Expectations;
  /** The configurations it runs on (default both; escalation is fast's alone). */
  tiers?: ('fast' | 'deep')[];
  /** The family questions it covers (`TOPICS`). */
  topics?: Topic[];
  /** A starting state other than the default fixture. */
  state?: ScenarioState;
};

/** A class's topic when a scenario names none. */
const CLASS_TOPICS: Readonly<Record<ScenarioClass, Topic>> = {
  realistic: 'everyday',
  injection: 'injection',
  privacy: 'privacy',
  sensitive: 'privacy',
  availability: 'availability_language',
  fabrication: 'fabrication',
  out_of_scope: 'authority',
  routing: 'escalation',
};

/** The topics a scenario covers: those it names, or its class's. */
export function topicsOf(s: Scenario): Topic[] {
  return s.topics && s.topics.length > 0 ? s.topics : [CLASS_TOPICS[s.class]];
}
