import 'server-only';
import { addDays, type IsoDate } from '@/lib/dates';
import { refSchema, type Ref, type ToolName } from '../tools/types';

// The turn's ledger (M8 contract §4.4 `LedgerEntry`, §6.1, §8.3): every
// record this attempt's tool results and the bundle returned, each as a
// `Ref` with the facts its result carried. The validator accepts only
// citations in the ledger (rule 2), and checks an answer's times, dates,
// numbers, names and people against the facts of the records each clause
// is about (rules 4–6). One ledger per attempt: an escalated turn's deep
// attempt starts a new one, so nothing the fast attempt read can be cited
// (C15); a record an earlier turn mentioned must be fetched again to be
// cited (C7).
//
// A record's facts (corrected in the Package 3 review, B-2): only its own.
// - Its own fields, as the tool sent them: times, dates, parts of the day,
//   numbers, durations, words and texts, read from the object that carries
//   it as `ref` (an occurrence's start and end, a task's estimate, a gap's
//   bounds, a forecast day's figures, a person's age and next birthday),
//   plus its ref's own `at`.
// - A nested record (a person on an event, a task's assignee, a gap's
//   neighbour, an item in a Today person group) gives its parent only its
//   identity: its recorded name or title, and for a person their role. Its
//   own times are not the parent's, with one exception: a conflict's
//   commitments, whose times define the overlap the conflict is (§6.2).
// - The day an agenda or Today item is listed under is the item's date (a
//   birthday has no other).
// - A result's top-level values are given to no record, except an explicit
//   allow-list decided from the tools' output schemas: the forecast's
//   `fetched_at` and `credit`, given to its forecast days. No other tool has
//   a top-level value that is a fact of every record in it: `from`/`to` are
//   the range asked for, `count`/`truncated` describe the list, `scope`,
//   `min_minutes` and `needs` echo the question.
// - A ref listed under an object's `refs` (an insight's facts) carries that
//   object's facts.
// Facts are read from the tool's output exactly as the model was sent it:
// nothing is re-derived here.
//
// Coverage (I-8, M-4): which days a read establishes "nothing is recorded"
// for, and of what kind: the bundle's Today and get_today cover today's
// agenda; get_agenda covers its range's agenda (only for the people asked
// for, when it was filtered); get_conflicts covers its range's overlaps. A
// truncated result covers nothing. The forecast, gaps and every other read
// cover nothing.

export type DayPart = 'morning' | 'afternoon' | 'evening';
/** How a person is on a record: their recorded role, `assignee`, `self` (the person record itself) or `on`. */
export type PersonRole = 'attending' | 'responsible' | 'assignee' | 'self' | 'on';

export type LedgerFacts = {
  /** Wall-clock times in the home zone, `HH:MM`, as the outputs wrote them. */
  times: Set<string>;
  dates: Set<IsoDate>;
  /** Weekdays the record names outright (a regular week's), lower-case. */
  weekdays: Set<string>;
  numbers: Set<number>;
  /** Minutes: estimates, minimum lengths, and every start–end span. */
  durations: Set<number>;
  parts: Set<DayPart>;
  /** Lower-cased words of every string the record carried, nested identities included. */
  words: Set<string>;
  /** Recorded strings (titles, names, sentences), nested identities included, as sent. */
  texts: Set<string>;
  /** The record's own title or name (its identity), as sent. */
  ownTexts: Set<string>;
  /** The people on the record, by lower-cased name, with how they are on it. */
  people: Map<string, Set<PersonRole>>;
  /** Numbers by what they are: `age`, `birthday_age`, `low_c`, `high_c`, `max_gust_kmh`, `estimate_minutes`. */
  keyed: Map<string, Set<number>>;
};

export type LedgerSource = ToolName | 'bundle';
export type LedgerEntry = {
  ref: Ref;
  source: LedgerSource;
  facts: LedgerFacts;
  /** The day the record was listed under (an agenda or Today day), if any. */
  day?: IsoDate;
  /** The agenda item kind it was listed as (`event`, `birthday`, `task_due` …), if any. */
  item?: string;
};

