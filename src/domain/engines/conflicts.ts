import type { AgendaDay, AgendaEventInput, AgendaItem, AgendaPersonRef } from './agenda';
import { occurrenceKey, routineEvents } from './day-facts';
import { addDays, longDate, type IsoDate } from '@/lib/dates';

// The conflict engine (M6 Package 2; contract §5.6–§5.7, ADR 0009 §9–§14).
// It states two things, and only these, from the records the reader can see:
//
//   conflict.responsible  a visible person is recorded as responsible on both
//                         of two overlapping timed occurrences;
//   conflict.overlap      a visible person is on both of two overlapping timed
//                         occurrences, and is not responsible on both.
//
// One conflict per person per pair. Overlap is decided on instants: each
// occurrence starts before the other ends, so ends that touch do not
// overlap. Excluded: all-day events (and so any away or travel reading),
// Today's routine occurrences, work-with-work pairs and two occurrences of
// the same event. Nothing is inferred: not availability, not transport, not
// who should change. Pure: the caller reads every record through the domain
// services as the reader (so visibility, archive and sensitivity are already
// applied), runs the shared agenda over the window and passes it in. No I/O,
// no clock (`now` is injected), stable sorts with explicit tie-breaks.
//
// Identity (§5.7.1, ADR 0009 §13). A key is built from ids and times only:
//   standing    both occurrences are unchanged occurrences of recurring
//               series: `{rule}:{person}:{seriesA}.{seriesB}:w{HHMM}-{HHMM}`,
//               the overlap's home-zone wall clock. Said once, at its next
//               occurrence; every repeat in the window has the same key.
//   occurrence  either is a one-off or a changed occurrence (its own row):
//               `{rule}:{person}:{eventA}.{eventB}:{startUTC}-{endUTC}`, the
//               overlap's instants to the minute. An unchanged series
//               occurrence in such a pair is named by its series id.
// Ids are sorted. No viewing date, no occurrence date, no text: a key changes
// exactly when the rule, the person, either commitment or the window does.

export const CONFLICT_RULES = ['conflict.responsible', 'conflict.overlap'] as const;
export type ConflictRule = (typeof CONFLICT_RULES)[number];
export type ConflictIdentity = 'standing' | 'occurrence';

/** A person the reader can see. Only these can be in a conflict. */
export type ConflictPerson = { id: string; name: string; inHousehold: boolean };

export type ConflictInput = {
  now: Date;
  /** The home zone: `when`, standing windows and wording use its wall clock. */
  timeZone: string;
  /** The home dates to look across, inclusive (Today: 8 days; Forward: 90). */
  window: { from: IsoDate; to: IsoDate };
  /** The shared agenda's days over at least the window. */
  days: readonly AgendaDay[];
  /** The home-date range the agenda was computed over (it leaves empty days out). */
  coverage: { from: IsoDate; to: IsoDate };
  /** The events the agenda was given: their recurrence and kind decide identity and exclusions. */
  events: readonly AgendaEventInput[];
  /** The people the reader can see. */
  people: readonly ConflictPerson[];
};

/** One side of a conflict: an occurrence as recorded, and the person's role on it. */
export type ConflictOccurrence = {
  /** `{eventId}:{occurrenceDate}`: the agenda's occurrence identity. */
  occurrence: string;
  eventId: string;
  occurrenceDate: IsoDate;
  title: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  /** Whether it is an unchanged occurrence of a recurring series. */
  repeats: boolean;
  /** The conflict's person's recorded role on it. */
  role: 'attending' | 'responsible';
};

/** One overlap of the two commitments. A standing conflict has one per repeat in the window. */
export type ConflictInstance = {
  occurrences: readonly [ConflictOccurrence, ConflictOccurrence];
  overlap: { from: Date; to: Date };
  /** The home date the overlap starts. */
  when: IsoDate;
};

