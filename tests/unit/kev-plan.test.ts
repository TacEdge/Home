import { describe, expect, it } from 'vitest';
import {
  PLAN_FACT_KINDS,
  PLAN_LEAD_IDS,
  PLAN_SCOPE_KINDS,
  PLAN_SHOW_FIELDS,
  PLAN_VIEW_PHRASES,
  PLAN_VIEW_TYPES,
  VALIDATOR_CODES,
  storedPlanSchema,
} from '@/domain/kev-bookkeeping/schema';
import { LEAD_IDS, LEADS, VIEW_PHRASE_IDS, VIEW_PHRASES, VIEW_TYPES } from '@/kev/answer/catalogue';
import { buildFallback, limitsFor } from '@/kev/answer/fallback';
import { FALLBACK_WITH_ROWS } from '@/kev/answer/language';
import { Ledger } from '@/kev/answer/ledger';
import {
  ANSWER_JSON_SCHEMA,
  FACT_KINDS,
  SCOPE_KINDS,
  SHOW_FIELDS,
  parsePlan,
} from '@/kev/answer/schema';
import { codesOf, validateAnswer, type ValidateResult } from '@/kev/answer/validate';
import type { Ref } from '@/kev/tools/types';
import {
  board,
  bundle,
  bundleRefs,
  busy,
  busyLedger,
  conflict,
  dentistToday,
  dentistTue,
  E,
  fence,
  fixtureLedger,
  foot,
  gap,
  interviews,
  kapaHaka,
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
  T,
  teacherOnly,
  withEvent,
  ZONE,
} from './kev-ledger-fixture';

// The answer plan and its checker (M8 contract \u00A78.1–\u00A78.3; owner amendment
// of 2026-10-15, ADR 0012 \u00A746; the V rows as re-mapped). The model selects
// records and writes only fact-free words; HOME renders every fact. Every
// false acceptance in the final review's findings is here, shown to be
// inexpressible (no field carries it) or refused; every unnecessary
// rejection is here as an accepted plan that renders naturally. Fixtures
// are parsed with the tools' own output schemas. A finite suite is not a
// proof of universal correctness. Synthetic only.

const wire = (r: Ref) => ({ type: r.type, id: r.id, at: r.at ?? null });
const rec = (r: Ref, show: string[] = []) => ({ kind: r.type, ref: wire(r), show, scope: null });
type ScopeIn = {
  of?: string;
  from?: string | null;
  to?: string | null;
  people?: string[];
  part?: string | null;
  else?: boolean;
};
const scope = (s: ScopeIn) => ({
  of: 'agenda',
  from: null,
  to: null,
  people: [],
  part: null,
  else: false,
  ...s,
});
const absence = (s: ScopeIn) => ({ kind: 'absence', ref: null, show: [], scope: scope(s) });
const count = (s: ScopeIn) => ({ kind: 'count', ref: null, show: [], scope: scope(s) });
/** A plan: a lead from HOME's catalogue (or, to show it refused, any string), facts and a typed view. */
const plan = (
  lead: string,
  facts: unknown[] = [],
  view: { type: string; phrase: string; about: number[] } | null = null,
) => ({ lead, facts, view, decline: null });
const check = (raw: unknown, l: Ledger = busyLedger(), question?: string): ValidateResult =>
  validateAnswer({
    raw,
    ledger: l,
    now: NOW,
    timeZone: ZONE,
    ...(question ? { question } : {}),
  });
const codes = (r: ValidateResult) => (r.ok ? [] : codesOf(r.violations));
const shownText = (r: ValidateResult) => {
  if (!r.ok || !r.rendered) throw new Error(JSON.stringify(r));
  return [r.rendered.say, ...r.rendered.blocks.map((b) => b.text)];
};
const THU = '2026-10-15';
const SAT = '2026-10-17';
const SUN = '2026-10-18';
const TODAY = '2026-10-14';
const plumber: Ref = { type: 'task', id: T.plumber };

