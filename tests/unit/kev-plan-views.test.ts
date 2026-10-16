import { describe, expect, it } from 'vitest';
import { VIEW_PHRASE_IDS, VIEW_PHRASES, type ViewPhraseId } from '@/kev/answer/catalogue';
import type { Ledger } from '@/kev/answer/ledger';
import { codesOf, validateAnswer, type ValidateResult } from '@/kev/answer/validate';
import { getCalendarHealth } from '@/kev/tools/get-calendar-health';
import { getContext } from '@/kev/tools/get-context';
import { getGaps } from '@/kev/tools/get-gaps';
import { getInsights } from '@/kev/tools/get-insights';
import { getPeople } from '@/kev/tools/get-people';
import { getTasks } from '@/kev/tools/get-tasks';
import { getWeather } from '@/kev/tools/get-weather';
import type { Ref } from '@/kev/tools/types';
import {
  agenda,
  board,
  busyLedger,
  calendar,
  conflict,
  dinosaurs,
  foot,
  gap,
  id,
  insight,
  lunch,
  more,
  note,
  NOW,
  on,
  P,
  paint,
  party,
  person,
  sat,
  sun,
  swim,
  T,
  timedItem,
  u,
  ZONE,
  type Read,
} from './kev-ledger-fixture';

// Kev's view: every one of the fifteen phrases, each with a supporting
// case, a case whose blocks do not support it, a case where an unrelated
// block is cited beside a supporting one, and a case where one record is
// cited twice (owner decision of 2026-10-15, Part 7; ADR 0012 §47). Every
// block a view is about must itself support it; each record counts once.
// Fixtures parse through the tools' own output schemas. Synthetic only.
// NOW is Wednesday 14 October 2026, 07:03; the reader is Sam.

const wire = (r: Ref) => ({ type: r.type, id: r.id, at: r.at ?? null });
const rec = (r: Ref, show: string[] = []) => ({ kind: r.type, ref: wire(r), show, scope: null });
/** "HOME hasn't marked any overlaps for next week." (a complete overlaps read, nothing found). */
const absence = () => ({
  kind: 'absence',
  ref: null,
  show: [],
  scope: {
    of: 'conflicts',
    from: '2026-10-19',
    to: '2026-10-25',
    people: [],
    part: null,
    else: false,
  },
});
const SAT = '2026-10-17';
const SUN = '2026-10-18';
const FRI = '2026-10-16';

