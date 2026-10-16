import 'server-only';
import { bandWords } from '@/domain/engines/weather';
import type { LedgerEntry } from './ledger';
import type { FactBlock } from './schema';

// What Kev may say in its own name (M8 contract §8.1, §8.2; owner decisions
// of 2026-10-15, ADR 0012 §46, decisions 6–8): HOME's code-owned
// catalogue. The model never writes a sentence. It selects:
// - a **lead**, by identifier, from the lead catalogue below; code writes
//   its words (and fills `{when}`), and code decides when each is allowed:
//   by what the plan shows and, to restrict only, by the shape of the
//   adult's message (`classifyMessage`);
// - optionally **Kev's view**, a typed interpretation: a type
//   (`consideration`, `suggestion`, `follow_up`, `uncertainty`), a phrase
//   from that type's approved vocabulary, and the fact blocks it is about.
//   Code writes the phrase and checks that the blocks it is about support
//   it (a raincoat beside a wet forecast; leaving early beside an overlap or
//   a tight sequence), so a phrase whose sense depends on facts is only ever
//   shown beside those facts.
// Model reasoning stays flexible; the initial presentation vocabulary is
// deliberately constrained (owner, 2026-10-15). The registry is versioned:
// adding a lead, a type or a phrase is a reviewed change to this file, its
// tests, the contract's §8.1 and the stored plan's closed sets (content v2;
// application schema, no migration). Nothing here acts, remembers or
// changes a record: every phrase is words, checked against the four
// forbidden lists like all fixed copy.

/** The catalogue's version (bumped by any change to the leads, types or phrases). */
export const CATALOGUE_VERSION = 1;

// ---------------------------------------------------------------------------
// Leads.

export const LEAD_IDS = [
  'home_has',
  'when',
  'righto_when',
  'here_you_go',
  'good_question',
  'found',
  'have_a_look',
  'ka_pai',
  'no_worries',
  'flagged',
  'welcome',
  'kia_ora',
  'morena',
  'ka_kite',
  'cheers',
  'unsure',
] as const;
export type LeadId = (typeof LEAD_IDS)[number];

/** `{when}`: the days the plan's blocks are on, filled by code. */
export const WHEN = '{when}';

type LeadSpec = {
  text: string;
  /**
   * `facts`: shown beside at least one fact block; `social`: only as the
   * whole reply to a message that asks nothing, with no fact block and no
   * view; `uncertain`: HOME's fixed "not sure" reply, with no fact block and
   * no view.
   */
  kind: 'facts' | 'social' | 'uncertain';
  /** Holds `{when}`: needs a dated block. */
  when?: true;
  /** "here it is": exactly one block, a record. */
  one?: true;
  /** Needs at least one record block (not only an absence or count). */
  record?: true;
  /** "flagged": needs an overlap or an insight HOME flagged. */
  flagged?: true;
  /**
   * Could read as "yes" (or, for "No worries.", as "no"): only for a message
   * HOME clearly recognises as informational (`classifyMessage`), never for
   * anything else. A block shown is never a yes or no.
   */
  affirming?: true;
};

export const LEADS: Readonly<Record<LeadId, LeadSpec>> = Object.freeze({
  home_has: { text: 'Here’s what HOME has.', kind: 'facts' },
  when: { text: 'Here’s {when}.', kind: 'facts', when: true },
  righto_when: { text: 'Righto, here’s {when}.', kind: 'facts', when: true, affirming: true },
  here_you_go: { text: 'Here you go.', kind: 'facts' },
  good_question: { text: 'Good question.', kind: 'facts' },
  found: { text: 'Here’s what I found.', kind: 'facts' },
  have_a_look: { text: 'Let’s have a look.', kind: 'facts' },
  ka_pai: { text: 'Ka pai, here it is.', kind: 'facts', one: true, affirming: true },
  no_worries: { text: 'No worries.', kind: 'facts', record: true, affirming: true },
  flagged: { text: 'Here’s what HOME flagged.', kind: 'facts', flagged: true },
  welcome: { text: 'You’re welcome.', kind: 'social' },
  kia_ora: { text: 'Kia ora.', kind: 'social' },
  morena: { text: 'Mōrena.', kind: 'social' },
  ka_kite: { text: 'Ka kite.', kind: 'social' },
  cheers: { text: 'Cheers.', kind: 'social' },
  unsure: { text: 'I’m not sure what you’re after. Try asking another way.', kind: 'uncertain' },
});