describe('the plan’s schema (V1)', () => {
  it('plain text, wrong shapes, unknown keys and fields a kind does not offer are answer.schema', () => {
    for (const raw of [
      'Just swimming at 3:30.',
      '{"say":{"text":"x","cites":[]},"blocks":[],"decline":null}',
      { ...plan('when'), extra: 1 },
      plan('here_you_go', [{ ...rec(swim), text: 'Swimming at 4' }]),
      plan('here_you_go', [rec(swim, ['estimate'])]),
      plan('here_you_go', [{ ...absence({ from: TODAY, to: TODAY }), ref: wire(swim) }]),
      // The lead and the view are HOME's identifiers: words are not a plan.
      plan('Just swimming at 3:30.', [rec(swim)]),
      plan('Here’s today.', [rec(swim)]),
      plan('when', [rec(swim)], { text: 'Might be worth leaving early.', about: [0] } as never),
      plan('when', [rec(swim)], { type: 'suggestion', phrase: 'leave_early', about: [0] }),
      plan('when', [rec(swim)], { type: 'opinion', phrase: 'raincoat', about: [0] }),
      plan('when', [rec(swim)], { type: 'suggestion', phrase: 'Nice day for it.', about: [0] }),
      plan(
        'Here you go.',
        Array.from({ length: 11 }, () => rec(swim)),
      ),
      { lead: 'when', facts: [], view: null, decline: 'write' },
    ])
      expect(codes(check(raw)), JSON.stringify(raw)).toEqual(['answer.schema']);
  });

  it('a valid plan passes; the flat wire shape and the contract’s both parse', () => {
    expect(check(plan('when', [rec(swim)])).ok).toBe(true);
    expect(parsePlan({ lead: 'here_you_go', facts: [], view: null })).toEqual({
      lead: 'here_you_go',
      facts: [],
      view: null,
    });
    expect(parsePlan({ lead: null, facts: [], view: null, decline: 'write' })).toEqual({
      decline: 'write',
    });
  });

  it('the provider’s schema is static and strict: every object closed, every field required, no record value', () => {
    const strict = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(strict);
      if (typeof n !== 'object' || n === null) return;
      const o = n as Record<string, unknown>;
      if (o.type === 'object') {
        expect(o.additionalProperties).toBe(false);
        expect(Object.keys(o.properties as object).sort()).toEqual(
          [...(o.required as string[])].sort(),
        );
      }
      Object.values(o).forEach(strict);
    };
    strict(ANSWER_JSON_SCHEMA);
    expect(JSON.stringify(ANSWER_JSON_SCHEMA)).not.toMatch(/Swimming|Milo|2026|0000/);
  });

  it('the stored plan’s closed sets are the plan’s (content v2)', () => {
    expect([...PLAN_FACT_KINDS]).toEqual([...FACT_KINDS]);
    expect([...PLAN_SHOW_FIELDS]).toEqual([...SHOW_FIELDS]);
    expect([...PLAN_SCOPE_KINDS]).toEqual([...SCOPE_KINDS]);
    expect([...PLAN_LEAD_IDS]).toEqual([...LEAD_IDS]);
    expect([...PLAN_VIEW_TYPES]).toEqual([...VIEW_TYPES]);
    expect([...PLAN_VIEW_PHRASES]).toEqual([...VIEW_PHRASE_IDS]);
    const r = check(
      plan('when', [rec(swim), absence({ from: TODAY, to: TODAY, else: true })]),
      fixtureLedger([]),
    );
    expect(r.ok && storedPlanSchema.safeParse(r.plan).success).toBe(true);
    expect(VALIDATOR_CODES).not.toContain('time.unsupported');
    // No free text remains, so no prose code does.
    expect(VALIDATOR_CODES.filter((c) => c.startsWith('prose.'))).toEqual([]);
  });
});

describe('records: membership, kind and fields (V2)', () => {
  it('a ref no read returned this attempt is cite.unknown; Swimming from the bundle renders', () => {
    expect(
      codes(
        check(
          plan('here_you_go', [
            rec({ type: 'event', id: E.lunch, at: '2026-10-25T12:30:00+13:00' }),
          ]),
        ),
      ),
    ).toEqual(['cite.unknown']);
    expect(codes(check(plan('here_you_go', [rec({ type: 'task', id: 'not-returned' })])))).toEqual([
      'cite.unknown',
    ]);
    const r = check(plan('when', [rec(swim)]), fixtureLedger([]));
    expect(shownText(r)).toEqual([
      'Here’s today.',
      '“Swimming”: today, 15:30–16:15. Milo attending, Sam responsible.',
    ]);
    expect(r.ok && r.rendered!.cites).toEqual([swim]);
  });

  it('a kind that is not the record’s type is fact.kind; a field it does not carry is fact.field', () => {
    expect(
      codes(check(plan('here_you_go', [{ kind: 'task', ref: wire(swim), show: [], scope: null }]))),
    ).toEqual(['fact.kind']);
    const c = new Ledger(ZONE);
    c.addResult(
      reads.thursdayConflicts.tool,
      reads.thursdayConflicts.data,
      reads.thursdayConflicts.refs,
      reads.thursdayConflicts.input,
    );
    expect(codes(check(plan('here_you_go', [rec(board, ['people'])]), c))).toEqual(['fact.field']);
  });

  it('C7: an earlier turn’s record, not read again this attempt, is cite.unknown', () => {
    expect(codes(check(plan('here_you_go', [rec(foot)]), fixtureLedger([])))).toEqual([
      'cite.unknown',
    ]);
  });
});