// Friday: three timed events, 20 minutes then 45 minutes apart.
const fri1: Ref = { type: 'event', id: id(70), at: `${FRI}T09:00:00+13:00` };
const fri2: Ref = { type: 'event', id: id(71), at: `${FRI}T10:20:00+13:00` };
const fri3: Ref = { type: 'event', id: id(72), at: `${FRI}T11:45:00+13:00` };
const friday = agenda(FRI, FRI, [
  {
    date: FRI,
    items: [
      timedItem(fri1, 'Assembly', `${FRI}T10:00:00+13:00`, [on(P.milo, 'Milo', 'attending')]),
      timedItem(fri2, 'Library', `${FRI}T11:00:00+13:00`, [on(P.isla, 'Isla', 'attending')]),
      timedItem(fri3, 'Haircut', `${FRI}T12:30:00+13:00`, [on(P.sam, 'Sam', 'attending')]),
    ],
  },
]);
/** A warm, dry Friday (low 14°C), fetched with the weekend's forecast. */
const warm: Ref = { type: 'forecast', id: `forecast:${FRI}` };
const warmFriday: Read = {
  tool: 'get_weather',
  input: { from: FRI, to: FRI },
  data: getWeather.output.parse({
    configured: true,
    freshness: 'fresh',
    fetched_at: '2026-10-14T06:55:00+13:00',
    days: [
      {
        ref: warm,
        date: FRI,
        phrase: 'Looks dry',
        low_c: 14,
        high_c: 22,
        max_gust_kmh: 20,
        parts: [{ part: 'morning', band: 'dry' }],
      },
    ],
    uncovered: [],
    credit: 'Open-Meteo',
    count: 1,
    truncated: false,
  }),
  refs: [warm],
};
/** Sunday afternoon's stretch, showers (get_gaps). */
const sunGap: Ref = { type: 'gap', id: 'gap:household:2026-10-18:1400' };
const sundayGaps: Read = {
  tool: 'get_gaps',
  input: { from: SUN, to: SUN, scope: 'household' },
  data: getGaps.output.parse({
    from: SUN,
    to: SUN,
    scope: 'household',
    min_minutes: 60,
    needs: [],
    coverage: {
      status: 'recorded',
      calendars: [
        {
          ref: calendar,
          label: u('Family'),
          last_success: '2026-10-14T06:00:00+13:00',
          status: 'healthy',
        },
      ],
    },
    gaps: [
      {
        ref: sunGap,
        key: sunGap.id,
        date: SUN,
        from: `${SUN}T14:00:00+13:00`,
        to: `${SUN}T19:30:00+13:00`,
        before: { ref: lunch, title: u('Lunch at Nana Jo’s') },
        after: null,
        daylight: { from: `${SUN}T06:30:00+13:00`, to: `${SUN}T19:30:00+13:00` },
        forecast_band: 'showers',
      },
    ],
    limit: true,
    count: 1,
    truncated: false,
  }),
  refs: [calendar, sunGap, lunch],
};
/** A calendar that has not updated for over a day, and context marked as possibly out of date. */
const staleCal: Ref = { type: 'calendar', id: id(31) };
const staleCalendar: Read = {
  tool: 'get_calendar_health',
  input: {},
  data: getCalendarHealth.output.parse({
    calendars: [
      {
        ref: staleCal,
        label: u('School calendar'),
        last_success: '2026-10-12T06:58:00+13:00',
        status: 'stale',
      },
    ],
    count: 1,
    truncated: false,
  }),
  refs: [staleCal],
};
const staleCtx: Ref = { type: 'context', id: id(43) };
const staleContext: Read = {
  tool: 'get_context',
  input: { subject_type: 'person', subject_id: P.isla },
  data: getContext.output.parse({
    context: [
      {
        ref: staleCtx,
        subject: { type: 'person', ref: person(P.isla) },
        category: 'interest',
        content: u('Likes horses.'),
        last_confirmed: '2026-01-06',
        stale: true,
      },
    ],
    count: 1,
    truncated: false,
  }),
  refs: [staleCtx, person(P.isla)],
};
/** Alex's task, done; the plumber (open, Alex's) comes from `more.alexTasks`. */
const plumber: Ref = { type: 'task', id: T.plumber };
const gutters: Ref = { type: 'task', id: id(25) };
const doneTask: Read = {
  tool: 'get_tasks',
  input: { assignee: P.alex, status: 'done' },
  data: getTasks.output.parse({
    tasks: [
      {
        ref: gutters,
        title: u('Clear the gutters'),
        status: 'done',
        estimate_minutes: 60,
        needs: [],
        due: '2026-10-10',
        scheduled: null,
        assignee: { ref: person(P.alex), name: u('Alex') },
        project: null,
      },
    ],
    count: 1,
    truncated: false,
  }),
  refs: [gutters, person(P.alex)],
};
/** A Forward Week insight that is not a birthday (M5's busy day). */
const busyDay: Ref = { type: 'insight', id: 'busy_day.count:2026-10-17' };
const busyInsight: Read = {
  tool: 'get_insights',
  input: { surface: 'forward_week' },
  data: getInsights.output.parse({
    surface: 'forward_week',
    insights: [
      {
        ref: busyDay,
        key: busyDay.id,
        kind: 'busy_day',
        rule: 'busy_day.count',
        when: SAT,
        text: u('Saturday has three things on.'),
        shown_on: 'list',
        refs: [foot, party],
      },
    ],
    count: 1,
    truncated: false,
  }),
  refs: [busyDay, foot, party],
};
/** Sam's own birthday (the reader), from get_people. */
const samPeople: Read = {
  tool: 'get_people',
  input: { person_id: P.sam },
  data: getPeople.output.parse({
    people: [
      {
        ref: person(P.sam),
        name: u('Sam'),
        role: 'parent',
        in_household: true,
        age: 41,
        next_birthday: { date: '2026-10-22', age: 42 },
        regular_week: [],
        stage_note: null,
      },
    ],
    count: 1,
    truncated: false,
  }),
  refs: [person(P.sam)],
};

