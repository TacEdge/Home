import { describe, expect, it } from 'vitest';
import { bundleSchema } from '@/kev/context/assemble';
import { classifyMessage, LEADS } from '@/kev/answer/catalogue';
import { limitsFor, type Coverage } from '@/kev/answer/fallback';
import { Ledger } from '@/kev/answer/ledger';
import { codesOf, validateAnswer, type ValidateResult } from '@/kev/answer/validate';
import { getAgenda } from '@/kev/tools/get-agenda';
import { getConflicts } from '@/kev/tools/get-conflicts';
import { getToday } from '@/kev/tools/get-today';
import { getWeather } from '@/kev/tools/get-weather';
import { search } from '@/kev/tools/search';
import type { Ref } from '@/kev/tools/types';
import {
  bundle,
  bundleRefs,
  busyLedger,
  conflict,
  fixtureLedger,
  foot,
  gap,
  id,
  lunch,
  more,
  NOW,
  P,
  paint,
  party,
  person,
  reads,
  sat,
  sun,
  swim,
  swimItem,
  T,
  u,
  ZONE,
} from './kev-ledger-fixture';

// The final structured-answer review of PR #86 (8f9ecd9), every
// counterexample in its findings file, as regression tests (owner
// decisions of 2026-10-15, ADR 0012 §46). Every fixture parses through the
// tools' own output schemas or `bundleSchema`: schema-valid evidence only.
// Synthetic only. NOW is Wednesday 14 October 2026, 07:03.

const wire = (r: Ref) => ({ type: r.type, id: r.id, at: r.at ?? null });
const rec = (r: Ref, show: string[] = []) => ({ kind: r.type, ref: wire(r), show, scope: null });
const scope = (s: Record<string, unknown>) => ({
  of: 'agenda',
  from: null,
  to: null,
  people: [],
  part: null,
  else: false,
  ...s,
});
const absence = (s: Record<string, unknown>) => ({
  kind: 'absence',
  ref: null,
  show: [],
  scope: scope(s),
});
const count = (s: Record<string, unknown>) => ({
  kind: 'count',
  ref: null,
  show: [],
  scope: scope(s),
});
type ViewIn = { type: string; phrase: string; about: number[] };
const plan = (lead: string, facts: unknown[] = [], view: ViewIn | null = null) => ({
  lead,
  facts,
  view,
  decline: null,
});
const check = (raw: unknown, l: Ledger, question?: string): ValidateResult =>
  validateAnswer({ raw, ledger: l, now: NOW, timeZone: ZONE, ...(question ? { question } : {}) });
const codes = (r: ValidateResult) => (r.ok ? [] : codesOf(r.violations));
const texts = (r: ValidateResult) => {
  if (!r.ok || !r.rendered) throw new Error(JSON.stringify(r));
  return [r.rendered.say, ...r.rendered.blocks.map((b) => b.text)];
};
const TODAY = '2026-10-14';
const SAT = '2026-10-17';
const SUN = '2026-10-18';
const on = (pid: string, name: string, role: 'attending' | 'responsible') => ({
  ref: person(pid),
  name: u(name),
  role,
});

// The findings' Today lines (Coverage 1).
const camp: Ref = { type: 'event', id: id(60), at: '2026-10-13T00:00:00+13:00' };
const campItem = {
  type: 'event',
  ref: camp,
  title: u('School camp'),
  all_day: true,
  day: 2,
  days: 3,
  kind: null,
  people: [on(P.milo, 'Milo', 'attending')],
};
const conf: Ref = { type: 'event', id: id(61), at: '2026-10-13T18:00:00+13:00' };
const confItem = {
  type: 'event',
  ref: conf,
  title: u('Conference'),
  all_day: false,
  start: '2026-10-13T18:00:00+13:00',
  end: '2026-10-15T10:00:00+13:00',
  day: 2,
  days: 3,
  kind: null,
  people: [on(P.alex, 'Alex', 'attending')],
};
const islaBirthday = { type: 'birthday', ref: person(P.isla), name: u('Isla'), age: 7 };
const peopleRefs = bundleRefs.filter((r) => r.type === 'person');