describe('absence and counts: scoped, covered, uncontradicted (V4, V5)', () => {
  it('"Nothing else is recorded for today." holds only with every record of today shown', () => {
    const quiet = fixtureLedger([]);
    expect(
      shownText(
        check(plan('when', [rec(swim), absence({ from: TODAY, to: TODAY, else: true })]), quiet),
      ),
    ).toEqual([
      'Here’s today.',
      '“Swimming”: today, 15:30–16:15. Milo attending, Sam responsible.',
      'Nothing else is recorded for today.',
    ]);
    // The busy day: the dentist and the teacher-only day are left out.
    const busyDay = plan('when', [rec(swim), absence({ from: TODAY, to: TODAY, else: true })]);
    expect(codes(check(busyDay))).toEqual(['absence.unsupported']);
    expect(
      check(
        plan('when', [
          rec(dentistToday),
          rec(teacherOnly),
          rec(swim),
          absence({ from: TODAY, to: TODAY, else: true }),
        ]),
      ).ok,
    ).toBe(true);
  });

  it('no bare absence: a scope with no days, or days no read covered, is absence.unsupported', () => {
    const today = fixtureLedger([]);
    expect(codes(check(plan('here_you_go', [absence({})]), today))).toEqual([
      'absence.unsupported',
    ]);
    // "What about Saturday?" when only today is covered.
    expect(codes(check(plan('here_you_go', [absence({ from: SAT, to: SAT })]), today))).toEqual([
      'absence.unsupported',
    ]);
  });

  it('a truncated read covers nothing: "That’s all Isla has next week" cannot be shown', () => {
    const p = plan('when', [
      rec(dentistTue),
      absence({ from: '2026-10-19', to: '2026-10-25', people: [P.isla], else: true }),
    ]);
    expect(codes(check(p))).toEqual(['absence.unsupported']);
  });

  it('people and parts of the day are structural; a person-filtered read covers only its people', () => {
    const l = busyLedger([busy.sundayKids]);
    expect(
      shownText(
        check(plan('here_you_go', [absence({ from: SUN, to: SUN, people: [P.isla, P.milo] })]), l),
      )[1],
    ).toBe('Nothing is recorded for Isla and Milo on Sunday 18 October.');
    // Sam is on Sunday's lunch.
    expect(
      codes(check(plan('here_you_go', [absence({ from: SUN, to: SUN, people: [P.sam] })]), l)),
    ).toEqual(['absence.unsupported']);
    // Alex on Thursday evening (\u00A73.2 row 1): Thursday's read is unfiltered and Alex is on nothing.
    expect(
      shownText(
        check(
          plan('here_you_go', [absence({ from: THU, to: THU, people: [P.alex], part: 'evening' })]),
        ),
      )[1],
    ).toBe('Nothing is recorded for Alex tomorrow, in the evening.');
    // Sam is on the board meeting, Thursday evening.
    expect(
      codes(
        check(
          plan('here_you_go', [absence({ from: THU, to: THU, people: [P.sam], part: 'evening' })]),
        ),
      ),
    ).toEqual(['absence.unsupported']);
    // Morning only: kapa haka (16:00) and the board meeting are not in it.
    expect(
      shownText(check(plan('here_you_go', [absence({ from: THU, to: THU, part: 'morning' })])))[1],
    ).toBe('Nothing is recorded for tomorrow, in the morning.');
  });

  it('overlaps, the forecast and a search, each by its own read', () => {
    expect(
      shownText(
        check(
          plan('here_you_go', [absence({ of: 'conflicts', from: '2026-10-19', to: '2026-10-25' })]),
        ),
      )[1],
    ).toBe('HOME hasn’t marked any overlaps for next week.');
    // An agenda read is never overlap coverage, and an overlap read never agenda coverage.
    expect(
      codes(check(plan('here_you_go', [absence({ of: 'conflicts', from: SAT, to: SAT })]))),
    ).toEqual(['absence.unsupported']);
    expect(
      codes(check(plan('here_you_go', [absence({ from: '2026-10-19', to: '2026-10-25' })]))),
    ).toEqual(['absence.unsupported']);
    const w = busyLedger([more.weather24, more.searchDentist]);
    expect(
      shownText(
        check(
          plan('here_you_go', [absence({ of: 'forecast', from: '2026-10-24', to: '2026-10-24' })]),
          w,
        ),
      )[1],
    ).toBe('HOME doesn’t have a forecast for Saturday 24 October yet.');
    expect(
      codes(check(plan('here_you_go', [absence({ of: 'forecast', from: SAT, to: SAT })]), w)),
    ).toEqual(['absence.unsupported']);
    expect(shownText(check(plan('here_you_go', [absence({ of: 'search' })]), w))[1]).toBe(
      'Nothing you can see in HOME has a matching title.',
    );
    const none = busyLedger([more.weatherNone]);
    expect(
      shownText(
        check(
          plan('here_you_go', [absence({ of: 'forecast', from: SAT, to: SAT })]),
          fixtureLedger([more.weatherNone]),
        ),
      )[1],
    ).toBe('HOME doesn’t have a forecast set up.');
    void none;
    // A search that found something: an absence needs `else` with every result shown.
    const f = busyLedger([more.searchFence]);
    expect(codes(check(plan('here_you_go', [absence({ of: 'search' })]), f))).toEqual([
      'absence.unsupported',
    ]);
  });

  it('counts are computed by code from complete reads ("There are 3 things on this week" cannot be written)', () => {
    expect(shownText(check(plan('here_you_go', [count({ from: TODAY, to: TODAY })])))[1]).toBe(
      'Three events are recorded for today.',
    );
    expect(
      shownText(
        check(plan('here_you_go', [count({ from: TODAY, to: TODAY, people: [P.milo] })])),
      )[1],
    ).toBe('Two events are recorded for Milo today.');
    expect(shownText(check(plan('here_you_go', [count({ from: SAT, to: SAT })])))[1]).toBe(
      'Two events are recorded for Saturday 17 October.',
    );
    // This week: Thursday and Friday were never read.
    expect(codes(check(plan('here_you_go', [count({ from: TODAY, to: SUN })])))).toEqual([
      'absence.unsupported',
    ]);
    expect(
      shownText(check(plan('here_you_go', [count({ of: 'conflicts', from: THU, to: THU })])))[1],
    ).toBe('HOME has marked one overlap for tomorrow.');
  });
});

