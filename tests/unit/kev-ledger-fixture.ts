import { bundleSchema } from '@/kev/context/assemble';
import { Ledger } from '@/kev/answer/ledger';
import { getAgenda } from '@/kev/tools/get-agenda';
import { getCalendarHealth } from '@/kev/tools/get-calendar-health';
import { getContext } from '@/kev/tools/get-context';
import { getInsights } from '@/kev/tools/get-insights';
import { getProjects } from '@/kev/tools/get-projects';
import { getToday } from '@/kev/tools/get-today';
import { search } from '@/kev/tools/search';
import { getConflicts } from '@/kev/tools/get-conflicts';
import { getGaps } from '@/kev/tools/get-gaps';
import { getPeople } from '@/kev/tools/get-people';
import { getTasks } from '@/kev/tools/get-tasks';
import { getWeather } from '@/kev/tools/get-weather';
import type { Ref, ToolName } from '@/kev/tools/types';

// The validator's fixture ledger (M8 contract §15.6's synthetic family, on
// Wednesday 14 October 2026, 07:03, Pacific/Auckland), built from tool
// outputs that each tool's own strict output schema accepts: every result
// is parsed with the tool's `output` before the ledger sees it, and the
// bundle with `bundleSchema`, so a fixture the real tools could not return
// cannot exist here (Package 3 review, B-2). Synthetic only.

export const NOW = new Date('2026-10-14T07:03:00+13:00');
export const ZONE = 'Pacific/Auckland';
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const P = { sam: id(1), alex: id(2), milo: id(3), isla: id(4), nana: id(5) };
export const E = {
  swimming: id(10),
  football: id(11),
  board: id(12),
  interviews: id(13),
  injected: id(14),
  dentistToday: id(15),
  teacherOnly: id(16),
  party: id(17),
  lunch: id(18),
  kapaHaka: id(19),
  dentistTue: id(21),
  dstEvent: id(22),
  overnight: id(23),
};
export const T = { paint: id(20), plumber: id(24) };
export const PR = { fence: id(40) };
export const NOTE = { colour: id(41) };
export const CTX = { dinosaurs: id(42) };
export const u = (s: string) => ({ untrusted_text: s });
export const person = (pid: string): Ref => ({ type: 'person', id: pid });
export const swim: Ref = { type: 'event', id: E.swimming, at: '2026-10-14T15:30:00+13:00' };
export const foot: Ref = { type: 'event', id: E.football, at: '2026-10-17T09:00:00+13:00' };
export const board: Ref = { type: 'event', id: E.board, at: '2026-10-15T17:30:00+13:00' };
export const interviews: Ref = { type: 'event', id: E.interviews, at: '2026-10-15T18:00:00+13:00' };
export const conflict: Ref = { type: 'conflict', id: 'conflict.overlap:abc' };
export const paint: Ref = { type: 'task', id: T.paint };
export const gap: Ref = { type: 'gap', id: 'gap:household:2026-10-17:1000' };
export const sat: Ref = { type: 'forecast', id: 'forecast:2026-10-17' };
export const sun: Ref = { type: 'forecast', id: 'forecast:2026-10-18' };
export const calendar: Ref = { type: 'calendar', id: id(30) };

const personRow = (
  pid: string,
  name: string,
  role: 'parent' | 'child' | 'other',
  age: number | null,
  relationship: string | null = null,
  inHousehold = true,
) => ({
  ref: person(pid),
  name: u(name),
  role,
  relationship: relationship === null ? null : u(relationship),
  age,
  in_household: inHousehold,
});

export const swimItem = {
  type: 'event' as const,
  ref: swim,
  title: u('Swimming'),
  all_day: false,
  start: '2026-10-14T15:30:00+13:00',
  end: '2026-10-14T16:15:00+13:00',
  kind: null,
  people: [
    { ref: person(P.milo), name: u('Milo'), role: 'attending' as const },
    { ref: person(P.sam), name: u('Sam'), role: 'responsible' as const },
  ],
};