/** Structural references: every one resolves to a record the reader can see. */
export type ConflictFact =
  { kind: 'person'; id: string } | { kind: 'event'; id: string; occurrenceDate: IsoDate };

export type Conflict = {
  key: string;
  rule: ConflictRule;
  identity: ConflictIdentity;
  person: { id: string; name: string };
  /** The (next) overlap: the one it is said at. */
  when: IsoDate;
  occurrences: readonly [ConflictOccurrence, ConflictOccurrence];
  overlap: { from: Date; to: Date };
  /** Every current overlap under this key in the window, the next first. */
  instances: readonly ConflictInstance[];
  facts: readonly ConflictFact[];
  /** The sentence that states it (§5.6), factual and nothing more. */
  text: string;
};

/** Thrown when the agenda does not cover the window: absence there would mean nothing. */
export class ConflictWindowError extends Error {
  constructor(window: { from: IsoDate; to: IsoDate }, coverage: { from: IsoDate; to: IsoDate }) {
    super(
      `the agenda covers ${coverage.from}…${coverage.to}, not the window ${window.from}…${window.to}`,
    );
    this.name = 'ConflictWindowError';
  }
}

type Timed = Extract<AgendaItem, { kind: 'event'; allDay: false }>;
/** One occurrence as one person is on it, built once and shared by every pair it is in. */
type Side = ConflictOccurrence & {
  kind: Timed['eventKind'];
  from: { date: IsoDate; clock: string };
  to: { clock: string };
};

const RULE_RANK: Record<ConflictRule, number> = {
  'conflict.responsible': 0,
  'conflict.overlap': 1,
};

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * An instant's home date and wall clock ("2026-10-14", "15:45"), the same as
 * `isoDateInZone` and `clockOf`, from one formatter per run and once per
 * instant: those helpers build a formatter on every call, which would cost
 * more than the whole sweep.
 */
