import { bundleSchema } from '@/kev/context/assemble';
import { Ledger } from '@/kev/answer/ledger';
import { getAgenda } from '@/kev/tools/get-agenda';
import { getConflicts } from '@/kev/tools/get-conflicts';
import { getGaps } from '@/kev/tools/get-gaps';
import { getPeople } from '@/kev/tools/get-people';
import { getTasks } from '@/kev/tools/get-tasks';
import { getWeather } from '@/kev/tools/get-weather';
import type { Ref } from '@/kev/tools/types';

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
};
export const T = { paint: id(20) };
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
          due: null,
          scheduled: null,
          assignee: { ref: person(P.sam), name: u('Sam') },
          project: null,
        },
      ],
      count: 1,
      truncated: false,
    }),
    refs: [paint, person(P.sam)],
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

export type Read = (typeof reads)[keyof typeof reads];

/** The fixture ledger: the bundle, then the reads asked for (default: all of them). */
export function fixtureLedger(only?: readonly Read[]): Ledger {
  const l = new Ledger();
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