/** The bundle, as the assembly would build it (parsed with its schema). */
export const bundle = bundleSchema.parse({
  now: { weekday: 'Wednesday', date: '2026-10-14', time: '07:03', zone: ZONE },
  reader: { ref: person(P.sam), name: u('Sam') },
  people: [
    personRow(P.sam, 'Sam', 'parent', null),
    personRow(P.alex, 'Alex', 'parent', null),
    personRow(P.milo, 'Milo', 'child', 9),
    personRow(P.isla, 'Isla', 'child', 6),
    personRow(P.nana, 'Nana Jo', 'other', 79, 'Grandmother', false),
  ],
  people_count: 5,
  people_truncated: false,
  today: {
    date: '2026-10-14',
    state: 'day',
    headline: u('Swimming at 3:30.'),
    qualified: false,
    late: null,
    people: [{ ref: person(P.milo), name: u('Milo'), items: [swimItem] }],
    also_today: [],
    evening: null,
    todo: [],
    to_sort: 0,
    count: 1,
    truncated: false,
  },
  freshness: {
    calendars: { healthy: 1, stale: 0, failed: 0, never: 0 },
    forecast_fetched_at: '2026-10-14T06:55:00+13:00',
  },
  to_sort: 0,
  focus: null,
});
export const bundleRefs: Ref[] = [
  person(P.sam),
  person(P.alex),
  person(P.milo),
  person(P.isla),
  person(P.nana),
  swim,
  person(P.milo),
  person(P.sam),
];

/** Each read, as its tool returns it: output parsed with the tool's own schema, refs, input. */
export const reads = {
  weekendAgenda: {
    tool: 'get_agenda' as const,
    input: { from: '2026-10-17', to: '2026-10-18' },
    data: getAgenda.output.parse({
      from: '2026-10-17',
      to: '2026-10-18',
      days: [
        {
          date: '2026-10-17',
          items: [
            {
              type: 'event',
              ref: foot,
              title: u('Football'),
              all_day: false,
              start: '2026-10-17T09:00:00+13:00',
              end: '2026-10-17T10:00:00+13:00',
              kind: null,
              people: [{ ref: person(P.milo), name: u('Milo'), role: 'attending' }],
            },
          ],
        },
        { date: '2026-10-18', items: [] },
      ],
      count: 1,
      truncated: false,
    }),
    refs: [foot, person(P.milo)],
  },
  thursdayConflicts: {
    tool: 'get_conflicts' as const,
    input: { from: '2026-10-15', to: '2026-10-15' },
    data: getConflicts.output.parse({
      from: '2026-10-15',
      to: '2026-10-15',
      conflicts: [
        {
          ref: conflict,
          key: 'conflict.overlap:abc',
          rule: 'conflict.overlap',
          person: { ref: person(P.sam), name: u('Sam') },
          commitments: [
            {
              ref: board,
              title: u('Board meeting'),
              start: '2026-10-15T17:30:00+13:00',
              end: '2026-10-15T19:30:00+13:00',
              role: 'attending',
            },
            {
              ref: interviews,
              title: u('Parent interviews'),
              start: '2026-10-15T18:00:00+13:00',
              end: '2026-10-15T18:30:00+13:00',
              role: 'attending',
            },
          ],
          overlap: { from: '2026-10-15T18:00:00+13:00', to: '2026-10-15T18:30:00+13:00' },
          when: '2026-10-15',
          responded: false,
        },
      ],
      count: 1,
      truncated: false,
    }),
    refs: [conflict, person(P.sam), board, interviews],
  },
  nextWeekConflicts: {
    tool: 'get_conflicts' as const,
    input: { from: '2026-10-19', to: '2026-10-25' },
    data: getConflicts.output.parse({
      from: '2026-10-19',
      to: '2026-10-25',
      conflicts: [],
      count: 0,
      truncated: false,
    }),
    refs: [] as Ref[],
  },
  tasks: {
    tool: 'get_tasks' as const,
    input: { assignee: 'me' },
    data: getTasks.output.parse({
      tasks: [
        {
          ref: paint,
          title: u('Paint the back fence'),
          status: 'open',
          estimate_minutes: 180,
          needs: ['dry_weather', 'daylight'],
          due: '2026-11-01',
          scheduled: null,
          assignee: { ref: person(P.sam), name: u('Sam') },
          project: { ref: { type: 'project', id: PR.fence }, title: u('Back fence') },
        },
      ],
      count: 1,
      truncated: false,
    }),
    refs: [paint, person(P.sam), { type: 'project', id: PR.fence } as Ref],
  },
  saturdayGaps: {
    tool: 'get_gaps' as const,
    input: { from: '2026-10-17', to: '2026-10-17', scope: 'household' },
    data: getGaps.output.parse({
      from: '2026-10-17',
      to: '2026-10-17',
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
          ref: gap,
          key: 'gap:household:2026-10-17:1000',
          date: '2026-10-17',
          from: '2026-10-17T10:00:00+13:00',
          to: '2026-10-17T19:30:00+13:00',
          before: { ref: foot, title: u('Football') },
          after: null,
          daylight: { from: '2026-10-17T06:30:00+13:00', to: '2026-10-17T19:30:00+13:00' },
          forecast_band: 'dry',
        },
      ],
      limit: true,
      count: 1,
      truncated: false,
    }),
    refs: [calendar, gap, foot],
  },
  weekendWeather: {
    tool: 'get_weather' as const,
    input: { from: '2026-10-17', to: '2026-10-18' },
    data: getWeather.output.parse({
      configured: true,
      freshness: 'fresh',
      fetched_at: '2026-10-14T06:55:00+13:00',
      days: [
        {
          ref: sat,
          date: '2026-10-17',
          phrase: 'Looks dry',
          low_c: 9,
          high_c: 17,
          max_gust_kmh: 30,
          parts: [{ part: 'morning', band: 'dry' }],
        },
        {
          ref: sun,
          date: '2026-10-18',
          phrase: 'Showers possible',
          low_c: 8,
          high_c: 14,
          max_gust_kmh: 45,
          parts: [{ part: 'afternoon', band: 'showers' }],
        },
      ],
      uncovered: [],
      credit: 'Open-Meteo',
      count: 2,
      truncated: false,
    }),
    refs: [sat, sun],
  },
  nana: {
    tool: 'get_people' as const,
    input: { person_id: P.nana },
    data: getPeople.output.parse({
      people: [
        {
          ref: person(P.nana),
          name: u('Nana Jo'),
          role: 'other',
          in_household: false,
          age: 79,
          next_birthday: { date: '2026-10-20', age: 80 },
          regular_week: [],
          stage_note: null,
        },
      ],
      count: 1,
      truncated: false,
    }),
    refs: [person(P.nana)],
  },
};