function homeClock(timeZone: string): (instant: Date) => { date: IsoDate; clock: string } {
  const format = new Intl.DateTimeFormat('en-NZ', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const seen = new Map<number, { date: IsoDate; clock: string }>();
  return (instant) => {
    const t = instant.getTime();
    let out = seen.get(t);
    if (!out) {
      const parts = format.formatToParts(instant);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
      out = {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        clock: `${get('hour')}:${get('minute')}`,
      };
      seen.set(t, out);
    }
    return out;
  };
}

/** `20261014T0230Z`: an instant in UTC, to the minute. */
function utcMinute(instant: Date): string {
  return (
    `${instant.getUTCFullYear()}${pad(instant.getUTCMonth() + 1)}${pad(instant.getUTCDate())}` +
    `T${pad(instant.getUTCHours())}${pad(instant.getUTCMinutes())}Z`
  );
}

/** The person's role on an occurrence: responsible if any of their entries says so. */
function roleOf(people: readonly AgendaPersonRef[], personId: string): Side['role'] | null {
  let role: Side['role'] | null = null;
  for (const p of people)
    if (p.personId === personId) {
      if (p.role === 'responsible') return 'responsible';
      role = 'attending';
    }
  return role;
}

/** Earlier start first, then earlier end, then occurrence identity: a total order. */
function compareSides(
  a: { startsAt: Date; endsAt: Date; occurrence: string },
  b: { startsAt: Date; endsAt: Date; occurrence: string },
): number {
  return (
    a.startsAt.getTime() - b.startsAt.getTime() ||
    a.endsAt.getTime() - b.endsAt.getTime() ||
    (a.occurrence < b.occurrence ? -1 : a.occurrence > b.occurrence ? 1 : 0)
  );
}

/** "today", "tomorrow", "on Wednesday 4 November": each date worded once per run. */
function dayWords(today: IsoDate): (date: IsoDate) => string {
  const tomorrow = addDays(today, 1);
  const said = new Map<IsoDate, string>();
  return (date) => {
    if (date === today) return 'today';
    if (date === tomorrow) return 'tomorrow';
    let words = said.get(date);
    if (!words) said.set(date, (words = `on ${longDate(date)}`));
    return words;
  };
}

/** The sentence (§5.6). It names what is recorded and when; never why, where or who should change. */
function sentence(
  c: Pick<Conflict, 'occurrences' | 'when' | 'person' | 'rule' | 'identity'>,
  onDay: (date: IsoDate) => string,
  [from, to]: [string, string],
  clockAt: (instant: Date) => string,
): string {
  // Two occurrences with the same title (a moved occurrence on another of its
  // own series, ADR 0009 §33) are told apart by their recorded starts.
  const same = c.occurrences[0].title === c.occurrences[1].title;
  const label = (o: ConflictOccurrence) => ({
    title: same ? `${o.title} (from ${clockAt(o.startsAt)})` : o.title,
  });
  const [a, b] = [label(c.occurrences[0]), label(c.occurrences[1])];
  const span = `${from}–${to}`;
  const day = onDay(c.when);
  const name = c.person.name;
  if (c.identity === 'standing') {
    const lead =
      c.rule === 'conflict.responsible'
        ? `${name} is recorded as responsible for both ${a.title} and ${b.title}, which overlap regularly`
        : `${name}’s ${a.title} and ${b.title} overlap regularly`;
    // "…; the next is today.", "…; the next is on Wednesday 21 October." (owner's wording, ADR 0009 §36)
    return `${lead}, ${span}; the next is ${day}.`;
  }
  return c.rule === 'conflict.responsible'
    ? `${name} is recorded as responsible for both ${a.title} and ${b.title}, which overlap ${day}, ${span}.`
    : `${name} has ${a.title} and ${b.title} at the same time ${day}, ${span}.`;
}

/**
 * The reader's current conflicts in the window, in order: `responsible`
 * before `overlap`, then the (next) overlap's start, then the key. A
 * conflict is current while its (next) overlap has not ended at `now`.
 */
export function conflicts(input: ConflictInput): Conflict[] {
  const { now, timeZone, window, coverage } = input;
  if (coverage.from > window.from || coverage.to < window.to)
    throw new ConflictWindowError(window, coverage);

  const visible = new Map(input.people.map((p) => [p.id, p]));
  const household = new Set(input.people.filter((p) => p.inHousehold).map((p) => p.id));
  const routine = routineEvents(input.events, household);
  const recurring = new Set(input.events.filter((e) => e.rrule).map((e) => e.id));
  const home = homeClock(timeZone);

  // Each timed occurrence once, however many home days it is placed on.
  const seen = new Map<string, Timed>();
  for (const d of input.days) {
    if (d.date < window.from || d.date > window.to) continue;
    for (const i of d.items)
      if (i.kind === 'event' && !i.allDay && !seen.has(occurrenceKey(i)))
        seen.set(occurrenceKey(i), i);
  }

  // Per visible person, the occurrences they are on.
  const byPerson = new Map<string, Side[]>();
  for (const [occurrence, item] of seen) {
    if (routine.has(item.eventId)) continue; // Today's routine takes part in no conflict
    if (item.endsAt <= item.startsAt) continue; // no time, so nothing to overlap
    for (const personId of new Set(item.people.map((p) => p.personId))) {
      if (!visible.has(personId)) continue;
      const side: Side = {
        occurrence,
        eventId: item.eventId,
        occurrenceDate: item.occurrenceDate,
        title: item.title,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        timeZone: item.timeZone,
        repeats: recurring.has(item.eventId),
        role: roleOf(item.people, personId)!,
        kind: item.eventKind,
        from: home(item.startsAt),
        to: home(item.endsAt),
      };
      const list = byPerson.get(personId);
      if (list) list.push(side);
      else byPerson.set(personId, [side]);
    }
  }

  type Found = Pick<Conflict, 'key' | 'rule' | 'identity' | 'person'> & {
    instances: ConflictInstance[];
    clocks: [string, string];
  };
  const found = new Map<string, Found>();
  for (const [personId, sides] of byPerson) {
    // A sweep in start order: each occurrence is compared only with those
    // still running when it starts, never with the whole window.
    sides.sort(compareSides);
    const running: Side[] = [];
    for (const s of sides) {
      for (let k = running.length - 1; k >= 0; k--)
        // The overlap test: one that ended when (or before) s starts has no
        // time in common with it, so ends that touch do not overlap. Every
        // one left started no later than s and ends after s starts, and s
        // has length, so each pair below overlaps from s's start.
        if (running[k]!.endsAt <= s.startsAt) running.splice(k, 1);
      for (const r of running) {
        // r started no later than s (start order), so the overlap starts at s.
        const first = r.endsAt < s.endsAt ? r : s; // whose end ends the overlap
        const from = s.startsAt;
        const to = first.endsAt;
        if (to <= now) continue; // over: not current
        if (r.eventId === s.eventId) continue; // a series never conflicts with itself
        if (r.kind === 'work' && s.kind === 'work') continue;
        const rule: ConflictRule =
          r.role === 'responsible' && s.role === 'responsible'
            ? 'conflict.responsible'
            : 'conflict.overlap';
        const identity: ConflictIdentity = r.repeats && s.repeats ? 'standing' : 'occurrence';
        const ids =
          r.eventId < s.eventId ? `${r.eventId}.${s.eventId}` : `${s.eventId}.${r.eventId}`;
        const span =
          identity === 'standing'
            ? `w${s.from.clock.replace(':', '')}-${first.to.clock.replace(':', '')}`
            : `${utcMinute(from)}-${utcMinute(to)}`;
        const key = `${rule}:${personId}:${ids}:${span}`;
        const instance: ConflictInstance = {
          occurrences:
            compareSides(r, s) <= 0
              ? [occurrenceOf(r), occurrenceOf(s)]
              : [occurrenceOf(s), occurrenceOf(r)],
          overlap: { from, to },
          when: s.from.date,
        };
        const existing = found.get(key);
        if (existing) existing.instances.push(instance);
        else
          found.set(key, {
            key,
            rule,
            identity,
            person: { id: personId, name: visible.get(personId)!.name },
            instances: [instance],
            clocks: [s.from.clock, first.to.clock],
          });
      }
      running.push(s);
    }
  }

  const onDay = dayWords(home(now).date);
  const out: Conflict[] = [];
  for (const { clocks, ...f } of found.values()) {
    const instances = f.instances.sort(
      (a, b) =>
        a.overlap.from.getTime() - b.overlap.from.getTime() ||
        compareSides(a.occurrences[0], b.occurrences[0]),
    );
    const next = instances[0]!;
    const base = { ...f, when: next.when, occurrences: next.occurrences, overlap: next.overlap };
    out.push({
      ...base,
      facts: [
        { kind: 'person', id: f.person.id },
        ...next.occurrences.map((o): ConflictFact => ({
          kind: 'event',
          id: o.eventId,
          occurrenceDate: o.occurrenceDate,
        })),
      ],
      text: sentence(base, onDay, clocks, (d) => home(d).clock),
    });
  }
  return out.sort(compareConflicts);
}

/** The public view of a side: what was recorded, and this person's role on it. */
function occurrenceOf(s: Side): ConflictOccurrence {
  return {
    occurrence: s.occurrence,
    eventId: s.eventId,
    occurrenceDate: s.occurrenceDate,
    title: s.title,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    timeZone: s.timeZone,
    repeats: s.repeats,
    role: s.role,
  };
}

/** The approved order (§5.6): rule, then the (next) overlap's start, then the key. Total. */
export function compareConflicts(a: Conflict, b: Conflict): number {
  return (
    RULE_RANK[a.rule] - RULE_RANK[b.rule] ||
    a.overlap.from.getTime() - b.overlap.from.getTime() ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}
