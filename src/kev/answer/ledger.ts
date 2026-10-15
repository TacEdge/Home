import 'server-only';
import { addDays, isoDateInZone, type IsoDate } from '@/lib/dates';
import { refSchema, type Ref, type ToolName } from '../tools/types';

// The attempt's ledger (M8 contract §4.4 `LedgerEntry`, §6.1, §8.3; owner
// amendment ADR 0012 §46): every record the bundle and this attempt's
// successful tool results carry, each kept as the object that carried it,
// so HOME's renderer can write a fact block from that record's own fields
// and nothing else. One ledger per attempt: an escalated turn's deep
// attempt starts a new one, so nothing the fast attempt read can be shown
// (C15); a record an earlier turn mentioned must be read again (C7).
//
// What an entry knows, all from the object that carried its ref:
// - `record`: that object as the tool sent it (null for a ref listed only
//   under an object's `refs`, such as an insight's facts: such a record can
//   be cited by the insight, never rendered on its own);
// - `shape`: which of the tools' output shapes it is (an agenda item, a
//   conflict's commitment, a person on an event …), so the renderer reads
//   the right fields and refuses the wrong ones (a person on an event
//   carries a role on that event, never their own facts);
// - `dates`, `people`, `span`: when it is recorded, who is on it (null when
//   the object does not say) and its timed span, for absence and counts;
// - `context`: the few result-level values that are facts of every record
//   in the result, by an explicit allow-list decided from the output
//   schemas: a forecast day's fetch time, freshness and credit; a gap's
//   scope and the coverage of the read that found it. Nothing else at the
//   top level of a result (its `from`/`to`, `count`, `truncated`) is a fact
//   of its records.
//
// Coverage (kept from the Package 3 review, I-8 and M-4): which days a
// complete read establishes "nothing is recorded" for, of what kind and for
// whom: the bundle's Today and get_today cover today's agenda; get_agenda
// its range's agenda (only for the people asked for, when it was filtered);
// get_conflicts its range's overlaps; get_weather the asked days it has no
// forecast for (all of them when none is set up); a search what it searched
// for. A truncated read covers nothing. A forecast, gaps or conflicts read is
// never agenda coverage.

export type DayPart = 'morning' | 'afternoon' | 'evening';
export type LedgerSource = ToolName | 'bundle';

export type Shape =
  | 'agenda_event'
  | 'commitment'
  | 'regular'
  | 'title_only'
  | 'task'
  | 'task_due'
  | 'task_scheduled'
  | 'todo'
  | 'project_list'
  | 'project_full'
  | 'project_target'
  | 'note'
  | 'bundle_person'
  | 'people_person'
  | 'birthday'
  | 'person_on'
  | 'named'
  | 'conflict'
  | 'insight'
  | 'gap'
  | 'forecast'
  | 'calendar'
  | 'context'
  | 'ref_only';

export type EntryContext = {
  /** A gap's read: whose stretches (`household` or a person id) and how complete its calendars were. */
  gapScope?: 'household' | string;
  gapCoverage?: 'recorded' | 'partial' | 'unknown';
  /** A forecast day's read: when it was fetched, how fresh, and whose forecast. */
  fetchedAt?: string | null;
  freshness?: string;
  credit?: string;
};

export type LedgerEntry = {
  ref: Ref;
  source: LedgerSource;
  /** Which read (bundle or tool result, numbered in order) returned it. */
  read: number;
  record: Readonly<Record<string, unknown>> | null;
  shape: Shape;
  /** The day an agenda or Today list put it under, if any. */
  day?: IsoDate;
  context: EntryContext;
  /** The home dates it is recorded on (its occurrence, due date, target, birthday …). */
  dates: ReadonlySet<IsoDate>;
  /** The visible people on it, or null when the object does not say. */
  people: ReadonlySet<string> | null;
  /** Its timed span (epoch ms), or null when it has no time of day. */
  span: { from: number; to: number } | null;
};