export type CoverageKind = 'agenda' | 'conflicts' | 'forecast' | 'search';
export type CoverageSpan = {
  kind: CoverageKind;
  /** The days covered (for `forecast`: the days the forecast does not cover). */
  days: ReadonlySet<IsoDate>;
  /** The person ids the read was limited to, or null for everyone the reader can see. */
  persons: ReadonlySet<string> | null;
  /** A search's query words. */
  query?: ReadonlySet<string>;
};

const INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(\d{2}):(\d{2})$/;
const PARTS: readonly string[] = ['morning', 'afternoon', 'evening'];
const WEEKDAY_NAMES: readonly string[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
/** Keys whose values are identifiers, never facts a sentence may state. */
const ID_KEYS = new Set(['id', 'key', 'rule']);
/** Numbers that are what they are named. */
const KEYED = new Set(['low_c', 'high_c', 'max_gust_kmh', 'estimate_minutes']);
/** The only top-level values that are facts of the records in a result (B-2), by tool. */
const TOP_FACTS: Partial<
  Record<ToolName, { keys: readonly string[]; to: readonly Ref['type'][] }>
> = {
  get_weather: { keys: ['fetched_at', 'credit'], to: ['forecast'] },
};

export const emptyFacts = (): LedgerFacts => ({
  times: new Set(),
  dates: new Set(),
  weekdays: new Set(),
  numbers: new Set(),
  durations: new Set(),
  parts: new Set(),
  words: new Set(),
  texts: new Set(),
  ownTexts: new Set(),
  people: new Map(),
  keyed: new Map(),
});

export const partOf = (hour: number): DayPart =>
  hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

/** NFKC, apostrophes and dashes as one form, and runs of white space as one space. */
export function normaliseText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words of a string: letters and digits, lower-cased; apostrophes and possessives dropped. */
export function wordsOf(s: string): string[] {
  return (
    normaliseText(s)
      .toLowerCase()
      .replace(/'s\b/g, '')
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  );
}

function addInstant(f: LedgerFacts, s: string): boolean {
  const m = INSTANT.exec(s);
  if (!m) return false;
  f.dates.add(m[1] as IsoDate);
  f.times.add(`${m[2]}:${m[3]}`);
  f.parts.add(partOf(Number(m[2])));
  return true;
}

const minutesBetween = (a: string, b: string): number | null => {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && y > x ? Math.round((y - x) / 60_000) : null;
};

const isRef = (v: unknown): v is Ref => refSchema.safeParse(v).success;
const refOf = (v: unknown): Ref | null => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const r = (v as { ref?: unknown }).ref;
  return isRef(r) ? r : null;
};
const untrustedOf = (v: unknown): string | null =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { untrusted_text?: unknown }).untrusted_text === 'string'
    ? (v as { untrusted_text: string }).untrusted_text
    : null;

function addText(f: LedgerFacts, s: string, own: boolean): void {
  const t = normaliseText(s);
  f.texts.add(t);
  if (own) f.ownTexts.add(t);
  for (const w of wordsOf(t)) f.words.add(w);
}

function addPerson(f: LedgerFacts, name: string, role: PersonRole): void {
  const k = normaliseText(name).toLowerCase();
  const roles = f.people.get(k) ?? new Set<PersonRole>();
  roles.add(role);
  f.people.set(k, roles);
}

function addKeyed(f: LedgerFacts, key: string, n: number): void {
  const s = f.keyed.get(key) ?? new Set<number>();
  s.add(n);
  f.keyed.set(key, s);
}

/** A nested record's identity, given to its parent: its name or title, and a person's role. */
function addIdentity(
  f: LedgerFacts,
  nested: Record<string, unknown>,
  ref: Ref,
  key: string,
  nameOf: (id: string) => string | null,
): void {
  // A person given by ref alone (a context's subject) is named from the bundle.
  const name = untrustedOf(nested.name) ?? (ref.type === 'person' ? nameOf(ref.id) : null);
  const title = untrustedOf(nested.title);
  for (const t of [name, title]) if (t !== null) addText(f, t, false);
  if (ref.type === 'person' && name !== null) {
    const role = nested.role;
    addPerson(
      f,
      name,
      role === 'attending' || role === 'responsible'
        ? role
        : key === 'assignee'
          ? 'assignee'
          : 'on',
    );
  }
}

