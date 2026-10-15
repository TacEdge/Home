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

// Usefulness, measured (owner amendments, ADR 0012 \u00A746): realistic,
// truthful plans over the final review's fixture, in the ways a household
// asks, with HOME's catalogue leads and typed views. Every one must pass;
// the rate is the false-rejection measure. A second set holds leads and
// views HOME withholds on purpose (an affirming lead to a yes-or-no
// question, a phrase its facts do not support), so the cost is visible.
// Set KEV_QUALITY_OUT to a file path to write the rendered answers for
// reading. Synthetic only.

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
type ViewIn = { type: string; phrase: string; about: number[] };
const plan = (lead: string, facts: unknown[], view: ViewIn | null = null) => ({
  lead,
  facts,
  view,
  decline: null,
});
const v = (type: string, phrase: string, about: number[]): ViewIn => ({ type, phrase, about });
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

/** [question, plan] — truthful over the fixture, in HOME's catalogue's words. */
const TRUTHFUL: [string, unknown][] = [
  [
    'What’s on today?',
    plan('when', [
      rec(dentistToday),
      rec(teacherOnly),
      rec(swim),
      abs({ from: TODAY, to: TODAY, else: true }),
    ]),
  ],
  ['Anything this morning?', plan('when', [rec(dentistToday), rec(teacherOnly)])],
  ['When’s swimming?', plan('no_worries', [rec(swim)])],
  ['Who’s taking Milo to swimming?', plan('here_you_go', [rec(swim, ['people'])])],
  ['Is there a dentist today?', plan('found', [rec(dentistToday)])],
  ['How many things today?', plan('here_you_go', [cnt({ from: TODAY, to: TODAY })])],
  [
    'How many for Milo today?',
    plan('here_you_go', [cnt({ from: TODAY, to: TODAY, people: [P.milo] })]),
  ],
  ['What’s on tomorrow?', plan('when', [rec(kapaHaka), rec(board), rec(interviews)])],
  ['Why is Thursday flagged?', plan('flagged', [rec(conflict)])],
  [
    'Anything clashing on Thursday?',
    plan('flagged', [rec(conflict)], v('consideration', 'leave_early', [0])),
  ],
  [
    'Anything in the morning on Thursday?',
    plan('here_you_go', [
      rec(plumber, ['due']),
      abs({ from: THU, to: THU, part: 'morning', else: true }),
    ]),
  ],
  [
    'Is Alex free Thursday night?',
    plan('here_you_go', [
      rec(plumber, ['due']),
      abs({ from: THU, to: THU, people: [P.alex], part: 'evening', else: true }),
    ]),
  ],
  ['What have we got this weekend?', plan('righto_when', [rec(foot), rec(party), rec(lunch)])],
  [
    'What’s on Saturday?',
    plan('when', [rec(foot), rec(party), abs({ from: SAT, to: SAT, else: true })]),
  ],
  ['How many things on Saturday?', plan('here_you_go', [cnt({ from: SAT, to: SAT })])],
  [
    'What are the kids doing Sunday?',
    plan('here_you_go', [abs({ from: SUN, to: SUN, people: [P.isla, P.milo] })]),
  ],
  ['When’s lunch at Nana Jo’s?', plan('ka_pai', [rec(lunch)])],
  ['Who’s going to lunch on Sunday?', plan('here_you_go', [rec(lunch, ['people'])])],
  ['What’s the weather on Saturday?', plan('when', [rec(sat)])],
  ['Weather this weekend?', plan('when', [rec(sat), rec(sun)], v('suggestion', 'raincoat', [1]))],
  ['How windy on Sunday?', plan('here_you_go', [rec(sun, ['gust'])])],
  [
    'Will it rain Sunday afternoon?',
    plan('when', [rec(sun, ['phrase', 'parts'])], v('uncertainty', 'forecast_can_change', [0])),
  ],
  [
    'Forecast for the 24th?',
    plan('here_you_go', [abs({ of: 'forecast', from: '2026-10-24', to: '2026-10-24' })]),
  ],
  [
    'Anything on next week we should know?',
    plan(
      'flagged',
      [rec(insight), abs({ of: 'conflicts', ...NEXT })],
      v('consideration', 'present', [0]),
    ),
  ],
  ['Any overlaps next week?', plan('here_you_go', [abs({ of: 'conflicts', ...NEXT })])],
  ['Isla’s dentist next week?', plan('here_you_go', [rec(dentistTue)])],
  ['What tasks have I got?', plan('here_you_go', [rec(paint, ['status', 'estimate', 'needs'])])],
  ['When’s the fence due?', plan('here_you_go', [rec(paint, ['due'])])],
  ['Is the fence done?', plan('here_you_go', [rec(paint, ['status'])])],
  [
    'What’s Alex got to do?',
    plan(
      'here_you_go',
      [rec(plumber, ['status', 'due', 'assignee'])],
      v('suggestion', 'nudge', [0]),
    ),
  ],
  [
    'What’s in the Back fence project?',
    plan('found', [rec(fence, ['status', 'target']), rec(paint, ['status']), rec(note)]),
  ],
  ['What colour for the fence?', plan('found', [rec(note)])],
  [
    'When’s Nana Jo’s birthday?',
    plan('here_you_go', [rec(person(P.nana), ['birthday'])], v('consideration', 'present', [0])),
  ],
  ['How old is Nana Jo turning?', plan('here_you_go', [rec(person(P.nana), ['age', 'birthday'])])],
  ['How old is Isla?', plan('here_you_go', [rec(person(P.isla), ['age'])])],
  ['What’s Milo’s usual week?', plan('here_you_go', [rec(person(P.milo), ['regular_week'])])],
  ['What does HOME know about Milo?', plan('home_has', [rec(dinosaurs)])],
  ['Is my calendar up to date?', plan('here_you_go', [rec(calendar)])],
  [
    'When could I do the fence this weekend?',
    plan(
      'when',
      [rec(gap, ['neighbours', 'forecast']), rec(paint, ['estimate', 'needs'])],
      v('suggestion', 'stretch_estimate', [0, 1]),
    ),
  ],
  [
    'Help me think about Saturday.',
    plan('when', [rec(foot), rec(party)], v('follow_up', 'who_goes_where', [0, 1])),
  ],
  ['What time’s the dentist next month?', plan('here_you_go', [abs({ of: 'search' })])],
  [
    'Anything else on Saturday after football?',
    plan('when', [rec(foot), rec(party), abs({ from: SAT, to: SAT, else: true })]),
  ],
  [
    'What’s on tomorrow evening for Sam?',
    plan('when', [rec(board), rec(interviews)], v('consideration', 'leave_early', [0, 1])),
  ],
  ['Kia ora Kev', plan('kia_ora', [])],
  ['Cheers', plan('cheers', [])],
  ['Thanks Kev, that’s helpful.', plan('welcome', [])],
  ['M\u014Drena', plan('morena', [])],
  ['Ka kite', plan('ka_kite', [])],
  ['asdf', plan('unsure', [])],
  [
    'What’s happening Saturday?',
    plan('have_a_look', [rec(foot), rec(party)], v('uncertainty', 'recorded_only', [])),
  ],
  [
    'Can you show me Saturday?',
    plan('good_question', [rec(foot), rec(party)], v('follow_up', 'ask_more', [0, 1])),
  ],
  [
    'Who’s on what this weekend?',
    plan(
      'when',
      [rec(foot, ['people']), rec(party, ['people'])],
      v('consideration', 'check_with_others', [0, 1]),
    ),
  ],
];