const ledger = (): Ledger =>
  busyLedger([
    more.insights,
    more.calendars,
    more.context,
    more.alexTasks,
    more.project,
    more.milo,
    friday,
    warmFriday,
    sundayGaps,
    staleCalendar,
    staleContext,
    doneTask,
    busyInsight,
    samPeople,
  ]);

type Block = ReturnType<typeof rec> | ReturnType<typeof absence>;
type Case = [label: string, facts: Block[], about: number[]];
type PhraseCases = {
  valid: Case[];
  invalid: Case[];
  unrelated: Case[];
  /** Absent where a phrase rests on nothing, so has no evidence to repeat. */
  duplicate: Case[];
};

const view = (phrase: ViewPhraseId, about: number[]) => ({
  type: VIEW_PHRASES[phrase].type,
  phrase,
  about,
});
const check = (phrase: ViewPhraseId, facts: Block[], about: number[]): ValidateResult =>
  validateAnswer({
    raw: { lead: 'here_you_go', facts, view: view(phrase, about), decline: null },
    ledger: ledger(),
    now: NOW,
    timeZone: ZONE,
  });

const gapDry = rec(gap, ['neighbours', 'forecast']);
const all = (n: number) => Array.from({ length: n }, (_, i) => i);
const c = (label: string, facts: Block[], about: number[] = all(facts.length)): Case => [
  label,
  facts,
  about,
];