/** The lead HOME uses when the model's lead or view fails but its facts pass (§8.5). */
export const SALVAGE_LEAD_ID: LeadId = 'home_has';

// ---------------------------------------------------------------------------
// The adult's message: a code-side classifier used only to restrict leads.
//
// Deny by default (owner decisions of 2026-10-15, ADR 0012 §47): an
// affirming lead is allowed only for a message HOME clearly recognises as
// informational, and a social lead only for a message made of nothing but
// greetings, thanks, farewells and courtesies. Everything else (a yes-or-no
// question, availability, overlaps, a status check, a condition, an action
// request, a fragment HOME cannot place) gets neither: a neutral lead and
// the facts. Misreading a message costs a lead, never a fact.

export type MessageShape = {
  /** HOME could read the message at all (a test may give none). */
  known: boolean;
  /**
   * Only greeting, thanks, farewell or courtesy words (with emoji and
   * punctuation, but no question mark): the one message a social lead may
   * answer, with no facts.
   */
  social: boolean;
  /**
   * Clearly informational: every clause a positive question-word question
   * ("What's on this weekend?", "When is swimming?", "Who is attending?")
   * or a read request ("Show my tasks.", "List tomorrow's commitments."),
   * with no yes-or-no form, availability, overlap or status word, no "if"
   * or "whether", and no action verb. Only then may an affirming lead be used.
   */
  informational: boolean;
};

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
/** Courtesies skipped at the start of a clause ("Thanks Kev, what's on?"). */
const OPENERS = words(`kev hey hi hello kia ora morena morning ok okay so um uh oh ah hmm please
  just quick thanks thank you cheers ta now actually`);
/** Question words that open a positive informational question ("why" presumes, so it is left out). */
const WH = words(`what whats when whens where wheres who whos whose whom which how hows`);
/** Read requests: the verbs that ask HOME to show what it has. */
const READ = words(`show list find check look search tell give`);
/** After "tell" or "give", only the adult themselves: "tell Alex …" is a message to send. */
const TO_READER = words(`me us`);
/** Words that make a message about who is free, busy or around, or about overlaps (English and te reo). */
const AVAILABILITY = words(`free available availability unavailable busy around away clash clashes
  clashing overlap overlaps overlapping conflict conflicts conflicting double clear spare open
  booked home watea`);
const AVAILABILITY_PHRASES = /\b(?:make it|same time|at once|anything on|nothing on)\b/;
/** A state to confirm: a question about it can be answered yes or no. */
const STATUS = words(`still yet sorted cancelled canceled confirmed`);
/** A condition: "if", "whether". */
const CONDITION = words(`if whether`);
/** Asking Kev to do something (an action HOME declines), anywhere in the message. */
const ACTION = words(`book add cancel pay text move swap delete remove remind send schedule
  reschedule change email message ring call arrange organise organize save remember invite buy
  order update edit`);

/**
 * Social words and phrases, each as its words (longest first when matched):
 * a message is social only when these cover every word of it.
 */
