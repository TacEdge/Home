import 'server-only';
import { FILLER, forbiddenIn, phrasePattern } from './language';
import type { Ledger } from './ledger';

// The fact-free check of the model's own words (M8 contract \u00A78.3; owner
// amendment, ADR 0012 \u00A746): the lead and Kev's view. The model no longer
// states facts, so nothing here tries to verify one. Instead the text is
// refused if it carries anything fact-bearing, by closed categories, deny
// by default: a digit or number word; a clock, date, day, part-of-day or
// month word; a person's name, a relationship word, a third-person pronoun
// or a group of people; a word of any recorded title, name, label or note,
// a weather or place word; status, completion, commitment, exclusivity or
// negation; availability; an overlap word; a claim by Kev to have done or to
// do something; the four forbidden lists; markup or a link; and any
// character outside plain printable ASCII, typographic quotes and dashes,
// and macron vowels (so control and format characters, combining marks,
// other scripts' digits and look-alike letters never reach a check).
//
// The boundary, stated plainly: this is defence in depth, not proof. The
// facts the adult reads are rendered by code from records; this keeps the
// model's words from carrying any, as far as a closed vocabulary can. An
// open-vocabulary noun ("indoors" aside, "a haircut") can still pass; it is
// labelled as Kev's words and carries no time, name, number or status.

export type ProseCode =
  | 'text.unsafe'
  | 'markup'
  | 'prose.time'
  | 'prose.number'
  | 'prose.person'
  | 'prose.record'
  | 'prose.claim'
  | 'availability.claim'
  | 'conflict.unsupported'
  | 'authority.claim'
  | 'phrase.forbidden'
  | 'tone.filler';

/** Printable ASCII, typographic quotes, dashes and ellipsis, and macron vowels: nothing else. */
const ALLOWED =
  /^[\x20-\x7E\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u0100\u0101\u0112\u0113\u012A\u012B\u014C\u014D\u016A\u016B]*$/;
