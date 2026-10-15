import 'server-only';
import { bandWords } from '@/domain/engines/weather';
import type { IsoDate } from '@/lib/dates';
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
   * Could read as "yes" (or, for "No worries.", as "no"): never to a
   * yes-or-no question, an availability or overlap question, or a message
   * HOME cannot classify. A block shown is never a yes or no.
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

export type MessageShape = {
  /** HOME could read the message at all (a test may give none). */
  known: boolean;
  /** It asks something, or asks for something: never answered with a social lead alone. */
  question: boolean;
  /** It can be answered yes or no (or reads that way): no affirming lead. */
  yesNo: boolean;
  /** It is about who is free, busy, around or away, or about overlaps: no affirming lead. */
  availability: boolean;
};

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
/** Openers and courtesies skipped at the start of a clause. */
const OPENERS = words(`kev hey hi hello kia ora morena morning ok okay so and but also then um uh
  oh ah right well hmm please just quick thanks thank you cheers ta sweet great nice actually now`);
/** A clause starting with one of these can be answered yes or no. */
const AUX =
  words(`is isnt are arent am was wasnt were werent do dont does doesnt did didnt has hasnt
  have havent had hadnt can cant could couldnt will wont would wouldnt should shouldnt shall may
  might must any anything anyone anybody someone something got is there are there`);
const WH = words(`what whats when whens where wheres who whos whose whom which why how hows`);
/** Asking for something, in other words. */
const REQUEST = words(`show tell list find check look give search remind book add help explain
  walk run let lets`);
const AVAILABILITY_WORDS = words(`free available availability unavailable busy around away clash
  clashes clashing overlap overlaps overlapping conflict conflicts conflicting double clear spare
  open booked make home`);

/**
 * The shape of the adult's message (owner decision 6), conservatively:
 * anything with a question mark, a clause opening with a question word or
 * an auxiliary ("Is…", "Any…", "Did…"), or a request verb is a question; a
 * question mark without a question word, or a clause opening with an
 * auxiliary, is yes-or-no-shaped; any availability or overlap word makes it
 * an availability question. It only ever withholds leads.
 */