export type CoverageKind = 'agenda' | 'conflicts' | 'forecast' | 'search';
export type CoverageSpan = {
  kind: CoverageKind;
  /** The read that established it. */
  read: number;
  /** The days covered (for `forecast`: the days the forecast does not cover). */
  days: ReadonlySet<IsoDate>;
  /** The person ids the read was limited to, or null for everyone the reader can see. */
  persons: ReadonlySet<string> | null;
  /** `forecast`: whether a forecast is set up at all. */
  configured?: boolean;
  /** `search`: what was searched for, trimmed. */
  query?: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Keys of recorded text whose words are a record's own (titles, names, labels, notes …). */
const RECORD_TEXT_KEYS = new Set([
  'title',
  'name',
  'label',
  'body',
  'content',
  'summary',
  'stage_note',
  'relationship',
]);

const isRef = (v: unknown): v is Ref => refSchema.safeParse(v).success;
const refOf = (v: unknown): Ref | null => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const r = (v as { ref?: unknown }).ref;
  return isRef(r) ? r : null;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const untrustedOf = (v: unknown): string | null =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { untrusted_text?: unknown }).untrusted_text === 'string'
    ? (v as { untrusted_text: string }).untrusted_text
    : null;

/** The dates `from`…`to` inclusive (at most 92). */
export function daysFrom(from: string, to: string): Set<IsoDate> {
  const out = new Set<IsoDate>();
  if (!DATE.test(from) || !DATE.test(to) || to < from) return out;
  let d = from as IsoDate;
  for (let i = 0; i < 92 && d <= to; i++) {
    out.add(d);
    d = addDays(d, 1);
  }
  return out;
}

/** The shape of an object carrying a ref, from its own keys and where it sat. */
function shapeOf(o: Record<string, unknown>, ref: Ref, parentKey: string | undefined): Shape {
  const has = (k: string) => Object.hasOwn(o, k);
  switch (o.type) {
    case 'event':
      if (ref.type === 'event' && has('all_day')) return 'agenda_event';
      break;
    case 'birthday':
      if (ref.type === 'person') return 'birthday';
      break;
    case 'task_due':
      if (ref.type === 'task') return 'task_due';
      break;
    case 'task_scheduled':
      if (ref.type === 'task') return 'task_scheduled';
      break;
    case 'project_target':
      if (ref.type === 'project') return 'project_target';
      break;
  }
  switch (ref.type) {
    case 'event':
      if (parentKey === 'commitments') return 'commitment';
      if (has('weekday') && has('cadence')) return 'regular';
      return has('title') ? 'title_only' : 'ref_only';
    case 'task':
      if (has('status')) return 'task';
      if (has('rule')) return 'todo';
      return has('title') ? 'title_only' : 'ref_only';
    case 'project':
      if (has('summary') && has('tasks')) return 'project_full';
      if (has('open_tasks')) return 'project_list';
      return has('title') ? 'title_only' : 'ref_only';
    case 'note':
      return has('body') ? 'note' : 'ref_only';
    case 'person':
      if (has('in_household') && has('relationship')) return 'bundle_person';
      if (has('next_birthday')) return 'people_person';
      if (o.role === 'attending' || o.role === 'responsible') return 'person_on';
      return has('name') || has('title') ? 'named' : 'ref_only';
    case 'conflict':
      return has('commitments') ? 'conflict' : 'ref_only';
    case 'insight':
      return has('rule') && has('text') ? 'insight' : 'ref_only';
    case 'gap':
      return has('from') && has('to') && has('date') ? 'gap' : 'ref_only';
    case 'forecast':
      return has('phrase') ? 'forecast' : 'ref_only';
    case 'calendar':
      return has('status') && has('label') ? 'calendar' : 'ref_only';
    case 'context':
      return has('content') && has('category') ? 'context' : 'ref_only';
  }
  return 'ref_only';
}

export class Ledger {
  readonly #entries: LedgerEntry[] = [];
  readonly #byKey = new Map<string, LedgerEntry[]>();
  readonly #coverage: CoverageSpan[] = [];
  /** Refs the tools (not the bundle) returned, in order, each once. */
  readonly #toolRefs: Ref[] = [];
  readonly #toolRefKeys = new Set<string>();
  #reads = 0;
  readonly #timeZone: string;
  /** The visible people's names by person id (from the bundle and the reads). */
  readonly namesById = new Map<string, string>();
  /** Every recorded title, name, label, note and context text in the ledger, as sent. */
  readonly recordTexts = new Set<string>();
  /** The reader's own person id, when a person is linked to them. */
  readerId: string | null = null;