/** The bundle with these person lines under Today (parsed with `bundleSchema`). */
function bundleWith(people: unknown[], extra: Record<string, unknown> = {}): Ledger {
  const b = bundleSchema.parse({
    ...bundle,
    today: { ...bundle.today, people, count: 3, ...extra },
  });
  const l = new Ledger(ZONE);
  // The bundle's refs are its own records' (the walk adds every one it carries).
  l.addBundle(b, peopleRefs);
  return l;
}

/** The bundle with an empty Today, then get_today with these person lines (parsed with its output schema). */
function getTodayWith(people: unknown[]): Ledger {
  const l = new Ledger(ZONE);
  l.addBundle(
    bundleSchema.parse({ ...bundle, today: { ...bundle.today, people: [], count: 0 } }),
    peopleRefs,
  );
  const data = getToday.output.parse({
    ...bundle.today,
    people,
    count: people.length,
    insights: [],
  });
  l.addResult('get_today', data, [], {});
  return l;
}

describe('Coverage 1: a Today person line’s items keep their day (bundle and get_today)', () => {
  const milo = [{ ref: person(P.milo), name: u('Milo'), items: [campItem, swimItem] }];
  for (const [name, ledger] of [
    ['bundle', () => bundleWith(milo)],
    ['get_today', () => getTodayWith(milo)],
  ] as const) {
    it(`${name}: Milo’s camp (day 2 of 3) is today’s: no "nothing else", the counts are two`, () => {
      const l = ledger();
      expect(
        codes(check(plan('when', [rec(swim), absence({ from: TODAY, to: TODAY, else: true })]), l)),
      ).toEqual(['absence.unsupported']);
      expect(
        texts(
          check(plan('here_you_go', [count({ from: TODAY, to: TODAY, people: [P.milo] })]), l),
        )[1],
      ).toBe('Two events are recorded for Milo today.');
      expect(texts(check(plan('here_you_go', [count({ from: TODAY, to: TODAY })]), l))[1]).toBe(
        'Two events are recorded for today.',
      );
      // Showing both does support it.
      expect(
        check(
          plan('when', [rec(camp), rec(swim), absence({ from: TODAY, to: TODAY, else: true })]),
          l,
        ).ok,
      ).toBe(true);
    });
  }

  it('a multi-day all-day occurrence is on every day it covers, wherever it is listed', () => {
    const l = bundleWith(milo);
    const e = l.entries.find((x) => x.ref.id === camp.id && x.record)!;
    expect([...e.dates].sort()).toEqual(['2026-10-13', '2026-10-14', '2026-10-15']);
  });

  it('Isla’s birthday under her line: no absence for today or for Isla; her birthday renders from the bundle', () => {
    for (const ledger of [
      () => bundleWith([{ ref: person(P.isla), name: u('Isla'), items: [islaBirthday] }]),
      () => getTodayWith([{ ref: person(P.isla), name: u('Isla'), items: [islaBirthday] }]),
    ]) {
      const l = ledger();
      expect(codes(check(plan('here_you_go', [absence({ from: TODAY, to: TODAY })]), l))).toEqual([
        'absence.unsupported',
      ]);
      expect(
        codes(
          check(plan('here_you_go', [absence({ from: TODAY, to: TODAY, people: [P.isla] })]), l),
        ),
      ).toEqual(['absence.unsupported']);
      // The unnecessary fact.field refusal is gone.
      expect(texts(check(plan('here_you_go', [rec(person(P.isla), ['birthday'])]), l))[1]).toBe(
        'Isla turns 7 today.',
      );
    }
  });

  it('Alex’s conference (Tuesday 18:00 to Thursday 10:00) is on Wednesday too', () => {
    for (const ledger of [
      () => bundleWith([{ ref: person(P.alex), name: u('Alex'), items: [confItem] }]),
      () => getTodayWith([{ ref: person(P.alex), name: u('Alex'), items: [confItem] }]),
    ]) {
      const l = ledger();
      expect(
        codes(
          check(plan('here_you_go', [absence({ from: TODAY, to: TODAY, people: [P.alex] })]), l),
        ),
      ).toEqual(['absence.unsupported']);
      expect(texts(check(plan('here_you_go', [count({ from: TODAY, to: TODAY })]), l))[1]).toBe(
        'One event is recorded for today.',
      );
    }
  });

  it('R12: a truncated Today covers nothing', () => {
    const l = bundleWith([{ ref: person(P.milo), name: u('Milo'), items: [swimItem] }], {
      truncated: true,
    });
    expect(
      codes(check(plan('when', [rec(swim), absence({ from: TODAY, to: TODAY, else: true })]), l)),
    ).toEqual(['absence.unsupported']);
    expect(codes(check(plan('here_you_go', [count({ from: TODAY, to: TODAY })]), l))).toEqual([
      'absence.unsupported',
    ]);
  });

  it('a later truncated read’s record still contradicts the bundle’s complete coverage', () => {
    const l = fixtureLedger([]);
    const dent: Ref = { type: 'event', id: id(80), at: '2026-10-14T10:00:00+13:00' };
    l.addResult(
      'get_agenda',
      getAgenda.output.parse({
        from: TODAY,
        to: TODAY,
        days: [
          {
            date: TODAY,
            items: [
              {
                type: 'event',
                ref: dent,
                title: u('Dentist'),
                all_day: false,
                start: dent.at,
                end: '2026-10-14T10:30:00+13:00',
                kind: null,
                people: [on(P.isla, 'Isla', 'attending')],
              },
            ],
          },
        ],
        count: 5,
        truncated: true,
      }),
      [dent],
      { from: TODAY, to: TODAY },
    );
    expect(
      codes(check(plan('when', [rec(swim), absence({ from: TODAY, to: TODAY, else: true })]), l)),
    ).toEqual(['absence.unsupported']);
  });
});