export function classifyMessage(text: string | undefined): MessageShape {
  if (text === undefined || text.trim() === '')
    return { known: false, question: true, yesNo: true, availability: true };
  const norm = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ`']/g, '')
    .replace(/[ā]/g, 'a')
    .replace(/[ē]/g, 'e')
    .replace(/[ī]/g, 'i')
    .replace(/[ō]/g, 'o')
    .replace(/[ū]/g, 'u');
  const clauses = norm
    .split(/[,.;:!?\n–—-]+|\b(?:and|so|but|or|then)\b/)
    .map((c) => (c.match(/[a-z0-9]+/g) ?? []).filter(Boolean))
    .map((ws) => {
      let i = 0;
      while (i < ws.length && OPENERS.has(ws[i]!)) i++;
      return ws.slice(i);
    })
    .filter((ws) => ws.length > 0);
  const all = norm.match(/[a-z0-9]+/g) ?? [];
  const mark = norm.includes('?');
  const auxClause = clauses.some((ws) => AUX.has(ws[0]!));
  const whWord = all.some((w) => WH.has(w));
  const question = mark || auxClause || whWord || all.some((w) => REQUEST.has(w));
  const yesNo = auxClause || (mark && !whWord);
  const availability =
    all.some((w) => AVAILABILITY_WORDS.has(w)) ||
    /\b(?:make it|same time|at once|anything on|nothing on)\b/.test(norm);
  return { known: true, question, yesNo, availability };
}

// ---------------------------------------------------------------------------
// Kev's view: typed interpretations.

export const VIEW_TYPES = ['consideration', 'suggestion', 'follow_up', 'uncertainty'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

/**
 * What a phrase needs of the blocks it is about (checked by code, over
 * those blocks only, and only over what they show):
 * - `none`: nothing (HOME's own caveat);
 * - `record`: at least one record;
 * - `several`: at least two records;
 * - `tight`: an overlap HOME flagged, or two timed events that overlap or
 *   follow within 30 minutes;
 * - `people`: an overlap, or an event recording someone besides the reader;
 * - `same_day`: an overlap, or two events on the same day;
 * - `wet`: a forecast day, part of a day or stretch shown as showers or rain;
 * - `cool_or_wet`: `wet`, or a forecast low of 12°C or under shown;
 * - `forecast`: a forecast shown;
 * - `birthday`: a birthday shown (a person's, or HOME's birthday insight);
 * - `open_assigned`: a task shown as open, with its assignee;
 * - `stretch_estimate`: exactly one stretch and one task whose estimate is
 *   shown, the stretch at least as long as the estimate;
 * - `calendar_unhealthy`: a calendar shown as not up to date;
 * - `may_have_changed`: a calendar not up to date, or context flagged stale.
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

const shows = (a: AboutBlock, f: string) => a.show.includes(f);
const recOf = (a: AboutBlock) => a.entry?.record ?? null;

function wetShown(a: AboutBlock): boolean {
  const b = a.block;
  const o = recOf(a);
  if (isSummary(b) || !o) return false;
  if (b.kind === 'forecast') {
    const phrase = typeof o.phrase === 'string' ? o.phrase : '';
    const phraseWet =
      shows(a, 'phrase') &&
      (phrase.startsWith(bandWords('showers')) || phrase.startsWith(bandWords('rain')));
    const parts = Array.isArray(o.parts) ? (o.parts as { band?: string }[]) : [];
    const partWet = shows(a, 'parts') && parts.some((p) => WET.has(String(p.band)));
    return phraseWet || partWet;
  }
  if (b.kind === 'gap') return shows(a, 'forecast') && WET.has(String(o.forecast_band));
  return false;
}

function forecastShown(a: AboutBlock): boolean {
  const b = a.block;
  if (isSummary(b) || !recOf(a)) return false;
  return b.kind === 'forecast' || (b.kind === 'gap' && shows(a, 'forecast'));
}

/**
 * Whether the blocks a view is about support its phrase (above). `reader`:
 * the reader's own person id, when HOME knows it.
 */
export function supports(
  phrase: ViewPhraseId,
  about: readonly AboutBlock[],
  reader: string | null,
): boolean {
  const records = about.filter((a) => !isSummary(a.block) && a.entry?.record);
  const of = (kind: string) => records.filter((a) => a.block.kind === kind);
  const timedEvents = of('event').filter((a) => a.entry!.span !== null);
  switch (VIEW_PHRASES[phrase].support) {
    case 'none':
      return true;
    case 'record':
      return records.length > 0;
    case 'several':
      return records.length >= 2;
    case 'tight': {
      if (of('conflict').length > 0) return true;
      const spans = timedEvents.map((a) => a.entry!.span!).sort((x, y) => x.from - y.from);
      return spans.some((s, i) => i > 0 && s.from - spans[i - 1]!.to <= TIGHT_MS);
    }
    case 'people':
      return (
        of('conflict').length > 0 ||
        of('event').some(
          (a) =>
            a.entry!.shape === 'agenda_event' &&
            shows(a, 'people') &&
            [...(a.entry!.people ?? [])].some((p) => p !== reader),
        )
      );
    case 'same_day': {
      if (of('conflict').length > 0) return true;
      const seen = new Set<IsoDate>();
      for (const a of of('event'))
        for (const d of a.entry!.dates) {
          if (seen.has(d)) return true;
          seen.add(d);
        }
      return false;
    }
    case 'wet':
      return about.some(wetShown);
    case 'cool_or_wet':
      return (
        about.some(wetShown) ||
        of('forecast').some(
          (a) =>
            shows(a, 'temperature') &&
            typeof recOf(a)!.low_c === 'number' &&
            (recOf(a)!.low_c as number) <= COOL_C,
        )
      );
    case 'forecast':
      return about.some(forecastShown);
    case 'birthday':
      return (
        of('person').some(
          (a) =>
            shows(a, 'birthday') &&
            (a.entry!.shape === 'birthday' ||
              (a.entry!.shape === 'people_person' &&
                (recOf(a)!.next_birthday as { date?: unknown } | null)?.date !== undefined)),
        ) || of('insight').some((a) => /(?:^|\.)birthday(?:\.|$)/.test(String(recOf(a)!.rule)))
      );
    case 'open_assigned':
      return of('task').some(
        (a) =>
          a.entry!.shape === 'task' &&
          shows(a, 'status') &&
          shows(a, 'assignee') &&
          recOf(a)!.status === 'open' &&
          recOf(a)!.assignee !== null &&
          recOf(a)!.assignee !== undefined,
      );
    case 'stretch_estimate': {
      const gaps = of('gap');
      const tasks = of('task').filter((a) => a.entry!.shape === 'task' && shows(a, 'estimate'));
      if (gaps.length !== 1 || tasks.length !== 1) return false;
      const g = recOf(gaps[0]!)!;
      const est = recOf(tasks[0]!)!.estimate_minutes;
      const from = Date.parse(String(g.from));
      const to = Date.parse(String(g.to));
      return (
        typeof est === 'number' &&
        Number.isFinite(from) &&
        Number.isFinite(to) &&
        to - from >= est * 60_000
      );
    }
    case 'calendar_unhealthy':
      return of('calendar').some((a) => recOf(a)!.status !== 'healthy');
    case 'may_have_changed':
      return (
        of('calendar').some((a) => recOf(a)!.status !== 'healthy') ||
        of('context').some((a) => recOf(a)!.stale === true)
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
