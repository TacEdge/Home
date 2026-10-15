import 'server-only';
import { addDays, type IsoDate } from '@/lib/dates';
import { refSchema, type Ref, type ToolName } from '../tools/types';

// The turn's ledger (M8 contract §4.4 `LedgerEntry`, §6.1, §8.3): every
// record this attempt's tool results and the bundle returned, each as a
// `Ref` with the facts its result carried (times, dates, weekdays, numbers,
// durations, parts of the day, names and words). The validator accepts only
// citations in the ledger (rule 2), and checks an answer's times, dates,
// numbers and names against the facts of what that sentence cites (rules
// 4–6). One ledger per attempt: an escalated turn's deep attempt starts a
// new one, so nothing the fast attempt read can be cited (C15); a record an
// earlier turn mentioned must be fetched again to be cited (C7).
//
// What a ref's facts are: everything in the object that carries it as its
// `ref` (the occurrence's start and end, its people's names, a task's
// estimate, a gap's bounds and the commitments either side, a conflict's
// commitments and overlap, a forecast day's figures), plus the ref's own
// `at`. A ref listed under an object's `refs` (an insight's facts) carries
// that object's facts. Facts are read from the tool's output exactly as the
// model was sent it: nothing is re-derived here.

export type DayPart = 'morning' | 'afternoon' | 'evening';

export type LedgerFacts = {
  /** Wall-clock times in the home zone, `HH:MM`, as the outputs wrote them. */
  times: Set<string>;
  dates: Set<IsoDate>;
  numbers: Set<number>;
  /** Minutes: estimates, minimum lengths, and every start–end span. */
  durations: Set<number>;
  parts: Set<DayPart>;
  /** Lower-cased words of every string the record carried (titles, names, phrases, codes). */
  words: Set<string>;
  /** The record's own recorded strings (titles, names, sentences), as sent. */
  texts: Set<string>;
};

export type LedgerSource = ToolName | 'bundle';
export type LedgerEntry = { ref: Ref; source: LedgerSource; facts: LedgerFacts };

const INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PARTS: readonly string[] = ['morning', 'afternoon', 'evening'];
/** Keys whose values are identifiers, never facts a sentence may state. */
const ID_KEYS = new Set(['id', 'key']);

const emptyFacts = (): LedgerFacts => ({
  times: new Set(),
  dates: new Set(),
  numbers: new Set(),
  durations: new Set(),
  parts: new Set(),
  words: new Set(),
  texts: new Set(),
});

export const partOf = (hour: number): DayPart =>
  hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

