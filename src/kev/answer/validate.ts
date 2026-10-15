import 'server-only';
import type { VALIDATOR_CODES } from '@/domain/kev-bookkeeping/schema';
import type { IsoDate } from '@/lib/dates';
import type { Ref } from '../tools/types';
import { FILLER, forbiddenIn, normalisePunctuation, phrasePattern } from './language';
import { partOf, wordsOf, type DayPart, type Ledger, type LedgerFacts } from './ledger';
import { parseAnswer, type AnswerOf, type KevAnswer } from './schema';

// The grounding check (M8 contract §8.3; matrix rows V1–V16): pure and
// deterministic, run on every answer before anything is shown or stored as
// an answer. Inputs: the model's final output, the attempt's ledger (its
// tool results and the bundle), `now` and the home zone, and (defence in
// depth) any sensitive strings known to the caller.
//
// The boundary, stated plainly: these rules are deterministic checks of
// what a sentence *says* about times, dates, weekdays, parts of the day,
// durations, numbers, names, overlaps, gaps, availability, commitments and
// authority, against the facts its own citations carry, and of its words
// against the screen lists. They are not a proof that every
// natural-language claim is true: a sentence can pass while restating a
// cited fact loosely (a count that happens to equal another cited number,
// a time that belongs to a different cited record of the same sentence, a
// relation to now such as "tomorrow" that the cited record does not fall
// on). What the rules guarantee is that no time, date, number, name, overlap
// or commitment reaches the screen that no cited record carries, that no
// listed phrase does, and that every citation is one this attempt's tools
// (or the bundle) returned. Whole-word matching of short words ("out",
// "free", "clear") will sometimes reject an innocent sentence: that costs a
// regeneration, not a wrong answer (§8.6), and Package 5 measures it.

export type ValidatorCode = (typeof VALIDATOR_CODES)[number];
/** Where a rule failed: the `say` sentence, a block by index, or the answer as a whole. */
export type Where = 'answer' | 'say' | number;
export type Violation = { code: ValidatorCode; where: Where };

export type ValidateInput = {
  /** The model's final output: text (structured output) or the `answer` tool's input. */
  raw: unknown;
  ledger: Ledger;
  now: Date;
  timeZone: string;
  /** Strings that must never appear (rule 16; Kev never receives sensitive context, D7). */
  sensitive?: readonly string[];
};

export type ValidateResult =
  | { ok: true; answer: KevAnswer }
  | { ok: false; answer: KevAnswer | null; violations: Violation[] };

const ORDER: readonly ValidatorCode[] = [
  'answer.schema',
  'cite.unknown',
  'cite.missing',
  'time.unsupported',
  'number.unsupported',
  'name.unknown',
  'phrase.forbidden',
  'conflict.unsupported',
  'availability.claim',
  'gap.unqualified',
  'commitment.unrecorded',
  'authority.claim',
  'markup',
  'view.in_say',
  'tone.filler',
  'sensitive.leak',
];

// ---------------------------------------------------------------------------
// Vocabulary.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};
const NUMBER_WORD = Object.keys(NUMBER_WORDS).join('|');

/**
 * Words that may start a sentence or appear capitalised without being a
 * name: English function words, HOME's own words and Kev's vocabulary.
 * A capitalised word outside this list, the reader's people and the cited
 * records' words is `name.unknown` (rule 6).
 */