/** A read as the ledger takes it: a tool's name, its input, its parsed output and refs. */
export type Read = {
  tool: Exclude<ToolName, 'escalate'>;
  input: unknown;
  data: unknown;
  refs: readonly Ref[];
};

/** The fixture ledger: the bundle, then the reads asked for (default: all of them). */
export function fixtureLedger(only?: readonly Read[]): Ledger {
  const l = new Ledger(ZONE);
  l.addBundle(bundle, bundleRefs);
  for (const r of only ?? Object.values(reads)) l.addResult(r.tool, r.data, r.refs, r.input);
  return l;
}

/** One more agenda read with a single event (an injected title, a "Free swim day"). */
export function withEvent(
  l: Ledger,
  ref: Ref & { at: string },
  title: string,
  end: string,
): Ledger {
  const date = ref.at.slice(0, 10);
  l.addResult(
    'get_agenda',
    getAgenda.output.parse({
      from: date,
      to: date,
      days: [
        {
          date,
          items: [
            {
              type: 'event',
              ref,
              title: u(title),
              all_day: false,
              start: ref.at,
              end,
              kind: null,
              people: [{ ref: person(P.alex), name: u('Alex'), role: 'attending' }],
            },
          ],
        },
      ],
      count: 1,
      truncated: false,
    }),
    [ref, person(P.alex)],
    { from: date, to: date },
  );
  return l;
}

// ---------------------------------------------------------------------------
// The final review's fixture (its findings file): the same family, with a
// busier week. Today also has a dentist appointment at 10:00 and a
// teacher-only day; Saturday a birthday party; Sunday lunch at Nana Jo's;
// Thursday kapa haka; next week's read is truncated, with the dentist on
// Tuesday 20 October (Isla attending, Alex responsible). Every output is
// parsed with its tool's own schema, the bundle with `bundleSchema`.