const SOCIAL = [
  'thank you very much',
  'thank you so much',
  'thanks for that',
  'thank you for that',
  'much appreciated',
  'appreciate it',
  'see you later',
  'catch you later',
  'thats great',
  'thats awesome',
  'thats good',
  'thats perfect',
  'thats lovely',
  'thats helpful',
  'very helpful',
  'thank you',
  'thanks heaps',
  'thanks mate',
  'kia ora',
  'ka kite',
  'ka kite ano',
  'nga mihi',
  'tena koe',
  'see ya',
  'see you',
  'nice one',
  'sweet as',
  'good morning',
  'good night',
  'all good',
  'no worries',
  'thanks',
  'thank',
  'thx',
  'ta',
  'cheers',
  'mate',
  'kev',
  'morena',
  'bye',
  'goodbye',
  'ok',
  'okay',
  'hi',
  'hello',
  'hey',
  'heaps',
  'great',
  'awesome',
  'perfect',
  'lovely',
  'brilliant',
  'helpful',
  'legend',
  'cool',
  'sweet',
  'good',
  'night',
  'later',
].map((p) => p.split(' '));

/** The message lower-cased, apostrophes dropped and macrons folded ("wātea" → "watea"). */
function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ`']/g, '')
    .normalize('NFD')
    .replace(/̄/g, '')
    .normalize('NFC');
}

/** Whether these words are covered, in order, by the social phrases alone. */
function allSocial(ws: readonly string[]): boolean {
  let i = 0;
  while (i < ws.length) {
    const at = i;
    const match = SOCIAL.filter((p) => p.every((w, k) => ws[at + k] === w)).sort(
      (a, b) => b.length - a.length,
    )[0];
    if (!match) return false;
    i += match.length;
  }
  return true;
}

/**
 * The shape of the adult's message (above). Pure; it only ever withholds
 * leads, never answers.
 */
export function classifyMessage(text: string | undefined): MessageShape {
  if (text === undefined || text.trim() === '')
    return { known: false, social: false, informational: false };
  const norm = normalise(text);
  const all = norm.match(/[\p{L}\p{N}]+/gu) ?? [];
  const pictographs = /\p{Extended_Pictographic}/u.test(norm);
  const mark = norm.includes('?');
  const social =
    !mark &&
    (all.length > 0 || pictographs) &&
    all.every((w) => /^[a-z]+$/.test(w)) &&
    allSocial(all);

  const clauses = norm
    .split(/[,.;:!?\n–—-]+|\b(?:and|so|but|or|then)\b/)
    .map((c) => c.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((ws) => {
      let i = 0;
      while (i < ws.length && OPENERS.has(ws[i]!)) i++;
      return ws.slice(i);
    })
    .filter((ws) => ws.length > 0);
  const opensInformational = (ws: readonly string[]) =>
    WH.has(ws[0]!) ||
    (READ.has(ws[0]!) && (!/^(?:tell|give)$/.test(ws[0]!) || TO_READER.has(ws[1] ?? '')));
  const informational =
    clauses.length > 0 &&
    clauses.every(opensInformational) &&
    !all.some((w) => AVAILABILITY.has(w) || STATUS.has(w) || CONDITION.has(w) || ACTION.has(w)) &&
    !AVAILABILITY_PHRASES.test(norm);
  return { known: true, social, informational };
}

// ---------------------------------------------------------------------------
// Kev's view: typed interpretations.

export const VIEW_TYPES = ['consideration', 'suggestion', 'follow_up', 'uncertainty'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

/**
 * What a phrase needs of the blocks it is about (checked by code, over
 * those blocks only, and only over what they show). Every block a view is
 * about must itself support it (owner decision of 2026-10-15, ADR 0012 §47):
 * no unrelated block can lend support, each record counts once (by its full
 * identity, occurrence included), and only `none` may rest on an absence or
 * a count.
 * - `none`: nothing (HOME's own caveat);
 * - `record`: records;
 * - `several`: two or more distinct records;
 * - `tight`: overlaps HOME flagged, and timed events each overlapping or
 *   within 30 minutes of another event it is about;
 * - `people`: overlaps, and events each showing someone besides the reader;
 * - `same_day`: overlaps, and events each on a day another event or overlap
 *   it is about is on;
 * - `wet`: forecast days, parts of days or stretches each shown as showers
 *   or rain, and records each on a day one of those is for;
 * - `cool_or_wet`: as `wet`, a forecast day also qualifying by a low of
 *   12°C or under, shown;
 * - `forecast`: forecasts shown (a forecast day, or a stretch's band);
 * - `birthday`: birthdays shown (someone else's, or HOME's birthday insight
 *   about someone else);
 * - `open_assigned`: tasks each shown as open, with its assignee;
 * - `stretch_estimate`: exactly one stretch and one task whose estimate is
 *   shown, the stretch at least as long as the estimate, and, when the task
 *   records dry weather as a need, the stretch's band shown as dry;
 * - `calendar_unhealthy`: calendars each shown as not up to date;
 * - `may_have_changed`: calendars not up to date, or context flagged stale.
 */
export type Support =
  | 'none'
  | 'record'
  | 'several'
  | 'tight'
  | 'people'
  | 'same_day'
  | 'wet'
  | 'cool_or_wet'
  | 'forecast'
  | 'birthday'
  | 'open_assigned'
  | 'stretch_estimate'
  | 'calendar_unhealthy'
  | 'may_have_changed';

type PhraseSpec = { type: ViewType; text: string; support: Support };

export const VIEW_PHRASES = Object.freeze({
  leave_early: { type: 'consideration', text: 'Might be worth leaving early.', support: 'tight' },
  check_with_others: {
    type: 'consideration',
    text: 'Worth checking with the others.',
    support: 'people',
  },
  double_check: { type: 'consideration', text: 'Worth double-checking those.', support: 'several' },
  plan_b: { type: 'consideration', text: 'Might be worth having a plan B.', support: 'wet' },
  present: {
    type: 'consideration',
    text: 'Might be worth thinking about a present.',
    support: 'birthday',
  },
  raincoat: { type: 'suggestion', text: 'Could be worth a raincoat.', support: 'wet' },
  jacket: { type: 'suggestion', text: 'Might be worth a jacket.', support: 'cool_or_wet' },
  nudge: { type: 'suggestion', text: 'Might be worth a nudge.', support: 'open_assigned' },
  stretch_estimate: {
    type: 'suggestion',
    text: 'That stretch is at least as long as the task’s estimate.',
    support: 'stretch_estimate',
  },
  who_goes_where: {
    type: 'follow_up',
    text: 'Worth a quick chat about who goes where.',
    support: 'same_day',
  },
  check_calendar: {
    type: 'follow_up',
    text: 'Might be worth checking that calendar.',
    support: 'calendar_unhealthy',
  },
  ask_more: {
    type: 'follow_up',
    text: 'Ask me about any of these for more detail.',
    support: 'record',
  },
  recorded_only: {
    type: 'uncertainty',
    text: 'HOME only knows what’s been recorded.',
    support: 'none',
  },
  forecast_can_change: { type: 'uncertainty', text: 'Forecasts can change.', support: 'forecast' },
  may_have_changed: {
    type: 'uncertainty',
    text: 'Things may have changed since this was recorded.',
    support: 'may_have_changed',
  },
} as const satisfies Record<string, PhraseSpec>);
export type ViewPhraseId = keyof typeof VIEW_PHRASES;
export const VIEW_PHRASE_IDS = Object.keys(VIEW_PHRASES) as [ViewPhraseId, ...ViewPhraseId[]];

/** The phrases of a type. */
export const phrasesOf = (type: ViewType): ViewPhraseId[] =>
  VIEW_PHRASE_IDS.filter((p) => VIEW_PHRASES[p].type === type);

/** What the support check sees of a block the view is about. */
export type AboutBlock = {
  block: FactBlock;
  /** The entry the block was rendered from (null for an absence or a count). */
  entry: LedgerEntry | null;
  /** The fields the block shows (its `show`, or its kind's usual ones). */
  show: readonly string[];
};

// No runtime import of ./schema (which imports this module's closed sets).
const isSummary = (b: FactBlock) => b.kind === 'absence' || b.kind === 'count';

const TIGHT_MS = 30 * 60_000;
const WET = new Set(['showers', 'rain']);
const COOL_C = 12;
/** HOME's birthday insight (src/domain/engines/insights). */
const BIRTHDAY_RULES = new Set(['preparation.birthday']);
/** How many people an event block lists (the renderer's limit). */
export const LIST_MAX = 8;

const shows = (a: AboutBlock, f: string) => a.show.includes(f);
const recOf = (a: AboutBlock) => a.entry!.record!;
const kindOf = (a: AboutBlock) => a.block.kind;
/** A record's full identity: its type, id and occurrence. */
const identity = (a: AboutBlock) =>
  `${a.entry!.ref.type}|${a.entry!.ref.id}|${a.entry!.ref.at ?? ''}`;
const shareDate = (a: AboutBlock, b: AboutBlock) =>
  [...a.entry!.dates].some((d) => b.entry!.dates.has(d));

function wetShown(a: AboutBlock): boolean {
  const o = recOf(a);
  if (kindOf(a) === 'forecast') {
    const phrase = typeof o.phrase === 'string' ? o.phrase : '';
    const phraseWet =
      shows(a, 'phrase') &&
      (phrase.startsWith(bandWords('showers')) || phrase.startsWith(bandWords('rain')));
    const parts = Array.isArray(o.parts) ? (o.parts as { band?: string }[]) : [];
    const partWet = shows(a, 'parts') && parts.some((p) => WET.has(String(p.band)));
    return phraseWet || partWet;
  }
  if (kindOf(a) === 'gap') return shows(a, 'forecast') && WET.has(String(o.forecast_band));
  return false;
}

const coolShown = (a: AboutBlock) =>
  kindOf(a) === 'forecast' &&
  shows(a, 'temperature') &&
  typeof recOf(a).low_c === 'number' &&
  (recOf(a).low_c as number) <= COOL_C;

const forecastShown = (a: AboutBlock) =>
  kindOf(a) === 'forecast' ||
  (kindOf(a) === 'gap' && shows(a, 'forecast') && typeof recOf(a).forecast_band === 'string');

/**
 * Weather support: at least one forecast day or stretch, every one of them
 * qualifying, and every other block a record on a day one of them is for
 * (a raincoat beside Saturday's football needs Saturday's wet forecast).
 */
function weatherSupports(about: readonly AboutBlock[], qualifies: (a: AboutBlock) => boolean) {
  const weather = about.filter((a) => kindOf(a) === 'forecast' || kindOf(a) === 'gap');
  if (weather.length === 0 || !weather.every(qualifies)) return false;
  return about.every((a) => weather.includes(a) || weather.some((w) => shareDate(a, w)));
}

const isConflict = (a: AboutBlock) => kindOf(a) === 'conflict' && a.entry!.shape === 'conflict';
const isEvent = (a: AboutBlock) => kindOf(a) === 'event';
const timed = (a: AboutBlock) => isEvent(a) && a.entry!.span !== null;
/** Two spans overlap, or the later starts within 30 minutes of the earlier's end. */
const close = (a: AboutBlock, b: AboutBlock) => {
  const x = a.entry!.span!;
  const y = b.entry!.span!;
  return Math.max(x.from, y.from) - Math.min(x.to, y.to) <= TIGHT_MS;
};

function birthdayShown(a: AboutBlock, reader: string | null): boolean {
  const o = recOf(a);
  if (kindOf(a) === 'person')
    return (
      a.entry!.ref.id !== reader &&
      shows(a, 'birthday') &&
      (a.entry!.shape === 'birthday' ||
        (a.entry!.shape === 'people_person' &&
          typeof (o.next_birthday as { date?: unknown } | null)?.date === 'string'))
    );
  if (kindOf(a) === 'insight') {
    const about = Array.isArray(o.refs) ? (o.refs as { type?: string; id?: string }[]) : [];
    return (
      BIRTHDAY_RULES.has(String(o.rule)) &&
      !about.some((r) => r.type === 'person' && r.id === reader)
    );
  }
  return false;
}

const openAssigned = (a: AboutBlock) =>
  kindOf(a) === 'task' &&
  a.entry!.shape === 'task' &&
  shows(a, 'status') &&
  shows(a, 'assignee') &&
  recOf(a).status === 'open' &&
  recOf(a).assignee !== null &&
  recOf(a).assignee !== undefined;

const unhealthyCalendar = (a: AboutBlock) =>
  kindOf(a) === 'calendar' && recOf(a).status !== 'healthy';

/**
 * Whether the blocks a view is about support its phrase (above). `reader`:
 * the reader's own person id, when HOME knows it.
 */
export function supports(
  phrase: ViewPhraseId,
  about: readonly AboutBlock[],
  reader: string | null,
): boolean {
  const need = VIEW_PHRASES[phrase].support;
  if (need === 'none') return true;
  // Records only, each rendered from a record HOME read, each record once.
  if (about.length === 0) return false;
  if (about.some((a) => isSummary(a.block) || !a.entry?.record)) return false;
  if (new Set(about.map(identity)).size !== about.length) return false;
  const all = (f: (a: AboutBlock) => boolean) => about.every(f);
  const others = (a: AboutBlock) => about.filter((b) => b !== a);
  switch (need) {
    case 'record':
      return true;
    case 'several':
      return about.length >= 2;
    case 'tight':
      return all(
        (a) => isConflict(a) || (timed(a) && others(a).some((b) => timed(b) && close(a, b))),
      );
    case 'people':
      return all(
        (a) =>
          isConflict(a) ||
          (isEvent(a) &&
            a.entry!.shape === 'agenda_event' &&
            shows(a, 'people') &&
            (Array.isArray(recOf(a).people) ? (recOf(a).people as { ref?: { id?: string } }[]) : [])
              .slice(0, LIST_MAX)
              .some((p) => typeof p.ref?.id === 'string' && p.ref.id !== reader)),
      );
    case 'same_day':
      return all(
        (a) =>
          isConflict(a) ||
          (isEvent(a) && others(a).some((b) => (isEvent(b) || isConflict(b)) && shareDate(a, b))),
      );
    case 'wet':
      return weatherSupports(about, wetShown);
    case 'cool_or_wet':
      return weatherSupports(about, (a) => wetShown(a) || coolShown(a));
    case 'forecast':
      return all(forecastShown);
    case 'birthday':
      return all((a) => birthdayShown(a, reader));
    case 'open_assigned':
      return all(openAssigned);
    case 'stretch_estimate': {
      if (about.length !== 2) return false;
      const g = about.find((a) => kindOf(a) === 'gap');
      const t = about.find(
        (a) => kindOf(a) === 'task' && a.entry!.shape === 'task' && shows(a, 'estimate'),
      );
      if (!g || !t) return false;
      const est = recOf(t).estimate_minutes;
      const from = Date.parse(String(recOf(g).from));
      const to = Date.parse(String(recOf(g).to));
      const needs = Array.isArray(recOf(t).needs) ? (recOf(t).needs as unknown[]) : [];
      if (
        needs.includes('dry_weather') &&
        !(shows(g, 'forecast') && recOf(g).forecast_band === 'dry')
      )
        return false;
      return (
        typeof est === 'number' &&
        Number.isFinite(from) &&
        Number.isFinite(to) &&
        to - from >= est * 60_000
      );
    }
    case 'calendar_unhealthy':
      return all(unhealthyCalendar);
    case 'may_have_changed':
      return all(
        (a) => unhealthyCalendar(a) || (kindOf(a) === 'context' && recOf(a).stale === true),
      );
  }
}

/** Every fixed string of the catalogue, for the copy test against the four lists. */
export function catalogueCopy(): string[] {
  return [
    ...LEAD_IDS.map((l) => LEADS[l].text.replace(WHEN, 'today')),
    ...VIEW_PHRASE_IDS.map((p) => VIEW_PHRASES[p].text),
  ];
}