describe('the final review’s false acceptances: impossible or refused', () => {
  // Each was accepted as fact by the free-prose checker. In the lead or the
  // view (the only text the model writes) each is refused; and no field of
  // the plan can carry it.
  const PROSE: [string, string][] = [
    ['Just swimming at 3:30 today.', 'prose.claim'],
    ['Just swimming at 3:30 with Milo, and you’re marked responsible.', 'prose.person'],
    ['Swimming is the only event today.', 'prose.claim'],
    ['Swimming at 3:30 is all there is today.', 'prose.claim'],
    ['Swimming at 3:30 and that’s it.', 'prose.claim'],
    ['There are no other commitments today.', 'prose.claim'],
    ['That’s everything for today.', 'prose.claim'],
    ['No other events today.', 'prose.claim'],
    ['Nothing else today.', 'prose.claim'],
    ['That’s all for today.', 'prose.claim'],
    ['Only football on Saturday.', 'prose.claim'],
    ['Saturday is just football at 9.', 'prose.claim'],
    ['That’s everything for Saturday: football at 9.', 'prose.claim'],
    ['Football at 9 is all that’s on Saturday.', 'prose.claim'],
    ['That’s all Isla has next week.', 'prose.claim'],
    ['Isla’s only appointment next week is the dentist.', 'prose.claim'],
    ['Milo only has football this weekend.', 'prose.claim'],
    ['Milo doesn’t have swimming today.', 'prose.claim'],
    ['Football on Saturday is cancelled.', 'prose.claim'],
    ['Football is cancelled on Saturday.', 'prose.claim'],
    ['Swimming has been moved.', 'prose.claim'],
    ['Nothing is recorded.', 'prose.claim'],
    ['Nothing else is recorded for Saturday, you and Milo both at home.', 'availability.claim'],
    ['Nothing is recorded for Saturday for you and Milo, all day at home.', 'availability.claim'],
    ['Isla has swimming at 3:30pm today.', 'prose.person'],
    ['Isla has football on Saturday at 9am.', 'prose.person'],
    ['Sam has football on Saturday at 9am.', 'prose.person'],
    ['Nana Jo is coming to swimming at 3:30pm today.', 'prose.person'],
    ['Isla is on it too.', 'prose.person'],
    ['You have football on Saturday at 9am.', 'prose.record'],
    ['She also has swimming at 3:30pm today.', 'prose.person'],
    ['Milo is in charge of swimming at 3:30pm.', 'prose.person'],
    ['She’ll be picking him up afterwards.', 'prose.person'],
    ['Saturday’s high is 14 and Sunday’s high is 17.', 'prose.number'],
    ['Gusts up to 30 on Sunday.', 'prose.record'],
    ['Saturday gets to 14 degrees.', 'prose.number'],
    ['Showers are possible on Saturday.', 'prose.record'],
    ['Saturday looks showery, Sunday dry.', 'prose.record'],
    ['Isla has an appointment at 3:30pm.', 'prose.person'],
    ['Milo’s appointment is on Tuesday.', 'prose.person'],
    ['Milo has something on Tuesday at 9am.', 'prose.person'],
    ['Swimming is at 9am, the dentist at 3:30pm.', 'prose.record'],
    ['Swimming is at 9am with the dentist at 3:30pm.', 'prose.record'],
    ['Parent interviews are at 5:30pm.', 'prose.record'],
    ['The board meeting starts at 6pm.', 'prose.record'],
    ['Sam and Milo have the board meeting on Thursday.', 'prose.person'],
    ['Swimming starts at 4:15pm today.', 'prose.record'],
    ['Swimming finishes at 3:30pm today.', 'prose.record'],
    ['There are 3 things on this week.', 'prose.number'],
    ['Milo has 2 events today.', 'prose.number'],
    ['Two things on today: swimming at 3:30.', 'prose.number'],
    ['Sam painted the back fence.', 'prose.person'],
    ['The back fence is painted.', 'prose.record'],
    ['It’s painted now.', 'prose.record'],
    ['Sam has done the back fence.', 'prose.claim'],
    ['The back fence task is complete.', 'prose.claim'],
    ['Sunday looks dry.', 'prose.time'],
    ['Football on Saturday at 9am will be windy.', 'prose.record'],
    ['Football is at 9am on Saturday and it will be dry.', 'prose.record'],
    ['Milo has the dentist at 3:30pm today.', 'prose.person'],
    ['Milo has a haircut on Saturday at 9am.', 'prose.person'],
    ['It’s a haircut.', 'prose.record'],
    ['Swimming at 3:30pm is indoors.', 'prose.record'],
    ['It starts at midnight.', 'prose.time'],
    ['It runs from 12am.', 'prose.number'],
    ['It’s on Friday morning.', 'prose.time'],
    ['Alex is ‘free’ on Saturday at 11.', 'availability.claim'],
    ["Alex is 'free' on Saturday at 11.", 'availability.claim'],
    ['Alex is -free- on Saturday at 11.', 'availability.claim'],
    ['Alex is ‘around’ on Saturday.', 'availability.claim'],
    ['I’ve ‘booked’ football on Saturday at 9.', 'authority.claim'],
    ['I’ve ‘added’ football to your calendar on Saturday at 9.', 'authority.claim'],
    ['Alex is fr\u034Fee.', 'text.unsafe'],
    ['Alex is fr\uFE0Fee.', 'text.unsafe'],
    ['Alex is fre\u0336e.', 'text.unsafe'],
    ['Alex is \uA730\u0280\u1D07\u1D07.', 'text.unsafe'],
    ['Alex is \u0251vailable.', 'text.unsafe'],
    ['Swimming is at \u0664:\u0663\u0660 today.', 'text.unsafe'],
    ['Football on Saturday at \u0967\u0966.', 'text.unsafe'],
    ['Grandad collects Alex on Saturday at 11.', 'prose.person'],
    ['That one’s off.', 'availability.claim'],
    ['They overlap.', 'conflict.unsupported'],
    ['I’ll remind you.', 'authority.claim'],
    ['See https://example.test/claim.', 'markup'],
    ['Great question!', 'tone.filler'],
    // The final structured-answer review's paraphrases, every one accepted as
    // the model's own words at 8f9ecd9 (findings, "Prose").
    ['Looks like it.', 'final review'],
    ['Seems so.', 'final review'],
    ['Afraid so.', 'final review'],
    ['I think so.', 'final review'],
    ['Already taken care of.', 'final review'],
    ['Correct.', 'final review'],
    ["You're good.", 'final review'],
    ['Unlikely.', 'final review'],
    ['I doubt it.', 'final review'],
    ['Hardly.', 'final review'],
    ['Spot on.', 'final review'],
    ['Indeed.', 'final review'],
    ["That's right.", 'final review'],
    ['Bang on.', 'final review'],
    ['Yep.', 'final review'],
    ['Yep, here it is.', 'final review'],
    ['Yes.', 'final review'],
    ['Sure, here it is.', 'final review'],
    ['Sure.', 'final review'],
    ['Of course.', 'final review'],
    ['Righto.', 'final review'],
    ['Sure thing.', 'final review'],
    ['Already handled.', 'final review'],
    ["That's been dealt with.", 'final review'],
    ['Scratch that one.', 'final review'],
    ['That one fell through.', 'final review'],
    ['Pushed back, by the look of it.', 'final review'],
    ["That one's been ditched.", 'final review'],
    ['Wrapped up already.', 'final review'],
    ['Still on.', 'final review'],
    ['Yep, still on.', 'final review'],
    ['It is happening.', 'final review'],
    ['Too late for that.', 'final review'],
    ['Good news.', 'final review'],
    ['Bad news, sorry.', 'final review'],
    ['Looks good today.', 'final review'],
    ['Busier than usual.', 'final review'],
    ['Quieter than usual.', 'final review'],
    ['Fuller than usual.', 'final review'],
    ['Calmer than usual.', 'final review'],
    ['Easier than usual.', 'final review'],
    ['Lighter than usual.', 'final review'],
    ['Bit hectic.', 'final review'],
    ['Looks hectic.', 'final review'],
    ['Looks chocka.', 'final review'],
    ['Swamped, by the look of it.', 'final review'],
    ['Bit of a crunch.', 'final review'],
    ['Looks pretty relaxed.', 'final review'],
    ['Pretty low-key.', 'final review'],
    ["You've got room to breathe.", 'final review'],
    ['Loads of space there.', 'final review'],
    ['Good to go after that.', 'final review'],
    ['Smooth sailing after that.', 'final review'],
    ["You're good after that.", 'final review'],
    ['That leaves the rest unbooked.', 'final review'],
    ['You cannot make it.', 'final review'],
    ['Unable to make it.', 'final review'],
    ['Heads up — a busy afternoon.', 'final review'],
    ['Sounds like a full one.', 'final review'],
    ['Looks settled.', 'final review'],
    ['Looks fair.', 'final review'],
    ['Picnic weather, by the look of it.', 'final review'],
    ['Beach weather.', 'final review'],
    ['Sunscreen weather.', 'final review'],
    ['Looks gorgeous.', 'final review'],
    ['Looks like a scorcher.', 'final review'],
    ['Bit breezy.', 'final review'],
    ['Bit nippy.', 'final review'],
    ['Brolly weather.', 'final review'],
    ['Pack a jacket.', 'final review'],
    ['Grab sunscreen.', 'final review'],
    ['Looks soggy.', 'final review'],
    ['Bit damp.', 'final review'],
    ['Bucketing down.', 'final review'],
    ["You're on this one.", 'final review'],
    ["This one's on you.", 'final review'],
    ['Yours, by the look of it.', 'final review'],
    ['Your turn for this one.', 'final review'],
    ["You're running this one.", 'final review'],
    ["You've got this one.", 'final review'],
    ["Looks like you're covering it.", 'final review'],
    ['Your eldest is on it.', 'final review'],
    ['The youngest has it.', 'final review'],
    ["The wee one's on it.", 'final review'],
    ["The little one's on it.", 'final review'],
    ["The lad's on it.", 'final review'],
    ['Those collide.', 'final review'],
    ['Those coincide.', 'final review'],
    ['Tight squeeze between those.', 'final review'],
    ['Back-to-back, those.', 'final review'],
    ['Bit of a squeeze.', 'final review'],
    ['That about covers it.', 'final review'],
    ["And that's that.", 'final review'],
    ['Cov\u0113red.', 'final review'],
    ['P\u0113rfect for it.', 'final review'],
    ['Fr-ee.', 'final review'],
    ['f r e e.', 'final review'],
    ['The seventeenth.', 'final review'],
    ['Crack of dawn.', 'final review'],
    ['Before brekkie.', 'final review'],
    ['At bedtime.', 'final review'],
    ['Bright and early.', 'final review'],
    ['All good.', 'final review'],
    ['Any time.', 'final review'],
  ];
  /** Every sentence HOME's catalogue can produce, with `{when}` filled every way the fixture can. */
  const EXPRESSIBLE = [
    ...LEAD_IDS.flatMap((l) =>
      ['today', 'tomorrow', 'this weekend', 'Saturday 17 October', 'next week'].map((w) =>
        LEADS[l].text.replace('{when}', w).toLowerCase(),
      ),
    ),
    ...VIEW_PHRASE_IDS.map((p) => VIEW_PHRASES[p].text.toLowerCase()),
  ];

  it.each(PROSE)('inexpressible: %s (once %s)', (sentence) => {
    // The lead and the view are identifiers: the sentence, as either, is not a plan.
    expect(codes(check(plan(sentence, [rec(swim)]))), sentence).toEqual(['answer.schema']);
    expect(
      codes(check(plan('when', [rec(swim)], { text: sentence, about: [0] } as never))),
      sentence,
    ).toEqual(['answer.schema']);
    // And no lead or phrase HOME owns is it.
    expect(EXPRESSIBLE, sentence).not.toContain(sentence.toLowerCase());
  });

  it('the plan has no field for a status, an exclusivity, a person on a record or a figure', () => {
    // A record block carries only kind, ref and show; any other key is answer.schema.
    for (const extra of [
      { status: 'cancelled' },
      { people: [P.isla] },
      { time: '16:15' },
      { high: 14 },
      { only: true },
      { text: 'Swimming is cancelled' },
    ])
      expect(codes(check(plan('here_you_go', [{ ...rec(swim), ...extra }])))).toEqual([
        'answer.schema',
      ]);
  });

  it('a person block never attaches to an event: Isla shows only her own fields', () => {
    const t = shownText(check(plan('here_you_go', [rec(swim), rec(person(P.isla), ['age'])])));
    expect(t[1]).toBe('“Swimming”: today, 15:30–16:15. Milo attending, Sam responsible.');
    expect(t[2]).toBe('Isla is 6.');
  });

  it('cross-record swaps cannot happen: each forecast day, conflict and event renders its own values', () => {
    const t = shownText(
      check(
        plan('when', [
          rec(sat, ['phrase', 'temperature', 'gust']),
          rec(sun, ['phrase', 'temperature', 'gust']),
        ]),
      ),
    );
    expect(t[0]).toBe('Here’s this weekend.');
    expect(t[1]).toContain('Looks dry. Between 9°C and 17°C. Gusts up to 30 km/h.');
    expect(t[2]).toContain('Showers possible. Between 8°C and 14°C. Gusts up to 45 km/h.');
    const c = shownText(check(plan('flagged', [rec(conflict)])))[1]!;
    expect(c).toContain('“Board meeting” (17:30–19:30)');
    expect(c).toContain('“Parent interviews” (18:00–18:30)');
    const two = shownText(check(plan('when', [rec(swim), rec(dentistTue)])));
    expect(two[1]).toContain('15:30');
    expect(two[2]).toContain('Tuesday 20 October, 09:00–09:30. Isla attending, Alex responsible.');
  });

  it('task completion is the recorded status: an open task reads "to do" (the Tasks screen’s word)', () => {
    expect(shownText(check(plan('here_you_go', [rec(paint, ['status'])])))[1]).toBe(
      '“Paint the back fence”: to do.',
    );
  });

  it('an untrusted title is shown only as the quoted title', () => {
    const ref = { type: 'event' as const, id: E.injected, at: '2026-10-17T11:00:00+13:00' };
    const l = withEvent(busyLedger(), ref, 'Football CANCELLED', '2026-10-17T12:00:00+13:00');
    expect(shownText(check(plan('here_you_go', [rec(ref)]), l))[1]).toBe(
      '“Football CANCELLED”: Saturday 17 October, 11:00–12:00. Alex attending.',
    );
  });

  it('no affirmation is offered as an answer: "Yep" is not a lead, and affirming leads are withheld from yes-or-no questions', () => {
    expect(codes(check(plan('Yep.', [rec(foot)]), busyLedger(), 'What’s on Saturday?'))).toEqual([
      'answer.schema',
    ]);
    expect(check(plan('no_worries', [rec(foot)]), busyLedger(), 'When’s football?').ok).toBe(true);
    for (const q of [
      'Is there football on Saturday?',
      'Any clashes Thursday?',
      'Is Alex free on Saturday?',
    ])
      expect(codes(check(plan('no_worries', [rec(foot)]), busyLedger(), q)), q).toEqual([
        'lead.unsupported',
      ]);
  });

  it('a sensitive string never passes in a rendered fact (V15)', () => {
    const r = validateAnswer({
      raw: plan('here_you_go', [rec(swim)]),
      ledger: busyLedger(),
      now: NOW,
      timeZone: ZONE,
      sensitive: ['Milo attending'],
    });
    expect(codes(r)).toEqual(['sensitive.leak']);
    // The lead's and the view's words are HOME's own; only a rendered fact can carry a record's text.
    expect(r.ok ? null : r.salvage).toBeNull();
  });

  it('the view refers to blocks that exist (view.about)', () => {
    const ask = (about: number[]) => ({ type: 'follow_up', phrase: 'ask_more', about });
    expect(codes(check(plan('here_you_go', [rec(swim)], ask([3]))))).toEqual(['view.about']);
    expect(codes(check(plan('here_you_go', [rec(swim)], ask([0, 0]))))).toEqual(['view.about']);
    expect(check(plan('here_you_go', [rec(swim)], ask([0]))).ok).toBe(true);
  });
});