export const dentistToday: Ref = {
  type: 'event',
  id: E.dentistToday,
  at: '2026-10-14T10:00:00+13:00',
};
export const teacherOnly: Ref = {
  type: 'event',
  id: E.teacherOnly,
  at: '2026-10-14T00:00:00+13:00',
};
export const party: Ref = { type: 'event', id: E.party, at: '2026-10-17T14:00:00+13:00' };
export const lunch: Ref = { type: 'event', id: E.lunch, at: '2026-10-18T12:30:00+13:00' };
export const kapaHaka: Ref = { type: 'event', id: E.kapaHaka, at: '2026-10-15T16:00:00+13:00' };
export const dentistTue: Ref = { type: 'event', id: E.dentistTue, at: '2026-10-20T09:00:00+13:00' };
export const fence: Ref = { type: 'project', id: PR.fence };
export const note: Ref = { type: 'note', id: NOTE.colour };
export const dinosaurs: Ref = { type: 'context', id: CTX.dinosaurs };
export const insight: Ref = { type: 'insight', id: 'birthday.upcoming:nana' };

export const on = (pid: string, name: string, role: 'attending' | 'responsible') => ({
  ref: person(pid),
  name: u(name),
  role,
});
export const timedItem = (
  ref: Ref,
  title: string,
  end: string,
  people: ReturnType<typeof on>[] = [],
) => ({
  type: 'event' as const,
  ref,
  title: u(title),
  all_day: false,
  start: ref.at ?? '',
  end,
  kind: null,
  people,
});
export const allDayItem = (ref: Ref, title: string, people: ReturnType<typeof on>[] = []) => ({
  type: 'event' as const,
  ref,
  title: u(title),
  all_day: true,
  kind: null,
  people,
});
const dentistTodayItem = timedItem(dentistToday, 'Dentist', '2026-10-14T10:30:00+13:00', [
  on(P.isla, 'Isla', 'attending'),
]);
const teacherOnlyItem = allDayItem(teacherOnly, 'Teacher-only day', [
  on(P.milo, 'Milo', 'attending'),
]);

/** Today with three things: the dentist at 10:00, the teacher-only day and swimming. */
export const busyBundle = bundleSchema.parse({
  ...bundle,
  today: {
    ...bundle.today,
    headline: u('Three things today.'),
    people: [
      { ref: person(P.isla), name: u('Isla'), items: [dentistTodayItem] },
      { ref: person(P.milo), name: u('Milo'), items: [teacherOnlyItem, swimItem] },
    ],
    count: 3,
  },
});
export const busyBundleRefs: Ref[] = [...bundleRefs, dentistToday, teacherOnly];

export const agenda = (
  from: string,
  to: string,
  days: { date: string; items: unknown[] }[],
  truncated = false,
) => ({
  tool: 'get_agenda' as const,
  input: { from, to },
  data: getAgenda.output.parse({
    from,
    to,
    days,
    count: days.reduce((n, d) => n + d.items.length, 0),
    truncated,
  }),
  refs: [] as Ref[],
});

