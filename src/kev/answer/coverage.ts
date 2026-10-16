import 'server-only';
import { capitalise, nameList, numberWord } from '@/domain/engines/day-facts';
import { atHome, staleSentence } from '@/domain/engines/weather';
import { addDays, clockOf, isoDateInZone, type IsoDate } from '@/lib/dates';
import { daysFrom, fullKeyOf, partOf, type DayPart, type Ledger, type LedgerEntry } from './ledger';
import { daysPhrase, nameText } from './render';
import type { Scope, SummaryBlock } from './schema';

// Absence and counts (M8 contract §8.3; owner amendment, ADR 0012 §46). The
// model can no longer say "nothing", "only", "all" or "two things" in its
// own words: it asks for an `absence` or `count` block over an explicit
// scope, and this module decides whether the ledger supports it and what
// code says. The coverage rules are the ones the Package 3 review verified
// (agenda vs overlaps vs forecast; a person-filtered read only for
// its people; part of the day; `else`; truncated reads cover nothing; days
// no read covered fail), now applied to a scope the model states
// structurally instead of a sentence a pattern had to read.
//
// An absence holds when every day of its scope was covered by a complete
// read of its kind (for each person it names), and the ledger holds no
// record of that kind on those days (for those people, in that part of the
// day) except, with `else`, records the plan shows in its other blocks;
// `else` also needs at least one. A count is the number of events (or
// overlaps) the ledger holds in scope, over the same coverage, and only
// when who is on each is known. Code writes the sentence.

export type SummaryOutcome =
  { ok: true; text: string; dates: IsoDate[] } | { ok: false; code: 'absence.unsupported' };

const fail = { ok: false as const, code: 'absence.unsupported' as const };

const AGENDA_TYPES = new Set(['event', 'task', 'project']);

/** Whether an entry is a record of the scope's kind (the agenda: events, tasks, projects, birthdays). */
function ofKind(e: LedgerEntry, kind: Scope['of']): boolean {
  if (kind === 'conflicts') return e.ref.type === 'conflict';
  if (kind === 'forecast') return e.ref.type === 'forecast';
  if (kind === 'agenda')
    return (
      AGENDA_TYPES.has(e.ref.type) ||
      (e.ref.type === 'person' && (e.shape === 'birthday' || e.shape === 'people_person'))
    );
  return false;
}

/** The parts of the day a span touches, in the home zone. */
function partsOf(span: { from: number; to: number }, timeZone: string): Set<DayPart> {
  const out = new Set<DayPart>();
  const step = 15 * 60_000;
  const end = Math.max(span.from, span.to - 1);
  for (let t = span.from; t <= end; t += step) {
    out.add(partOf(Number(clockOf(new Date(t), timeZone).slice(0, 2))));
    if (out.size === 3) break;
  }
  out.add(partOf(Number(clockOf(new Date(end), timeZone).slice(0, 2))));
  return out;
}

/**
 * The parts of one home day a span touches: the span clipped to that day
 * (final review, minor: an event from Saturday 22:00 to Sunday 02:00 is in
 * Saturday's evening and Sunday's morning, and nothing else).
 */
function partsOn(span: { from: number; to: number }, day: IsoDate, timeZone: string): Set<DayPart> {
  const start = atHome(day, '00:00', timeZone).getTime();
  const end = atHome(addDays(day, 1), '00:00', timeZone).getTime();
  if (span.to <= span.from)
    return span.from >= start && span.from < end ? partsOf(span, timeZone) : new Set();
  const from = Math.max(span.from, start);
  const to = Math.min(span.to, end);
  return to > from ? partsOf({ from, to }, timeZone) : new Set();
}

const PART_WORDS: Readonly<Record<DayPart, string>> = {
  morning: 'in the morning',
  afternoon: 'in the afternoon',
  evening: 'in the evening',
};

/**
 * Evaluates an `absence` or `count` block against the ledger and renders
 * it, or fails `absence.unsupported`. `shown`: the full keys of the records
 * the plan's record blocks show.
 */