describe('the final review’s unnecessary rejections, and \u00A73.1–\u00A73.3: accepted, rendered naturally', () => {
  const l = busyLedger([
    more.project,
    more.alexTasks,
    more.searchDentist,
    more.insights,
    busy.sundayKids,
    more.weather24,
  ]);
  const cases: [string, unknown, string[], string?][] = [
    [
      'Might be worth leaving early. (Kev’s view beside Thursday’s overlap)',
      plan('flagged', [rec(conflict)], {
        type: 'consideration',
        phrase: 'leave_early',
        about: [0],
      }),
      [
        'Here’s what HOME flagged.',
        'Tomorrow: Sam is attending “Board meeting” (17:30–19:30) and attending “Parent interviews” (18:00–18:30). They overlap from 18:00 to 18:30.',
        'Might be worth leaving early.',
      ],
      'Why did HOME flag Thursday?',
    ],
    [
      'Good question. (\u00A73.1 row 6 as a plan)',
      plan('good_question', [rec(conflict)]),
      ['Good question.'],
      'Why did HOME flag this overlap?',
    ],
    [
      'Ka pai, here it is.',
      plan('ka_pai', [rec(foot)]),
      ['Ka pai, here it is.', '“Football”: Saturday 17 October, 09:00–10:00. Milo attending.'],
      'When’s football?',
    ],
    [
      'Righto, here’s the weekend.',
      plan('righto_when', [rec(foot), rec(party), rec(lunch)]),
      [
        'Righto, here’s this weekend.',
        '“Football”: Saturday 17 October, 09:00–10:00. Milo attending.',
        '“Birthday party”: Saturday 17 October, 14:00–16:00. Isla attending, Milo attending, Alex responsible.',
        '“Lunch at Nana Jo’s”: Sunday 18 October, 12:30–14:00. Sam attending, Alex attending.',
      ],
      'What’s on this weekend?',
    ],
    [
      'Plenty on Saturday: … (else, everything shown)',
      plan('when', [rec(foot), rec(party), absence({ from: SAT, to: SAT, else: true })]),
      ['Here’s Saturday 17 October.'],
    ],
    [
      'Due tomorrow: Call the plumber, for Alex.',
      plan('here_you_go', [rec(plumber, ['due', 'assignee'])]),
      ['Here you go.', '“Call the plumber”: due tomorrow, assigned to Alex.'],
    ],
    [
      'On Sunday there’s lunch at Nana Jo’s at 12:30. (a name inside a title)',
      plan('when', [rec(lunch, [])]),
      ['Here’s Sunday 18 October.'],
    ],
    [
      'Isla and Milo have nothing recorded on Sunday.',
      plan('here_you_go', [absence({ from: SUN, to: SUN, people: [P.isla, P.milo] })]),
      ['Here you go.', 'Nothing is recorded for Isla and Milo on Sunday 18 October.'],
    ],
    [
      'Nothing else is recorded for Saturday after football …',
      plan('when', [rec(foot), rec(party), absence({ from: SAT, to: SAT, else: true })]),
      ['Here’s Saturday 17 October.'],
    ],
    [
      '\u00A73.2 row 1: nothing is recorded for Alex on Thursday evening',
      plan('here_you_go', [absence({ from: THU, to: THU, people: [P.alex], part: 'evening' })]),
      ['Here you go.', 'Nothing is recorded for Alex tomorrow, in the evening.'],
      'Is Alex free on Thursday night?',
    ],
    [
      '\u00A73.3: HOME hasn’t marked anything for next week.',
      plan('here_you_go', [absence({ of: 'conflicts', from: '2026-10-19', to: '2026-10-25' })]),
      ['Here you go.', 'HOME hasn’t marked any overlaps for next week.'],
      'Any clashes next week?',
    ],
    [
      'Back fence is due by 1 November.',
      plan('here_you_go', [rec(paint, ['due'])]),
      ['Here you go.', '“Paint the back fence”: due Sunday 1 November.'],
    ],
    [
      '\u00A73.1 row 1: today, with nothing else (the quiet day)',
      plan('when', [
        rec(dentistToday),
        rec(teacherOnly),
        rec(swim),
        absence({ from: TODAY, to: TODAY, else: true }),
      ]),
      [
        'Here’s today.',
        '“Dentist”: today, 10:00–10:30. Isla attending.',
        '“Teacher-only day”: today, all day. Milo attending.',
        '“Swimming”: today, 15:30–16:15. Milo attending, Sam responsible.',
        'Nothing else is recorded for today.',
      ],
      'What’s happening today?',
    ],
    [
      '\u00A73.1 row 5: beyond the forecast',
      plan('here_you_go', [absence({ of: 'forecast', from: '2026-10-24', to: '2026-10-24' })]),
      ['Here you go.', 'HOME doesn’t have a forecast for Saturday 24 October yet.'],
    ],
    [
      '\u00A73.1 row 7: thinking through the weekend, with Kev’s view',
      plan('when', [rec(gap, ['neighbours', 'forecast']), rec(paint, ['estimate', 'needs'])], {
        type: 'suggestion',
        phrase: 'stretch_estimate',
        about: [0, 1],
      }),
      [
        'Here’s Saturday 17 October.',
        'Nothing is recorded for the household on Saturday 17 October, 10:00–19:30. That’s after “Football”. The forecast for then: looks dry.',
        '“Paint the back fence”: about three hours, in dry weather and daylight.',
        'That stretch is at least as long as the task’s estimate.',
      ],
      'Help me think through our weekend.',
    ],
    [
      'fabrication: what time’s the dentist? (search found nothing)',
      plan('here_you_go', [absence({ of: 'search' })]),
      ['Here you go.', 'Nothing you can see in HOME has a matching title.'],
      'What time’s the dentist?',
    ],
    [
      'No worries. (beside a record, for a question that is not yes-or-no)',
      plan('no_worries', [rec(foot)]),
      ['No worries.', '“Football”: Saturday 17 October, 09:00–10:00. Milo attending.'],
      'When’s football?',
    ],
  ];

  it.each(cases)('%s', (name, raw, starts, question) => {
    // Alex's task due Thursday is Alex's: §3.2's Thursday evening is asked without it.
    const r = check(raw, name.startsWith('§3.2') ? busyLedger() : l, question);
    expect(codes(r), JSON.stringify(r.ok ? null : r.violations)).toEqual([]);
    const t = shownText(r);
    starts.forEach((s, i) => expect(t[i]).toBe(s));
  });
});