/** Markup, links, code and ids: characters and forms prose never needs. */
const MARKUP: readonly RegExp[] = [
  /[<>[\]{}()`*_#|~^\\/@=+&%$]/,
  /\bhttps?\b|\bwww\b/i,
  /\b[a-z0-9-]+\.(?:com|nz|org|net|io|co|app|dev|test)\b/i,
];

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

const TIME =
  words(`today tonight tomorrow tmrw tomoz yesterday arvo arvos morning mornings afternoon
  afternoons evening evenings night nights overnight midnight midday noon weekend weekends week weeks
  weekday weekdays weekly fortnight fortnights fortnightly month months monthly year years yearly
  annual day days daily hour hours hourly minute minutes am pm oclock now soon later earlier half
  quarter date dates monday mondays tuesday tuesdays wednesday wednesdays thursday thursdays friday
  fridays saturday saturdays sunday sundays mon tue tues wed weds thu thur thurs fri sat sun
  january february march april june july august september october november december jan feb mar
  apr jun jul aug sep sept oct nov dec christmas easter holidays holiday term`);

const NUMBER = words(`zero nil two three four five six seven eight nine ten eleven twelve thirteen
  fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty
  ninety hundred hundreds thousand thousands million dozen dozens couple pair both once twice thrice
  first second third fourth fifth sixth seventh eighth ninth tenth single double triple few several
  many lots lot plenty heaps bunch handful numerous multiple various count counts number numbers
  degree degrees percent km kmh`);

const PERSON =
  words(`he she him her his hers they them their theirs himself herself themselves themself
  everyone everybody anyone anybody someone somebody nobody noone household family families whanau
  kids kid children child son sons daughter daughters baby babies parent parents mum mums mom moms
  mother mothers mummy mama dad dads father fathers daddy papa grandad granddad grandpa grandfather
  grandma grandmother granny gran nana nan nanna poppa pop koro kuia grandparent grandparents
  grandson granddaughter grandkids grandchild grandchildren aunt aunty auntie uncle cousin cousins
  niece nephew brother brothers sister sisters sibling siblings husband wife partner boyfriend
  girlfriend coach teacher teachers nanny babysitter sitter tutor friend friends neighbour neighbor
  neighbours boss caregiver whaea matua`);

/** Weather, places and kinds of appointment: details only a record may state. */
const RECORD =
  words(`dry wet rain rainy raining rained showers showery shower drizzle windy wind winds
  gust gusts gusty sunny sunshine cloudy overcast cold colder warm warmer hot hotter cool chilly frost
  frosty snow storm stormy thunder hail humid temperature temperatures indoors indoor outdoors outdoor
  inside outside venue pool school work office appointment appointments meeting meetings birthday
  birthdays party parties lesson lessons practice training game games class classes
  dentist doctor haircut dinner lunch breakfast`);

/** Status, completion, commitment, exclusivity and negation: claims only a record or a scope may make. */
const CLAIM =
  words(`cancelled canceled cancel cancels cancelling postponed postpone moved move moves
  moving rescheduled reschedule changed delayed confirmed booked booking bookings scheduled planned
  plan plans arranged organised organized sorted done finished finish complete completed started
  starting ended attending attend responsible assigned due overdue pick picking picked pickup
  collect collects collecting collected drop dropping dropped dropoff drive driving drives taking take takes
  took bring bringing will shall gonna wont only just all everything nothing none no not never else
  other others another any anything either neither nor sole solely entire entirely whole every each
  alone nope nah`);

const AVAILABILITY = words(`free available unavailable availability busy around away able clear open
  empty spare quiet blank occupied off tied`);

const CONFLICT = words(`overlap overlaps overlapping overlapped clash clashes clashing conflict
  conflicts conflicting`);

/** Kev doing or promising: "I've added", "I'll remind". */
const KEV_VERBS = new Set(
  `added booked sent saved scheduled deleted removed changed updated created cancelled canceled moved
  reminded remembered noted set kept recorded told texted emailed messaged called put filed logged
  made marked paid ordered bought signed registered entered written wrote fixed organised organized
  arranged confirmed reserved shared forwarded copied stored tracked flagged`.split(/\s+/),
);

/** Words a record's own text shares with ordinary prose: never a reason to refuse. */
const COMMON = words(`the and for with from that this these those what when where which who how why
  are was were has have had been being its it's into onto over under after before about above
  below again also here there then than them they your you our out off one not but all any can may
  might could would should will just like look looks looking worth still even back next last time
  thing things stuff bit lot way side some more most much very well good great new old big small`);

/** The words before which "one" stands for a thing, not a number. */
const ONE_AS_THING = new Set([
  'this',
  'that',
  'which',
  'the',
  'next',
  'last',
  'other',
  'big',
  'long',
  'short',
  'quick',
  'early',
  'late',
]);

/** "Yep"/"Yes": an answer to a yes-or-no question. */
const AFFIRM = words(`yes yep yeah yup sure`);

/** The words of the adult's question that make it an availability question (D8). */
const AVAILABILITY_QUESTION =
  /\b(?:free|available|availability|busy|around|away|able|clear|can|could|make it|nothing on|anything on|spare|open)\b/i;

/** The text as checked (and shown): NFKC; straight apostrophes; words with word-edge quotes and hyphens split away. */
export function normaliseProse(text: string): string {
  return text.normalize('NFKC');
}

function tokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/[\u2018\u2019\u02BC`\u00B4]/g, "'")
      .replace(/[\u201C\u201D"]/g, ' ')
      .replace(/[\u2010-\u2015-]/g, ' ')
      .match(/[a-z\u0101\u0113\u012B\u014D\u016B']+/g) ?? []
  )
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

const macronless = (w: string) =>
  w
    .replace(/\u0101/g, 'a')
    .replace(/\u0113/g, 'e')
    .replace(/\u012B/g, 'i')
    .replace(/\u014D/g, 'o')
    .replace(/\u016B/g, 'u');

/** The words of every recorded text and every name in the ledger (three letters or more). */
function recordWords(ledger: Ledger): { record: Set<string>; names: Set<string> } {
  const record = new Set<string>();
  const names = new Set<string>();
  for (const t of ledger.recordTexts)
    for (const w of tokens(t.normalize('NFKC')).map(macronless))
      if (w.length >= 3 && !COMMON.has(w)) record.add(w);
  for (const n of ledger.namesById.values())
    for (const w of tokens(n.normalize('NFKC')).map(macronless)) if (w.length >= 2) names.add(w);
  return { record, names };
}

/** A record's word, or a form of it ("painted" for "paint", "fences" for "fence"). */
function recordHas(record: ReadonlySet<string>, w: string): boolean {
  if (record.has(w)) return true;
  for (const r of record) if (r.length >= 4 && w.length > r.length && w.startsWith(r)) return true;
  return false;
}

export type ProseInput = {
  text: string;
  ledger: Ledger;
  /** The lead may hold `{when}` once; the view may not. */
  where: 'lead' | 'view';
  /** The plan shows at least one record (for "Yep"). */
  showsRecord: boolean;
  /** The adult's question (for "Yep" on an availability question). */
  question?: string;
};

/** The codes a lead or view fails, in a fixed order (none: it is fact-free). */
export function proseViolations(input: ProseInput): ProseCode[] {
  const out = new Set<ProseCode>();
  let raw = input.text;
  if (input.where === 'lead') {
    const n = raw.split('{when}').length - 1;
    if (n > 1) out.add('markup');
    raw = raw.replace('{when}', ' ');
  }
  if (!ALLOWED.test(raw) || /[\p{Cf}\p{Cc}\p{M}]/u.test(raw)) out.add('text.unsafe');
  const t = normaliseProse(raw);
  if (/[\p{M}\p{Cf}]/u.test(t) || !ALLOWED.test(t)) out.add('text.unsafe');
  if (MARKUP.some((re) => re.test(t))) out.add('markup');
  if (/\d/.test(t)) out.add('prose.number');

  const { record, names } = recordWords(input.ledger);
  const ws = tokens(t);
  const lower = ` ${ws.join(' ')} `;
  // "one" is a number unless it stands for a thing ("this one", "that one").
  ws.forEach((w, i) => {
    if (w === 'one' && !ONE_AS_THING.has(ws[i - 1] ?? '')) out.add('prose.number');
  });
  for (const w0 of ws) {
    const w = macronless(w0);
    const base = w.replace(/'s$/, '');
    const neg = /n't$/.test(w);
    const stem = neg ? w.slice(0, -3) : base;
    if (TIME.has(stem) || TIME.has(stem.replace(/s$/, ''))) out.add('prose.time');
    if (NUMBER.has(stem)) out.add('prose.number');
    if (PERSON.has(stem) || names.has(stem)) out.add('prose.person');
    if (RECORD.has(stem) || recordHas(record, stem)) out.add('prose.record');
    if (CLAIM.has(stem) || neg || /'ll$/.test(w)) out.add('prose.claim');
    if (AVAILABILITY.has(stem)) out.add('availability.claim');
    if (CONFLICT.has(stem)) out.add('conflict.unsupported');
    if (AFFIRM.has(stem)) {
      if (!input.showsRecord) out.add('prose.claim');
      if (input.question && AVAILABILITY_QUESTION.test(input.question))
        out.add('availability.claim');
    }
  }
  if (/ same time | at once | double booked /.test(lower)) out.add('conflict.unsupported');
  if (/ that's it | that is it | thats it /.test(lower)) out.add('prose.claim');
  if (/ at home | be home | is home | are home | home all /.test(lower))
    out.add('availability.claim');
  // Kev's own actions and promises: "I've added", "I have booked", "I'll", "I will", "I remember".
  const did =
    / i(?:'ve| have| had|'d)? (?:(?:now|just|already|also|gone ahead and|went ahead and) )*([a-z]+)/g;
  if ([...lower.matchAll(did)].some((m) => KEV_VERBS.has(m[1]!))) out.add('authority.claim');
  if (
    / i'll | i will | i remember | remind | reminder | noted | gone ahead | went ahead /.test(lower)
  )
    out.add('authority.claim');
  if (forbiddenIn(t).length > 0) out.add('phrase.forbidden');
  if (FILLER.some((f) => phrasePattern(f).test(t))) out.add('tone.filler');
  return ORDER.filter((c) => out.has(c));
}

const ORDER: readonly ProseCode[] = [
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
];