/**
 * Collects a record's own facts into `f` (see the header). `record` is the
 * object that carries the ref; `refType` its type, for the conflict rule.
 */
function collectOwn(
  record: Record<string, unknown>,
  refType: Ref['type'],
  f: LedgerFacts,
  nameOf: (id: string) => string | null,
): void {
  const isBirthday = record.type === 'birthday';
  /** `container`: the key the enclosing object or array sits under (`#record` for the record's own fields). */
  const visit = (
    node: unknown,
    key: string | undefined,
    depth: number,
    container: string,
  ): void => {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (typeof node === 'string') {
      if (key !== undefined && ID_KEYS.has(key)) return;
      if (addInstant(f, node)) return;
      if (DATE.test(node)) {
        f.dates.add(node as IsoDate);
        return;
      }
      const clock = CLOCK.exec(node);
      if (clock && key === 'time') {
        f.times.add(node);
        f.parts.add(partOf(Number(clock[1])));
        return;
      }
      if (PARTS.includes(node)) f.parts.add(node as DayPart);
      if (key === 'weekday' && WEEKDAY_NAMES.includes(node)) f.weekdays.add(node);
      for (const w of wordsOf(node)) f.words.add(w);
      return;
    }
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) return;
      f.numbers.add(node);
      if (key && /minutes?$/.test(key)) f.durations.add(node);
      if (key && KEYED.has(key)) addKeyed(f, key, node);
      if (key === 'age')
        addKeyed(
          f,
          container === 'next_birthday' || (container === '#record' && isBirthday)
            ? 'birthday_age'
            : 'age',
          node,
        );
      return;
    }
    if (Array.isArray(node)) {
      // How many there are is a fact of the record ("two timed events").
      if (node.length > 0) f.numbers.add(node.length);
      for (const v of node) visit(v, undefined, depth + 1, key ?? container);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const text = untrustedOf(o);
    if (text !== null) {
      addText(f, text, container === '#record' && (key === 'title' || key === 'name'));
      return;
    }
    const nested = depth > 0 ? refOf(o) : null;
    if (nested) {
      const where = key ?? container;
      addIdentity(f, o, nested, where, nameOf);
      // A conflict's commitments define its overlap: their times are its own (§6.2).
      if (refType === 'conflict' && where === 'commitments') {
        for (const k of ['start', 'end'] as const)
          if (typeof o[k] === 'string') addInstant(f, o[k] as string);
        const m =
          typeof o.start === 'string' && typeof o.end === 'string'
            ? minutesBetween(o.start, o.end)
            : null;
        if (m !== null) f.durations.add(m);
        // The conflict's person is on each commitment in its role.
        if (o.role === 'attending' || o.role === 'responsible')
          for (const roles of f.people.values()) if (roles.has('on')) roles.add(o.role);
      }
      return;
    }
    for (const [a, b] of [
      ['start', 'end'],
      ['from', 'to'],
    ] as const) {
      const x = o[a];
      const y = o[b];
      if (typeof x === 'string' && typeof y === 'string') {
        const m = minutesBetween(x, y);
        if (m !== null) f.durations.add(m);
      }
    }
    const inner = depth === 0 ? '#record' : (key ?? container);
    for (const [k, v] of Object.entries(o)) {
      if (depth === 0 && k === 'ref') continue;
      visit(v, k, depth + 1, inner);
    }
  };
  visit(record, undefined, 0, '#record');
  // The person record itself: its own name.
  if (refType === 'person') {
    const name = untrustedOf(record.name);
    if (name !== null) addPerson(f, name, 'self');
  }
}