/** A get_conflicts read over a range, with these conflicts (parsed with its output schema). */
function conflictsRead(from: string, to: string, conflicts: unknown[]): Ledger {
  const l = fixtureLedger([]);
  const data = getConflicts.output.parse({
    from,
    to,
    conflicts,
    count: conflicts.length,
    truncated: false,
  });
  l.addResult(
    'get_conflicts',
    data,
    (conflicts as { ref: Ref }[]).map((c) => c.ref),
    { from, to },
  );
  return l;
}
const pianoA: Ref = { type: 'event', id: id(70), at: '2026-10-20T15:30:00+13:00' };
const pianoB: Ref = { type: 'event', id: id(71), at: '2026-10-20T15:00:00+13:00' };
const conflictOf = (key: string, when: string) => ({
  ref: { type: 'conflict', id: key },
  key,
  rule: 'conflict.overlap',
  person: { ref: person(P.milo), name: u('Milo') },
  commitments: [
    {
      ref: pianoB,
      title: u('Piano'),
      start: `${when}T15:00:00+13:00`,
      end: `${when}T16:00:00+13:00`,
      role: 'attending',
    },
    {
      ref: pianoA,
      title: u('Swim squad'),
      start: `${when}T15:30:00+13:00`,
      end: `${when}T16:30:00+13:00`,
      role: 'attending',
    },
  ],
  overlap: { from: `${when}T15:30:00+13:00`, to: `${when}T16:00:00+13:00` },
  when,
  responded: false,
});

describe('Coverage 2 and 3: overlaps', () => {
  it('a standing conflict listed at its first instance (20 October) covers no later day: not 27 October, no count to the 31st', () => {
    const k = `conflict.overlap:${P.milo}:${id(70)}.${id(71)}:w1530-1600`;
    const l = conflictsRead('2026-10-19', '2026-10-31', [conflictOf(k, '2026-10-20')]);
    expect(
      codes(
        check(
          plan('here_you_go', [absence({ of: 'conflicts', from: '2026-10-27', to: '2026-10-27' })]),
          l,
        ),
      ),
    ).toEqual(['absence.unsupported']);
    expect(
      codes(
        check(
          plan('here_you_go', [count({ of: 'conflicts', from: '2026-10-19', to: '2026-10-31' })]),
          l,
        ),
      ),
    ).toEqual(['absence.unsupported']);
    // Up to its first instance, the read still speaks.
    expect(
      texts(
        check(
          plan('here_you_go', [count({ of: 'conflicts', from: '2026-10-19', to: '2026-10-20' })]),
          l,
        ),
      )[1],
    ).toBe('HOME has marked one overlap from Monday 19 October to Tuesday 20 October.');
  });

  it('a one-off conflict (its key names its own overlap) leaves the later days covered', () => {
    const k = `conflict.overlap:${P.milo}:${id(70)}.${id(71)}:20261020T0230Z-20261020T0300Z`;
    const l = conflictsRead('2026-10-19', '2026-10-31', [conflictOf(k, '2026-10-20')]);
    expect(
      texts(
        check(
          plan('here_you_go', [absence({ of: 'conflicts', from: '2026-10-27', to: '2026-10-27' })]),
          l,
        ),
      )[1],
    ).toBe('HOME hasn’t marked any overlaps for Tuesday 27 October.');
  });

  it('a day before today is never stated (12 October)', () => {
    const l = conflictsRead('2026-10-12', '2026-10-12', []);
    expect(
      codes(
        check(
          plan('here_you_go', [absence({ of: 'conflicts', from: '2026-10-12', to: '2026-10-12' })]),
          l,
        ),
      ),
    ).toEqual(['absence.unsupported']);
    expect(
      codes(
        check(
          plan('here_you_go', [absence({ of: 'conflicts', from: '2026-10-13', to: '2026-10-15' })]),
          l,
        ),
      ),
    ).toEqual(['absence.unsupported']);
  });
});

