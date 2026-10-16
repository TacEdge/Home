import { describe, expect, it } from 'vitest';
import { classifyMessage } from '@/kev/answer/catalogue';
import { buildFallback, limitsFor, type Coverage } from '@/kev/answer/fallback';
import { Ledger } from '@/kev/answer/ledger';
import {
  codesOf,
  validateAnswer,
  type RenderedAnswer,
  type ValidateResult,
} from '@/kev/answer/validate';
import { getAgenda } from '@/kev/tools/get-agenda';
import { getGaps } from '@/kev/tools/get-gaps';
import { getInsights } from '@/kev/tools/get-insights';
import { getWeather } from '@/kev/tools/get-weather';
import type { Ref } from '@/kev/tools/types';
import { search } from '@/kev/tools/search';
import {
  bundle,
  bundleRefs,
  busyLedger,
  dentistToday,
  foot,
  gap,
  more,
  NOW,
  P,
  paint,
  party,
  reads,
  sat,
  sun,
  swim,
  u,
  ZONE,
} from './kev-ledger-fixture';

// The final answer-integrity review of PR #86 (6d2413b), every blocker and
// important finding as a regression (owner decisions of 2026-10-15, ADR
// 0012 §47). Every fixture parses through the tools' own output schemas or
// `bundleSchema`: schema-valid evidence only. Synthetic only. NOW is
// Wednesday 14 October 2026, 07:03, Pacific/Auckland; the reader is Sam.

const wire = (r: Ref) => ({ type: r.type, id: r.id, at: r.at ?? null });
const rec = (r: Ref, show: string[] = []) => ({ kind: r.type, ref: wire(r), show, scope: null });
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
const AFFIRMING = ['righto_when', 'ka_pai', 'no_worries'] as const;
const FOOTBALL = '“Football”: Saturday 17 October, 09:00–10:00. Milo attending.';

describe('B1/B4: reassuring leads, deny by default (owner decision, Part 1)', () => {
  const l = () => busyLedger();
  // Yes-or-no, availability, status, condition, action and unplaceable forms.
  const WITHHELD = [
    'we good for Thursday',
    'Cancel swimming today',
    'Pay the swimming invoice',
    'plumber sorted',
    'football still happening',
    'fence painted yet',
    'I need to know whether football’s on',
    'let me know if Sam’s got anything Thursday',
    'Kei te wātea a Alex āpōpō',
    'Book football',
    'Book football for Saturday',
    'Add Milo to football on Saturday.',
    'Text Alex',
    'Text Alex football is on',
    'Tell Alex football is on',
    'Move football to 10 on Saturday',
    'Swap football with Alex this Saturday please',
    'Delete the dentist',
    'What’s on at the same time as football?',
    'Is Alex free on Thursday night?',
    'Any clashes Thursday?',
    'Football Saturday?',
    'and Sunday?',
    'Saturday',
    'Why is football cancelled?',
    'Can you tell me when football is?',
  ];

  it.each(WITHHELD)('"%s": no affirming lead; the facts are kept (salvage)', (q) => {
    expect(classifyMessage(q).informational).toBe(false);
    for (const lead of AFFIRMING) {
      const r = check(plan(lead, [rec(foot)]), l(), q);
      expect(codes(r), `${q} ${lead}`).toEqual(['lead.unsupported']);
      expect(r.ok ? null : r.salvage?.say, `${q} ${lead}`).toBe('Here’s what HOME has.');
      expect(r.ok ? null : r.salvage?.blocks.map((b) => b.text), `${q} ${lead}`).toEqual([
        FOOTBALL,
      ]);
    }
    // A neutral lead stays usable: the record speaks.
    expect(texts(check(plan('here_you_go', [rec(foot)]), l(), q))).toEqual([
      'Here you go.',
      FOOTBALL,
    ]);
  });

  it('kept: "What’s on this weekend?" with "Righto, here’s {when}." (V21), "When’s football?" with "No worries."', () => {
    expect(
      texts(check(plan('righto_when', [rec(foot), rec(party)]), l(), 'What’s on this weekend?'))[0],
    ).toBe('Righto, here’s Saturday 17 October.');
    expect(texts(check(plan('no_worries', [rec(foot)]), l(), 'When’s football?'))).toEqual([
      'No worries.',
      FOOTBALL,
    ]);
    expect(texts(check(plan('ka_pai', [rec(swim)]), l(), 'When is swimming?'))[0]).toBe(
      'Ka pai, here it is.',
    );
  });

  it.each([
    'What’s on this weekend?',
    'When is swimming?',
    'Who is attending?',
    'What’s happening today?',
    'How many things on Saturday?',
    'Show my tasks.',
    'List tomorrow’s commitments.',
    'Tell me when swimming is',
    'Thanks Kev, what’s on tomorrow?',
  ])('"%s" is clearly informational', (q) => {
    expect(classifyMessage(q).informational).toBe(true);
  });

  it('a message HOME was not given gets no affirming lead', () => {
    expect(codes(check(plan('righto_when', [rec(foot)]), l()))).toEqual(['lead.unsupported']);
  });
});

