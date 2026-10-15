import 'server-only';
import type { VALIDATOR_CODES } from '@/domain/kev-bookkeeping/schema';
import { addDays, isoDateInZone, weekdayOf as mondayFirst, type IsoDate } from '@/lib/dates';
import type { Ref } from '../tools/types';
import { FILLER, forbiddenIn, phrasePattern } from './language';
import {
  normaliseText,
  partOf,
  wordsOf,
  type CoverageKind,
  type DayPart,
  type Ledger,
  type LedgerEntry,
  type LedgerFacts,
} from './ledger';
import { parseAnswer, uniqueCites, type AnswerOf, type KevAnswer } from './schema';

// The grounding check (M8 contract §8.3; matrix rows V1–V18): pure and
// deterministic, run on every answer before anything is shown or stored as
// an answer. Inputs: the model's final output, the attempt's ledger (its
// tool results and the bundle, with what each read covered), `now` and the
// home zone, and (defence in depth) any sensitive strings known to the
// caller.
//
// How an answer is read (rebuilt in the Package 3 review, B-1, I-8–I-16):
// 0. Text first: control and format characters (U+200B, U+2063 …) are
//    refused, the rest NFKC-normalised, and a word mixing scripts (Latin
//    with Cyrillic or Greek) or a non-Latin word no cited record carries is
//    refused (`text.unsafe`). Names with diacritics (Zoë, Māori macrons)
//    are Latin and pass.
// 1. Each `say` and block is split into sentences and clauses (at `;`,
//    `: `, a dash, and ", and" / ", but" / ", so" …).
// 2. A clause that is wholly a statement of absence ("Nothing else is
//    recorded for today.", "No overlaps are recorded for next week.",
//    "HOME hasn't marked an overlap there.") may stand without citations,
//    but only as a template: an absence phrase and a scope of days, people
//    and HOME's own words, nothing else. Its days (resolved from `now` in
//    the home zone) must each be covered by a complete read of the right
//    kind (the agenda for "nothing is recorded", the conflicts read for "no
//    overlaps"), for the person it names, and the ledger must hold no
//    record on those days (for that person) that the answer does not cite
//    when it says "else", or at all when it does not (`absence.unsupported`).
// 3. Every other clause is a claim and needs citations (`cite.missing`;
//    a view too, when it names a person, a record, a time, a date or a
//    number). Its facts are checked against the records it is about: the
//    cited records it names (by title or name words, or by their kind:
//    "the forecast", "the overlap", "the stretch"), or all the part's cited
//    records when it names none. A clause joining two named records with
//    "and" is checked a half at a time, so their times cannot swap.
//    - times, dates, weekdays, parts of the day, durations and numbers
//      (rules 4, 5), including today/tomorrow/this weekend/next week
//      resolved from `now`, recurrence ("every week"), and numbers that
//      are what they say (an age it turns, a low, a high, a gust);
//    - people (`person.unsupported`): every person named, and every
//      relationship word (grandad, nana, mum, coach …), must be on the
//      records the clause is about, and "responsible"/"attending" must be
//      the role recorded for the person it is said of;
//    - a plan or commitment (rule 11) must be a cited timed record with the
//      people the clause names.
// 4. Across the whole part: names (rule 6), the four lists (rule 7, the
//    only rule from which a quoted cited title, word for word, or a visible
//    person's name is exempt), overlaps (8), availability (9), gaps (10),
//    authority (12, completed actions and promises by Kev first), markup
//    (13), view markers in `say` (14), filler (15) and sensitive strings
//    (16).
//
// The boundary, stated plainly (ADR 0012 §45): these are deterministic
// checks of what a sentence says against the records it cites. They are not
// a proof that every natural-language claim is true. What they guarantee is
// that no time, date, number, person, role, overlap, commitment or absence
// reaches the screen that the cited records (or a covering read) do not
// carry, that no listed phrase does, and that every citation is one this
// attempt's tools (or the bundle) returned. They are deliberately
// conservative: an innocent sentence they cannot bind costs a regeneration
// or the safe fallback (§8.5), never a wrong answer, and Package 5 measures
// how often.

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
  | {
      ok: true;
      answer: KevAnswer;
      /** Whether the answer states an absence (code then adds the coverage sentences, §8.4). */
      absence: boolean;
    }
  | { ok: false; answer: KevAnswer | null; violations: Violation[] };