/** An agenda read (parsed with its output schema). */
function agendaRead(l: Ledger, from: string, to: string, days: unknown[], ids?: string[]): Ledger {
  const data = getAgenda.output.parse({ from, to, days, count: 1, truncated: false });
  l.addResult('get_agenda', data, [], { from, to, ...(ids ? { person_ids: ids } : {}) });
  return l;
}

describe('the reviewers’ surviving coverage mutations, each now caught', () => {
  it('R1, R2: an Isla-filtered Sunday read covers Isla only: the household and Milo refuse', () => {
    const l = agendaRead(fixtureLedger([]), SUN, SUN, [{ date: SUN, items: [] }], [P.isla]);
    expect(
      texts(check(plan('here_you_go', [absence({ from: SUN, to: SUN, people: [P.isla] })]), l))[1],
    ).toBe('Nothing is recorded for Isla on Sunday 18 October.');
    expect(codes(check(plan('here_you_go', [absence({ from: SUN, to: SUN })]), l))).toEqual([
      'absence.unsupported',
    ]);
    expect(
      codes(check(plan('here_you_go', [absence({ from: SUN, to: SUN, people: [P.milo] })]), l)),
    ).toEqual(['absence.unsupported']);
  });

  it('R4, R4b: an event 09:00–18:00 is in the morning, the afternoon and the evening', () => {
    const long: Ref = { type: 'event', id: id(81), at: `${SAT}T09:00:00+13:00` };
    const l = agendaRead(fixtureLedger([]), SAT, SAT, [
      {
        date: SAT,
        items: [
          {
            type: 'event',
            ref: long,
            title: u('Working bee'),
            all_day: false,
            start: long.at,
            end: `${SAT}T18:00:00+13:00`,
            kind: null,
            people: [],
          },
        ],
      },
    ]);
    for (const part of ['morning', 'afternoon', 'evening'])
      expect(
        codes(check(plan('here_you_go', [absence({ from: SAT, to: SAT, part })]), l)),
        part,
      ).toEqual(['absence.unsupported']);
  });

  it('overnight (Saturday 22:00 to Sunday 02:00): Saturday evening and Sunday morning only', () => {
    const night: Ref = { type: 'event', id: id(90), at: `${SAT}T22:00:00+13:00` };
    const item = {
      type: 'event',
      ref: night,
      title: u('Night shift'),
      all_day: false,
      start: night.at,
      end: `${SUN}T02:00:00+13:00`,
      kind: null,
      people: [on(P.alex, 'Alex', 'attending')],
    };
    const l = agendaRead(fixtureLedger([]), SAT, SUN, [
      { date: SAT, items: [{ ...item, day: 1, days: 2 }] },
      { date: SUN, items: [{ ...item, day: 2, days: 2 }] },
    ]);
    const abs = (d: string, part: string) =>
      check(plan('here_you_go', [absence({ from: d, to: d, part })]), l);
    expect(texts(abs(SUN, 'evening'))[1]).toBe(
      'Nothing is recorded for Sunday 18 October, in the evening.',
    );
    expect(texts(abs(SAT, 'morning'))[1]).toBe(
      'Nothing is recorded for Saturday 17 October, in the morning.',
    );
    expect(codes(abs(SAT, 'evening'))).toEqual(['absence.unsupported']);
    expect(codes(abs(SUN, 'morning'))).toEqual(['absence.unsupported']);
    expect(texts(check(plan('here_you_go', [count({ from: SAT, to: SUN })]), l))[1]).toBe(
      'One event is recorded for this weekend.',
    );
  });

  it('R6: `{when}` beside nothing dated (a search absence) is refused', () => {
    const l = busyLedger([more.searchDentist]);
    expect(codes(check(plan('when', [absence({ of: 'search' })]), l))).toEqual([
      'lead.unsupported',
    ]);
    expect(codes(check(plan('righto_when', [absence({ of: 'search' })]), l, 'Dentist?'))).toEqual([
      'lead.unsupported',
    ]);
  });

  it('R9: `else` over a covered day with nothing shown in scope is refused', () => {
    const l = agendaRead(fixtureLedger([]), SUN, SUN, [{ date: SUN, items: [] }]);
    expect(
      codes(check(plan('here_you_go', [absence({ from: SUN, to: SUN, else: true })]), l)),
    ).toEqual(['absence.unsupported']);
  });

  it('R11: a forecast absence for a day the forecast has is refused', () => {
    const l = fixtureLedger([reads.weekendWeather]);
    expect(
      codes(check(plan('here_you_go', [absence({ of: 'forecast', from: SAT, to: SAT })]), l)),
    ).toEqual(['absence.unsupported']);
  });

  it('R13, R18: records whose people HOME does not know are possibly anyone’s: no count or absence for Milo', () => {
    // A task due Saturday, with no assignee, in an unfiltered read.
    const task = agendaRead(fixtureLedger([]), SAT, SAT, [
      {
        date: SAT,
        items: [
          { type: 'task_due', ref: { type: 'task', id: T.paint }, title: u('Paint'), due: SAT },
        ],
      },
    ]);
    expect(
      codes(check(plan('here_you_go', [absence({ from: SAT, to: SAT, people: [P.milo] })]), task)),
    ).toEqual(['absence.unsupported']);
    // Two events known only as an overlap's commitments (who is on each: unknown), beside a
    // Milo-filtered read of Saturday that lists nothing.
    const k = `conflict.overlap:${P.sam}:${id(70)}.${id(71)}:20261016T2000Z-20261016T2030Z`;
    const l = conflictsRead(SAT, SAT, [conflictOf(k, SAT)]);
    agendaRead(l, SAT, SAT, [{ date: SAT, items: [] }], [P.milo]);
    expect(
      codes(check(plan('here_you_go', [count({ from: SAT, to: SAT, people: [P.milo] })]), l)),
    ).toEqual(['absence.unsupported']);
    expect(
      codes(check(plan('here_you_go', [absence({ from: SAT, to: SAT, people: [P.milo] })]), l)),
    ).toEqual(['absence.unsupported']);
  });

  it('R7, R17 and the minors: what is qualified when a calendar is stale, or there is none', () => {
    const stale: Coverage = { calendarsUnhealthy: true, noCalendars: false, gapsUnknown: false };
    const none: Coverage = { calendarsUnhealthy: false, noCalendars: true, gapsUnknown: false };
    const shown = (types: string[], summaries: string[] = []) =>
      ({
        types: new Set(types),
        summaries: new Set(summaries),
        gapsPartial: false,
      }) as Parameters<typeof limitsFor>[0];
    expect(limitsFor(shown([], ['conflicts']), stale)).toEqual(['calendar_stale']);
    expect(limitsFor(shown(['event']), stale)).toEqual(['calendar_stale']);
    expect(limitsFor(shown([], ['search']), stale)).toEqual(['calendar_stale']);
    expect(limitsFor(shown([], ['conflicts']), none)).toEqual(['coverage_unknown']);
    expect(limitsFor(shown(['conflict']), none)).toEqual(['coverage_unknown']);
    expect(limitsFor(shown([], ['search']), none)).toEqual(['coverage_unknown']);
    expect(limitsFor(shown([], ['forecast']), stale)).toEqual([]);
  });
});

