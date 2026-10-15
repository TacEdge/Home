import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codesOf, validateAnswer } from '@/kev/answer/validate';
import type { Ref } from '@/kev/tools/types';
import {
  board,
  busy,
  busyLedger,
  calendar,
  conflict,
  dentistToday,
  dentistTue,
  dinosaurs,
  fence,
  foot,
  gap,
  insight,
  interviews,
  kapaHaka,
  lunch,
  more,
  note,
  NOW,
  P,
  paint,
  party,
  person,
  sat,
  sun,
  swim,
  T,
  teacherOnly,
  ZONE,
} from './kev-ledger-fixture';

// Usefulness, measured (owner amendment, ADR 0012 \u00A746; the brief's phase
// 10): realistic, truthful plans over the final review's fixture, in the
// ways a household asks, with natural NZ leads. Every one must pass; the
// rate is the false-rejection measure. A second set holds leads the
// contract's language rules refuse on purpose (\u00A78.6's lists, the
// fact-free rule), so the cost is visible. Set KEV_QUALITY_OUT to a file
// path to write the rendered answers for reading. Synthetic only.

const w = (r: Ref) => ({ type: r.type, id: r.id, at: r.at ?? null });
const rec = (r: Ref, show: string[] = []) => ({ kind: r.type, ref: w(r), show, scope: null });
const sc = (s: Record<string, unknown>) => ({
  of: 'agenda',
  from: null,
  to: null,
  people: [],
  part: null,
  else: false,
  ...s,
});
const abs = (s: Record<string, unknown>) => ({
  kind: 'absence',
  ref: null,
  show: [],
  scope: sc(s),
});
const cnt = (s: Record<string, unknown>) => ({ kind: 'count', ref: null, show: [], scope: sc(s) });
const plan = (
  lead: string,
  facts: unknown[],
  view: { text: string; about: number[] } | null = null,
) => ({
  lead,
  facts,
  view,
  decline: null,
});
const plumber: Ref = { type: 'task', id: T.plumber };
const TODAY = '2026-10-14';
const THU = '2026-10-15';
const SAT = '2026-10-17';
const SUN = '2026-10-18';
const NEXT = { from: '2026-10-19', to: '2026-10-25' };

const ledger = () =>
  busyLedger([
    more.project,
    more.alexTasks,
    more.searchDentist,
    more.insights,
    more.context,
    more.calendars,
    more.milo,
    busy.sundayKids,
    more.weather24,
  ]);