describe('B1/I1: social replies, strict (owner decision, Part 2)', () => {
  const l = () => busyLedger();
  it.each([
    ['Thanks Kev', 'welcome', 'You’re welcome.'],
    ['thanks heaps!', 'welcome', 'You’re welcome.'],
    ['cheers mate', 'cheers', 'Cheers.'],
    ['ta', 'welcome', 'You’re welcome.'],
    ['ka kite', 'ka_kite', 'Ka kite.'],
    ['👍', 'cheers', 'Cheers.'],
    ['Mōrena Kev', 'morena', 'Mōrena.'],
  ])('"%s" → %s', (q, lead, said) => {
    expect(texts(check(plan(lead, []), l(), q))).toEqual([said]);
  });

  it.each([
    'Thanks Kev, what’s on tomorrow?',
    'alex free saturday',
    'Saturday',
    'I need to know whether football’s on',
    'Pay the swimming invoice',
    'Cancel swimming today',
    'Delete the dentist',
    'Text Alex football is on',
    'ok?',
  ])('"%s": no social reply, and no salvage', (q) => {
    expect(classifyMessage(q).social).toBe(false);
    for (const lead of ['welcome', 'kia_ora', 'morena', 'ka_kite', 'cheers']) {
      const r = check(plan(lead, []), l(), q);
      expect(codes(r), `${q} ${lead}`).toEqual(['lead.unsupported']);
      expect(r.ok ? 'ok' : r.salvage, `${q} ${lead}`).toBeNull();
    }
  });

  it('a social lead never stands beside facts, even after thanks', () => {
    expect(codes(check(plan('welcome', [rec(paint)]), l(), 'Thanks Kev'))).toEqual([
      'lead.unsupported',
    ]);
  });

  it('a message HOME was not given gets no social reply', () => {
    expect(codes(check(plan('welcome', []), l()))).toEqual(['lead.unsupported']);
  });

  it('the social list is checked against "more" reads too: no social reply beside a view', () => {
    expect(
      codes(
        check(
          plan('cheers', [], { type: 'uncertainty', phrase: 'recorded_only', about: [] }),
          busyLedger([more.insights]),
          'cheers',
        ),
      ),
    ).toContain('lead.unsupported');
  });
});