describe('Rendering 4 and 5: search and the forecast', () => {
  /** A complete search that found nothing, for a query the model wrote (parsed with its output schema). */
  const emptySearch = (query: string) => {
    const l = fixtureLedger([]);
    l.addResult('search', search.output.parse({ results: [], returned: 0, truncated: false }), [], {
      query,
    });
    return l;
  };

  it.each([
    'Milo is sick so no swimming',
    'x”. Football is cancelled. “y',
    'football, which is cancelled',
  ])('a search absence never echoes the query: %s', (query) => {
    const r = check(plan('here_you_go', [absence({ of: 'search' })]), emptySearch(query));
    expect(texts(r)).toEqual(['Here you go.', 'Nothing you can see in HOME has a matching title.']);
    expect(JSON.stringify(r)).not.toContain('cancelled');
    expect(JSON.stringify(r)).not.toContain('sick');
  });

  it('a truncated search covers nothing', () => {
    const l = fixtureLedger([]);
    l.addResult('search', search.output.parse({ results: [], returned: 0, truncated: true }), [], {
      query: 'dentist',
    });
    expect(codes(check(plan('here_you_go', [absence({ of: 'search' })]), l))).toEqual([
      'absence.unsupported',
    ]);
  });

  const weatherAt = (fetched: string, freshness: 'fresh' | 'older') => {
    const l = fixtureLedger([]);
    const data = getWeather.output.parse({
      ...reads.weekendWeather.data,
      fetched_at: fetched,
      freshness,
    });
    l.addResult('get_weather', data, [sat, sun], reads.weekendWeather.input);
    return l;
  };

  it('an older forecast (nine hours) says "As of …" with its own time, and the answer keeps that time', () => {
    const r = check(plan('when', [rec(sat)]), weatherAt('2026-10-13T22:03:00+13:00', 'older'));
    expect(texts(r)[1]).toBe(
      'As of yesterday 22:03, Saturday 17 October: Looks dry. Between 9°C and 17°C. Gusts up to 30 km/h.',
    );
    expect(r.ok && r.rendered!.shown.forecastAt).toBe('2026-10-13T22:03:00+13:00');
  });

  it('a fresh forecast reads as before; its time is still kept for the credit', () => {
    const r = check(plan('when', [rec(sat)]), weatherAt('2026-10-14T06:55:00+13:00', 'fresh'));
    expect(texts(r)[1]).toBe(
      'Saturday 17 October: Looks dry. Between 9°C and 17°C. Gusts up to 30 km/h.',
    );
    expect(r.ok && r.rendered!.shown.forecastAt).toBe('2026-10-14T06:55:00+13:00');
  });
});