export function renderSummary(
  block: SummaryBlock,
  ledger: Ledger,
  now: Date,
  shown: ReadonlySet<string>,
): SummaryOutcome {
  const { scope } = block;
  const tz = ledger.timeZone;
  const today = isoDateInZone(now, tz);
  const count = block.kind === 'count';
  const isShown = (e: LedgerEntry) =>
    shown.has(fullKeyOf(e.ref)) || shown.has(`${e.ref.type}|${e.ref.id}|`);

  // Every other kind names its days.
  if (!scope.from || !scope.to || scope.to < scope.from) return fail;
  const days = daysFrom(scope.from, scope.to);
  if (days.size === 0) return fail;
  const dayList = [...days];
  if (
    (scope.of === 'conflicts' || scope.of === 'forecast') &&
    (scope.people.length > 0 || scope.part)
  )
    return fail;
  // Overlaps are found from today on: a day before today holds none, by
  // construction, so it is never stated (final review, Coverage 3).
  if (scope.of === 'conflicts' && dayList.some((d) => d < today)) return fail;
  const persons = [...new Set(scope.people)];
  if (persons.some((p) => !ledger.namesById.has(p))) return fail;

  if (scope.of === 'forecast') {
    if (count || scope.else) return fail;
    const spans = ledger.coverage.filter((c) => c.kind === 'forecast');
    for (const d of days) if (!spans.some((c) => c.days.has(d))) return fail;
    if (ledger.entries.some((e) => ofKind(e, 'forecast') && [...e.dates].some((d) => days.has(d))))
      return fail;
    const relevant = spans.filter((c) => dayList.some((d) => c.days.has(d)));
    if (relevant.length > 0 && relevant.every((c) => c.configured === false))
      return { ok: true, text: 'HOME doesn’t have a forecast set up.', dates: dayList };
    // A forecast HOME has but can no longer use (over 12 hours old) is never
    // "no forecast yet": M7's own sentence with its fetch time, and nothing
    // when that time is not known (owner decision, ADR 0012 §47).
    const unusable = relevant.filter((c) => c.configured !== false && c.freshness === 'unusable');
    if (unusable.length > 0) {
      const times = new Set(unusable.map((c) => c.fetchedAt ?? ''));
      const at = times.size === 1 ? Date.parse([...times][0]!) : NaN;
      const stale = Number.isFinite(at) ? staleSentence(new Date(at), now, tz) : null;
      return stale ? { ok: true, text: stale.text, dates: dayList } : fail;
    }
    return {
      ok: true,
      text: `HOME doesn’t have a forecast ${daysPhrase(days, today, 'for')} yet.`,
      dates: dayList,
    };
  }

  // Coverage: each day, by a complete read of the kind, for each person named.
  for (const d of days) {
    if (persons.length === 0) {
      if (!ledger.covers(scope.of, d, null)) return fail;
    } else if (persons.some((p) => !ledger.covers(scope.of, d, p))) return fail;
  }

  // What the ledger holds in scope.
  const inScope = ledger.entries.filter((e) => {
    if (!ofKind(e, scope.of)) return false;
    if (![...e.dates].some((d) => days.has(d))) return false;
    if (persons.length > 0) {
      const on = ledger.peopleOf(e);
      // Who is on it is unknown: possibly theirs (conservative).
      if (on !== null && !persons.some((p) => on.has(p))) return false;
    }
    if (scope.part && e.span) {
      const part = scope.part;
      const on = [...e.dates].filter((d) => days.has(d));
      if (!on.some((d) => partsOn(e.span!, d, tz).has(part))) return false;
    }
    return true;
  });

  const who = persons.map((p) =>
    p === ledger.readerId ? 'you' : nameText(ledger.namesById.get(p)!),
  );
  const part = scope.part ? `, ${PART_WORDS[scope.part]}` : '';
  const span = persons.length > 0 ? daysPhrase(days, today, 'on') : daysPhrase(days, today, 'for');
  const forWho = persons.length > 0 ? `for ${nameList(who)} ` : '';

  if (count) {
    if (scope.else) return fail;
    const counted = inScope.filter(
      (e) => e.ref.type === (scope.of === 'agenda' ? 'event' : 'conflict'),
    );
    // Who is on each must be known to count for a person.
    if (persons.length > 0 && counted.some((e) => ledger.peopleOf(e) === null)) return fail;
    const n = new Set(counted.map((e) => fullKeyOf(e.ref))).size;
    const nWord = numberWord(n);
    const text =
      scope.of === 'agenda'
        ? n === 0
          ? `No events are recorded ${forWho}${span}${part}.`
          : `${capitalise(nWord)} event${n === 1 ? ' is' : 's are'} recorded ${forWho}${span}${part}.`
        : n === 0
          ? `HOME hasn’t marked any overlaps ${span}.`
          : `HOME has marked ${nWord} overlap${n === 1 ? '' : 's'} ${span}.`;
    return { ok: true, text, dates: dayList };
  }

  if (scope.else) {
    if (inScope.length === 0 || !inScope.some(isShown)) return fail;
    if (inScope.some((e) => !isShown(e))) return fail;
  } else if (inScope.length > 0) return fail;

  const text =
    scope.of === 'agenda'
      ? `Nothing ${scope.else ? 'else ' : ''}is recorded ${forWho}${span}${part}.`
      : `HOME hasn’t marked any ${scope.else ? 'other ' : ''}overlaps ${span}.`;
  return { ok: true, text, dates: dayList };
}