describe('B5: a search that finds nothing makes no claim (owner decision, Part 6)', () => {
  /** The busy bundle (Dentist today, 10:00), then a complete search that found nothing. */
  const l = () => {
    const ledger = busyLedger();
    ledger.addResult(
      'search',
      search.output.parse({ results: [], returned: 0, truncated: false }),
      [],
      { query: 'dentist appointment' },
    );
    return ledger;
  };
  const searchAbsence = (extra: Record<string, unknown> = {}) => ({
    kind: 'absence',
    ref: null,
    show: [],
    scope: { of: 'search', from: null, to: null, people: [], part: null, else: false, ...extra },
  });

  it('a search absence is unrepresentable: alone, beside the dentist, or with `else`', () => {
    expect(
      codes(check(plan('here_you_go', [searchAbsence()]), l(), 'What time’s the dentist?')),
    ).toEqual(['answer.schema']);
    expect(
      codes(
        check(
          plan('here_you_go', [rec(dentistToday), searchAbsence()]),
          l(),
          'What time’s the dentist?',
        ),
      ),
    ).toEqual(['answer.schema']);
    expect(
      codes(check(plan('here_you_go', [rec(dentistToday), searchAbsence({ else: true })]), l())),
    ).toEqual(['answer.schema']);
  });

  it('the dentist record beside the empty search: the record only', () => {
    expect(
      texts(check(plan('here_you_go', [rec(dentistToday)]), l(), 'What time’s the dentist?')),
    ).toEqual(['Here you go.', '“Dentist”: today, 10:00–10:30. Isla attending.']);
  });

  it('nothing else read: HOME’s fixed “not sure”, with no echo of the query', () => {
    const r = check(plan('unsure', []), l(), 'What time’s the dentist?');
    expect(texts(r)).toEqual(['I’m not sure what you’re after. Try asking another way.']);
    expect(JSON.stringify(r)).not.toContain('appointment');
  });

  it('a search covers nothing', () => {
    expect(l().coverage.some((c) => (c.kind as string) === 'search')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Qualifications: absence, forecasts and openings (Parts 3, 4, 5, 8).

const THU = '2026-10-15';
const SAT = '2026-10-17';
const healthy: Coverage = { calendarsUnhealthy: false, noCalendars: false, gapsUnknown: false };
const stale: Coverage = { calendarsUnhealthy: true, noCalendars: false, gapsUnknown: false };
const none: Coverage = { calendarsUnhealthy: false, noCalendars: true, gapsUnknown: false };
const absence = (s: Record<string, unknown>) => ({
  kind: 'absence',
  ref: null,
  show: [],
  scope: { of: 'agenda', from: null, to: null, people: [], part: null, else: false, ...s },
});
const shownOf = (r: ValidateResult): RenderedAnswer => {
  if (r.ok && r.rendered) return r.rendered;
  if (!r.ok && r.salvage) return r.salvage;
  throw new Error(JSON.stringify(r));
};
/** The answer's own words, its limits and its stored forecast time, on this calendar coverage. */
const outcome = (r: ValidateResult, c: Coverage = healthy) => {
  const a = shownOf(r);
  return {
    texts: [a.say, ...a.blocks.map((b) => b.text)],
    limits: limitsFor(a.shown, c),
    forecastAt: a.shown.forecastAt ?? null,
  };
};
const fallbackOf = (l: Ledger, c: Coverage = healthy) => {
  const f = buildFallback(l, NOW);
  return {
    texts: [f.say, ...f.blocks.map((b) => b.text)],
    limits: limitsFor(f.shown, c),
    forecastAt: f.shown.forecastAt ?? null,
  };
};

describe('A-B1: every agenda absence carries the limit sentence (Part 3)', () => {
  /** The busy ledger, then Alex's Thursday, person-filtered, with nothing on it. */
  const l = () => {
    const ledger = busyLedger();
    ledger.addResult(
      'get_agenda',
      getAgenda.output.parse({
        from: THU,
        to: THU,
        days: [{ date: THU, items: [] }],
        count: 0,
        truncated: false,
      }),
      [],
      { from: THU, to: THU, person_ids: [P.alex] },
    );
    return ledger;
  };
  const alexEvening = absence({ from: THU, to: THU, people: [P.alex], part: 'evening' });

  it('"Is Alex free on Thursday night?": the absence, then "only what HOME has recorded"', () => {
    const r = check(plan('here_you_go', [alexEvening]), l(), 'Is Alex free on Thursday night?');
    expect(outcome(r)).toEqual({
      texts: ['Here you go.', 'Nothing is recorded for Alex tomorrow, in the evening.'],
      limits: ['gap_limit'],
      forecastAt: null,
    });
    // And on a stale calendar, or none at all, with the qualification as before.
    expect(outcome(r, stale).limits).toEqual(['gap_limit', 'calendar_stale']);
    expect(outcome(r, none).limits).toEqual(['gap_limit', 'coverage_unknown']);
  });

  it('the salvage keeps it: an affirming lead withheld, the absence and its limit shown', () => {
    const r = check(plan('righto_when', [alexEvening]), l(), 'Is Alex free on Thursday night?');
    expect(codes(r)).toEqual(['lead.unsupported']);
    expect(outcome(r).limits).toEqual(['gap_limit']);
  });

  it('every kind: household, part of the day, `else`, and an agenda count', () => {
    const busy = busyLedger();
    for (const block of [
      absence({ from: '2026-10-18', to: '2026-10-18', part: 'evening' }),
      absence({ from: '2026-10-18', to: '2026-10-18', people: [P.isla, P.milo] }),
    ]) {
      const ledger =
        (block.scope.people as string[]).length > 0 ? busyLedger([kidsSunday()]) : busy;
      const r = check(plan('here_you_go', [block]), ledger, 'What’s on?');
      expect(outcome(r).limits, JSON.stringify(block.scope)).toContain('gap_limit');
    }
    const count = { ...absence({ from: SAT, to: SAT }), kind: 'count' };
    expect(outcome(check(plan('here_you_go', [count]), busy)).limits).toEqual(['gap_limit']);
    // An overlaps absence is not about anyone's plans: no limit sentence.
    const overlaps = absence({ of: 'conflicts', from: '2026-10-19', to: '2026-10-25' });
    expect(outcome(check(plan('here_you_go', [overlaps]), busy)).limits).toEqual([]);
  });
});

/** Sunday for Isla and Milo, person-filtered, empty. */
function kidsSunday() {
  return {
    tool: 'get_agenda' as const,
    input: { from: '2026-10-18', to: '2026-10-18', person_ids: [P.isla, P.milo] },
    data: getAgenda.output.parse({
      from: '2026-10-18',
      to: '2026-10-18',
      days: [{ date: '2026-10-18', items: [] }],
      count: 0,
      truncated: false,
    }),
    refs: [] as Ref[],
  };
}

/** Saturday's stretch with a rain band (get_gaps, parsed with its schema). */
const rainGaps = () => ({
  tool: 'get_gaps' as const,
  input: reads.saturdayGaps.input,
  data: getGaps.output.parse({
    ...reads.saturdayGaps.data,
    gaps: reads.saturdayGaps.data.gaps.map((g) => ({ ...g, forecast_band: 'rain' })),
  }),
  refs: reads.saturdayGaps.refs,
});
/** The weekend forecast as fetched at `at` with M7's freshness (get_weather, parsed with its schema). */
const weather = (at: string | null, freshness: 'fresh' | 'older' | 'unusable') => ({
  tool: 'get_weather' as const,
  input: reads.weekendWeather.input,
  data: getWeather.output.parse(
    freshness === 'unusable'
      ? {
          ...reads.weekendWeather.data,
          freshness,
          fetched_at: at,
          days: [],
          uncovered: ['2026-10-17', '2026-10-18'],
        }
      : { ...reads.weekendWeather.data, freshness, fetched_at: at },
  ),
  refs: freshness === 'unusable' ? [] : [sat, sun],
});
const FRESH = '2026-10-14T06:55:00+13:00';
const OLDER = '2026-10-13T22:03:00+13:00';
const UNUSABLE = '2026-10-13T12:00:00+13:00';
/** The bundle, then these reads (no busy records). */
const ledgerOf = (
  ...rs: { tool: string; input: unknown; data: unknown; refs: readonly Ref[] }[]
) => {
  const l = new Ledger(ZONE);
  l.addBundle(bundle, bundleRefs);
  for (const r of rs) l.addResult(r.tool as 'get_gaps', r.data, r.refs, r.input);
  return l;
};
const GAP = 'Nothing is recorded for the household on Saturday 17 October, 10:00–19:30.';
const GAP_RAIN = `${GAP} That’s after “Football”. The forecast for then: rain likely.`;

describe('A-B2: forecast words in a gap carry their read’s time and the credit (Part 4)', () => {
  const gapPlan = plan('when', [rec(gap, ['neighbours', 'forecast'])], {
    type: 'suggestion',
    phrase: 'raincoat',
    about: [0],
  });

  it('fresh: the band, with the read’s fetch time stored and the credit', () => {
    const r = check(gapPlan, ledgerOf(rainGaps(), weather(FRESH, 'fresh')), 'What’s on Saturday?');
    expect(outcome(r)).toEqual({
      texts: ['Here’s Saturday 17 October.', GAP_RAIN, 'Could be worth a raincoat.'],
      limits: ['gap_limit', 'forecast_credit'],
      forecastAt: FRESH,
    });
  });

  it('older (nine hours): M7’s "As of {time}, " with that read’s own time', () => {
    const r = check(gapPlan, ledgerOf(rainGaps(), weather(OLDER, 'older')), 'What’s on Saturday?');
    expect(outcome(r)).toEqual({
      texts: [
        'Here’s Saturday 17 October.',
        `${GAP} That’s after “Football”. As of yesterday 22:03, the forecast for then: rain likely.`,
        'Could be worth a raincoat.',
      ],
      limits: ['gap_limit', 'forecast_credit'],
      forecastAt: OLDER,
    });
  });

  it.each([
    ['unusable (over 12 hours)', () => ledgerOf(rainGaps(), weather(UNUSABLE, 'unusable'))],
    ['absent (no forecast read)', () => ledgerOf(rainGaps())],
    ['a read for another day only', () => ledgerOf(rainGaps(), weatherSundayOnly())],
  ])('%s: the forecast words are refused; the fallback shows the gap without them', (_, l) => {
    const r = check(gapPlan, l(), 'What’s on Saturday?');
    // The block cannot render, so the view it was about has nothing to rest on: no salvage.
    expect(codes(r)).toEqual(['fact.field', 'lead.unsupported', 'view.unsupported']);
    expect(r.ok ? 'ok' : r.salvage).toBeNull();
    const f = fallbackOf(l());
    expect(f.texts).toContain(`${GAP} That’s after “Football”.`);
    expect(f.texts.join(' ')).not.toContain('rain likely');
    expect(f.limits).toContain('gap_limit');
  });

  it('a gap without its forecast shown needs no forecast read', () => {
    const r = check(plan('when', [rec(gap)]), ledgerOf(rainGaps()), 'What’s on Saturday?');
    expect(outcome(r).limits).toEqual(['gap_limit']);
  });
});

function weatherSundayOnly() {
  return {
    tool: 'get_weather' as const,
    input: { from: '2026-10-18', to: '2026-10-18' },
    data: getWeather.output.parse({
      ...reads.weekendWeather.data,
      days: reads.weekendWeather.data.configured
        ? reads.weekendWeather.data.days.filter((d) => d.date === '2026-10-18')
        : [],
      count: 1,
    }),
    refs: [sun],
  };
}

/** M7's opening with a matched task (Forward Week), its forecast clause "as of {asOf}". */
const opening = (asOf: string | null) => {
  const ref: Ref = {
    type: 'insight',
    id: `open_window:household:2026-10-17:1000-1400:task:${paint.id}`,
  };
  const weatherWords = asOf ? `, and the forecast for Saturday as of ${asOf} looks dry` : '';
  return {
    ref,
    read: {
      tool: 'get_insights' as const,
      input: { surface: 'forward_week' },
      data: getInsights.output.parse({
        surface: 'forward_week',
        insights: [
          {
            ref,
            key: ref.id,
            kind: 'open_window',
            rule: 'open_window.task',
            when: '2026-10-17',
            text: u(
              `Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–14:00${weatherWords}.`,
            ),
            shown_on: 'list',
            refs: [paint],
          },
        ],
        count: 1,
        truncated: false,
      }),
      refs: [ref, paint],
    },
  };
};
const OPENING = (asOf: string) =>
  `Worth knowing: Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–14:00, and the forecast for Saturday as of ${asOf} looks dry.`;

describe('A-B3: opening insights are qualified like gaps (Parts 4, 5)', () => {
  const ask = 'Are we free on Saturday to paint the fence?';

  it('with a fresh forecast read: the limit sentence, the credit and the read’s time', () => {
    const o = opening('06:55');
    const l = ledgerOf(o.read, weather(FRESH, 'fresh'));
    expect(outcome(check(plan('flagged', [rec(o.ref)]), l, ask))).toEqual({
      texts: ['Here’s what HOME flagged.', OPENING('06:55')],
      limits: ['gap_limit', 'forecast_credit'],
      forecastAt: FRESH,
    });
    // A stale calendar, or none, qualifies it as it would a gap.
    expect(outcome(check(plan('flagged', [rec(o.ref)]), l, ask), stale).limits).toEqual([
      'gap_limit',
      'calendar_stale',
      'forecast_credit',
    ]);
    expect(outcome(check(plan('flagged', [rec(o.ref)]), l, ask), none).limits).toEqual([
      'gap_limit',
      'forecast_credit',
      'coverage_unknown',
    ]);
    // The fallback over the same reads: the same qualifications.
    expect(fallbackOf(l).limits).toEqual(['gap_limit', 'forecast_credit']);
    expect(fallbackOf(l).forecastAt).toBe(FRESH);
  });

  it('with an older read whose time the opening states: kept, with that time', () => {
    const o = opening('yesterday 22:03');
    const r = check(plan('flagged', [rec(o.ref)]), ledgerOf(o.read, weather(OLDER, 'older')), ask);
    expect(outcome(r).forecastAt).toBe(OLDER);
    expect(outcome(r).limits).toEqual(['gap_limit', 'forecast_credit']);
  });

  it.each([
    ['no forecast read', () => ledgerOf(opening('06:55').read)],
    ['an unusable read', () => ledgerOf(opening('06:55').read, weather(UNUSABLE, 'unusable'))],
    [
      'a read whose time is not the one the opening states',
      () => ledgerOf(opening('06:55').read, weather(OLDER, 'older')),
    ],
  ])('%s: the opening’s forecast words are refused, and the fallback leaves it out', (_, l) => {
    const o = opening('06:55');
    expect(codes(check(plan('flagged', [rec(o.ref)]), l(), ask))).toEqual(['fact.field']);
    const f = fallbackOf(l());
    expect(f.texts.some((t) => t.startsWith('Worth knowing'))).toBe(false);
    expect(f.limits).not.toContain('gap_limit');
  });

  it('an opening with no forecast clause needs no forecast read, and still carries the limit', () => {
    const o = opening(null);
    const r = check(plan('flagged', [rec(o.ref)]), ledgerOf(o.read), ask);
    expect(outcome(r)).toEqual({
      texts: [
        'Here’s what HOME flagged.',
        'Worth knowing: Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–14:00.',
      ],
      limits: ['gap_limit'],
      forecastAt: null,
    });
    expect(fallbackOf(ledgerOf(o.read)).limits).toEqual(['gap_limit']);
  });
});

describe('A-I1: an unusable forecast is never "no forecast yet" (Part 8)', () => {
  const forecastAbsence = absence({ of: 'forecast', from: SAT, to: SAT });

  it('M7’s wording, with the read’s fetch time', () => {
    const r = check(
      plan('here_you_go', [forecastAbsence]),
      ledgerOf(weather(UNUSABLE, 'unusable')),
    );
    expect(outcome(r).texts).toEqual([
      'Here you go.',
      "The forecast hasn't updated since yesterday.",
    ]);
    expect(outcome(r).limits).toEqual([]);
  });

  it('with no fetch time, nothing is claimed', () => {
    const r = check(plan('here_you_go', [forecastAbsence]), ledgerOf(weather(null, 'unusable')));
    expect(codes(r)).toEqual(['absence.unsupported']);
  });

  it('beyond a usable forecast, and with none set up, the wording is unchanged', () => {
    const l24 = ledgerOf(more.weather24);
    expect(
      outcome(
        check(
          plan('here_you_go', [absence({ of: 'forecast', from: '2026-10-24', to: '2026-10-24' })]),
          l24,
        ),
      ).texts[1],
    ).toBe('HOME doesn’t have a forecast for Saturday 24 October yet.');
    expect(
      outcome(check(plan('here_you_go', [forecastAbsence]), ledgerOf(more.weatherNone))).texts[1],
    ).toBe('HOME doesn’t have a forecast set up.');
  });
});