describe('leads: HOME’s catalogue, by question class (owner decision 6)', () => {
  const l = () => busyLedger([more.insights]);
  it.each([
    ['Is football cancelled?', true, false],
    ['Did Alex book the plumber?', true, false],
    ['Any clashes Thursday?', true, true],
    ['Am I free Saturday afternoon?', true, true],
    ['Football Saturday?', true, false],
    ['We’re doing the fence on Saturday, right?', true, false],
    ['When’s football?', false, false],
    ['What’s on this weekend?', false, false],
    ['Who’s on that?', false, false],
  ] as const)('%s → yes-or-no %s, availability %s', (q, yesNo, availability) => {
    const m = classifyMessage(q);
    expect(m.yesNo).toBe(yesNo);
    expect(m.availability).toBe(availability);
    expect(m.question).toBe(true);
  });

  it('"No worries." beside a record for "When’s football?"; refused for "Any clashes Thursday?" and with no facts', () => {
    expect(texts(check(plan('no_worries', [rec(foot)]), l(), 'When’s football?'))[0]).toBe(
      'No worries.',
    );
    expect(codes(check(plan('no_worries', [rec(conflict)]), l(), 'Any clashes Thursday?'))).toEqual(
      ['lead.unsupported'],
    );
    expect(codes(check(plan('no_worries', []), l(), 'When’s football?'))).toEqual([
      'lead.unsupported',
    ]);
    // Beside only an absence: not a record.
    expect(
      codes(check(plan('no_worries', [absence({ from: SAT, to: SAT })]), l(), 'When’s football?')),
    ).toContain('lead.unsupported');
  });

  it('bare yes-or-no answers, with and without facts: no lead is a yes; affirming ones are withheld', () => {
    for (const q of ['Is football cancelled?', 'Did Alex book the plumber?', 'Is the fence done?'])
      for (const lead of ['righto_when', 'ka_pai', 'no_worries']) {
        expect(codes(check(plan(lead, [rec(paint, ['status'])]), l(), q)), `${q} ${lead}`).toEqual([
          'lead.unsupported',
        ]);
        expect(codes(check(plan(lead, []), l(), q)), `${q} ${lead}`).toEqual(['lead.unsupported']);
      }
    // A message HOME cannot read gets no affirming lead either.
    expect(codes(check(plan('righto_when', [rec(foot)]), l()))).toEqual(['lead.unsupported']);
    // The neutral leads stay: the record speaks.
    expect(
      texts(check(plan('here_you_go', [rec(paint, ['status'])]), l(), 'Is the fence done?')),
    ).toEqual(['Here you go.', '“Paint the back fence”: to do.']);
  });

  it('"Ka pai, here it is." beside exactly one record; "flagged" only beside an overlap or insight', () => {
    expect(
      codes(check(plan('ka_pai', [rec(foot), rec(party)]), l(), 'What’s on Saturday?')),
    ).toEqual(['lead.unsupported']);
    expect(codes(check(plan('flagged', [rec(foot)]), l(), 'What’s on Saturday?'))).toEqual([
      'lead.unsupported',
    ]);
    expect(
      texts(
        check(plan('flagged', [rec({ type: 'insight', id: 'birthday.upcoming:nana' })]), l()),
      )[0],
    ).toBe(LEADS.flagged.text);
  });
});

