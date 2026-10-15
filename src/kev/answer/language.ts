import 'server-only';

// Kev's fixed, code-owned language (M8 contract §3.2, §8.4, §8.6, §9.9,
// §11.3; ADR 0012 §8). Every decline, error, refusal, fallback, progress
// line and code-added sentence Kev shows is one of these strings, chosen by
// code from a closed code: never written by the model, never carrying a
// database or provider error, a secret, a schema or a private id. Pure: no
// imports, so tests and the validator share one copy.
//
// The screen lists (M5 §8.1, M6 §5.5, M7 §5.8) and Kev's own list (§8.6)
// apply to everything Kev says; this copy is tested against all four, with
// one exemption: its "can't" is about Kev itself, never about a person (§8.6).

/** What a decline is about: the closed code the model returns (§3.2). */
export const DECLINE_CODES = [
  'external_action',
  'write',
  'memory',
  'private_or_absent',
  'not_kept',
  'not_held',
  'reminder',
] as const;
export type DeclineCode = (typeof DECLINE_CODES)[number];

/** §3.2's templates, verbatim. */
export const DECLINE_TEXT: Readonly<Record<DeclineCode, string>> = Object.freeze({
  external_action: 'I can’t book, send or pay for anything.',
  write: 'I can’t add things yet. Keep in To sort below saves your words for later.',
  memory:
    'I can’t save that. Keep in To sort keeps your words, and you can add it to What Kev knows yourself.',
  private_or_absent:
    'I can only see what HOME shows you, and nothing about that is recorded that you can see.',
  not_kept: 'That’s not something HOME keeps.',
  not_held: 'HOME doesn’t have that.',
  reminder: 'I can’t remind you of anything. Today shows what’s coming up when you look.',
});

/** Declines whose words the adult may want to keep (D6: "Keep in To sort"). */
export const KEEPABLE_DECLINES: ReadonlySet<DeclineCode> = new Set(['write', 'memory']);

/**
 * Why a turn ended without an answer (§9.9, §11.3), as the event stream
 * carries it. `cap_reached`, `provider_unavailable`, `timeout`, `refused`,
 * `bad_response` and `budget_exhausted` are also content v2's stored codes;
 * the rest end a turn before any model ran, so nothing of Kev's is stored.
 */
export const KEV_TURN_ERROR_CODES = [
  'off',
  'invalid_request',
  'rate_limited',
  'turn_in_flight',
  'cap_reached',
  'provider_unavailable',
  'timeout',
  'refused',
  'bad_response',
  'budget_exhausted',
  'not_saved',
] as const;
export type KevTurnErrorCode = (typeof KEV_TURN_ERROR_CODES)[number];

/** §9.9's lines, verbatim where the contract gives them. */
export const ERROR_TEXT: Readonly<Record<KevTurnErrorCode, string>> = Object.freeze({
  off: 'Kev isn’t switched on here.',
  // Not in §9.9's table: a message over 2,000 characters, or blank, is
  // refused before it is stored (§13.4).
  invalid_request: 'Kev can take up to 2,000 characters at a time. Try asking it a shorter way.',
  rate_limited: 'That’s a lot of questions for now. Try again in a little while.',
  turn_in_flight: 'Kev’s still answering.',
  cap_reached: 'I’ve reached this month’s limit. I’ll be back on the 1st.',
  provider_unavailable: 'Kev isn’t answering right now. What you asked is kept here.',
  timeout: 'That took too long. What you asked is kept here.',
  refused: 'I can’t help with that one.',
  // The provider sent something HOME could not use (N16, a malformed stream).
  bad_response: 'Kev isn’t answering right now. What you asked is kept here.',
  // Not shown as an error: a turn out of budget ends with the safe fallback.
  budget_exhausted: 'I can’t answer that reliably right now.',
  // Something failed before the person's words were stored (§9.9's added
  // row, Package 3 review I-4): nothing is kept, and the line says so.
  not_saved: 'Something went wrong and nothing was saved. Try again in a moment.',
});

/** Errors under which the adult may keep their words (D6; §9.9). */
export const KEEPABLE_ERRORS: ReadonlySet<KevTurnErrorCode> = new Set([
  'cap_reached',
  'provider_unavailable',
  'timeout',
  'bad_response',
]);

/** The safe fallback (§8.5): the first sentence alone when the ledger is empty. */
export const FALLBACK_LEAD = 'I can’t answer that reliably right now.';
export const FALLBACK_WITH_ROWS = `${FALLBACK_LEAD} Here’s what HOME has that I looked at.`;

/** The sentences code adds by what an answer cites (§8.4), by content v2's limit codes. */
export const LIMIT_TEXT = Object.freeze({
  gap_limit:
    'This is only what HOME has recorded that you can see. It isn’t a check of anyone’s plans.',
  calendar_stale: 'As far as HOME knows.',
  // `{time}` is the forecast's fetch time, filled by the screen from the cite.
  forecast_credit: 'Forecast as of {time} · Open-Meteo',
  coverage_unknown: 'HOME has no calendar connected, so this is only what’s been entered here.',
} as const);