/**
 * Leads and views HOME withholds on purpose (owner decisions 6–8), shown
 * with their facts and HOME's lead instead: their cost, made visible.
 * "Heads up — a busy afternoon." and "Sounds like a full one." (owner: kept
 * refused) are not in the catalogue at all.
 */
const WITHHELD: [string, unknown, string][] = [
  ['Any clashes Thursday?', plan('no_worries', [rec(conflict)]), 'reads as a no'],
  ['Is football on Saturday?', plan('righto_when', [rec(foot)]), 'reads as a yes'],
  ['Is Alex free Saturday?', plan('ka_pai', [rec(foot)]), 'availability: reads as a yes'],
  ['What’s on today?', plan('ka_pai', [rec(swim), rec(dentistToday)]), '“here it is”: one record'],
  ['What’s on Saturday?', plan('flagged', [rec(foot)]), 'nothing HOME flagged'],
  [
    'Weather Saturday?',
    plan('here_you_go', [rec(sat)], v('suggestion', 'raincoat', [0])),
    'a raincoat beside a dry forecast',
  ],
  [
    'What’s on this weekend?',
    plan('here_you_go', [rec(foot), rec(lunch)], v('consideration', 'leave_early', [0, 1])),
    'leaving early beside events a day apart',
  ],
  [
    'What’s on this weekend?',
    plan('here_you_go', [rec(foot), rec(lunch)], v('follow_up', 'who_goes_where', [0, 1])),
    'a chat about who goes where beside events on different days',
  ],
];
describe('false rejection: truthful plans', () => {
  it(`all ${TRUTHFUL.length} pass, and render naturally`, () => {
    expect(TRUTHFUL.length).toBeGreaterThanOrEqual(45);
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

  it('the leads and views HOME withholds are withheld; the facts still show, with HOME’s lead', () => {
    for (const [q, raw, why] of WITHHELD) {
      const r = validateAnswer({ raw, ledger: ledger(), now: NOW, timeZone: ZONE, question: q });
      expect(r.ok, `${q} (${why})`).toBe(false);
      const c = r.ok ? [] : codesOf(r.violations);
      expect(
        c.every((x) => x === 'lead.unsupported' || x === 'view.unsupported'),
        why,
      ).toBe(true);
      expect(r.ok ? null : r.salvage?.say).toBe('Here’s what HOME has.');
    }
  });
});