const CASES: Record<ViewPhraseId, PhraseCases> = {
  leave_early: {
    valid: [
      c('an overlap HOME flagged', [rec(conflict)]),
      c('two events 20 minutes apart', [rec(fri1), rec(fri2)]),
    ],
    invalid: [
      c('two events 45 minutes apart (M10)', [rec(fri2), rec(fri3)]),
      c('one event', [rec(swim)]),
      c('events a day apart', [rec(foot), rec(lunch)]),
    ],
    unrelated: [
      c('an overlap beside Saturday’s football', [rec(conflict), rec(foot)]),
      c('a tight pair beside Sunday’s lunch', [rec(fri1), rec(fri2), rec(lunch)]),
    ],
    duplicate: [c('one event twice (P3a)', [rec(fri1), rec(fri1, ['people'])])],
  },
  check_with_others: {
    valid: [c('an event with others on it', [rec(party)]), c('an overlap', [rec(conflict)])],
    invalid: [c('an event with only the reader on it (M3)', [rec(board)])],
    unrelated: [
      c('beside a task', [rec(party), rec(paint)]),
      c('beside the reader’s own event', [rec(party), rec(board)]),
    ],
    duplicate: [c('one event twice', [rec(party), rec(party, ['people'])])],
  },
  double_check: {
    valid: [c('two records', [rec(foot), rec(party)])],
    invalid: [c('one note', [rec(note)]), c('one event', [rec(foot)])],
    unrelated: [c('a record beside an absence', [rec(foot), absence()])],
    duplicate: [
      c('one note twice (P3c)', [rec(note), rec(note)]),
      c('one event twice', [rec(foot), rec(foot, ['people'])]),
    ],
  },
  plan_b: {
    valid: [
      c('Sunday’s showers', [rec(sun)]),
      c('Sunday’s lunch beside Sunday’s showers', [rec(lunch), rec(sun)]),
    ],
    invalid: [c('Saturday, dry', [rec(sat)])],
    unrelated: [
      c('Saturday’s football beside Sunday’s showers (P13c)', [rec(foot), rec(sun)]),
      c('Saturday (dry) beside Sunday (showers)', [rec(sat), rec(sun)]),
    ],
    duplicate: [c('Saturday twice', [rec(sat), rec(sat, ['phrase'])])],
  },
  present: {
    valid: [
      c('Nana Jo’s birthday', [rec(person(P.nana), ['birthday'])]),
      c('HOME’s birthday insight', [rec(insight)]),
    ],
    invalid: [
      c('an age, not a birthday (M4)', [rec(person(P.milo), ['age'])]),
      c('an insight that is not a birthday (M16)', [rec(busyDay)]),
      c('the reader’s own birthday', [rec(person(P.sam), ['birthday'])]),
    ],
    unrelated: [c('the insight beside football', [rec(insight), rec(foot)])],
    duplicate: [
      c('Nana Jo twice', [
        rec(person(P.nana), ['birthday']),
        rec(person(P.nana), ['birthday', 'age']),
      ]),
    ],
  },
  raincoat: {
    valid: [
      c('Sunday’s showers', [rec(sun)]),
      c('Sunday’s showers, by its parts', [rec(sun, ['parts'])]),
      c('a stretch with showers', [rec(sunGap, ['forecast'])]),
      c('Sunday’s lunch beside Sunday’s showers', [rec(lunch), rec(sun)]),
    ],
    invalid: [
      c('Saturday, dry', [rec(sat)]),
      c('Sunday’s temperature only', [rec(sun, ['temperature'])]),
      c('a stretch, its band not shown', [rec(sunGap)]),
    ],
    unrelated: [
      c('Saturday’s football beside Sunday’s showers (P1b)', [rec(foot), rec(sun)]),
      c('Saturday (dry) beside Sunday (showers) (P1c)', [rec(sat), rec(sun)]),
    ],
    duplicate: [c('Sunday twice', [rec(sun), rec(sun, ['phrase'])])],
  },
  jacket: {
    valid: [
      c('Saturday’s low of 9°C, shown', [rec(sat)]),
      c('Sunday’s showers', [rec(sun, ['phrase'])]),
    ],
    invalid: [
      c('Saturday’s phrase only, no temperature (M2)', [rec(sat, ['phrase'])]),
      c('a warm, dry Friday (low 14°C) (M2b)', [rec(warm)]),
    ],
    unrelated: [c('Saturday (cool) beside Sunday’s lunch', [rec(sat), rec(lunch)])],
    duplicate: [c('Saturday twice', [rec(sat), rec(sat, ['temperature'])])],
  },
  nudge: {
    valid: [c('an open task with its assignee', [rec(plumber, ['status', 'assignee'])])],
    invalid: [
      c('its assignee not shown', [rec(plumber, ['status'])]),
      c('a done task (M13)', [rec(gutters, ['status', 'assignee'])]),
    ],
    unrelated: [c('beside football', [rec(plumber, ['status', 'assignee']), rec(foot)])],
    duplicate: [
      c('one task twice', [
        rec(plumber, ['status', 'assignee']),
        rec(plumber, ['status', 'assignee', 'due']),
      ]),
    ],
  },
  stretch_estimate: {
    valid: [c('Saturday’s dry stretch and the fence', [gapDry, rec(paint, ['estimate'])])],
    invalid: [
      c('the stretch’s band not shown, for a task needing dry weather (P7a)', [
        rec(gap),
        rec(paint, ['estimate']),
      ]),
      c('a showery stretch, for a task needing dry weather', [
        rec(sunGap, ['forecast']),
        rec(paint, ['estimate']),
      ]),
      c('the estimate not shown', [gapDry, rec(paint, ['status'])]),
    ],
    unrelated: [
      c('two stretches and the task (M12)', [
        gapDry,
        rec(sunGap, ['forecast']),
        rec(paint, ['estimate']),
      ]),
      c('the pair beside football', [gapDry, rec(paint, ['estimate']), rec(foot)]),
    ],
    duplicate: [c('one stretch twice', [gapDry, rec(gap, ['forecast']), rec(paint, ['estimate'])])],
  },
  who_goes_where: {
    valid: [c('two events on Saturday', [rec(foot), rec(party)]), c('an overlap', [rec(conflict)])],
    invalid: [c('events on different days', [rec(foot), rec(lunch)])],
    unrelated: [
      c('Saturday’s pair beside Sunday’s lunch', [rec(foot), rec(party), rec(lunch)]),
      c('Saturday’s pair beside a task', [rec(foot), rec(party), rec(paint)]),
    ],
    duplicate: [c('one event twice (P3b)', [rec(foot), rec(foot, ['people'])])],
  },
  check_calendar: {
    valid: [c('a stale calendar', [rec(staleCal)])],
    invalid: [c('an up-to-date calendar', [rec(calendar)])],
    unrelated: [
      c('beside football', [rec(staleCal), rec(foot)]),
      c('beside an up-to-date calendar', [rec(staleCal), rec(calendar)]),
    ],
    duplicate: [c('one calendar twice', [rec(staleCal), rec(staleCal)])],
  },
  ask_more: {
    valid: [c('a record', [rec(foot)])],
    invalid: [c('an absence alone', [absence()])],
    unrelated: [c('a record beside an absence', [rec(foot), absence()])],
    duplicate: [c('one record twice', [rec(foot), rec(foot)])],
  },
  recorded_only: {
    valid: [c('beside a record', [rec(foot)], []), c('about an absence', [absence()], [0])],
    invalid: [c('with no fact block at all', [], [])],
    unrelated: [],
    duplicate: [],
  },
  forecast_can_change: {
    valid: [
      c('Saturday’s forecast', [rec(sat)]),
      c('both days', [rec(sat), rec(sun)]),
      c('a stretch’s band', [gapDry]),
    ],
    invalid: [c('a stretch without its band (M6)', [rec(gap)])],
    unrelated: [c('a forecast beside football', [rec(sat), rec(foot)])],
    duplicate: [c('Saturday twice', [rec(sat), rec(sat, ['gust'])])],
  },
  may_have_changed: {
    valid: [
      c('context marked stale (P9g)', [rec(staleCtx)]),
      c('a stale calendar', [rec(staleCal)]),
    ],
    invalid: [c('fresh context (M5)', [rec(dinosaurs)])],
    unrelated: [c('stale context beside football', [rec(staleCtx), rec(foot)])],
    duplicate: [c('stale context twice', [rec(staleCtx), rec(staleCtx)])],
  },
};