export const busy = {
  weekend: agenda('2026-10-17', '2026-10-18', [
    {
      date: '2026-10-17',
      items: [
        timedItem(foot, 'Football', '2026-10-17T10:00:00+13:00', [on(P.milo, 'Milo', 'attending')]),
        timedItem(party, 'Birthday party', '2026-10-17T16:00:00+13:00', [
          on(P.isla, 'Isla', 'attending'),
          on(P.milo, 'Milo', 'attending'),
          on(P.alex, 'Alex', 'responsible'),
        ]),
      ],
    },
    {
      date: '2026-10-18',
      items: [
        timedItem(lunch, 'Lunch at Nana Jo\u2019s', '2026-10-18T14:00:00+13:00', [
          on(P.sam, 'Sam', 'attending'),
          on(P.alex, 'Alex', 'attending'),
        ]),
      ],
    },
  ]),
  thursday: agenda('2026-10-15', '2026-10-15', [
    {
      date: '2026-10-15',
      items: [
        timedItem(kapaHaka, 'Kapa haka', '2026-10-15T17:00:00+13:00', [
          on(P.milo, 'Milo', 'attending'),
        ]),
        timedItem(board, 'Board meeting', '2026-10-15T19:30:00+13:00', [
          on(P.sam, 'Sam', 'attending'),
        ]),
        timedItem(interviews, 'Parent interviews', '2026-10-15T18:30:00+13:00', [
          on(P.sam, 'Sam', 'attending'),
        ]),
      ],
    },
  ]),
  /** Next week, cut: it covers nothing. */
  nextWeekCut: agenda(
    '2026-10-19',
    '2026-10-25',
    [
      {
        date: '2026-10-20',
        items: [
          timedItem(dentistTue, 'Dentist', '2026-10-20T09:30:00+13:00', [
            on(P.isla, 'Isla', 'attending'),
            on(P.alex, 'Alex', 'responsible'),
          ]),
        ],
      },
    ],
    true,
  ),
  /** Sunday alone, for Isla and Milo (a person-filtered read). */
  sundayKids: {
    ...agenda('2026-10-18', '2026-10-18', [{ date: '2026-10-18', items: [] }]),
    input: { from: '2026-10-18', to: '2026-10-18', person_ids: [P.isla, P.milo] },
  },
};

/** The final review's ledger: the busy bundle, the base reads and the busy ones. */
export function busyLedger(extra: readonly Read[] = []): Ledger {
  const l = new Ledger(ZONE);
  l.addBundle(busyBundle, busyBundleRefs);
  for (const r of [
    reads.thursdayConflicts,
    reads.nextWeekConflicts,
    reads.tasks,
    reads.saturdayGaps,
    reads.weekendWeather,
    reads.nana,
    busy.weekend,
    busy.thursday,
    busy.nextWeekCut,
    ...extra,
  ])
    l.addResult(r.tool, r.data, r.refs, r.input);
  return l;
}