const COMMON_WORDS = new Set(
  `a about above according across after afterwards again ahead all along already also although
  always an and another any anything are as at back be because been before being below besides
  between both but by can could did do does doing done down during each earlier early either else
  even every everything few first for from further had has have having he her here hers him his
  how however i if in into is it its itself just last later least less let like looks looking
  many may me more most much my neither never next no nobody none nor not nothing now of off often
  on once one only or other others our ours over own per rather recorded same second several she
  since so some something sometimes still such than that the their theirs them then there these
  they this those though through till to today tomorrow tonight too under until up upcoming upon
  us very was we were what whatever when whenever where whether which while who whom whose why
  will with within without yes yet you your yours yesterday half quarter past
  home kev view kev's forecast forecasts calendar calendars records record task tasks project
  projects note notes event events person people birthday birthdays weekend week weeks month
  months day days morning afternoon evening night hour hours minute minutes sort settings
  usage activity forward knows open meteo as about around nothing's here's there's that's it's
  what's who's let's i'm i've i'll i'd you're you've you'll they're we're overlap overlaps
  rule both ages age stretch stretches showers rain dry daylight gusts gust low high`
    .split(/\s+/)
    .filter(Boolean),
);
for (const w of [...WEEKDAYS, ...MONTHS, ...MONTH_SHORT, ...Object.keys(NUMBER_WORDS)])
  COMMON_WORDS.add(w);