/** Words of a string: letters and digits, lower-cased; apostrophes and possessives dropped. */
export function wordsOf(s: string): string[] {
  return (
    s
      .toLowerCase()
      .replace(/[‘’']s\b/g, '')
      .match(/[\p{L}\p{N}]+/gu) ?? []
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

/** Collects the facts of a subtree into `f`. */
function collect(node: unknown, f: LedgerFacts, key?: string): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    if (key !== undefined && ID_KEYS.has(key)) return;
    if (addInstant(f, node)) return;
    if (DATE.test(node)) {
      f.dates.add(node as IsoDate);
      return;
    }
    if (PARTS.includes(node)) f.parts.add(node as DayPart);
    for (const w of wordsOf(node)) f.words.add(w);
    return;
  }
  if (typeof node === 'number') {
    if (!Number.isFinite(node)) return;
    f.numbers.add(node);
    if (key && /minutes?$/.test(key)) f.durations.add(node);
    return;
  }
  if (typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    // How many there are is a fact of the record ("two timed events").
    if (node.length > 0) f.numbers.add(node.length);
    for (const v of node) collect(v, f);
    return;
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.untrusted_text === 'string') {
      f.texts.add(o.untrusted_text);
      for (const w of wordsOf(o.untrusted_text)) f.words.add(w);
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
    for (const [k, v] of Object.entries(o)) collect(v, f, k);
  }
}

const isRef = (v: unknown): v is Ref => refSchema.safeParse(v).success;
const keyOf = (r: Pick<Ref, 'type' | 'id'>) => `${r.type}|${r.id}`;

export class Ledger {
  readonly #entries: LedgerEntry[] = [];
  readonly #byKey = new Map<string, LedgerEntry[]>();
  /** Dates a successful read covered (its `from`…`to`), for statements of absence. */
  readonly #covered = new Set<IsoDate>();
  /** Refs the tools (not the bundle) returned, in order, each once. */
  readonly #toolRefs: Ref[] = [];
  readonly #toolRefKeys = new Set<string>();
  /** Words of the people the reader can see (the bundle), for rule 6. */
  readonly peopleWords = new Set<string>();
  /** Their names as recorded (exempt from the lists, rule 7). */
  readonly peopleNames = new Set<string>();
  /** Every recorded string the ledger holds (titles and names), for rule 7's exemption. */
  readonly recordedTexts = new Set<string>();

  get size(): number {
    return this.#entries.length;
  }

  get entries(): readonly LedgerEntry[] {
    return this.#entries;
  }

  #add(ref: Ref, source: LedgerSource, facts: LedgerFacts): void {
    if (ref.at) addInstant(facts, ref.at);
    const entry: LedgerEntry = {
      ref: ref.at === undefined ? { type: ref.type, id: ref.id } : { ...ref },
      source,
      facts,
    };
    this.#entries.push(entry);
    const k = keyOf(ref);
    const list = this.#byKey.get(k) ?? [];
    list.push(entry);
    this.#byKey.set(k, list);
    for (const t of facts.texts) this.recordedTexts.add(t);
    if (source !== 'bundle') {
      const full = `${k}|${ref.at ?? ''}`;
      if (!this.#toolRefKeys.has(full)) {
        this.#toolRefKeys.add(full);
        this.#toolRefs.push(entry.ref);
      }
    }
  }

  /**
   * `top`: the result's own top-level facts, given to every record in it.
   * `enclosing`: the facts of the nearest object carrying a ref, given only
   * to refs listed under that object's `refs` (an insight's facts), never to
   * a nested record (a person on an event does not carry the event's time).
   */
  #walk(
    node: unknown,
    source: LedgerSource,
    top: LedgerFacts,
    enclosing: LedgerFacts | null,
  ): void {
    if (Array.isArray(node)) {
      for (const v of node) this.#walk(v, source, top, enclosing);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const o = node as Record<string, unknown>;
    let here = enclosing;
    if (isRef(o.ref)) {
      const facts = emptyFacts();
      mergeInto(facts, top);
      collect(o, facts);
      this.#add(o.ref, source, facts);
      here = facts;
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'ref') continue;
      if (k === 'refs' && Array.isArray(v)) {
        for (const r of v)
          if (isRef(r)) {
            const facts = emptyFacts();
            mergeInto(facts, here ?? top);
            this.#add(r, source, facts);
          }
        continue;
      }
      this.#walk(v, source, top, here);
    }
  }

  /**
   * A tool's successful result: its data as sent, and every ref it returned.
   * The result's own top-level values (a forecast's fetch time and credit, a
   * list's count) are facts of every record in it.
   */
  addResult(source: ToolName, data: unknown, refs: readonly Ref[]): void {
    const top = emptyFacts();
    if (typeof data === 'object' && data !== null && !Array.isArray(data))
      for (const [k, v] of Object.entries(data))
        if (typeof v === 'string' || typeof v === 'number') collect(v, top, k);
    this.#walk(data, source, top, null);
    // Every returned ref is citable, even one the walk did not meet.
    for (const r of refs) if (!this.has(r)) this.#add(r, source, emptyFacts());
  }

  /** The bundle: its records start the ledger; its people are names the answer may use. */
  addBundle(bundle: unknown, refs: readonly Ref[]): void {
    this.#walk(bundle, 'bundle', emptyFacts(), null);
    for (const r of refs) if (!this.has(r)) this.#add(r, 'bundle', emptyFacts());
    const b = bundle as {
      people?: { name?: { untrusted_text?: string } }[];
      reader?: { name?: { untrusted_text?: string } } | null;
      now?: { date?: string };
    };
    for (const p of [...(b.people ?? []), ...(b.reader ? [b.reader] : [])]) {
      const n = p.name?.untrusted_text;
      if (typeof n !== 'string') continue;
      this.recordedTexts.add(n);
      this.peopleNames.add(n);
      for (const w of wordsOf(n)) this.peopleWords.add(w);
    }
    if (typeof b.now?.date === 'string' && DATE.test(b.now.date))
      this.#covered.add(b.now.date as IsoDate);
  }

  /** The dates `from`…`to` (inclusive, at most 92) that a successful read covered. */
  addCovered(from: string, to: string): void {
    if (!DATE.test(from) || !DATE.test(to) || to < from) return;
    let d = from as IsoDate;
    for (let i = 0; i < 92 && d <= to; i++) {
      this.#covered.add(d);
      d = addDays(d, 1);
    }
  }

  get covered(): ReadonlySet<IsoDate> {
    return this.#covered;
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

function mergeInto(into: LedgerFacts, from: LedgerFacts): void {
  for (const k of ['times', 'dates', 'numbers', 'durations', 'parts', 'words', 'texts'] as const)
    for (const v of from[k] as Set<unknown>) (into[k] as Set<unknown>).add(v);
}