describe('no-fact responses (owner decision 7)', () => {
  const l = () => fixtureLedger([]);
  it.each([
    ['Thanks', 'welcome', 'You’re welcome.'],
    ['Kia ora Kev', 'kia_ora', 'Kia ora.'],
    ['Mōrena', 'morena', 'Mōrena.'],
    ['Ka kite', 'ka_kite', 'Ka kite.'],
    ['Cheers, that’s great', 'cheers', 'Cheers.'],
  ])('social: %s → %s', (q, lead, said) => {
    const r = check(plan(lead, []), l(), q);
    expect(texts(r)).toEqual([said]);
  });

  it('a social lead never answers a question, and never stands beside facts or a view', () => {
    for (const q of ['Is football cancelled?', 'What’s on?', 'Show me Saturday'])
      expect(codes(check(plan('welcome', []), l(), q)), q).toEqual(['lead.unsupported']);
    expect(codes(check(plan('welcome', [rec(swim)]), l(), 'Thanks'))).toEqual(['lead.unsupported']);
    expect(
      codes(
        check(
          plan('welcome', [], { type: 'uncertainty', phrase: 'recorded_only', about: [] }),
          l(),
          'Thanks',
        ),
      ),
    ).toEqual(['lead.unsupported', 'view.unsupported']);
  });

  it('HOME’s fixed "not sure" for anything, with nothing else', () => {
    expect(texts(check(plan('unsure', []), l(), 'Is football cancelled?'))).toEqual([
      'I’m not sure what you’re after. Try asking another way.',
    ]);
    expect(codes(check(plan('unsure', [rec(swim)]), l(), 'What’s on?'))).toEqual([
      'lead.unsupported',
    ]);
  });

  it('a non-social lead with no facts is refused, and has no salvage ("Here’s what HOME has." over nothing)', () => {
    for (const lead of ['home_has', 'here_you_go', 'good_question', 'when', 'found']) {
      const r = check(plan(lead, []), l(), 'Thanks');
      expect(codes(r), lead).toEqual(['lead.unsupported']);
      expect(r.ok ? 'ok' : r.salvage, lead).toBeNull();
    }
  });

  it('a salvage keeps the facts and replaces only the lead or view, when facts exist', () => {
    const r = check(
      plan('no_worries', [rec(foot)]),
      fixtureLedger([reads.weekendAgenda]),
      'Is football on?',
    );
    expect(r.ok ? null : r.salvage?.say).toBe('Here’s what HOME has.');
    expect(r.ok ? null : r.salvage?.blocks.map((b) => b.text)).toEqual([
      '“Football”: Saturday 17 October, 09:00–10:00. Milo attending.',
    ]);
  });
});