/** [question, plan] — truthful over the fixture. */
const TRUTHFUL: [string, unknown][] = [
  [
    'What’s on today?',
    plan('Here’s {when}.', [
      rec(dentistToday),
      rec(teacherOnly),
      rec(swim),
      abs({ from: TODAY, to: TODAY, else: true }),
    ]),
  ],
  ['Anything this morning?', plan('Here’s {when}.', [rec(dentistToday), rec(teacherOnly)])],
  ['When’s swimming?', plan('Here you go.', [rec(swim)])],
  ['Who’s taking Milo to swimming?', plan('Here’s who’s recorded on it.', [rec(swim, ['people'])])],
  ['Is there a dentist today?', plan('Yep, here it is.', [rec(dentistToday)])],
  ['How many things today?', plan('Here you go.', [cnt({ from: TODAY, to: TODAY })])],
  [
    'How many for Milo today?',
    plan('Here you go.', [cnt({ from: TODAY, to: TODAY, people: [P.milo] })]),
  ],
  ['What’s on tomorrow?', plan('Here’s {when}.', [rec(kapaHaka), rec(board), rec(interviews)])],
  ['Why is Thursday flagged?', plan('Here’s why HOME flagged it.', [rec(conflict)])],
  ['Anything clashing on Thursday?', plan('Might be worth a look.', [rec(conflict)])],
  [
    'Anything in the morning on Thursday?',
    plan('Here you go.', [
      rec(plumber, ['due']),
      abs({ from: THU, to: THU, part: 'morning', else: true }),
    ]),
  ],
  [
    'Is Alex free Thursday night?',
    plan('Here’s what’s recorded that you can see.', [
      rec(plumber, ['due']),
      abs({ from: THU, to: THU, people: [P.alex], part: 'evening', else: true }),
    ]),
  ],
  [
    'What have we got this weekend?',
    plan('Righto, here’s {when}.', [rec(foot), rec(party), rec(lunch)]),
  ],
  [
    'What’s on Saturday?',
    plan('Here’s {when}.', [rec(foot), rec(party), abs({ from: SAT, to: SAT, else: true })]),
  ],
  ['How many things on Saturday?', plan('Here you go.', [cnt({ from: SAT, to: SAT })])],
  [
    'What are the kids doing Sunday?',
    plan('Here you go.', [abs({ from: SUN, to: SUN, people: [P.isla, P.milo] })]),
  ],
  ['When’s lunch at Nana Jo’s?', plan('Here you go.', [rec(lunch)])],
  [
    'Who’s going to lunch on Sunday?',
    plan('Here’s who’s recorded on it.', [rec(lunch, ['people'])]),
  ],
  ['What’s the weather on Saturday?', plan('Here’s the forecast.', [rec(sat)])],
  ['Weather this weekend?', plan('Here’s {when}.', [rec(sat), rec(sun)])],
  ['How windy on Sunday?', plan('Here you go.', [rec(sun, ['gust'])])],
  ['Will it rain Sunday afternoon?', plan('Here’s the forecast.', [rec(sun, ['phrase', 'parts'])])],
  [
    'Forecast for the 24th?',
    plan('Here you go.', [abs({ of: 'forecast', from: '2026-10-24', to: '2026-10-24' })]),
  ],
  [
    'Anything on next week we should know?',
    plan('Here’s what HOME lists.', [rec(insight), abs({ of: 'conflicts', ...NEXT })]),
  ],
  ['Any overlaps next week?', plan('Here you go.', [abs({ of: 'conflicts', ...NEXT })])],
  ['Isla’s dentist next week?', plan('Here it is.', [rec(dentistTue)])],
  [
    'What tasks have I got?',
    plan('Here’s what’s on your list.', [rec(paint, ['status', 'estimate', 'needs'])]),
  ],
  ['When’s the fence due?', plan('Here you go.', [rec(paint, ['due'])])],
  ['Is the fence done?', plan('Here’s where it stands.', [rec(paint, ['status'])])],
  ['What’s Alex got to do?', plan('Here you go.', [rec(plumber, ['due', 'assignee'])])],
  [
    'What’s in the Back fence project?',
    plan('Here’s the project.', [
      rec(fence, ['status', 'target']),
      rec(paint, ['status']),
      rec(note),
    ]),
  ],
  ['What colour for the fence?', plan('Here’s the note.', [rec(note)])],
  ['When’s Nana Jo’s birthday?', plan('Here you go.', [rec(person(P.nana), ['birthday'])])],
  ['How old is Nana Jo turning?', plan('Here you go.', [rec(person(P.nana), ['age', 'birthday'])])],
  ['How old is Isla?', plan('Here you go.', [rec(person(P.isla), ['age'])])],
  [
    'What’s Milo’s usual week?',
    plan('Here’s what’s recorded as usual.', [rec(person(P.milo), ['regular_week'])]),
  ],
  ['What does HOME know about Milo?', plan('Here’s what HOME has.', [rec(dinosaurs)])],
  ['Is my calendar up to date?', plan('Here’s how it looks.', [rec(calendar)])],
  [
    'When could I do the fence this weekend?',
    plan(
      'Here’s how {when} looks in HOME.',
      [rec(gap, ['neighbours', 'forecast']), rec(paint, ['estimate', 'needs'])],
      { text: 'The stretch above matches what the task records.', about: [0, 1] },
    ),
  ],
  [
    'Help me think about Saturday.',
    plan('Heads up, here’s {when}.', [rec(foot), rec(party)], {
      text: 'Worth keeping an eye on the timing between those.',
      about: [0, 1],
    }),
  ],
  ['What time’s the dentist next month?', plan('Here you go.', [abs({ of: 'search' })])],
  [
    'Anything else on Saturday after football?',
    plan('Here’s {when}.', [rec(foot), rec(party), abs({ from: SAT, to: SAT, else: true })]),
  ],
  [
    'What’s on tomorrow evening for Sam?',
    plan('Here’s {when}.', [rec(board), rec(interviews)], {
      text: 'Might be worth leaving early.',
      about: [0, 1],
    }),
  ],
  ['Kia ora Kev', plan('Kia ora.', [])],
  ['Cheers', plan('Cheers.', [])],
];

/** Leads the contract refuses on purpose: \u00A78.6's lists, or a fact in the model's words. */
const REFUSED_BY_DESIGN: [string, string][] = [
  ['Heads up — a busy afternoon.', 'busy is on M5’s list; afternoon is a time'],
  ['Sounds like a full one.', 'full is on M5’s list'],
  ['Righto, here’s the weekend.', 'a day word: say {when}'],
  ['Plenty on Saturday.', 'a quantity and a day'],
  ['Nope, nothing for Alex.', 'negation and a name: an absence block says it'],
  ['Just the one thing today.', 'exclusivity, a number, a day'],
  ['Here’s the morning.', 'a part of the day: say {when}, or show it'],
  ['Here’s the usual week.', 'a time word'],
  ['No worries.', '“no” is negation'],
  ['Worth watching the first two.', 'number words, even as references'],
];

describe('false rejection: truthful plans', () => {
  it(`all ${TRUTHFUL.length} pass, and render naturally`, () => {
    expect(TRUTHFUL.length).toBeGreaterThanOrEqual(40);
    const out: string[] = [];
    const failed: string[] = [];
    for (const [q, raw] of TRUTHFUL) {
      const r = validateAnswer({ raw, ledger: ledger(), now: NOW, timeZone: ZONE, question: q });
      if (!r.ok || !r.rendered) {
        failed.push(`${q}: ${r.ok ? 'declined' : codesOf(r.violations).join(',')}`);
        continue;
      }
      out.push(
        `Q: ${q}\n  ${r.rendered.say}\n${r.rendered.blocks.map((b) => `  ${b.kind === 'view' ? 'Kev’s view: ' : ''}${b.text}`).join('\n')}`,
      );
    }
    if (process.env.KEV_QUALITY_OUT) writeFileSync(process.env.KEV_QUALITY_OUT, out.join('\n\n'));
    expect(failed).toEqual([]);
  });

  it('the leads the contract refuses on purpose are refused (their cost, made visible)', () => {
    for (const [lead, why] of REFUSED_BY_DESIGN) {
      const r = validateAnswer({
        raw: plan(lead, [rec(foot)]),
        ledger: ledger(),
        now: NOW,
        timeZone: ZONE,
      });
      expect(r.ok, `${lead} (${why})`).toBe(false);
      // Only the words: the facts would still be shown, with HOME's lead.
      expect(r.ok ? null : r.salvage).not.toBeNull();
    }
  });
});