// ---------------------------------------------------------------------------
// Text helpers.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces each recorded string (a title, a name) with a neutral marker: titles and names are exempt. */
function exempt(text: string, recorded: Iterable<string>, quotedOk: ReadonlySet<string>): string {
  let out = normalisePunctuation(text);
  // Quoted segments that are a recorded string, wherever the record came from.
  out = out.replace(/["“”']([^"“”']{1,200})["“”']/g, (m, inner: string) =>
    quotedOk.has(inner.toLowerCase()) ? ' ⁣ ' : m,
  );
  const list = [...new Set([...recorded].map((r) => normalisePunctuation(r).trim()))]
    .filter((r) => r.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const r of list)
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escape(r)}(?![\\p{L}\\p{N}])`, 'giu'),
      ' ⁣ ',
    );
  return out;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const ABSENCE =
  /\b(nothing|no)\b[^.!?]*\b(recorded|marked|listed|lists)\b|\bhome (hasn't|has not|doesn't|does not)\b/i;
const isAbsence = (s: string) => ABSENCE.test(normalisePunctuation(s));

const weekdayOf = (d: string) => WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]!;

type Span = [number, number];
const overlaps = (a: Span, spans: Span[]) => spans.some((b) => a[0] < b[1] && b[0] < a[1]);

const hourOf = (w: string): number | null => {
  if (/^\d{1,2}$/.test(w)) return Number(w);
  const n = NUMBER_WORDS[w.toLowerCase()];
  return n !== undefined && n >= 1 && n <= 12 ? n : null;
};

/** Whether a stated clock time is one the facts carry (both halves of the day when unmarked). */
function timeAllowed(
  h: number,
  m: number,
  meridiem: 'am' | 'pm' | null,
  times: Set<string>,
): boolean {
  if (h > 23 || m > 59) return false;
  const pad = (n: number) => String(n).padStart(2, '0');
  let candidates: number[];
  if (meridiem) {
    if (h < 1 || h > 12) return false;
    candidates = [meridiem === 'am' ? h % 12 : (h % 12) + 12];
  } else if (h === 12) candidates = [12, 0];
  else if (h >= 1 && h < 12) candidates = [h, h + 12];
  else candidates = [h];
  return candidates.some((c) => times.has(`${pad(c)}:${pad(m)}`));
}

const meridiemOf = (s: string | undefined): 'am' | 'pm' | null =>
  !s ? null : s.toLowerCase().startsWith('a') ? 'am' : 'pm';

type Allowed = {
  times: Set<string>;
  dates: Set<IsoDate>;
  weekdays: Set<string>;
  numbers: Set<number>;
  durations: Set<number>;
  parts: Set<DayPart>;
};

function allowedFor(
  facts: LedgerFacts,
  extraDates: Iterable<IsoDate>,
  cites: readonly Ref[],
  absence = false,
): Allowed {
  const dates = new Set<IsoDate>([...facts.dates, ...extraDates]);
  const numbers = new Set<number>(facts.numbers);
  const unique = new Set(cites.map((c) => `${c.type}|${c.id}|${c.at ?? ''}`));
  numbers.add(unique.size);
  const perType = new Map<string, number>();
  for (const k of unique) {
    const t = k.split('|')[0]!;
    perType.set(t, (perType.get(t) ?? 0) + 1);
  }
  for (const n of perType.values()) numbers.add(n);
  for (const d of dates) numbers.add(Number(d.slice(0, 4)));
  return {
    times: facts.times,
    dates,
    weekdays: new Set([...dates].map(weekdayOf)),
    numbers,
    durations: facts.durations,
    // A statement of absence may name any part of a covered day.
    parts: absence ? new Set<DayPart>(['morning', 'afternoon', 'evening']) : facts.parts,
  };
}

/** Rules 4 and 5 on one sentence: every time, date, weekday, part, duration and number stated. */
function checkFacts(s: string, a: Allowed): { time: boolean; number: boolean } {
  const used: Span[] = [];
  let time = true;
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | null) => {
    for (const m of s.matchAll(re)) {
      const span: Span = [m.index, m.index + m[0].length];
      if (overlaps(span, used)) continue;
      const r = fn(m as RegExpExecArray);
      if (r === null) continue;
      used.push(span);
      if (!r) time = false;
    }
  };
  const mer = '(a\\.?m\\.?|p\\.?m\\.?)';
  // 15:30, 3:30pm, 3.30pm
  take(new RegExp(`\\b(\\d{1,2}):(\\d{2})\\s*${mer}?(?![\\d])`, 'gi'), (m) =>
    timeAllowed(Number(m[1]), Number(m[2]), meridiemOf(m[3]), a.times),
  );
  take(new RegExp(`\\b(\\d{1,2})\\.(\\d{2})\\s*${mer}(?![a-z])`, 'gi'), (m) =>
    timeAllowed(Number(m[1]), Number(m[2]), meridiemOf(m[3]), a.times),
  );
  // 3pm
  take(new RegExp(`\\b(\\d{1,2})\\s*${mer}(?![a-z])`, 'gi'), (m) =>
    timeAllowed(Number(m[1]), 0, meridiemOf(m[2]), a.times),
  );
  // half past three, quarter past 3, quarter to four
  take(
    new RegExp(`\\b(half past|quarter past|quarter to)\\s+(\\d{1,2}|${NUMBER_WORD})\\b`, 'gi'),
    (m) => {
      const h = hourOf(m[2]!);
      if (h === null) return false;
      const kind = m[1]!.toLowerCase();
      if (kind === 'quarter to') return timeAllowed(h === 1 ? 12 : h - 1, 45, null, a.times);
      return timeAllowed(h, kind === 'half past' ? 30 : 15, null, a.times);
    },
  );
  take(/\b(noon|midday)\b/gi, () => a.times.has('12:00'));
  take(/\bmidnight\b/gi, () => a.times.has('00:00'));
  take(new RegExp(`\\b(\\d{1,2}|${NUMBER_WORD})\\s+o'clock\\b`, 'gi'), (m) => {
    const h = hourOf(m[1]!);
    return h === null ? false : timeAllowed(h, 0, null, a.times);
  });
  // A range: "10 till 7:30", "from 10 to 12".
  take(
    /\b(from\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:–|-|till|til|until|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![\d:])/gi,
    (m) => {
      const marked = m[1] || m[3] || m[5] || m[6];
      if (!marked) return null;
      const okA = timeAllowed(Number(m[2]), Number(m[3] ?? 0), null, a.times);
      const okB = timeAllowed(Number(m[4]), Number(m[5] ?? 0), meridiemOf(m[6]), a.times);
      return okA && okB;
    },
  );
  // A bare hour after a time word: "at 4", "from nine", "until 6".
  take(
    new RegExp(
      `\\b(?:at|from|till|til|until|by|before|after)\\s+(\\d{1,2}|${NUMBER_WORD})\\b(?!\\s*(?:[:.]\\d|%|°|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|km|mm|degrees|people|things|tasks|events|items|of\\b|and a half))`,
      'gi',
    ),
    (m) => {
      const h = hourOf(m[1]!);
      return h === null ? null : timeAllowed(h, 0, null, a.times);
    },
  );
  // Durations: "three hours", "30 minutes", "half an hour", "an hour and a half".
  take(
    new RegExp(
      `\\b(\\d+|${NUMBER_WORD}|an?)(\\s+and a half)?\\s*(hours?|hrs?|minutes?|mins?)\\b|\\bhalf an hour\\b`,
      'gi',
    ),
    (m) => {
      if (m[0].toLowerCase() === 'half an hour') return a.durations.has(30);
      const raw = m[1]!.toLowerCase();
      const n = /^\d+$/.test(raw)
        ? Number(raw)
        : raw === 'a' || raw === 'an'
          ? 1
          : NUMBER_WORDS[raw]!;
      const hours = /^h/i.test(m[3]!);
      const minutes = hours ? n * 60 + (m[2] ? 30 : 0) : n;
      return a.durations.has(minutes);
    },
  );
  // Dates: "20 October", "October 20", "the 24th", "20/10", "2026-10-20".
  const monthIndex = (w: string) => {
    const i = MONTHS.indexOf(w.toLowerCase());
    return i >= 0 ? i : MONTH_SHORT.indexOf(w.toLowerCase().slice(0, 3));
  };
  const dateAllowed = (month: number | null, day: number) =>
    [...a.dates].some(
      (d) =>
        Number(d.slice(8, 10)) === day && (month === null || Number(d.slice(5, 7)) === month + 1),
    );
  const monthRe = `(${MONTHS.join('|')}|${MONTH_SHORT.join('|')})`;
  take(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => a.dates.has(m[0] as IsoDate));
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthRe}\\b`, 'gi'), (m) =>
    dateAllowed(monthIndex(m[2]!), Number(m[1])),
  );
  take(new RegExp(`\\b${monthRe}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi'), (m) =>
    dateAllowed(monthIndex(m[1]!), Number(m[2])),
  );
  take(/\b(\d{1,2})\/(\d{1,2})\b/g, (m) => dateAllowed(Number(m[2]) - 1, Number(m[1])));
  take(/\b(?:the\s+)?(\d{1,2})(st|nd|rd|th)\b/gi, (m) => dateAllowed(null, Number(m[1])));
  take(new RegExp(`\\b(${WEEKDAYS.join('|')})s?\\b`, 'gi'), (m) =>
    a.weekdays.has(m[1]!.toLowerCase()),
  );
  // Parts of the day ("tonight" is a relation to now; "this evening" is not
  // exempt: it says when the cited record is).
  take(/\b(morning|afternoon|evening|night)s?\b/gi, (m) => {
    const p = m[1]!.toLowerCase();
    return a.parts.has((p === 'night' ? 'evening' : p) as DayPart);
  });
  // Numbers left over (rule 5): counts, ages, temperatures, minutes.
  let number = true;
  for (const m of s.matchAll(new RegExp(`\\b(\\d+(?:\\.\\d+)?|${NUMBER_WORD})\\b`, 'gi'))) {
    const span: Span = [m.index, m.index + m[0].length];
    if (overlaps(span, used)) continue;
    const raw = m[1]!.toLowerCase();
    const n = NUMBER_WORDS[raw] ?? Number(raw);
    if (!a.numbers.has(n)) number = false;
  }
  return { time, number };
}