describe('the code’s sentences and the fallback (V16, V18)', () => {
  it('limits follow what is rendered: a stale calendar qualifies events, conflicts, gaps, insights and agenda absences', () => {
    const stale = { calendarsUnhealthy: true, noCalendars: false, gapsUnknown: false };
    const shown = (types: string[], summaries: string[] = []) =>
      ({
        types: new Set(types),
        summaries: new Set(summaries),
        gapsPartial: false,
      }) as Parameters<typeof limitsFor>[0];
    expect(limitsFor(shown(['conflict']), stale)).toEqual(['calendar_stale']);
    expect(limitsFor(shown(['insight']), stale)).toEqual(['calendar_stale']);
    expect(limitsFor(shown(['gap']), stale)).toEqual(['gap_limit', 'calendar_stale']);
    expect(limitsFor(shown([], ['agenda']), stale)).toEqual(['calendar_stale']);
    expect(limitsFor(shown(['forecast']), stale)).toEqual(['forecast_credit']);
    expect(limitsFor(shown(['task']), stale)).toEqual([]);
    expect(
      limitsFor(shown(['event'], ['agenda']), {
        calendarsUnhealthy: false,
        noCalendars: true,
        gapsUnknown: false,
      }),
    ).toEqual(['coverage_unknown']);
    expect(
      limitsFor(
        { types: new Set(['gap']), summaries: new Set(), gapsPartial: true },
        { calendarsUnhealthy: false, noCalendars: false, gapsUnknown: false },
      ),
    ).toEqual(['gap_limit', 'calendar_stale']);
  });

  it('the fallback renders the attempt’s rows by the same renderer; the bundle’s today when no tool ran', () => {
    const l = new Ledger(ZONE);
    l.addBundle(bundle, bundleRefs);
    l.addResult(
      reads.weekendAgenda.tool,
      reads.weekendAgenda.data,
      reads.weekendAgenda.refs,
      reads.weekendAgenda.input,
    );
    const f = buildFallback(l, NOW);
    expect(f.say).toBe(FALLBACK_WITH_ROWS);
    expect(f.blocks.map((b) => b.text)).toEqual([
      '“Football”: Saturday 17 October, 09:00–10:00. Milo attending.',
    ]);
    expect(f.cites).toEqual([foot]);
    const quiet = new Ledger(ZONE);
    quiet.addBundle(bundle, bundleRefs);
    expect(buildFallback(quiet, NOW).cites).toEqual([swim]);
  });

  it('kapa haka is Thursday’s and stays Thursday’s', () => {
    expect(shownText(check(plan('here_you_go', [rec(kapaHaka)])))[1]).toBe(
      '“Kapa haka”: tomorrow, 16:00–17:00. Milo attending.',
    );
    void interviews;
    void fence;
  });
});