describe('typed interpretations: support checked by code (owner decision 8)', () => {
  const v = (type: string, phrase: string, about: number[]): ViewIn => ({ type, phrase, about });
  const weekend = () =>
    busyLedger([reads.weekendWeather, reads.saturdayGaps, reads.tasks, more.calendars]);

  it('a raincoat beside a dry forecast is refused; beside showers it shows', () => {
    expect(
      codes(check(plan('when', [rec(sat)], v('suggestion', 'raincoat', [0])), weekend())),
    ).toEqual(['view.unsupported']);
    expect(
      texts(check(plan('when', [rec(sun)], v('suggestion', 'raincoat', [0])), weekend())).at(-1),
    ).toBe('Could be worth a raincoat.');
    // Only what the block shows counts: Sunday's temperature alone does not show its showers.
    expect(
      codes(
        check(
          plan('when', [rec(sun, ['temperature'])], v('suggestion', 'raincoat', [0])),
          weekend(),
        ),
      ),
    ).toEqual(['view.unsupported']);
  });

  it('leaving early beside events that do not overlap or follow closely is refused', () => {
    expect(
      codes(
        check(
          plan('when', [rec(foot), rec(party)], v('consideration', 'leave_early', [0, 1])),
          weekend(),
        ),
      ),
    ).toEqual(['view.unsupported']);
    expect(
      codes(
        check(
          plan('when', [rec(foot), rec(lunch)], v('consideration', 'leave_early', [0, 1])),
          weekend(),
        ),
      ),
    ).toEqual(['view.unsupported']);
    expect(
      check(plan('flagged', [rec(conflict)], v('consideration', 'leave_early', [0])), busyLedger())
        .ok,
    ).toBe(true);
  });

  it('a follow-up without its support is refused', () => {
    // Who goes where: needs an overlap or two events on one day.
    expect(
      codes(check(plan('when', [rec(foot)], v('follow_up', 'who_goes_where', [0])), weekend())),
    ).toEqual(['view.unsupported']);
    // Checking that calendar: the calendar shown is up to date.
    expect(
      codes(
        check(
          plan(
            'here_you_go',
            [rec({ type: 'calendar', id: id(30) })],
            v('follow_up', 'check_calendar', [0]),
          ),
          weekend(),
        ),
      ),
    ).toEqual(['view.unsupported']);
    // Ask about any of these: needs a record.
    expect(
      codes(
        check(
          plan('here_you_go', [absence({ from: SAT, to: SAT })], v('follow_up', 'ask_more', [0])),
          weekend(),
        ),
      ),
    ).toContain('view.unsupported');
  });

  it('a stretch at least as long as the estimate: checked against the figures', () => {
    expect(
      texts(
        check(
          plan(
            'when',
            [rec(gap), rec(paint, ['estimate'])],
            v('suggestion', 'stretch_estimate', [0, 1]),
          ),
          weekend(),
        ),
      ).at(-1),
    ).toBe('That stretch is at least as long as the task’s estimate.');
    // The estimate not shown: the view would rest on something the adult cannot see.
    expect(
      codes(
        check(
          plan(
            'when',
            [rec(gap), rec(paint, ['status'])],
            v('suggestion', 'stretch_estimate', [0, 1]),
          ),
          weekend(),
        ),
      ),
    ).toEqual(['view.unsupported']);
  });

  it('a phrase of another type, or a phrase that is not HOME’s, is not a plan', () => {
    expect(
      codes(check(plan('when', [rec(sun)], v('consideration', 'raincoat', [0])), weekend())),
    ).toEqual(['answer.schema']);
    expect(
      codes(check(plan('when', [rec(sun)], v('suggestion', 'Brolly weather.', [0])), weekend())),
    ).toEqual(['answer.schema']);
  });

  it('HOME’s own caveat needs no support, but never stands alone', () => {
    expect(
      texts(
        check(plan('here_you_go', [rec(foot)], v('uncertainty', 'recorded_only', [])), weekend()),
      ).at(-1),
    ).toBe('HOME only knows what’s been recorded.');
  });
});