const NAME_TOKEN = /(?<![\p{L}\p{N}'])\p{Lu}[\p{L}'\-]*/gu;

/** Rule 6: every capitalised word is a person in the bundle, a cited record's word, or HOME's own. */
function namesKnown(text: string, facts: LedgerFacts, ledger: Ledger): boolean {
  for (const m of text.matchAll(NAME_TOKEN)) {
    for (const w of wordsOf(m[0])) {
      if (COMMON_WORDS.has(w) || facts.words.has(w) || ledger.peopleWords.has(w)) continue;
      return false;
    }
  }
  return true;
}

const AVAILABILITY = [
  /\b(?:is|are|isn't|aren't|'s|be|being|was|were|will be|'ll be|won't be)\s+(?:free|available|unavailable|around|away|able|busy|clear|out|off|tied up|booked up|occupied|home)\b/i,
  /\bnothing on\b/i,
  /\b(?:has|have|got)\s+(?:time|room|space)\b/i,
  /\b(?:has|have|got)\s+nothing\s+(?:on|planned|booked|scheduled)\b/i,
  /\bcan make it\b/i,
  /\b(?:free|available)\s+(?:on|at|from|for|until|after|before|in|to)\b/i,
];
const GAP_OPEN = /\b(?:is|are)\s+open\b|\bopen\s+(?:time|stretch|slot)\b|\bspare\b|\bfor you\b/i;
const GAP_SAID = /\bnothing\s+(?:else\s+)?(?:is\s+|'s\s+)?recorded\b/i;
const COMMITMENT =
  /\bbooked\b|\bis on for\b|\bplanned for\b|\byou(?:'re| are) doing\b|\bis set for\b|\byou(?:'ll| will) be\b/i;
const AUTHORITY = [
  /\bi(?:'ve| have)\s+(?:added|booked|sent|saved|scheduled|deleted|removed|changed|updated|created|cancell?ed|moved|reminded|remembered|noted|set|kept|recorded|told|texted|emailed)\b/i,
  /\bi(?:'ll| will)\s+(?:remind|let|remember|add|book|send|save|schedule|delete|remove|change|update|create|cancel|move|note|set|keep|tell|text|email|call|check back)\b/i,
  /\bi remember\b/i,
  /\bnoted\b/i,
];
const MARKUP = [
  /\bhttps?:\/\//i,
  /\bwww\./i,
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/,
  /<\/?[a-z][^>]*>/i,
  /\[[^\]]*\]\([^)]*\)/,
  /!\[/,
  /`/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\b[a-z0-9-]+\.(?:com|nz|org|net|io|co|au|uk|app|dev|test)\b/i,
];
const VIEW_MARKER =
  /^\s*(?:kev's view|in my view|i think|i reckon|my take|it seems|i'd say|i would say)\b|kev's view/i;
const OVERLAP_WORDS =
  /\boverlap(?:s|ping|ped)?\b|\bconflicts?\b|\bclash(?:es)?\b|\bat the same time\b|\bdouble-booked\b/i;

// ---------------------------------------------------------------------------

/**
 * Checks an answer (§8.3). A decline passes (code renders it). Returns the
 * parsed answer when it passes, or every rule it failed, with where.
 */
export function validateAnswer(input: ValidateInput): ValidateResult {
  const answer = parseAnswer(input.raw);
  if (!answer)
    return { ok: false, answer: null, violations: [{ code: 'answer.schema', where: 'answer' }] };
  if ('decline' in answer) return { ok: true, answer };
  const violations = checkAnswer(answer, input);
  return violations.length === 0 ? { ok: true, answer } : { ok: false, answer, violations };
}

function checkAnswer(answer: AnswerOf, input: ValidateInput): Violation[] {
  const { ledger } = input;
  const out: Violation[] = [];
  const add = (code: ValidatorCode, where: Where) => {
    if (!out.some((v) => v.code === code && v.where === where)) out.push({ code, where });
  };
  const quotedOk = new Set([...ledger.recordedTexts].map((t) => t.toLowerCase()));
  const sensitive = (input.sensitive ?? []).filter((s) => s.trim().length >= 4);
  const parts: { where: Where; kind: 'say' | 'fact' | 'view'; text: string; cites: Ref[] }[] = [
    { where: 'say', kind: 'say', text: answer.say.text, cites: answer.say.cites },
    ...answer.blocks.map((b, i) => ({
      where: i as Where,
      kind: b.kind,
      text: b.text,
      cites: b.cites,
    })),
  ];

  for (const p of parts) {
    // Rule 2: every citation is in the ledger.
    if (p.cites.some((c) => !ledger.has(c))) add('cite.unknown', p.where);
    const known = p.cites.filter((c) => ledger.has(c));
    const facts = ledger.factsOf(known);
    const said = sentences(p.text);
    // Rule 3: a factual sentence has something behind it, unless it states
    // an absence the tools (or the bundle) established.
    if (p.kind !== 'view' && p.cites.length === 0 && !said.every(isAbsence))
      add('cite.missing', p.where);

    // Titles and names as recorded are exempt: the cited records' own
    // strings, and the names of the people the reader can see.
    const plain = exempt(p.text, [...facts.texts, ...ledger.peopleNames], quotedOk);
    const norm = normalisePunctuation(plain);

    // Rules 4 and 5, sentence by sentence; an absence may name any day a read covered.
    for (const s of sentences(plain)) {
      const absent = isAbsence(s);
      const allowed = allowedFor(facts, absent ? ledger.covered : [], known, absent);
      const r = checkFacts(s, allowed);
      if (!r.time) add('time.unsupported', p.where);
      if (!r.number) add('number.unsupported', p.where);
    }
    // Rule 6.
    if (!namesKnown(plain, facts, ledger)) add('name.unknown', p.where);
    // Rule 7: the four lists, titles and names exempt.
    if (forbiddenIn(plain).length > 0) add('phrase.forbidden', p.where);
    // Rule 8: an overlap only with a cited conflict from get_conflicts.
    if (OVERLAP_WORDS.test(norm) && !known.some((c) => c.type === 'conflict'))
      add('conflict.unsupported', p.where);
    // Rule 9.
    if (AVAILABILITY.some((re) => re.test(norm))) add('availability.claim', p.where);
    // Rule 10: a gap is only ever "nothing is recorded": never open time for
    // anyone, and a fact (or `say`) that cites one says so. A view may speak
    // of the stretch it cites ("Saturday's stretch matches what the fence
    // task records", V11), never as open time.
    const citesGap = known.some((c) => c.type === 'gap');
    if (GAP_OPEN.test(norm) || (citesGap && p.kind !== 'view' && !GAP_SAID.test(norm)))
      add('gap.unqualified', p.where);
    // Rule 11: a plan is presented as made only with a cited record at that time.
    if (COMMITMENT.test(norm)) {
      const timed = known.some(
        (c) => c.type === 'event' || (c.type === 'task' && ledger.factsOf([c]).times.size > 0),
      );
      if (!timed) add('commitment.unrecorded', p.where);
    }
    // Rule 12.
    if (AUTHORITY.some((re) => re.test(norm))) add('authority.claim', p.where);
    // Rule 13: no link, address, markup or id; nor any ref id the ledger holds.
    if (
      MARKUP.some((re) => re.test(p.text)) ||
      ledger.entries.some((e) => e.ref.id.length >= 8 && p.text.includes(e.ref.id))
    )
      add('markup', p.where);
    // Rule 14.
    if (p.kind === 'say' && VIEW_MARKER.test(normalisePunctuation(p.text)))
      add('view.in_say', p.where);
    // Rule 15.
    if (FILLER.some((f) => phrasePattern(f).test(normalisePunctuation(p.text))))
      add('tone.filler', p.where);
    // Rule 16.
    const lower = p.text.toLowerCase();
    if (sensitive.some((s) => lower.includes(s.toLowerCase()))) add('sensitive.leak', p.where);
  }
  return out.sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));
}

/** The distinct codes of a set of violations, in rule order (content v2's `violations`). */
export function codesOf(violations: readonly Violation[]): ValidatorCode[] {
  return ORDER.filter((c) => violations.some((v) => v.code === c));
}

/** The part-of-day of an instant's wall clock (exported for the ledger's tests). */
export { partOf };
