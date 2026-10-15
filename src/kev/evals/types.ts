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
// Pure data and types: no imports from the database, the app or a provider.

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
] as const;
export type FixtureKey = (typeof FIXTURE_KEYS)[number];

/**
 * A citation, symbolically: a fixture record (an occurrence with its `at`),
 * a forecast day, or the first record in this call's tool results whose
 * JSON contains `find` (for records whose ids are keys only a tool knows:
 * conflicts, insights, gaps).
 */
export type RefSpec =
  { fixture: FixtureKey; at?: string } | { forecast: string } | { find: string; type?: string };

export type BlockSpec = { kind: 'fact' | 'view'; text: string; cites: RefSpec[] };

/**
 * One scripted model call. Tool inputs may name a fixture id as `$key`
 * (`{ project_id: '$fence' }`).
 */
export type StepSpec =
  | { tools: [string, Record<string, unknown>][] }
  | { answer: { say: string; cites: RefSpec[]; blocks?: BlockSpec[] } }
  | { decline: string }
  | { text: string }
  | { refusal: true };

export type TurnSpec = { question: string; script: StepSpec[] };

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
  /** On the fast configuration only: whether the turn moved to deep. */
  escalated?: boolean;
};

export type Scenario = {
  id: string;
  class: ScenarioClass;
  /** The adversarial class it exercises, or what it shows. */
  note: string;
  asker: 'sam' | 'alex';
  /** An instant with the home offset; the fixture's `now` unless stated. */
  now: string;
  /** Earlier turns, then the scored question last. */
  turns: TurnSpec[];
  expect: Expectations;
  /** The configurations it runs on (default both; escalation is fast's alone). */
  tiers?: ('fast' | 'deep')[];
};