  constructor(timeZone: string) {
    this.#timeZone = timeZone;
  }

  get timeZone(): string {
    return this.#timeZone;
  }

  get size(): number {
    return this.#entries.length;
  }

  get entries(): readonly LedgerEntry[] {
    return this.#entries;
  }

  get coverage(): readonly CoverageSpan[] {
    return this.#coverage;
  }

  #dateOf(instant: string | undefined): IsoDate | null {
    if (!instant) return null;
    const t = Date.parse(instant);
    return Number.isFinite(t) ? isoDateInZone(new Date(t), this.#timeZone) : null;
  }

  /** The dates, people and span an object records (see the header). */
  #facts(
    o: Record<string, unknown> | null,
    ref: Ref,
    shape: Shape,
    day: IsoDate | undefined,
  ): Pick<LedgerEntry, 'dates' | 'people' | 'span'> {
    const dates = new Set<IsoDate>();
    const add = (d: unknown) => {
      if (typeof d === 'string' && DATE.test(d)) dates.add(d as IsoDate);
    };
    const addInstant = (s: unknown) => {
      const d = this.#dateOf(str(s));
      if (d) dates.add(d);
    };
    if (day) dates.add(day);
    if (ref.at) addInstant(ref.at);
    let people: Set<string> | null = null;
    let span: LedgerEntry['span'] = null;
    const spanOf = (a: unknown, b: unknown) => {
      const x = Date.parse(str(a) ?? '');
      const y = Date.parse(str(b) ?? '');
      return Number.isFinite(x) ? { from: x, to: Number.isFinite(y) && y > x ? y : x } : null;
    };
    if (o) {
      switch (shape) {
        case 'agenda_event': {
          if (o.all_day !== true) {
            addInstant(o.start);
            addInstant(o.end);
            span = spanOf(o.start, o.end);
          }
          people = new Set(
            (Array.isArray(o.people) ? o.people : [])
              .map((p) => refOf(p)?.id)
              .filter((x): x is string => typeof x === 'string'),
          );
          break;
        }
        case 'commitment':
          addInstant(o.start);
          addInstant(o.end);
          span = spanOf(o.start, o.end);
          break;
        case 'task': {
          add(o.due);
          const s = o.scheduled as { start?: unknown; end?: unknown } | null;
          if (s) {
            addInstant(s.start);
            span = spanOf(s.start, s.end);
          }
          const a = refOf(o.assignee);
          people = new Set(a ? [a.id] : []);
          break;
        }
        case 'task_due':
          add(o.due);
          break;
        case 'task_scheduled':
          addInstant(o.start);
          span = spanOf(o.start, o.end);
          break;
        case 'todo':
          add(o.due);
          addInstant(o.scheduled_start);
          if (o.scheduled_start) span = spanOf(o.scheduled_start, o.scheduled_start);
          break;
        case 'project_list':
        case 'project_full':
          add(o.target_date);
          people = new Set();
          break;
        case 'project_target':
          add(o.date);
          people = new Set();
          break;
        case 'birthday':
          people = new Set([ref.id]);
          break;
        case 'people_person': {
          const nb = o.next_birthday as { date?: unknown } | null;
          if (nb) add(nb.date);
          people = new Set([ref.id]);
          break;
        }
        case 'conflict':
          add(o.when);
          break;
        case 'gap':
        case 'forecast':
          add(o.date);
          break;
        case 'insight':
          add(o.when);
          break;
        default:
          break;
      }
    }
    return { dates, people, span };
  }

  #add(
    ref: Ref,
    source: LedgerSource,
    record: Record<string, unknown> | null,
    shape: Shape,
    context: EntryContext,
    day?: IsoDate,
  ): void {
    const entry: LedgerEntry = {
      ref: ref.at === undefined ? { type: ref.type, id: ref.id } : { ...ref },
      source,
      read: this.#reads,
      record: record ? Object.freeze({ ...record }) : null,
      shape,
      ...(day ? { day } : {}),
      context,
      ...this.#facts(record, ref, shape, day),
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

  /** Recorded text and people's names, for the prose check (./prose.ts). */
  #texts(node: unknown, key: string | undefined): void {
    if (Array.isArray(node)) {
      for (const v of node) this.#texts(v, key);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const o = node as Record<string, unknown>;
    const t = untrustedOf(o);
    if (t !== null) {
      if (key !== undefined && RECORD_TEXT_KEYS.has(key)) this.recordTexts.add(t);
      return;
    }
    const ref = refOf(o);
    const name = untrustedOf(o.name);
    if (ref?.type === 'person' && name !== null && !this.namesById.has(ref.id))
      this.namesById.set(ref.id, name);
    for (const [k, v] of Object.entries(o)) this.#texts(v, k);
  }

  /**
   * Walks a result: every object carrying a ref is an entry; refs under
   * `refs` are ref-only entries; agenda days and Today give their items the
   * day. `context` is the result's allow-listed values for its records.
   */
  #walk(
    node: unknown,
    source: LedgerSource,
    context: (ref: Ref) => EntryContext,
    day: IsoDate | undefined,
    parentKey: string | undefined,
    todayDate: IsoDate | undefined,
  ): void {
    if (Array.isArray(node)) {
      for (const v of node) this.#walk(v, source, context, day, parentKey, todayDate);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const o = node as Record<string, unknown>;
    if (untrustedOf(o) !== null) return;
    const ref = refOf(o);
    if (ref) {
      const shape = shapeOf(o, ref, parentKey);
      const isItem = typeof o.type === 'string';
      // Today's To do: a task due or scheduled today is today's.
      const todoToday =
        shape === 'todo' &&
        (o.rule === 'todo.due_today' || o.rule === 'todo.scheduled_today') &&
        todayDate !== undefined;
      const itemDay = isItem ? day : todoToday ? todayDate : undefined;
      this.#add(ref, source, o, shape, context(ref), itemDay);
    }
    const ownDate =
      typeof o.date === 'string' && DATE.test(o.date) ? (o.date as IsoDate) : undefined;
    const isAgendaDay = !ref && ownDate !== undefined && Array.isArray(o.items);
    const isToday = !ref && ownDate !== undefined && 'headline' in o && 'state' in o;
    const today = isToday ? ownDate : todayDate;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'ref') continue;
      if (k === 'refs' && Array.isArray(v)) {
        for (const r of v) if (isRef(r)) this.#add(r, source, null, 'ref_only', {});
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
      this.#walk(v, source, context, childDay, k, today);
    }
  }

  /**
   * A tool's successful result: its data as sent, and every ref it
   * returned; `input` is the call's validated input (a filtered agenda's
   * people, the forecast's asked days, a search's query). Records the
   * read's coverage (above).
   */
  addResult(source: ToolName, data: unknown, refs: readonly Ref[], input?: unknown): void {
    this.#reads++;
    const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
    let context: (ref: Ref) => EntryContext = () => ({});
    if (source === 'get_weather') {
      const c: EntryContext = {
        fetchedAt: str(d.fetched_at) ?? null,
        ...(str(d.freshness) ? { freshness: str(d.freshness)! } : {}),
        ...(str(d.credit) ? { credit: str(d.credit)! } : {}),
      };
      context = (r) => (r.type === 'forecast' ? c : {});
    } else if (source === 'get_gaps') {
      const scope = d.scope === 'household' ? 'household' : refOf(d.scope)?.id;
      const status = (d.coverage as { status?: unknown } | undefined)?.status;
      const c: EntryContext = {
        ...(scope ? { gapScope: scope } : {}),
        ...(status === 'recorded' || status === 'partial' || status === 'unknown'
          ? { gapCoverage: status }
          : {}),
      };
      context = (r) => (r.type === 'gap' ? c : {});
    }
    this.#texts(data, undefined);
    this.#walk(data, source, context, undefined, undefined, undefined);
    // Every returned ref is citable, even one the walk did not meet.
    for (const r of refs) if (!this.has(r)) this.#add(r, source, null, 'ref_only', {});
    this.#coverFrom(source, d, input);
  }

  #cover(span: Omit<CoverageSpan, 'read'>): void {
    this.#coverage.push({ ...span, read: this.#reads });
  }

  #coverFrom(source: LedgerSource, d: Record<string, unknown>, input: unknown): void {
    const unconfigured = source === 'get_weather' && d.configured === false;
    if (d.truncated !== false && !unconfigured) return;
    const from = str(d.from);
    const to = str(d.to);
    if (source === 'get_agenda' && from && to) {
      const ids = (input as { person_ids?: unknown } | undefined)?.person_ids;
      const persons = Array.isArray(ids)
        ? new Set(ids.filter((x): x is string => typeof x === 'string'))
        : null;
      this.#cover({ kind: 'agenda', days: daysFrom(from, to), persons });
    } else if (source === 'get_conflicts' && from && to) {
      this.#cover({ kind: 'conflicts', days: daysFrom(from, to), persons: null });
    } else if (source === 'get_today' && typeof d.date === 'string' && DATE.test(d.date)) {
      this.#cover({ kind: 'agenda', days: new Set([d.date as IsoDate]), persons: null });
    } else if (source === 'get_weather') {
      // What the forecast does not have: the asked days it does not cover, or all of them with none set up.
      const asked = input as { from?: unknown; to?: unknown } | undefined;
      const days =
        unconfigured && typeof asked?.from === 'string' && typeof asked.to === 'string'
          ? daysFrom(asked.from, asked.to)
          : new Set(
              (Array.isArray(d.uncovered) ? d.uncovered : []).filter(
                (x): x is IsoDate => typeof x === 'string' && DATE.test(x),
              ),
            );
      this.#cover({ kind: 'forecast', days, persons: null, configured: !unconfigured });
    } else if (source === 'search') {
      const q = (input as { query?: unknown } | undefined)?.query;
      if (typeof q === 'string')
        this.#cover({ kind: 'search', days: new Set(), persons: null, query: q.trim() });
    }
  }

  /** The bundle: its records start the ledger; its people are named; its Today covers today. */
  addBundle(bundle: unknown, refs: readonly Ref[]): void {
    this.#reads++;
    const b = bundle as {
      people?: { ref?: unknown; name?: { untrusted_text?: string } }[];
      reader?: { ref?: unknown; name?: { untrusted_text?: string } } | null;
      today?: { date?: unknown; truncated?: unknown };
    };
    for (const p of [...(b.reader ? [b.reader] : []), ...(b.people ?? [])]) {
      const n = p.name?.untrusted_text;
      if (typeof n === 'string' && isRef(p.ref) && p.ref.type === 'person')
        this.namesById.set(p.ref.id, n);
    }
    if (b.reader && isRef(b.reader.ref)) this.readerId = b.reader.ref.id;
    this.#texts(bundle, undefined);
    this.#walk(bundle, 'bundle', () => ({}), undefined, undefined, undefined);
    for (const ref of refs) if (!this.has(ref)) this.#add(ref, 'bundle', null, 'ref_only', {});
    if (
      b.today &&
      typeof b.today.date === 'string' &&
      DATE.test(b.today.date) &&
      b.today.truncated === false
    )
      this.#cover({ kind: 'agenda', days: new Set([b.today.date as IsoDate]), persons: null });
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

  /** The entries a ref resolves to: its type and id, and its `at` when it gives one. */
  resolve(ref: Ref): LedgerEntry[] {
    const list = this.#byKey.get(keyOf(ref)) ?? [];
    return ref.at === undefined ? list : list.filter((e) => e.ref.at === ref.at);
  }

  has(ref: Ref): boolean {
    return this.resolve(ref).length > 0;
  }

  /** The visible people on a record, from whichever of its entries says (null if none does). */
  peopleOf(e: LedgerEntry): ReadonlySet<string> | null {
    if (e.people) return e.people;
    for (const o of this.resolve(e.ref)) if (o.people) return o.people;
    return null;
  }

  /** The refs the tools returned this attempt, in order, each once (the fallback's rows). */
  toolRefs(): readonly Ref[] {
    return this.#toolRefs;
  }
}

export const keyOf = (r: Pick<Ref, 'type' | 'id'>) => `${r.type}|${r.id}`;
export const fullKeyOf = (r: Ref) => `${r.type}|${r.id}|${r.at ?? ''}`;

/** The part of the day an hour is in: before 12, before 17, then evening. */
export const partOf = (hour: number): DayPart =>
  hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