/** More reads, each through its tool's own schema: get_today, search, insights, context, projects, calendars, recurring, DST. */
export const more = {
  today: {
    tool: 'get_today' as const,
    input: {},
    data: getToday.output.parse({ ...busyBundle.today, insights: [] }),
    refs: [] as Ref[],
  },
  searchDentist: {
    tool: 'search' as const,
    input: { query: 'dentist' },
    data: search.output.parse({ results: [], returned: 0, truncated: false }),
    refs: [] as Ref[],
  },
  searchFence: {
    tool: 'search' as const,
    input: { query: 'fence' },
    data: search.output.parse({
      results: [
        { ref: fence, type: 'project', title: u('Back fence') },
        { ref: paint, type: 'task', title: u('Paint the back fence') },
      ],
      returned: 2,
      truncated: false,
    }),
    refs: [fence, paint],
  },
  insights: {
    tool: 'get_insights' as const,
    input: { surface: 'forward_week' },
    data: getInsights.output.parse({
      surface: 'forward_week',
      insights: [
        {
          ref: insight,
          key: 'birthday.upcoming:nana',
          kind: 'preparation',
          rule: 'preparation.birthday',
          when: '2026-10-20',
          text: u('Nana Jo\u2019s birthday is on Tuesday.'),
          shown_on: 'list',
          refs: [person(P.nana)],
        },
      ],
      count: 1,
      truncated: false,
    }),
    refs: [insight, person(P.nana)],
  },
  context: {
    tool: 'get_context' as const,
    input: { subject_type: 'person', subject_id: P.milo },
    data: getContext.output.parse({
      context: [
        {
          ref: dinosaurs,
          subject: { type: 'person', ref: person(P.milo) },
          category: 'interest',
          content: u('Enjoys dinosaurs at the moment.'),
          last_confirmed: '2026-10-06',
          stale: false,
        },
      ],
      count: 1,
      truncated: false,
    }),
    refs: [dinosaurs, person(P.milo)],
  },
  project: {
    tool: 'get_projects' as const,
    input: { project_id: PR.fence },
    data: getProjects.output.parse({
      project: {
        ref: fence,
        title: u('Back fence'),
        status: 'active',
        target_date: '2026-11-01',
        summary: null,
        tasks: [
          {
            ref: paint,
            title: u('Paint the back fence'),
            status: 'open',
            estimate_minutes: 180,
            needs: ['dry_weather', 'daylight'],
            due: '2026-11-01',
            scheduled: null,
            assignee: { ref: person(P.sam), name: u('Sam') },
            project: { ref: fence, title: u('Back fence') },
          },
        ],
        notes: [{ ref: note, body: u('Same green as the shed.') }],
        notes_count: 1,
      },
      count: 3,
      truncated: false,
    }),
    refs: [fence, paint, person(P.sam), note],
  },
  calendars: {
    tool: 'get_calendar_health' as const,
    input: {},
    data: getCalendarHealth.output.parse({
      calendars: [
        {
          ref: calendar,
          label: u('Family calendar'),
          last_success: '2026-10-14T06:58:00+13:00',
          status: 'healthy',
        },
      ],
      count: 1,
      truncated: false,
    }),
    refs: [calendar],
  },
  milo: {
    tool: 'get_people' as const,
    input: { person_id: P.milo },
    data: getPeople.output.parse({
      people: [
        {
          ref: person(P.milo),
          name: u('Milo'),
          role: 'child',
          in_household: true,
          age: 9,
          next_birthday: { date: '2027-03-02', age: 10 },
          regular_week: [
            {
              weekday: 'Wednesday',
              time: '15:30',
              cadence: 'weekly',
              ref: { type: 'event', id: E.swimming },
              title: u('Swimming'),
            },
            {
              weekday: 'Saturday',
              time: '09:00',
              cadence: 'weekly',
              ref: { type: 'event', id: E.football },
              title: u('Football'),
            },
          ],
          stage_note: null,
        },
      ],
      count: 1,
      truncated: false,
    }),
    refs: [person(P.milo)],
  },
  alexTasks: {
    tool: 'get_tasks' as const,
    input: { assignee: P.alex },
    data: getTasks.output.parse({
      tasks: [
        {
          ref: { type: 'task', id: T.plumber },
          title: u('Call the plumber'),
          status: 'open',
          estimate_minutes: 15,
          needs: [],
          due: '2026-10-15',
          scheduled: null,
          assignee: { ref: person(P.alex), name: u('Alex') },
          project: null,
        },
      ],
      count: 1,
      truncated: false,
    }),
    refs: [{ type: 'task', id: T.plumber } as Ref, person(P.alex)],
  },
  /** The forecast asked for Saturday 24 October: beyond it. */
  weather24: {
    tool: 'get_weather' as const,
    input: { from: '2026-10-24', to: '2026-10-24' },
    data: getWeather.output.parse({
      configured: true,
      freshness: 'fresh',
      fetched_at: '2026-10-14T06:55:00+13:00',
      days: [],
      uncovered: ['2026-10-24'],
      credit: 'Open-Meteo',
      count: 1,
      truncated: false,
    }),
    refs: [] as Ref[],
  },
  /** No forecast set up at all. */
  weatherNone: {
    tool: 'get_weather' as const,
    input: { from: '2026-10-17', to: '2026-10-18' },
    data: getWeather.output.parse({ configured: false }),
    refs: [] as Ref[],
  },
  /** The night daylight saving ends (Sunday 5 April 2027): an event at 02:30, the second time. */
  dst: agenda('2027-04-04', '2027-04-04', [
    {
      date: '2027-04-04',
      items: [
        timedItem(
          { type: 'event', id: E.dstEvent, at: '2027-04-04T02:30:00+12:00' },
          'Night shift',
          '2027-04-04T03:30:00+12:00',
          [on(P.alex, 'Alex', 'attending')],
        ),
      ],
    },
  ]),
  overnight: agenda('2026-10-16', '2026-10-16', [
    {
      date: '2026-10-16',
      items: [
        timedItem(
          { type: 'event', id: E.overnight, at: '2026-10-16T22:00:00+13:00' },
          'Sleepover',
          '2026-10-17T09:00:00+13:00',
          [on(P.milo, 'Milo', 'attending')],
        ),
      ],
    },
  ]),
};