const ORDER: readonly ValidatorCode[] = [
  'answer.schema',
  'text.unsafe',
  'cite.unknown',
  'cite.missing',
  'absence.unsupported',
  'time.unsupported',
  'number.unsupported',
  'name.unknown',
  'person.unsupported',
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
const WEEKDAY_ABBR: Readonly<Record<string, string>> = {
  sun: 'sunday',
  mon: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  fri: 'friday',
  sat: 'saturday',
};
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
const UNITS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** A number in words, up to ninety-nine, and "a hundred" (longest first). */
const NUMBER_WORD = `(?:(?:${TENS.join('|')})(?:[- ](?:${UNITS.slice(1, 10).join('|')}))?|${[
  ...UNITS,
]
  .reverse()
  .join('|')}|hundred)`;

/** The value of a number written in words, or null. */
function wordNumber(w: string): number | null {
  const s = w.toLowerCase().replace(/\s+/g, '-');
  if (s === 'hundred') return 100;
  const u = UNITS.indexOf(s);
  if (u >= 0) return u;
  const [t, unit] = s.split('-');
  const ti = TENS.indexOf(t ?? '');
  if (ti < 0) return null;
  if (unit === undefined) return (ti + 2) * 10;
  const ui = UNITS.indexOf(unit);
  return ui >= 1 && ui <= 9 ? (ti + 2) * 10 + ui : null;
}
const numberOf = (raw: string): number | null =>
  /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : wordNumber(raw);

/**
 * Words that may start a sentence or appear capitalised without being a
 * name: English function words, HOME's own words and Kev's vocabulary.
 * A capitalised word outside this list, the reader's people and the cited
 * records' words is `name.unknown` (rule 6). Contractions are read whole
 * ("You're") and by their base ("Doesn't" → "does").
 */
const COMMON_WORDS = new Set(
  `a about above according across after afterwards again ahead all along already also although
  always an and another any anything are as at back be because been before being below besides
  between both but by can could did do does doing done down during each earlier early either else
  even every everything few first for from further had has have having he her here hers him his
  how however i if in into is it its itself just last later least less let like looks look looking
  many may me more most much my neither never next no nobody none nor not nothing now of off often
  on once one only or other others our ours over own per rather recorded same second several she
  since so some something sometimes still such than that the their theirs them then there these
  they this those though through till to today tomorrow tonight too under until up upcoming upon
  us very was we were what whatever when whenever where whether which while who whom whose why
  will with within without yes yet you your yours yesterday half quarter past
  home kev view forecast forecasts calendar calendars records record task tasks project
  projects note notes event events person people birthday birthdays weekend week weeks month
  months day days morning afternoon evening night hour hours minute minutes sort settings
  usage activity forward knows open meteo around overlap overlaps
  rule ages age stretch stretches showers rain dry daylight gusts gust low high just
  there's that's it's what's who's let's here's nothing's`
    .split(/\s+/)
    .filter(Boolean),
);
for (const w of [
  ...WEEKDAYS,
  ...Object.keys(WEEKDAY_ABBR),
  ...MONTHS,
  ...MONTH_SHORT,
  ...UNITS,
  ...TENS,
  'am',
  'pm',
])
  COMMON_WORDS.add(w);

/** Words that refer to a person by relationship: grounded only by a cited record (I-10). */
const RELATIONS = new Set(
  `grandad granddad grandpa grandfather grandma grandmother granny gran nana nan nanna poppa pop
  koro kuia mum mom mother mummy mama dad father daddy papa aunt aunty auntie uncle cousin niece
  nephew coach teacher nanny babysitter sitter tutor friend neighbour neighbor brother sister son
  daughter husband wife partner boss stepdad stepmum grandson granddaughter grandkids grandchild`
    .split(/\s+/)
    .filter(Boolean),
);

/** Words naming each kind of record: a clause using one is about the cited record of that kind. */
const TYPE_WORDS: Readonly<Partial<Record<Ref['type'], readonly string[]>>> = {
  event: ['event', 'events', 'appointment', 'appointments'],
  task: ['task', 'tasks', 'job', 'jobs'],
  project: ['project', 'projects'],
  note: ['note', 'notes'],
  conflict: ['overlap', 'overlaps', 'overlapping', 'conflict', 'conflicts'],
  gap: ['stretch', 'stretches', 'gap', 'gaps'],
  forecast: ['forecast', 'forecasts', 'weather', 'showers', 'rain', 'low', 'high', 'gust', 'gusts'],
  calendar: ['calendar', 'calendars'],
  context: ['context'],
  insight: ['insight', 'insights', 'noticed'],
};

// ---------------------------------------------------------------------------
// Rule patterns (on normalised, lower-cased text: apostrophes are ').

const AVAILABILITY: readonly RegExp[] = [
  /\b(?:is|are|isn't|aren't|'s|'re|be|being|was|were|will be|'ll be|won't be|looks?|seems?)\s+(?:free|available|unavailable|around|away|able|busy|clear|out|off|tied up|booked up|occupied|home|empty|light|quiet|blank|unbooked|at a loose end)\b/,
  /\bnothing (?:on|planned|booked|scheduled|happening|going on)\b/,
  /\b(?:has|have|had|got|gets)\s+(?:time|room|space|no plans|no commitments|the (?:day|morning|afternoon|evening|night) off)\b/,
  /\b(?:has|have|had|got)\s+nothing(?!\s+(?:else\s+|more\s+)?(?:is\s+)?(?:recorded|listed|marked))\b/,
  /\bno (?:plans|commitments|appointments|bookings)\b/,
  /\bto (?:himself|herself|themselves|themself|yourself|myself|ourselves)\b/,
  /\bcan make it\b/,
  /\b(?:free|available)\s+(?:on|at|from|for|until|after|before|in|to|all)\b/,
  /(?<!\bi )\bcan\b(?!\s+(?:see|only)\b)/,
  /\bable to\b/,
  /\b(?:nobody|no one|no-one)\b/,
  /\bavailability\b/,
  /\b(?:suits?|suited|suitable|works for|work for|good time|right time|a good fit)\b/,
  /\b(?:empty|unclaimed)\b/,
];
const GAP_OPEN =
  /\b(?:is|are|'s)\s+(?:wide\s+)?open\b|\bopen\s+(?:time|stretch|slot|space|day|morning|afternoon|evening)\b|\bspare\b/;
const GAP_SAID = /\bnothing\s+(?:else\s+)?(?:is\s+|'s\s+)?recorded\b/;
const COMMITMENT: readonly RegExp[] = [
  /\bbooked\b|\bis on for\b|\bplanned for\b|\bis set for\b|\bscheduled\b/,
  /\b(?:you|he|she|they|we|i)(?:'re|'s| are| is| am|'m)\s+(?:doing|painting|going|taking|heading|tackling|working|getting|starting|finishing|fixing|cleaning|cooking|driving|picking|dropping|on it)\b/,
  /\b(?:you|he|she|they|we)(?:'ll| will| are going to|'re going to| is going to|'s going to)\b/,
  /\bgoing to\b|\bgonna\b|\bplans? to\b/,
  /\b(?:is|are|'s|'re|was|were|has been|have been)\s+(?:done|finished|completed|sorted)\b/,
];
/** A named person (or you, he, she …) doing something: a plan stated as made. */
const DOING =
  /(?:^|[\s,])(?:\p{Lu}[\p{L}\p{M}'-]*|you|he|she|they|we)\s+(?:paints?|does|do|takes?|goes|go|drives?|picks?|drops?|fixes|fix|cleans?|tackles?|handles?|covers?|will|'ll)\b/u;
const WRITE_VERBS =
  'added|booked|sent|saved|scheduled|deleted|removed|changed|updated|created|cancell?ed|moved|reminded|remembered|noted|set|kept|recorded|told|texted|emailed|messaged|called|put|filed|logged|made|marked|paid|ordered|bought|signed|registered|entered|written|wrote|done|sorted|fixed|organised|organized|arranged|confirmed|reserved|shared|forwarded|copied|stored|tracked|flagged|gone ahead|went ahead';
const AUTHORITY: readonly RegExp[] = [
  new RegExp(
    `\\bi(?:'ve| have|'d| had)?\\s+(?:(?:now|just|already|also|then|quickly|gone ahead and|went ahead and)\\s+)*(?:${WRITE_VERBS})\\b`,
  ),
  /\bi(?:'ll| will|'m going to| am going to| can)\s+(?!only\b|see\b)[a-z]+/,
  /\bi(?:'m| am)\s+(?:adding|booking|sending|saving|scheduling|setting|reminding|noting|keeping|putting)\b/,
  /\bi remember\b/,
  /\bnoted\b/,
  /\b(?:gone|went) ahead\b/,
  /^\s*(?:all\s+)?done\b/,
  /\b(?:that|it|this)(?:'s| is| has been| was)\s+(?:now\s+)?(?:in|into|added to|put in|saved (?:in|to))\s+(?:to sort|your list|the list|your calendar|the calendar|home|what kev knows)\b/,
  /\b(?:added|saved|put|moved)\s+(?:it\s+|that\s+|this\s+)?(?:to|in|into)\s+(?:to sort|your list|the list|your calendar|the calendar|what kev knows)\b/,
];
const MARKUP: readonly RegExp[] = [
  /\bhttps?:\/\//i,
  /\bwww\./i,
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/,
  /<\/?[a-z][^>]*>/i,
  /[<>]/,
  /\[[^\]]*\]\([^)]*\)/,
  /[[\]]/,
  /`/,
  /[*_#|~^\\{}]/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  // A domain or address: name.tld, with or without a path.
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?(?![a-z])/i,
];
const VIEW_MARKER =
  /^\s*(?:kev's view|in my view|i think|i reckon|my take|it seems|i'd say|i would say)\b|kev's view|\b(?:seems?|seemed|appears?|might|maybe|perhaps|tight|hectic|a lot on|worth|i think|i reckon|i feel|i suspect|i'd|i would|in my view|my view|my take)\b/;
const OVERLAP_WORDS =
  /\boverlap(?:s|ping|ped)?\b|\bconflicts?\b|\bclash(?:es)?\b|\bat the same time\b|\bdouble-booked\b/;
const RECURRENCE =
  /\bevery\s+(?:day|week|weekday|morning|afternoon|evening|night|fortnight|month|year|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\beach\s+(?:week|day|month)\b|\b(?:weekly|daily|fortnightly|monthly|always|usually|regularly)\b/;
const ROLE_WORD = /\b(responsible|attending|assigned)\b/g;

/** An absence phrase at the start of a clause; the rest is its scope. */
const ABSENCE_HEAD = new RegExp(
  [
    "^(?:(?:and|but|so|otherwise|also)\\s+)?(?:(?:there's|there is)\\s+)?",
    '(?:',
    "nothing(?:\\s+else|\\s+more)?(?:\\s+is|'s)?\\s+(?:recorded|listed|marked)",
    "|(?:it\\s+)?(?:doesn't|does not)\\s+look\\s+like\\s+anything(?:\\s+else|\\s+more)?\\s+is\\s+(?:recorded|listed|marked)",
    '|no\\s+(?:other\\s+|more\\s+)?(?:overlaps?|conflicts?|events?|tasks?|birthdays?|items?|records?|forecasts?)\\s+(?:are|is)\\s+(?:recorded|listed|marked)',
    "|home\\s+(?:hasn't|has not|doesn't|does not)\\s+(?:marked|recorded|listed|list|show|shown|have|got)(?:\\s+(?:anything|any\\s+overlaps?|an\\s+overlap|overlaps?|any\\s+conflicts?|a\\s+conflict))?(?:\\s+(?:else|more|other))?",
    ')(?<scope>(?:\\s.*)?)$',
  ].join(''),
);
/** What an absence's scope may hold besides days, dates and the reader's people. */
const SCOPE_WORDS = new Set(
  `for on in over across during at the this that next rest of week weeks weekend weekends today
  tomorrow tonight morning mornings afternoon afternoons evening evenings night nights day days
  there then here you your household anyone everyone either and or yet so far besides apart from
  else other than as knows home what that's after before until till up to both all whole more any
  anything coming upcoming rest`
    .split(/\s+/)
    .filter(Boolean),
);

// ---------------------------------------------------------------------------
// Text helpers.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rule 0: control or format characters, mixed scripts, or a foreign-script word nothing recorded. */
function unsafeText(raw: string, recordedWords: ReadonlySet<string>): boolean {
  if (/[\p{Cf}\p{Co}\p{Cs}]/u.test(raw)) return true;
  if (/[\p{Cc}]/u.test(raw.replace(/[\n\t]/g, ' '))) return true;
  const t = raw.normalize('NFKC');
  if (/[\p{Cf}]/u.test(t)) return true;
  for (const w of t.match(/[\p{L}\p{M}]+/gu) ?? []) {
    const letters = [...w].filter((ch) => /\p{L}/u.test(ch));
    const latin = letters.some((ch) => /\p{Script=Latin}/u.test(ch));
    const other = letters.some((ch) => !/\p{Script=Latin}/u.test(ch));
    if (latin && other) return true;
    if (other && !recordedWords.has(w.toLowerCase())) return true;
  }
  return false;
}

/** Normalised text: NFKC, one apostrophe, straight double quotes, one space. */
const norm = (s: string) => normaliseText(s).replace(/[“”„‟″]/g, '"');

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A sentence's clauses: at `;`, `: `, a spaced dash, and a comma before and/but/so/while. */
function clausesOf(sentence: string): string[] {
  return sentence
    .replace(/[.!?]+$/, '')
    .split(
      /\s*;\s*|:\s+|\s+-\s+|,\s+(?=(?:and|but|so|while|though|although|whereas|as)\b)|\s+(?:but|whereas)\s+/i,
    )
    .map((c) => c.trim())
    .filter(Boolean);
}

const hasClock = (c: string) =>
  /\d{1,2}[:.]\d{2}|\b\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)\b|\b(?:noon|midday|midnight)\b|o'clock/i.test(
    c,
  );

// ---------------------------------------------------------------------------
// Dates relative to now (I-9).

type Today = { date: IsoDate; mondayFirst: number };

function weekOf(t: Today, offsetWeeks: number): IsoDate[] {
  const monday = addDays(t.date, -t.mondayFirst + offsetWeeks * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The days a relative phrase in the text names (today, tomorrow, this weekend, next week …). */
function relativeDays(lower: string, t: Today): { days: Set<IsoDate>; named: boolean } {
  const days = new Set<IsoDate>();
  let named = false;
  const add = (ds: Iterable<IsoDate>) => {
    named = true;
    for (const d of ds) days.add(d);
  };
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/.test(lower)) add([t.date]);
  if (/\btomorrow\b/.test(lower)) add([addDays(t.date, 1)]);
  if (/\byesterday\b/.test(lower)) add([addDays(t.date, -1)]);
  if (/\bnext weekend\b/.test(lower)) add(weekOf(t, 1).slice(5));
  else if (/\bweekend\b/.test(lower)) add(weekOf(t, 0).slice(5));
  if (/\bnext week\b/.test(lower)) add(weekOf(t, 1));
  if (/\blast week\b/.test(lower)) add(weekOf(t, -1));
  if (/\b(?:this week|rest of the week)\b/.test(lower))
    add(weekOf(t, 0).filter((d) => d >= t.date));
  return { days, named };
}

/** The date a weekday names from today: the next seven days, or next week's with "next". */
function weekdayDate(name: string, t: Today, next: boolean): IsoDate {
  const target = (WEEKDAYS.indexOf(name) + 6) % 7; // Monday first
  if (next) return weekOf(t, 1)[target]!;
  return addDays(t.date, (target - t.mondayFirst + 7) % 7);
}

// ---------------------------------------------------------------------------
// Facts: rules 4 and 5.

type Span = [number, number];
const overlaps = (a: Span, spans: Span[]) => spans.some((b) => a[0] < b[1] && b[0] < a[1]);

const hourOf = (w: string): number | null => {
  if (/^\d{1,2}$/.test(w)) return Number(w);
  const n = wordNumber(w);
  return n !== null && n >= 1 && n <= 12 ? n : null;
};

/** Whether a stated clock time is one the facts carry (both halves of the day when unmarked). */
function timeAllowed(
  h: number,
  m: number,
  meridiem: 'am' | 'pm' | null,
  times: ReadonlySet<string>,
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
  times: ReadonlySet<string>;
  dates: ReadonlySet<IsoDate>;
  weekdays: ReadonlySet<string>;
  numbers: ReadonlySet<number>;
  durations: ReadonlySet<number>;
  parts: ReadonlySet<DayPart>;
};

function allowedFor(facts: LedgerFacts, partCites: readonly Ref[]): Allowed {
  const numbers = new Set<number>(facts.numbers);
  const unique = new Set(partCites.map((c) => `${c.type}|${c.id}|${c.at ?? ''}`));
  numbers.add(unique.size);
  const perType = new Map<string, number>();
  for (const k of unique) {
    const t = k.split('|')[0]!;
    perType.set(t, (perType.get(t) ?? 0) + 1);
  }
  for (const n of perType.values()) numbers.add(n);
  for (const d of facts.dates) numbers.add(Number(d.slice(0, 4)));
  return {
    times: facts.times,
    dates: facts.dates,
    weekdays: new Set([
      ...[...facts.dates].map((d) => WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]!),
      ...facts.weekdays,
    ]),
    numbers,
    durations: facts.durations,
    parts: facts.parts,
  };
}

/** Rules 4 and 5 on one clause: every time, date, weekday, part, duration and number stated. */
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
  const H = `(\\d{1,2}|${NUMBER_WORD})`;
  // A range: "10 till 7:30", "from 3.30 to 4.15", "3:30–4:15".
  take(
    /\b(from\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|till|til|until|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?(?![\d:])/gi,
    (m) => {
      const marked = m[1] || m[3] || m[4] || m[6] || m[7];
      if (!marked) return null;
      const okA = timeAllowed(Number(m[2]), Number(m[3] ?? 0), meridiemOf(m[4]), a.times);
      const okB = timeAllowed(Number(m[5]), Number(m[6] ?? 0), meridiemOf(m[7]), a.times);
      return okA && okB;
    },
  );
  // 15:30, 3:30pm
  take(new RegExp(`\\b(\\d{1,2}):(\\d{2})\\s*${mer}?(?![\\d])`, 'gi'), (m) =>
    timeAllowed(Number(m[1]), Number(m[2]), meridiemOf(m[3]), a.times),
  );
  // 3.30pm, and NZ's 3.30 (a decimal the facts carry is left to the number rule)
  take(new RegExp(`\\b(\\d{1,2})\\.(\\d{2})\\s*${mer}?(?![\\d])`, 'gi'), (m) => {
    if (timeAllowed(Number(m[1]), Number(m[2]), meridiemOf(m[3]), a.times)) return true;
    if (!m[3] && a.numbers.has(Number(`${m[1]}.${m[2]}`))) return null;
    return false;
  });
  // 3pm, 9am
  take(new RegExp(`\\b(\\d{1,2})\\s*${mer}(?![a-z])`, 'gi'), (m) =>
    timeAllowed(Number(m[1]), 0, meridiemOf(m[2]), a.times),
  );
  // half past three, quarter past 3, quarter to four
  take(new RegExp(`\\b(half past|quarter past|quarter to)\\s+${H}\\b`, 'gi'), (m) => {
    const h = hourOf(m[2]!);
    if (h === null) return false;
    const kind = m[1]!.toLowerCase();
    if (kind === 'quarter to') return timeAllowed(h === 1 ? 12 : h - 1, 45, null, a.times);
    return timeAllowed(h, kind === 'half past' ? 30 : 15, null, a.times);
  });
  // NZ "half three" (3:30)
  take(
    new RegExp(`\\bhalf\\s+${H}\\b(?!\\s*(?:hours?|hrs?|minutes?|mins?|days?|weeks?))`, 'gi'),
    (m) => {
      const h = hourOf(m[1]!);
      return h === null ? null : timeAllowed(h, 30, null, a.times);
    },
  );
  // three-thirty, three fifteen, three forty-five
  take(new RegExp(`\\b${H}[- ](thirty|fifteen|forty[- ]five|o'clock)\\b`, 'gi'), (m) => {
    const h = hourOf(m[1]!);
    if (h === null) return null;
    const tail = m[2]!.toLowerCase();
    const min = tail === 'thirty' ? 30 : tail === 'fifteen' ? 15 : tail === "o'clock" ? 0 : 45;
    return timeAllowed(h, min, null, a.times);
  });
  take(/\b(noon|midday)\b/gi, () => a.times.has('12:00'));
  take(/\bmidnight\b/gi, () => a.times.has('00:00'));
  // A bare hour after a time word: "at 4", "from nine", "until 6".
  take(
    new RegExp(
      `\\b(?:at|from|till|til|until|by|before|after)\\s+${H}\\b(?!\\s*(?:[:.]\\d|%|°|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|km|mm|degrees|people|things|tasks|events|items|of\\b|and a half))`,
      'gi',
    ),
    (m) => {
      const h = hourOf(m[1]!);
      return h === null ? null : timeAllowed(h, 0, null, a.times);
    },
  );
  // Durations: "three hours", "30 minutes", "half an hour", "an hour and a half", "ninety minutes".
  take(
    new RegExp(
      `\\b(\\d+|${NUMBER_WORD}|an?)(\\s+and a half)?\\s*(hours?|hrs?|minutes?|mins?)\\b|\\bhalf an hour\\b`,
      'gi',
    ),
    (m) => {
      if (m[0].toLowerCase() === 'half an hour') return a.durations.has(30);
      const raw = m[1]!.toLowerCase();
      const n = raw === 'a' || raw === 'an' ? 1 : numberOf(raw);
      if (n === null) return false;
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
  // Abbreviated weekdays, capitalised only ("Sat 9am", "Wed 14 Oct"; never the sun).
  take(/\b(Sun|Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat)\b\.?/g, (m) =>
    a.weekdays.has(WEEKDAY_ABBR[m[1]!.toLowerCase()]!),
  );
  // Parts of the day ("tonight" is a relation to now; "this evening" says when the record is).
  take(/\b(morning|afternoon|evening|night|tonight)s?\b/gi, (m) => {
    const p = m[1]!.toLowerCase();
    return a.parts.has((p === 'night' || p === 'tonight' ? 'evening' : p) as DayPart);
  });
  // Numbers left over (rule 5): counts, ages, temperatures, minutes.
  let number = true;
  for (const m of s.matchAll(new RegExp(`\\b(\\d+(?:\\.\\d+)?|${NUMBER_WORD})\\b`, 'gi'))) {
    const span: Span = [m.index, m.index + m[0].length];
    if (overlaps(span, used)) continue;
    const n = numberOf(m[1]!);
    if (n === null || !a.numbers.has(n)) number = false;
  }
  return { time, number };
}

/** Numbers that say what they are: an age turned, an age, a low, a high, a gust (minor, Package 3 review). */
function keyedNumbersOk(lower: string, facts: LedgerFacts, namesPerson: boolean): boolean {
  const N = `(-?\\d+(?:\\.\\d+)?|${NUMBER_WORD})`;
  const has = (keys: string[], raw: string) => {
    const n = numberOf(raw);
    return n !== null && keys.some((k) => facts.keyed.get(k)?.has(n));
  };
  const rules: [RegExp, string[]][] = [
    [new RegExp(`\\b(?:turns?|turning|will be|'ll be)\\s+${N}\\b`, 'g'), ['birthday_age']],
    [new RegExp(`\\blows?\\s+(?:of\\s+)?${N}`, 'g'), ['low_c']],
    [new RegExp(`\\bhighs?\\s+(?:of\\s+)?${N}`, 'g'), ['high_c']],
    [new RegExp(`\\bgusts?\\s+(?:of\\s+|up to\\s+|to\\s+|around\\s+)?${N}`, 'g'), ['max_gust_kmh']],
    [new RegExp(`${N}\\s*(?:°|degrees)`, 'g'), ['low_c', 'high_c']],
  ];
  if (namesPerson && (facts.keyed.has('age') || facts.keyed.has('birthday_age')))
    rules.push([
      new RegExp(
        `\\b(?:is|aged|age)\\s+${N}\\b(?![:.]\\d|\\s*(?:am|pm))|\\b${N}[- ]years?[- ]old\\b`,
        'g',
      ),
      ['age'],
    ]);
  for (const [re, keys] of rules)
    for (const m of lower.matchAll(re)) {
      const raw = m[1] ?? m[2];
      if (raw !== undefined && !has(keys, raw)) return false;
    }
  return true;
}

// ---------------------------------------------------------------------------
// Names and people.

/** Rule 6: every capitalised word is a person in the bundle, a cited record's word, or HOME's own. */
function namesKnown(text: string, words: ReadonlySet<string>, ledger: Ledger): boolean {
  const ok = (w: string) => COMMON_WORDS.has(w) || words.has(w) || ledger.peopleWords.has(w);
  for (const m of text.matchAll(/(?<![\p{L}\p{N}'])\p{Lu}[\p{L}\p{M}'-]*/gu)) {
    const token = m[0].toLowerCase().replace(/'+$/, '');
    if (ok(token)) continue;
    const base = token.replace(/(?:'s|'re|'ve|'ll|'m|'d|n't)$/, '');
    const parts = base.split(/[-']/).filter(Boolean);
    if (parts.length > 0 && parts.every((p) => ok(p) || ok(p.replace(/s$/, '')))) continue;
    return false;
  }
  return true;
}

type Mention = { name: string; at: number };

/** The visible people a clause names (by any word of their name, capitalised), and where. */
function peopleIn(clause: string, ledger: Ledger): Mention[] {
  const out: Mention[] = [];
  for (const name of ledger.peopleNames) {
    const lower = name.toLowerCase();
    for (const w of wordsOf(name)) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'giu');
      for (const m of clause.matchAll(re)) {
        const first = clause[m.index]!;
        // A name word written in lower case is a relationship word, checked below.
        if (first !== first.toUpperCase()) continue;
        out.push({ name: lower, at: m.index });
      }
    }
  }
  return out;
}

/** The person a role word is said of: the nearest named person, or "you" (the reader). */
function nearest(mentions: Mention[], at: number): Mention | null {
  let best: Mention | null = null;
  for (const m of mentions) if (!best || Math.abs(m.at - at) < Math.abs(best.at - at)) best = m;
  return best;
}

/** `person.unsupported` on one clause: people, roles and relationship words against the records it is about. */
function peopleOk(clause: string, lower: string, facts: LedgerFacts, ledger: Ledger): boolean {
  const mentions = peopleIn(clause, ledger);
  const you = [...lower.matchAll(/\b(?:you|your|you're|you've|you'll|yourself)\b/g)];
  for (const m of mentions) if (!facts.people.has(m.name)) return false;
  // Relationship words, unless part of a visible person's capitalised name.
  for (const m of lower.matchAll(/[\p{L}]+/gu)) {
    const w = m[0];
    if (!RELATIONS.has(w)) continue;
    const written = clause.slice(m.index, m.index + w.length);
    const asName = written[0] !== written[0]!.toLowerCase() && ledger.peopleWords.has(w);
    if (asName) continue;
    if (!facts.words.has(w)) return false;
  }
  // "You" as being on a record, or a role said of someone.
  const reader = ledger.reader;
  const youOn =
    /\byou(?:'re| are)\s+(?:marked\s+|recorded\s+|listed\s+)?(?:as\s+)?(?:responsible|attending|on|down)\b|\byou(?:'ve| have)\s+got\b|\byour\s+(?:own\s+)?(?:event|task|appointment)/;
  if (youOn.test(lower) && (reader === null || !facts.people.has(reader))) return false;
  const all: Mention[] = [
    ...mentions,
    ...(reader ? you.map((y) => ({ name: reader, at: y.index })) : []),
  ];
  for (const r of lower.matchAll(ROLE_WORD)) {
    const who = nearest(all, r.index);
    if (!who) return false;
    const roles = facts.people.get(who.name);
    const want = r[1] === 'assigned' ? 'assignee' : r[1]!;
    if (!roles || !roles.has(want as 'attending')) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Which records a clause is about.

const significant = (w: string) => w.length >= 3 && !COMMON_WORDS.has(w);

/** The cited records a clause names: by title or name words, or by the words for their kind. */
function bindings(
  clauseWords: ReadonlySet<string>,
  lower: string,
  cites: readonly Ref[],
  ledger: Ledger,
): Ref[] {
  const out: Ref[] = [];
  for (const c of cites) {
    const facts = ledger.factsOf([c]);
    let bound = false;
    for (const t of facts.ownTexts)
      if (wordsOf(t).some((w) => significant(w) && clauseWords.has(w))) bound = true;
    if (!bound && (TYPE_WORDS[c.type] ?? []).some((w) => clauseWords.has(w))) bound = true;
    if (!bound && c.type === 'forecast')
      for (const w of facts.words) if (significant(w) && clauseWords.has(w)) bound = true;
    if (!bound && c.type === 'gap' && GAP_SAID.test(lower)) bound = true;
    if (
      !bound &&
      c.type === 'gap' &&
      /\bnothing recorded\b|\bhas nothing\b|\bhave nothing\b/.test(lower)
    )
      bound = true;
    if (bound) out.push(c);
  }
  return out;
}

const sameRefs = (a: Ref[], b: Ref[]) =>
  a.length === b.length && a.every((r, i) => r.type === b[i]!.type && r.id === b[i]!.id);

// ---------------------------------------------------------------------------
// Absence (B-1, I-8, I-16).

type AbsenceClaim = { kind: CoverageKind; else: boolean; scope: string };

/** Qualifiers an absence may carry that change nothing about what it claims. */
const QUALIFIERS = /\b(?:that\s+)?(?:you|i)\s+can\s+see\b|\bas far as home knows\b/g;
/** Words a search absence may use besides what was searched for. */
const SEARCH_WORDS = new Set(
  `a an any anything else by that name called named matching recorded listed appointment
  appointments event events task tasks note notes project projects record records you can see yet
  here in home with the of for`
    .split(/\s+/)
    .filter(Boolean),
);

function absenceOf(clauseLower: string): AbsenceClaim | null {
  if (hasClock(clauseLower)) return null;
  const m = ABSENCE_HEAD.exec(clauseLower);
  if (!m) return null;
  let scope = (m.groups?.scope ?? '').trim();
  const head = clauseLower.slice(0, clauseLower.length - (m.groups?.scope ?? '').length);
  let kind: CoverageKind = /overlap|conflict/.test(head) ? 'conflicts' : 'agenda';
  if (/forecast/.test(head)) kind = 'forecast';
  else if (/\b(?:have|got)$/.test(head.trim()) && /^(?:a\s+|any\s+)?forecast\b/.test(scope)) {
    kind = 'forecast';
    scope = scope.replace(/^(?:a\s+|any\s+)?forecast\b\s*/, '');
  }
  return {
    kind,
    else: /\b(?:else|more|other)\b/.test(head) || /^(?:anything\s+)?(?:else|more)\b/.test(scope),
    scope,
  };
}

/** The days, parts and people an absence's scope names; null if it holds anything else. */
function scopeOf(
  scope: string,
  scopeRaw: string,
  ledger: Ledger,
  today: Today,
): { days: Set<IsoDate>; parts: Set<DayPart>; persons: { id: string; name: string }[] } | null {
  const plain = scope.replace(QUALIFIERS, ' ');
  const tokens = plain.match(/[\p{L}\p{N}']+/gu) ?? [];
  const days = new Set<IsoDate>(relativeDays(plain, today).days);
  const parts = new Set<DayPart>();
  const weekdays: { name: string; next: boolean }[] = [];
  const explicit = new Set<IsoDate>();
  const monthOf = () => {
    const found = tokens
      .map((x) => (MONTHS.indexOf(x) >= 0 ? MONTHS.indexOf(x) : MONTH_SHORT.indexOf(x)))
      .find((x) => x >= 0);
    return found ?? Number(today.date.slice(5, 7)) - 1;
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!.replace(/'s$/, '');
    const part = /^(morning|afternoon|evening|night|tonight)s?$/.exec(tok);
    if (part)
      parts.add((part[1] === 'night' || part[1] === 'tonight' ? 'evening' : part[1]) as DayPart);
    if (SCOPE_WORDS.has(tok) || ledger.peopleWords.has(tok) || tok === 'set') continue;
    const wd = WEEKDAYS.includes(tok.replace(/s$/, ''))
      ? tok.replace(/s$/, '')
      : (WEEKDAY_ABBR[tok] ?? null);
    if (wd) {
      weekdays.push({ name: wd, next: tokens[i - 1] === 'next' });
      continue;
    }
    if (MONTHS.includes(tok) || MONTH_SHORT.includes(tok)) continue;
    const num = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(tok);
    if (num) {
      const mm = String(monthOf() + 1).padStart(2, '0');
      explicit.add(`${today.date.slice(0, 4)}-${mm}-${num[1]!.padStart(2, '0')}`);
      continue;
    }
    return null;
  }
  // "Saturday the 24th": a weekday beside a date must be that date's.
  if (explicit.size > 0) {
    for (const w of weekdays)
      if (![...explicit].some((d) => WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()] === w.name))
        return null;
    for (const d of explicit) days.add(d);
  } else for (const w of weekdays) days.add(weekdayDate(w.name, today, w.next));
  const persons: { id: string; name: string }[] = [];
  for (const m of peopleIn(scopeRaw.replace(QUALIFIERS, ' '), ledger)) {
    const id = ledger.peopleIds.get(m.name);
    if (id && !persons.some((p) => p.id === id)) persons.push({ id, name: m.name });
  }
  if (/\b(?:you|your)\b/.test(plain) && ledger.reader) {
    const id = ledger.peopleIds.get(ledger.reader);
    if (id && !persons.some((p) => p.id === id)) persons.push({ id, name: ledger.reader });
  }
  return { days, parts, persons };
}

/**
 * Whether an absence holds (B-1, I-8): its scope is days, parts of the day,
 * people and HOME's words only; each day it names (or, naming none, each day
 * a read of its kind covered) is covered completely for the people it names;
 * and no record of its kind on those days (in that part, for those people)
 * is in the ledger uncited ("else") or at all. "HOME doesn't have a dentist
 * appointment" holds only after a complete search for what it names, with
 * no result left uncited.
 */
function absenceHolds(
  claim: AbsenceClaim,
  scopeRaw: string,
  ledger: Ledger,
  today: Today,
  cited: readonly Ref[],
): boolean {
  const citedKeys = new Set(cited.map((c) => `${c.type}|${c.id}|${c.at ?? ''}`));
  const isCited = (e: LedgerEntry) =>
    citedKeys.has(`${e.ref.type}|${e.ref.id}|${e.ref.at ?? ''}`) ||
    citedKeys.has(`${e.ref.type}|${e.ref.id}|`);
  const scope = scopeOf(claim.scope, scopeRaw, ledger, today);
  if (scope === null) {
    // Not days and people: what was searched for, after a complete search?
    if (claim.kind !== 'agenda') return false;
    const sought = (claim.scope.replace(QUALIFIERS, ' ').match(/[\p{L}\p{N}']+/gu) ?? []).filter(
      (w) => !SEARCH_WORDS.has(w),
    );
    const queries = ledger.searchQueries();
    if (queries.length === 0) return false;
    if (!queries.some((q) => sought.every((w) => q.has(w) || q.has(w.replace(/s$/, '')))))
      return false;
    return !ledger.entries.some((e) => e.source === 'search' && !(claim.else && isCited(e)));
  }
  const { days, parts, persons } = scope;
  const claimedDays = days.size > 0 ? days : ledger.coveredDays(claim.kind);
  if (claimedDays.size === 0) return false;
  for (const d of claimedDays) {
    if (persons.length === 0) {
      if (!ledger.covers(claim.kind, d, null)) return false;
    } else if (persons.some((p) => !ledger.covers(claim.kind, d, p.id))) return false;
  }
  for (const e of ledger.entries) {
    const relevant =
      claim.kind === 'conflicts'
        ? e.ref.type === 'conflict'
        : claim.kind === 'forecast'
          ? e.ref.type === 'forecast'
          : e.ref.type === 'event' ||
            e.ref.type === 'task' ||
            e.ref.type === 'project' ||
            (e.ref.type === 'person' && e.item === 'birthday');
    if (!relevant) continue;
    if (![...e.facts.dates].some((d) => claimedDays.has(d))) continue;
    if (persons.length > 0 && !persons.some((p) => e.facts.people.has(p.name))) continue;
    // A part of the day: only what is in it, or has no time (all day, due, a birthday).
    if (parts.size > 0) {
      const timed = [...e.facts.times].some((t) => t !== '00:00');
      if (timed && ![...parts].some((p) => e.facts.parts.has(p))) continue;
    }
    if (claim.else && isCited(e)) continue;
    return false;
  }
  return true;
}

/** Whether a view says anything factual (a person, a record, a time, a date or a number). */
function factual(clause: string, lower: string, ledger: Ledger): boolean {
  if (peopleIn(clause, ledger).length > 0) return true;
  if (new RegExp(`\\d|\\b${NUMBER_WORD}\\b`, 'i').test(lower)) return true;
  if (
    new RegExp(
      `\\b(?:${[...WEEKDAYS, ...MONTHS].join('|')}|today|tomorrow|tonight|weekend|week)\\b`,
    ).test(lower)
  )
    return true;
  const words = new Set(wordsOf(clause));
  for (const e of ledger.entries)
    for (const t of e.facts.ownTexts)
      if (wordsOf(t).some((w) => significant(w) && words.has(w))) return true;
  return false;
}

// ---------------------------------------------------------------------------

/**
 * Checks an answer (§8.3). A decline passes (code renders it). Returns the
 * parsed answer when it passes (and whether it states an absence), or every
 * rule it failed, with where.
 */
export function validateAnswer(input: ValidateInput): ValidateResult {
  const answer = parseAnswer(input.raw);
  if (!answer)
    return { ok: false, answer: null, violations: [{ code: 'answer.schema', where: 'answer' }] };
  if ('decline' in answer) return { ok: true, answer, absence: false };
  const { violations, absence } = checkAnswer(answer, input);
  return violations.length === 0
    ? { ok: true, answer, absence }
    : { ok: false, answer, violations };
}

function checkAnswer(
  answer: AnswerOf,
  input: ValidateInput,
): { violations: Violation[]; absence: boolean } {
  const { ledger } = input;
  const out: Violation[] = [];
  const add = (code: ValidatorCode, where: Where) => {
    if (!out.some((v) => v.code === code && v.where === where)) out.push({ code, where });
  };
  const date = isoDateInZone(input.now, input.timeZone);
  const today: Today = { date, mondayFirst: mondayFirst(date) };
  const cited = uniqueCites(answer);
  const sensitive = (input.sensitive ?? []).map(norm).filter((s) => s.trim().length >= 4);
  let absence = false;
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
    const partFacts = ledger.factsOf(known);
    // Rule 0.
    if (unsafeText(p.text, new Set([...partFacts.words, ...ledger.peopleWords])))
      add('text.unsafe', p.where);
    const t = norm(p.text.replace(/[\p{Cf}\p{Cc}]/gu, ' '));
    const lowerAll = t.toLowerCase();

    // Clauses: absences, then claims.
    let missing = false;
    for (const sentence of sentences(t))
      for (const clause of clausesOf(sentence)) {
        const lower = clause.toLowerCase();
        const claim = absenceOf(lower);
        if (claim) {
          const scopeRaw = clause.slice(clause.length - claim.scope.length);
          if (absenceHolds(claim, scopeRaw, ledger, today, cited)) {
            absence = true;
            continue;
          }
          // An absence no covering read supports, or with more than a scope in it.
          add('absence.unsupported', p.where);
          continue;
        }
        if (known.length === 0) {
          if (p.kind !== 'view' || factual(clause, lower, ledger)) missing = true;
          continue;
        }
        // The records the clause is about; "A and B" with each half naming its own, a half at a time.
        const clauseWords = new Set(wordsOf(clause));
        const whole = bindings(clauseWords, lower, known, ledger);
        const halves = clause.split(/\s+and\s+/i);
        const pieces: { text: string; refs: Ref[] }[] = [];
        if (halves.length > 1) {
          const bound = halves.map((h) =>
            bindings(new Set(wordsOf(h)), h.toLowerCase(), known, ledger),
          );
          if (bound.every((b) => b.length > 0) && !bound.every((b) => sameRefs(b, bound[0]!)))
            halves.forEach((h, i) => pieces.push({ text: h, refs: bound[i]! }));
        }
        if (pieces.length === 0)
          pieces.push({ text: clause, refs: whole.length > 0 ? whole : known });
        for (const piece of pieces) {
          const pl = piece.text.toLowerCase();
          const facts = ledger.factsOf(piece.refs);
          const allowed = allowedFor(facts, known);
          const r = checkFacts(piece.text, allowed);
          if (!r.time) add('time.unsupported', p.where);
          if (!r.number) add('number.unsupported', p.where);
          // Relative days: the records must fall on them (I-9).
          const rel = relativeDays(pl, today);
          if (rel.named && ![...facts.dates].some((d) => rel.days.has(d)))
            add('time.unsupported', p.where);
          if (RECURRENCE.test(pl) && !facts.words.has('weekly') && !facts.words.has('fortnightly'))
            add('time.unsupported', p.where);
          const namesPerson = peopleIn(piece.text, ledger).length > 0;
          if (!keyedNumbersOk(pl, facts, namesPerson)) add('number.unsupported', p.where);
          if (!peopleOk(piece.text, pl, facts, ledger)) add('person.unsupported', p.where);
          // Rule 8: an overlap only with a cited conflict from get_conflicts.
          if (OVERLAP_WORDS.test(pl) && !known.some((c) => c.type === 'conflict'))
            add('conflict.unsupported', p.where);
          // Rule 11: a plan as made only as a cited timed record with its people.
          if (COMMITMENT.some((re) => re.test(pl)) || DOING.test(piece.text)) {
            const named = peopleIn(piece.text, ledger).map((m) => m.name);
            if (/\byou\b|\byou'/.test(pl) && ledger.reader) named.push(ledger.reader);
            const ok = piece.refs.some((c) => {
              if (c.type !== 'event' && c.type !== 'task') return false;
              const f = ledger.factsOf([c]);
              if (f.times.size === 0) return false;
              return named.every((n) => f.people.has(n));
            });
            if (!ok) add('commitment.unrecorded', p.where);
          }
        }
      }
    if (missing) add('cite.missing', p.where);

    // Rule 6: capitalised words.
    if (!namesKnown(t, partFacts.words, ledger)) add('name.unknown', p.where);
    // Rule 7: the four lists. Exempt: a quoted cited title, word for word, and a visible person's name.
    let listed = t.replace(/"([^"]{1,200})"/g, (m, inner: string) =>
      partFacts.texts.has(inner.trim()) ? ' \u0000 ' : m,
    );
    for (const n of [...ledger.peopleNames].sort((a, b) => b.length - a.length))
      listed = listed.replace(
        new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'gu'),
        ' \u0000 ',
      );
    if (forbiddenIn(listed).length > 0) add('phrase.forbidden', p.where);
    // Rule 9.
    if (AVAILABILITY.some((re) => re.test(lowerAll))) add('availability.claim', p.where);
    // Rule 10: a gap is only ever "nothing is recorded"; a fact (or `say`) citing one says so.
    const citesGap = known.some((c) => c.type === 'gap');
    if (
      GAP_OPEN.test(lowerAll) ||
      (citesGap &&
        p.kind !== 'view' &&
        !GAP_SAID.test(lowerAll) &&
        !/\b(?:has|have) nothing recorded\b/.test(lowerAll))
    )
      add('gap.unqualified', p.where);
    // Rule 12: completed actions and promises by Kev.
    if (sentences(lowerAll).some((s) => AUTHORITY.some((re) => re.test(s))))
      add('authority.claim', p.where);
    // Rule 13: no link, address, markup or id; nor any ref id the ledger holds.
    if (
      MARKUP.some((re) => re.test(t)) ||
      ledger.entries.some((e) => e.ref.id.length >= 8 && t.includes(e.ref.id))
    )
      add('markup', p.where);
    // Rule 14.
    if (p.kind === 'say' && VIEW_MARKER.test(lowerAll)) add('view.in_say', p.where);
    // Rule 15.
    if (FILLER.some((f) => phrasePattern(f).test(t))) add('tone.filler', p.where);
    // Rule 16.
    if (sensitive.some((s) => lowerAll.includes(s.toLowerCase()))) add('sensitive.leak', p.where);
  }
  return {
    violations: out.sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code)),
    absence,
  };
}

/** The distinct codes of a set of violations, in rule order (content v2's `violations`). */
export function codesOf(violations: readonly Violation[]): ValidatorCode[] {
  return ORDER.filter((c) => violations.some((v) => v.code === c));
}

/** The part-of-day of an instant's wall clock (exported for the ledger's tests). */
export { partOf };