/** The working line's fixed strings, by tool (§11.3); never model text. */
export const WORKING_TEXT = Object.freeze({
  start: 'Looking at what HOME has…',
  get_today: 'Looking at today…',
  get_agenda: 'Looking at the calendar…',
  get_conflicts: 'Looking for overlaps HOME has marked…',
  get_insights: 'Looking at what HOME has noticed…',
  get_tasks: 'Looking at the tasks…',
  get_projects: 'Looking at the projects…',
  get_people: 'Looking at the people in HOME…',
  get_context: 'Looking at What Kev knows…',
  get_calendar_health: 'Checking the calendars…',
  get_weather: 'Checking the forecast…',
  get_gaps: 'Looking at the calendar…',
  search: 'Searching HOME…',
} as const);
export type WorkingLabel = keyof typeof WORKING_TEXT;

/** "Give me a moment…" (KEV.md §5): shown when a turn moves to deep. */
export const ESCALATED_TEXT = 'Give me a moment…';

// ---------------------------------------------------------------------------
// The forbidden lists (§8.3 rule 7, §8.6), as whole words, case-insensitive.
// Each entry is a phrase; `'` stands for either apostrophe.

/** M5 contract §8.1. */
export const M5_FORBIDDEN = [
  'needs',
  'need',
  'needs you',
  "nobody's down",
  'who?',
  'lift',
  'pick up',
  'drop off',
  'taking',
  'driving',
  'free',
  'available',
  'out',
  'easy',
  'busy',
  'full',
  'calm',
  'covered',
  'sorted',
  'nothing needs',
  'should',
  'probably',
  'nothing prepared',
] as const;

/** M6 contract §5.5. */
export const M6_FORBIDDEN = [
  'packed',
  'steady',
  'clear',
  'quiet',
  'stressful',
  'overwhelming',
  'away',
  'unavailable',
  'in two places',
  'double-booked',
  "can't",
  'clash',
  'worth deciding',
] as const;

/** M7 contract §5.8 ("likely" only in the band phrase "rain likely"). */
export const M7_FORBIDDEN = [
  'free',
  'available',
  'nothing on',
  'everyone can',
  'both of you',
  'you could',
  'should',
  'a good time',
  'good day',
  'good for',
  'best',
  'ideal',
  'perfect',
  'nice',
  'great',
  'fine',
  'mild',
  'lovely',
  'chance to',
  'opportunity',
  'room for',
  'fits',
  'suitable',
  'recommend',
  'window',
  'out of date',
  'probably',
  'likely',
] as const;

/** Kev's own list (§8.6), filler aside (rule 15 has its own code). */
export const KEV_FORBIDDEN = [
  "i've added",
  "i've booked",
  "i've sent",
  "i've saved",
  "i've scheduled",
  "i'll remind",
  "i'll let",
  "i'll remember",
  'i remember',
  'noted',
  'definitely',
  'for sure',
  'guaranteed',
  'stressed',
  'tired',
  'upset',
  'worried',
  'anxious',
  'struggling',
  'behind',
] as const;

/** Corporate filler (§8.3 rule 15; KEV-AGENT-MODEL §4). */
export const FILLER = [
  'great question',
  'certainly',
  'absolutely',
  "i'd be happy to",
  'is there anything else',
  'happy to help',
] as const;

/** Every forbidden phrase, once. */
export const FORBIDDEN_PHRASES: readonly string[] = [
  ...new Set<string>([...M5_FORBIDDEN, ...M6_FORBIDDEN, ...M7_FORBIDDEN, ...KEV_FORBIDDEN]),
];

/** Apostrophes and dashes as one form, so a list entry matches either typing. */
export function normalisePunctuation(s: string): string {
  return s.replace(/[‘’ʼ]/g, "'").replace(/[‐‑]/g, '-');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole-word, case-insensitive pattern for a phrase. */
export function phrasePattern(phrase: string): RegExp {
  const body = escape(phrase).replace(/'/g, "'");
  const start = /^[a-z0-9]/i.test(phrase) ? "(?<![a-z0-9'-])" : '';
  const end = /[a-z0-9]$/i.test(phrase) ? "(?![a-z0-9'-])" : '';
  return new RegExp(`${start}${body}${end}`, 'i');
}

const FORBIDDEN_PATTERNS = FORBIDDEN_PHRASES.map((p) => ({ phrase: p, re: phrasePattern(p) }));

/** The forbidden phrases a text contains (whole words; `rain likely` is M7's band phrase). */
export function forbiddenIn(text: string): string[] {
  const t = normalisePunctuation(text).replace(/\brain likely\b/gi, ' ');
  return FORBIDDEN_PATTERNS.filter((f) => f.re.test(t)).map((f) => f.phrase);
}

/** Every fixed string above, for the copy test (§15.1, "Forbidden phrases"). */
export function fixedCopy(): string[] {
  return [
    ...Object.values(DECLINE_TEXT),
    ...Object.values(ERROR_TEXT),
    FALLBACK_LEAD,
    FALLBACK_WITH_ROWS,
    ...Object.values(LIMIT_TEXT),
    ...Object.values(WORKING_TEXT),
    ESCALATED_TEXT,
  ];
}