function mergeInto(into: LedgerFacts, from: LedgerFacts): void {
  for (const k of [
    'times',
    'dates',
    'weekdays',
    'numbers',
    'durations',
    'parts',
    'words',
    'texts',
    'ownTexts',
  ] as const)
    for (const v of from[k] as Set<unknown>) (into[k] as Set<unknown>).add(v);
  for (const [n, roles] of from.people) {
    const s = into.people.get(n) ?? new Set<PersonRole>();
    for (const r of roles) s.add(r);
    into.people.set(n, s);
  }
  for (const [k, ns] of from.keyed) for (const n of ns) addKeyed(into, k, n);
}

const keyOf = (r: Pick<Ref, 'type' | 'id'>) => `${r.type}|${r.id}`;

/** The dates `from`…`to` inclusive (at most 92). */
function daysFrom(from: string, to: string): Set<IsoDate> {
  const out = new Set<IsoDate>();
  if (!DATE.test(from) || !DATE.test(to) || to < from) return out;
  let d = from as IsoDate;
  for (let i = 0; i < 92 && d <= to; i++) {
    out.add(d);
    d = addDays(d, 1);
  }
  return out;
}

export class Ledger {
  readonly #entries: LedgerEntry[] = [];
  readonly #byKey = new Map<string, LedgerEntry[]>();
  readonly #coverage: CoverageSpan[] = [];
  /** The visible people's names by person id (from the bundle). */
  readonly #namesById = new Map<string, string>();
  /** Refs the tools (not the bundle) returned, in order, each once. */
  readonly #toolRefs: Ref[] = [];
  readonly #toolRefKeys = new Set<string>();
  /** Words of the people the reader can see (the bundle), for rule 6. */
  readonly peopleWords = new Set<string>();
  /** Their names as recorded (exempt from the lists, rule 7). */
  readonly peopleNames = new Set<string>();
  /** The people the reader can see: lower-cased name → person id. */
  readonly peopleIds = new Map<string, string>();
  /** The reader's own recorded name (lower-cased), when a person is linked to them. */
  reader: string | null = null;

  get size(): number {
    return this.#entries.length;
  }

  get entries(): readonly LedgerEntry[] {
    return this.#entries;
  }

  get coverage(): readonly CoverageSpan[] {
    return this.#coverage;
  }