describe('Kev’s view: every phrase, by what its blocks show (Part 7)', () => {
  it('every phrase in the catalogue has its cases', () => {
    expect(Object.keys(CASES).sort()).toEqual([...VIEW_PHRASE_IDS].sort());
    for (const p of VIEW_PHRASE_IDS) {
      expect(CASES[p].valid.length, p).toBeGreaterThan(0);
      expect(CASES[p].invalid.length, p).toBeGreaterThan(0);
      if (VIEW_PHRASES[p].support !== 'none') {
        expect(CASES[p].unrelated.length, p).toBeGreaterThan(0);
        expect(CASES[p].duplicate.length, p).toBeGreaterThan(0);
      }
    }
  });

  for (const phrase of VIEW_PHRASE_IDS) {
    describe(phrase, () => {
      const { valid, invalid, unrelated, duplicate } = CASES[phrase];
      it.each(valid)('supported: %s', (_, facts, about) => {
        const r = check(phrase, facts, about);
        expect(r.ok ? [] : codesOf(r.violations)).toEqual([]);
        expect(r.ok && r.rendered!.blocks.at(-1)).toEqual({
          kind: 'view',
          text: VIEW_PHRASES[phrase].text,
          cites: expect.any(Array),
        });
      });
      for (const [kind, cases] of [
        ['not supported', invalid],
        ['an unrelated block cited', unrelated],
        ['one record cited twice', duplicate],
      ] as const)
        if (cases.length > 0)
          it.each(cases)(`${kind}: %s`, (_, facts, about) => {
            const r = check(phrase, facts, about);
            // With no fact block at all, the lead is refused too.
            expect(r.ok ? [] : codesOf(r.violations)).toEqual(
              facts.length === 0 ? ['lead.unsupported', 'view.unsupported'] : ['view.unsupported'],
            );
            // Facts kept, the view never shown.
            if (!r.ok && r.salvage)
              expect(r.salvage.blocks.some((b) => b.kind === 'view')).toBe(false);
          });
    });
  }
});