  #add(ref: Ref, source: LedgerSource, facts: LedgerFacts, day?: IsoDate, item?: string): void {
    if (ref.at) addInstant(facts, ref.at);
    if (day) facts.dates.add(day);
    const entry: LedgerEntry = {
      ref: ref.at === undefined ? { type: ref.type, id: ref.id } : { ...ref },
      source,
      facts,
      ...(day ? { day } : {}),
      ...(item ? { item } : {}),
    };
    this.#entries.push(entry);
    const k = keyOf(ref);
    const list = this.#byKey.get(k) ?? [];
    list.push(entry);
    this.#byKey.set(k, list);
    if (source !== 'bundle') {
      const full = `${k}|${ref.at ?? ''}`;
      if (!this.#toolRefKeys.has(full)) {
        this.#toolRefKeys.add(full);
        this.#toolRefs.push(entry.ref);
      }
    }
  }

  /**
   * Walks a result: every object carrying a ref is an entry with its own
   * facts (and the allow-listed top-level facts for its type); refs under
   * `refs` carry their enclosing object's facts; agenda days and Today give
   * their items the day.
   */
  #walk(
    node: unknown,
    source: LedgerSource,
    top: { facts: LedgerFacts; to: readonly Ref['type'][] } | null,
    enclosing: LedgerFacts | null,
    day: IsoDate | undefined,
  ): void {
    if (Array.isArray(node)) {
      for (const v of node) this.#walk(v, source, top, enclosing, day);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const o = node as Record<string, unknown>;
    let here = enclosing;
    const ref = refOf(o);
    if (ref) {
      const facts = emptyFacts();
      if (top && top.to.includes(ref.type)) mergeInto(facts, top.facts);
      collectOwn(o, ref.type, facts, (pid) => this.#namesById.get(pid) ?? null);
      // An item's day is its own only when it is an agenda item (not a Today person group).
      const item = typeof o.type === 'string' ? o.type : undefined;
      this.#add(ref, source, facts, item ? day : undefined, item);
      here = facts;
    }
    // A day of the agenda lists its items under it; Today lists its people
    // groups and "also today" under its date (not its evening's tomorrow).
    const ownDate =
      typeof o.date === 'string' && DATE.test(o.date) ? (o.date as IsoDate) : undefined;
    const isAgendaDay = !ref && ownDate !== undefined && Array.isArray(o.items);
    const isToday = !ref && ownDate !== undefined && 'headline' in o && 'state' in o;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'ref') continue;
      if (k === 'refs' && Array.isArray(v)) {
        // The people an insight stands on are on it (named from the bundle).
        if (here)
          for (const r of v)
            if (isRef(r) && r.type === 'person') {
              const n = this.#namesById.get(r.id);
              if (n) addPerson(here, n, 'on');
            }
        for (const r of v)
          if (isRef(r)) {
            const facts = emptyFacts();
            if (here) mergeInto(facts, here);
            this.#add(r, source, facts);
          }
        continue;
      }
      const childDay = isAgendaDay
        ? k === 'items'
          ? ownDate
          : undefined
        : isToday
          ? k === 'people' || k === 'also_today'
            ? ownDate
            : undefined
          : ref
            ? undefined
            : day;
      this.#walk(v, source, top, here, childDay);
    }
  }

  /**
   * A tool's successful result: its data as sent, and every ref it
   * returned; `input` is the call's validated input (for a filtered
   * agenda's people). Records the read's coverage (above).
   */
  addResult(source: ToolName, data: unknown, refs: readonly Ref[], input?: unknown): void {
    const allow = TOP_FACTS[source];
    let top: { facts: LedgerFacts; to: readonly Ref['type'][] } | null = null;
    if (allow && typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const facts = emptyFacts();
      const d = data as Record<string, unknown>;
      for (const k of allow.keys) {
        const v = d[k];
        if (typeof v === 'string') {
          if (!addInstant(facts, v)) for (const w of wordsOf(v)) facts.words.add(w);
          if (!INSTANT.test(v)) facts.texts.add(normaliseText(v));
        }
      }
      top = { facts, to: allow.to };
    }
    this.#walk(data, source, top, null, undefined);
    // Every returned ref is citable, even one the walk did not meet.
    for (const r of refs) if (!this.has(r)) this.#add(r, source, emptyFacts());
    this.#coverFrom(source, data, input);
  }

  #coverFrom(source: LedgerSource, data: unknown, input: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const d = data as { from?: unknown; to?: unknown; date?: unknown; truncated?: unknown };
    const unconfigured =
      source === 'get_weather' && (data as { configured?: unknown }).configured === false;
    if (d.truncated !== false && !unconfigured) return;
    if (source === 'get_agenda' && typeof d.from === 'string' && typeof d.to === 'string') {
      const ids = (input as { person_ids?: unknown } | undefined)?.person_ids;
      const persons = Array.isArray(ids)
        ? new Set(ids.filter((x): x is string => typeof x === 'string'))
        : null;
      this.#coverage.push({ kind: 'agenda', days: daysFrom(d.from, d.to), persons });
    } else if (
      source === 'get_conflicts' &&
      typeof d.from === 'string' &&
      typeof d.to === 'string'
    ) {
      this.#coverage.push({ kind: 'conflicts', days: daysFrom(d.from, d.to), persons: null });
    } else if (source === 'get_today' && typeof d.date === 'string' && DATE.test(d.date)) {
      this.#coverage.push({ kind: 'agenda', days: new Set([d.date as IsoDate]), persons: null });
    } else if (source === 'get_weather') {
      // What the forecast does not have: the asked days it does not cover, or all of them with none set up.
      const w = data as { configured?: unknown; uncovered?: unknown };
      const asked = input as { from?: unknown; to?: unknown } | undefined;
      const days =
        w.configured === false && typeof asked?.from === 'string' && typeof asked.to === 'string'
          ? daysFrom(asked.from, asked.to)
          : new Set(
              (Array.isArray(w.uncovered) ? w.uncovered : []).filter(
                (x): x is IsoDate => typeof x === 'string' && DATE.test(x),
              ),
            );
      this.#coverage.push({ kind: 'forecast', days, persons: null });
    } else if (source === 'search') {
      const q = (input as { query?: unknown } | undefined)?.query;
      if (typeof q === 'string')
        this.#coverage.push({
          kind: 'search',
          days: new Set(),
          persons: null,
          query: new Set(wordsOf(q)),
        });
    }
  }

  /** The query words of every complete search this attempt made. */
  searchQueries(): ReadonlySet<string>[] {
    return this.#coverage.filter((c) => c.kind === 'search' && c.query).map((c) => c.query!);
  }

  /** The bundle: its records start the ledger; its people are names the answer may use; its Today covers today. */
  addBundle(bundle: unknown, refs: readonly Ref[]): void {
    const b = bundle as {
      people?: { ref?: unknown; name?: { untrusted_text?: string } }[];
      reader?: { ref?: unknown; name?: { untrusted_text?: string } } | null;
      today?: { date?: unknown; truncated?: unknown };
    };
    for (const p of [...(b.people ?? []), ...(b.reader ? [b.reader] : [])]) {
      const n = p.name?.untrusted_text;
      if (typeof n !== 'string') continue;
      const name = normaliseText(n);
      this.peopleNames.add(name);
      if (isRef(p.ref) && p.ref.type === 'person') {
        this.peopleIds.set(name.toLowerCase(), p.ref.id);
        this.#namesById.set(p.ref.id, name);
      }
      for (const w of wordsOf(name)) this.peopleWords.add(w);
    }
    const r = b.reader?.name?.untrusted_text;
    if (typeof r === 'string') this.reader = normaliseText(r).toLowerCase();
    this.#walk(bundle, 'bundle', null, null, undefined);
    for (const ref of refs) if (!this.has(ref)) this.#add(ref, 'bundle', emptyFacts());
    if (
      b.today &&
      typeof b.today.date === 'string' &&
      DATE.test(b.today.date) &&
      b.today.truncated === false
    )
      this.#coverage.push({
        kind: 'agenda',
        days: new Set([b.today.date as IsoDate]),
        persons: null,
      });
  }

  /** Whether a complete read of this kind covered the day, for this person (or for everyone). */
  covers(kind: CoverageKind, day: IsoDate, personId: string | null): boolean {
    return this.#coverage.some(
      (c) =>
        c.kind === kind &&
        c.days.has(day) &&
        (c.persons === null || (personId !== null && c.persons.has(personId))),
    );
  }

  /** Every day a complete read of this kind covered (for everyone). */
  coveredDays(kind: CoverageKind): Set<IsoDate> {
    const out = new Set<IsoDate>();
    for (const c of this.#coverage)
      if (c.kind === kind && c.persons === null) for (const d of c.days) out.add(d);
    return out;
  }

  /** The entries a citation resolves to: its type and id, and its `at` when it gives one. */
  resolve(ref: Ref): LedgerEntry[] {
    const list = this.#byKey.get(keyOf(ref)) ?? [];
    return ref.at === undefined ? list : list.filter((e) => e.ref.at === ref.at);
  }

  has(ref: Ref): boolean {
    return this.resolve(ref).length > 0;
  }

  /** The facts of everything the citations resolve to, merged. */
  factsOf(refs: readonly Ref[]): LedgerFacts {
    const f = emptyFacts();
    for (const r of refs) for (const e of this.resolve(r)) mergeInto(f, e.facts);
    return f;
  }

  /** The refs the tools returned this attempt, in order, each once (the fallback's rows). */
  toolRefs(): readonly Ref[] {
    return this.#toolRefs;
  }

  /** Where each cited ref came from. */
  sourcesOf(refs: readonly Ref[]): Set<LedgerSource> {
    const s = new Set<LedgerSource>();
    for (const r of refs) for (const e of this.resolve(r)) s.add(e.source);
    return s;
  }
}
