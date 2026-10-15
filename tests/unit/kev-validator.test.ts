import { describe, expect, it } from 'vitest';
import { buildFallback, limitsFor } from '@/kev/answer/fallback';
import {
  DECLINE_TEXT,
  ERROR_TEXT,
  FALLBACK_LEAD,
  FALLBACK_WITH_ROWS,
  fixedCopy,
  forbiddenIn,
  KEV_FORBIDDEN,
  M5_FORBIDDEN,
  M6_FORBIDDEN,
  M7_FORBIDDEN,
} from '@/kev/answer/language';
import { Ledger } from '@/kev/answer/ledger';
import { ANSWER_JSON_SCHEMA, parseAnswer } from '@/kev/answer/schema';
import { codesOf, validateAnswer } from '@/kev/answer/validate';
import type { Ref } from '@/kev/tools/types';
import {
  board,
  bundle,
  bundleRefs,
  conflict,
  E,
  fixtureLedger,
  foot,
  gap,
  id,
  NOW,
  P,
  paint,
  person,
  reads,
  sat,
  swim,
  swimItem,
  u,
  withEvent,
  ZONE,
} from './kev-ledger-fixture';
import { getAgenda } from '@/kev/tools/get-agenda';

// The grounding check (M8 contract §8.3–§8.5; matrix rows V1–V18 and V18's
// fallback; T22's answer half). Pure: a ledger built from tool outputs
// that the tools' own output schemas accept (./kev-ledger-fixture.ts), on
// the contract's fixture (Wednesday 14 October 2026, 07:03). Synthetic
// only. The Package 3 review's counterexamples (B-1, B-2, I-8–I-16 and the
// minors) are below the original rows, each with its expected result.

const ledger = () => fixtureLedger();

const say = (text: string, cites: Ref[] = [], blocks: unknown[] = []) => ({
  say: { text, cites: cites.map((c) => ({ ...c, at: c.at ?? null })) },
  blocks,
  decline: null,
});
const fact = (text: string, cites: Ref[] = []) => ({ kind: 'fact', text, cites });
const view = (text: string, cites: Ref[] = []) => ({ kind: 'view', text, cites });
function check(raw: unknown, sensitive: string[] = []) {
  const r = validateAnswer({ raw, ledger: ledger(), now: NOW, timeZone: ZONE, sensitive });
  return r.ok ? [] : codesOf(r.violations);
}
const json = (o: unknown) => JSON.stringify(o);

describe('V1: the answer schema', () => {
  it('plain text, wrong shapes and limits are answer.schema; a valid KevAnswer passes', () => {
    expect(check('Swimming is at 3:30 today.')).toEqual(['answer.schema']);
    expect(check(json({ say: 'x', blocks: [], decline: null }))).toEqual(['answer.schema']);
    expect(
      check(json({ say: { text: 'x'.repeat(161), cites: [] }, blocks: [], decline: null })),
    ).toEqual(['answer.schema']);
    expect(
      check(
        json(say('Swimming at 3:30.', [swim], Array(7).fill(fact('Swimming at 3:30.', [swim])))),
      ),
    ).toEqual(['answer.schema']);
    expect(check(json({ ...say('Swimming at 3:30.', [swim]), extra: 1 }))).toEqual([
      'answer.schema',
    ]);
    expect(check(json({ say: null, blocks: [fact('x', [swim])], decline: 'write' }))).toEqual([
      'answer.schema',
    ]);
    expect(check(json({ say: null, blocks: [], decline: 'something_else' }))).toEqual([
      'answer.schema',
    ]);
    expect(check(json(say('Just swimming at 3:30 with Milo.', [swim])))).toEqual([]);
    expect(check(json({ say: null, blocks: [], decline: 'external_action' }))).toEqual([]);
    expect(check({ decline: 'memory' })).toEqual([]);
  });

  it('T22: the answer’s JSON schema is static, strict, and carries no fixture value', () => {
    const text = JSON.stringify(ANSWER_JSON_SCHEMA);
    for (const v of [
      'Sam',
      'Alex',
      'Milo',
      'Isla',
      'Nana',
      'Swimming',
      'Football',
      'fence',
      '2026',
    ])
      expect(text).not.toContain(v);
    const strict = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(strict);
      if (n && typeof n === 'object') {
        const o = n as Record<string, unknown>;
        if (o.type === 'object') {
          expect(o.additionalProperties).toBe(false);
          expect(Object.keys(o.properties as object).sort()).toEqual(
            [...(o.required as string[])].sort(),
          );
        }
        Object.values(o).forEach(strict);
      }
    };
    strict(ANSWER_JSON_SCHEMA);
    expect(parseAnswer(json(say('Swimming at 3:30.', [swim])))).toEqual({
      say: { text: 'Swimming at 3:30.', cites: [swim] },
      blocks: [],
    });
  });
});

describe('V2: citations must be in the ledger', () => {
  it('a ref no tool returned is cite.unknown; Swimming from the bundle passes', () => {
    expect(
      check(json(say('Swimming at 3:30.', [{ type: 'event', id: id(99), at: swim.at }]))),
    ).toContain('cite.unknown');
    expect(
      check(json(say('Swimming at 3:30.', [{ ...swim, at: '2026-10-21T15:30:00+13:00' }]))),
    ).toContain('cite.unknown');
    expect(
      check(json(say('Just swimming at 3:30 with Milo, and you’re marked responsible.', [swim]))),
    ).toEqual([]);
  });
});

describe('V3: times, dates and weekdays against the citations', () => {
  it.each([
    ['Swimming at 4 today.', ['time.unsupported']],
    ['Swimming at 3:30 today.', []],
    ['Swimming at half past three today.', []],
    ['Swimming at 15:30 today.', []],
    ['Swimming at 3:30pm today.', []],
    ['Swimming at 3:30am today.', ['time.unsupported']],
    ['Swimming on Thursday at 3:30.', ['time.unsupported']],
    ['Swimming on Wednesday at 3:30.', []],
    ['Swimming on 14 October at 3:30.', []],
    ['Swimming on 15 October at 3:30.', ['time.unsupported']],
    ['Swimming this morning.', ['time.unsupported']],
    ['Swimming in the morning.', ['time.unsupported']],
    ['Swimming this afternoon.', []],
    ['Swimming, from 3:30 till 4:15.', []],
    ['Swimming, from 3:30 till 5.', ['time.unsupported']],
  ])('%s', (text, codes) => {
    expect(check(json(say(text, [swim])))).toEqual(codes);
  });

  it('durations: the task’s three hours pass; four do not', () => {
    expect(
      check(json(say('Paint the back fence is recorded as about three hours.', [paint]))),
    ).toEqual([]);
    expect(
      check(json(say('Paint the back fence is recorded as about four hours.', [paint]))),
    ).toEqual(['time.unsupported']);
  });
});

describe('V4: a factual sentence cites something, unless it states an absence', () => {
  it('a fact block with no citation is cite.missing; "Nothing else is recorded for today." passes', () => {
    expect(
      check(json(say('Swimming at 3:30.', [swim], [fact('Football is on Saturday.')]))),
    ).toContain('cite.missing');
    expect(
      check(json(say('Swimming at 3:30.', [swim], [fact('Nothing else is recorded for today.')]))),
    ).toEqual([]);
    // An absence may name a day a read covered (Saturday and Sunday), never another.
    expect(
      check(
        json(
          say('Football on Saturday at 9.', [foot], [fact('Nothing else is recorded for Sunday.')]),
        ),
      ),
    ).toEqual([]);
    expect(
      check(
        json(
          say('Football on Saturday at 9.', [foot], [fact('Nothing else is recorded for Monday.')]),
        ),
      ),
    ).toEqual(['absence.unsupported']);
    // A view may stand without citations (it may add nothing, though).
    expect(
      check(json(say('Swimming at 3:30.', [swim], [view('That is the only item listed.')]))),
    ).toEqual([]);
  });
});

describe('V5: numbers against the citations', () => {
  it('"Three things on Saturday" with two cited is number.unsupported; ages and counts pass', () => {
    expect(check(json(say('Three things on Saturday.', [foot, gap])))).toContain(
      'number.unsupported',
    );
    expect(
      check(json(say('Two things on Saturday: Football and the forecast.', [foot, sat]))),
    ).toEqual([]);
    expect(check(json(say('Milo is 9.', [person(P.milo)])))).toEqual([]);
    expect(check(json(say('Milo is 10.', [person(P.milo)])))).toEqual(['number.unsupported']);
    expect(check(json(say('Saturday looks dry, a low of 9 and a high of 17.', [sat])))).toEqual([]);
  });
});

describe('V6: names', () => {
  it('"Grandad’s coming Saturday" is name.unknown; "Nana Jo’s birthday is Tuesday" passes', () => {
    expect(check(json(say('Grandad’s coming Saturday at 9.', [foot])))).toContain('name.unknown');
    expect(check(json(say('Nana Jo’s birthday is Tuesday.', [person(P.nana)])))).toEqual([]);
    expect(check(json(say('Football on Saturday at 9, at Westpac Stadium.', [foot])))).toContain(
      'name.unknown',
    );
  });
});

describe('V7: the forbidden lists, titles and names exempt', () => {
  it.each(['free', 'available', 'best', 'busy', 'should', 'you could', 'can’t', 'nothing on'])(
    '"%s" in model text is phrase.forbidden',
    (w) => {
      expect(check(json(say(`Football on Saturday at 9, and ${w} after.`, [foot])))).toContain(
        'phrase.forbidden',
      );
    },
  );

  it('a cited title containing "Free" passes quoted word for word, and only then (I-11)', () => {
    const freeRef = { type: 'event' as const, id: id(40), at: '2026-10-17T11:00:00+13:00' };
    const run = (text: string) => {
      const l = withEvent(ledger(), freeRef, 'Free swim day', '2026-10-17T12:00:00+13:00');
      const r = validateAnswer({
        raw: json(say(text, [freeRef])),
        ledger: l,
        now: NOW,
        timeZone: ZONE,
      });
      return r.ok ? [] : codesOf(r.violations);
    };
    expect(run('“Free swim day” on Saturday at 11.')).toEqual([]);
    expect(run('Free swim day on Saturday at 11.')).toEqual(['phrase.forbidden']);
    expect(run('“Free Swim Day” on Saturday at 11.')).toEqual(['phrase.forbidden']);
  });

  it('every fixed string passes the four lists, its "can’t" about Kev itself excepted (§8.6)', () => {
    for (const s of fixedCopy())
      expect(
        forbiddenIn(s).filter((f) => f !== "can't"),
        s,
      ).toEqual([]);
    for (const list of [M5_FORBIDDEN, M6_FORBIDDEN, M7_FORBIDDEN, KEV_FORBIDDEN])
      expect(list.length).toBeGreaterThan(5);
  });
});

describe('V8–V12', () => {
  it('V8: an overlap without a cited conflict is conflict.unsupported; with one it passes', () => {
    expect(check(json(say('Swimming and pickup overlap at 3:30.', [swim])))).toContain(
      'conflict.unsupported',
    );
    expect(
      check(
        json(
          say(
            'Because you’re on both the board meeting and parent interviews on Thursday, from 6 to 6:30.',
            [conflict],
          ),
        ),
      ),
    ).toEqual([]);
  });

  it('V9: "Alex is around on Thursday evening" is availability.claim', () => {
    expect(check(json(say('Alex is around on Thursday evening.', [board])))).toContain(
      'availability.claim',
    );
    expect(check(json(say('Alex has nothing on Saturday.', [foot])))).toContain(
      'availability.claim',
    );
  });

  it('V10: a gap described as open time is gap.unqualified; "nothing is recorded" passes', () => {
    expect(check(json(say('Saturday 10 till 7:30 is open for you.', [gap])))).toContain(
      'gap.unqualified',
    );
    expect(check(json(say('On Saturday nothing is recorded from 10 till 7:30.', [gap])))).toEqual(
      [],
    );
  });

  it('V11: a plan presented as made is commitment.unrecorded; Kev’s view of a match passes', () => {
    expect(check(json(say('You’re doing the fence on Saturday.', [paint])))).toContain(
      'commitment.unrecorded',
    );
    expect(
      check(
        json(
          say(
            'On Saturday nothing is recorded from 10 till 7:30.',
            [gap],
            [view('Saturday’s stretch matches what the fence task records.', [gap, paint])],
          ),
        ),
      ),
    ).toEqual([]);
    // The view must cite what carries its Saturday.
    expect(
      check(
        json(
          say(
            'On Saturday nothing is recorded from 10 till 7:30.',
            [gap],
            [view('Saturday’s stretch matches what the fence task records.', [paint])],
          ),
        ),
      ),
    ).toEqual(['time.unsupported']);
    // A view never calls the stretch open time.
    expect(
      check(
        json(
          say(
            'On Saturday nothing is recorded from 10 till 7:30.',
            [gap],
            [view('Saturday’s stretch is open for the fence.', [gap, paint])],
          ),
        ),
      ),
    ).toEqual(['gap.unqualified']);
  });

  it('V12: "I’ve added it to the list." is authority.claim', () => {
    expect(check(json(say('I’ve added it to the list.', [paint])))).toContain('authority.claim');
    expect(check(json(say('I’ve deleted the tasks.', [paint])))).toContain('authority.claim');
    expect(check(json(say('Swimming at 3:30. I’ll remind you.', [swim])))).toContain(
      'authority.claim',
    );
  });
});

describe('V13–V16', () => {
  it('V13: a URL, a Markdown link and a record id are markup', () => {
    expect(check(json(say('Swimming at 3:30, see https://example.test/x.', [swim])))).toContain(
      'markup',
    );
    expect(check(json(say('Swimming at 3:30, [details](/events/1).', [swim])))).toContain('markup');
    expect(check(json(say(`Swimming at 3:30 (${E.swimming}).`, [swim])))).toContain('markup');
    expect(check(json(say('Swimming at 3:30 <b>today</b>.', [swim])))).toContain('markup');
  });

  it('V14: say marked as a view is view.in_say; "Great question!" is tone.filler', () => {
    expect(check(json(say('Kev’s view: Saturday matches the fence task.', [paint])))).toContain(
      'view.in_say',
    );
    expect(check(json(say('Great question! Swimming at 3:30.', [swim])))).toContain('tone.filler');
    expect(check(json(say('Certainly, swimming at 3:30.', [swim])))).toContain('tone.filler');
  });

  it('V15: a planted sensitive string is sensitive.leak', () => {
    expect(
      check(json(say('Swimming at 3:30, synthetic-sensitive-marker.', [swim])), [
        'synthetic-sensitive-marker',
      ]),
    ).toContain('sensitive.leak');
  });

  it('V16: the code adds the limit sentences by what is cited, whatever the answer says', () => {
    const healthy = { calendarsUnhealthy: false, noCalendars: false, gapsUnknown: false };
    expect(limitsFor([gap], healthy)).toEqual(['gap_limit']);
    expect(limitsFor([swim], { ...healthy, calendarsUnhealthy: true })).toEqual(['calendar_stale']);
    expect(limitsFor([swim], healthy)).toEqual([]);
    expect(limitsFor([sat], healthy)).toEqual(['forecast_credit']);
    expect(limitsFor([swim], { ...healthy, noCalendars: true })).toEqual(['coverage_unknown']);
    expect(limitsFor([gap], { ...healthy, gapsUnknown: true })).toEqual([
      'gap_limit',
      'coverage_unknown',
    ]);
  });
});

describe('§3.1’s answers pass as written', () => {
  it.each([
    [
      'today',
      say(
        'Just swimming at 3:30 with Milo, and you’re marked responsible.',
        [swim],
        [fact('Nothing else is recorded for today.')],
      ),
    ],
    [
      'the weekend',
      say(
        'Football on Saturday at 9 with Milo, and nothing else recorded for the weekend.',
        [foot],
        [fact('The forecast as of 06:55: Saturday looks dry.', [sat])],
      ),
    ],
    [
      'Nana Jo',
      say('One thing HOME lists for next week: Nana Jo’s birthday on Tuesday.', [person(P.nana)]),
    ],
    [
      'tasks',
      say(
        'One: Paint the back fence.',
        [paint],
        [fact('Recorded as about three hours, in dry weather and daylight.', [paint])],
      ),
    ],
    ['weather', say('As of 06:55, Saturday looks dry.', [sat])],
    [
      'the overlap',
      say(
        'Because you’re on both the board meeting and parent interviews on Thursday, from 6 to 6:30.',
        [conflict],
        [fact('HOME marks an overlap when one person is on two timed events at once.', [conflict])],
      ),
    ],
    [
      'think-through',
      say(
        'Saturday after football has nothing recorded, and the fence is waiting.',
        [gap, paint],
        [
          fact('On Saturday nothing is recorded from 10 till 7:30, and the forecast looks dry.', [
            gap,
            sat,
          ]),
          view(
            'Saturday’s stretch matches what the fence task records: dry, daylight and more than three hours.',
            [gap, paint],
          ),
        ],
      ),
    ],
  ])('%s', (_l, answer) => {
    expect(check(json(answer))).toEqual([]);
  });

  it('a nested record does not carry its parent’s facts: Milo alone does not support 9 o’clock', () => {
    expect(check(json(say('Milo at 9 on Saturday.', [person(P.milo)])))).toContain(
      'time.unsupported',
    );
  });
});

describe('V18 (pure half): the safe fallback', () => {
  it('the ledger’s tool rows with the fixed lead; the lead alone with nothing read', () => {
    const f = buildFallback(ledger());
    expect(f.say).toBe(FALLBACK_WITH_ROWS);
    expect(f.cites).toEqual(expect.arrayContaining([foot, conflict, paint, gap, sat]));
    expect(f.cites.some((c) => c.type === 'person')).toBe(false);
    const bare = new Ledger();
    bare.addBundle(
      { ...bundle, today: { date: '2026-10-14', people: [] } },
      bundleRefs.slice(0, 5),
    );
    expect(buildFallback(bare)).toEqual({ say: FALLBACK_LEAD, cites: [] });
    // With no tool run, today's records from the bundle.
    const today = new Ledger();
    today.addBundle(bundle, bundleRefs);
    expect(buildFallback(today).cites).toEqual([swim]);
  });

  it('the decline and error copy is §3.2’s and §9.9’s', () => {
    expect(DECLINE_TEXT.external_action).toBe('I can’t book, send or pay for anything.');
    expect(DECLINE_TEXT.reminder).toBe(
      'I can’t remind you of anything. Today shows what’s coming up when you look.',
    );
    expect(ERROR_TEXT.cap_reached).toBe(
      'I’ve reached this month’s limit. I’ll be back on the 1st.',
    );
    expect(ERROR_TEXT.provider_unavailable).toBe(
      'Kev isn’t answering right now. What you asked is kept here.',
    );
    expect(ERROR_TEXT.refused).toBe('I can’t help with that one.');
  });
});

// ---------------------------------------------------------------------------
// The Package 3 review's counterexamples (each was accepted before the
// correction) and the legitimate answers the correction must keep.

const inj = { type: 'event' as const, id: id(50), at: '2026-10-17T11:00:00+13:00' };
const injected = (title: string) =>
  withEvent(fixtureLedger(), inj, title, '2026-10-17T12:00:00+13:00');
const run = (answer: unknown, l: Ledger = fixtureLedger()) => {
  const r = validateAnswer({ raw: json(answer), ledger: l, now: NOW, timeZone: ZONE });
  return r.ok ? [] : codesOf(r.violations);
};
/** A ledger with one agenda read of Wednesday and Thursday holding swimming (B-2's from/to). */
function agendaWedThu(): Ledger {
  const l = new Ledger();
  l.addBundle(bundle, bundleRefs);
  l.addResult(
    'get_agenda',
    getAgenda.output.parse({
      from: '2026-10-14',
      to: '2026-10-15',
      days: [
        { date: '2026-10-14', items: [swimItem] },
        { date: '2026-10-15', items: [] },
      ],
      count: 1,
      truncated: false,
    }),
    [swim],
    { from: '2026-10-14', to: '2026-10-15' },
  );
  return l;
}
/** The fixture plus an agenda read of the rest of this week (Wednesday to Sunday). */
function withThisWeek(): Ledger {
  const l = fixtureLedger();
  l.addResult(
    'get_agenda',
    getAgenda.output.parse({
      from: '2026-10-14',
      to: '2026-10-18',
      days: ['14', '15', '16', '17', '18'].map((d) => ({ date: `2026-10-${d}`, items: [] })),
      count: 0,
      truncated: false,
    }),
    [],
    { from: '2026-10-14', to: '2026-10-18' },
  );
  return l;
}

describe('B-1: an absence is a whole clause, never a pass for the rest', () => {
  it.each([
    [say('HOME doesn’t show more, but Alex has the dentist with Milo.'), 'cite.missing'],
    [say('Nothing else is recorded, and Alex is responsible for football.'), 'cite.missing'],
    [
      say(
        'Football on Saturday at 9.',
        [foot],
        [fact('No reason to worry: Milo has swimming with Alex too, as recorded.')],
      ),
      'cite.missing',
    ],
  ])('%j is refused', (answer, code) => {
    expect(run(answer)).toContain(code);
  });
});

describe('B-2: a result’s range is never a fact of its records', () => {
  it.each([
    [say('Swimming on Thursday at 3:30.', [swim]), agendaWedThu()],
    [say('Swimming on 15 October at 3:30.', [swim]), agendaWedThu()],
    [say('Football on Sunday at 9.', [foot]), fixtureLedger()],
  ])('%j is time.unsupported', (answer, l) => {
    expect(run(answer, l)).toEqual(['time.unsupported']);
  });

  it('the forecast’s fetch time and credit are its days’ facts (the allow-list)', () => {
    expect(run(say('As of 06:55, Saturday looks dry.', [sat]))).toEqual([]);
    expect(run(say('As of 06:55, Swimming at 3:30.', [swim]))).toEqual(['time.unsupported']);
  });

  it('an agenda day’s date is its birthday item’s fact', () => {
    const l = fixtureLedger();
    l.addResult(
      'get_agenda',
      getAgenda.output.parse({
        from: '2026-10-20',
        to: '2026-10-20',
        days: [
          {
            date: '2026-10-20',
            items: [{ type: 'birthday', ref: person(P.nana), name: u('Nana Jo'), age: 80 }],
          },
        ],
        count: 1,
        truncated: false,
      }),
      [person(P.nana)],
      { from: '2026-10-20', to: '2026-10-20' },
    );
    expect(run(say('Nana Jo’s birthday is on Tuesday 20 October.', [person(P.nana)]), l)).toEqual(
      [],
    );
    expect(run(say('Nothing is recorded for Tuesday.'), l)).toEqual(['absence.unsupported']);
  });
});

describe('I-8: an absence must be covered, and not contradicted', () => {
  it.each([
    ['Nothing is recorded for Saturday.', 'Football is in the ledger'],
    ['Nothing is recorded for Thursday.', 'no agenda read covers Thursday'],
    ['Nothing is recorded for next week.', 'nothing read next week'],
    ['Nothing is recorded for Milo on Saturday.', 'Football has Milo'],
    ['Nothing else is recorded for today.', 'swimming is uncited'],
  ])('%s (%s) is absence.unsupported', (text) => {
    expect(run(say(text))).toEqual(['absence.unsupported']);
  });

  it('a conflicts or forecast read is not agenda coverage; a truncated read covers nothing', () => {
    // get_conflicts covered Thursday; get_weather covered the weekend: neither is the agenda.
    const l = fixtureLedger([reads.thursdayConflicts, reads.weekendWeather]);
    expect(run(say('Nothing is recorded for Thursday.'), l)).toEqual(['absence.unsupported']);
    expect(run(say('Nothing is recorded for Sunday.'), l)).toEqual(['absence.unsupported']);
    const cut = new Ledger();
    cut.addBundle(bundle, bundleRefs);
    cut.addResult(
      'get_agenda',
      { ...reads.weekendAgenda.data, truncated: true },
      reads.weekendAgenda.refs,
      reads.weekendAgenda.input,
    );
    expect(run(say('Nothing else is recorded for Sunday.'), cut)).toEqual(['absence.unsupported']);
  });

  it('a person-filtered agenda read covers only that person', () => {
    const l = new Ledger();
    l.addBundle(bundle, bundleRefs);
    l.addResult(
      'get_agenda',
      getAgenda.output.parse({
        from: '2026-10-18',
        to: '2026-10-18',
        days: [{ date: '2026-10-18', items: [] }],
        count: 0,
        truncated: false,
      }),
      [],
      { from: '2026-10-18', to: '2026-10-18', person_ids: [P.alex] },
    );
    expect(run(say('Nothing is recorded for Alex on Sunday.'), l)).toEqual([]);
    expect(run(say('Nothing is recorded for Sunday.'), l)).toEqual(['absence.unsupported']);
    expect(run(say('Nothing is recorded for Milo on Sunday.'), l)).toEqual(['absence.unsupported']);
  });

  it('supported absences pass', () => {
    expect(run(say('Nothing is recorded for Sunday.'))).toEqual([]);
    expect(run(say('Nothing is recorded for Alex on Saturday.'))).toEqual([]);
    expect(
      run(
        say(
          'Football on Saturday at 9.',
          [foot],
          [fact('Nothing else is recorded for Milo on Saturday.')],
        ),
      ),
    ).toEqual([]);
  });
});

describe('I-9: today, tomorrow, the weekend and next week are resolved from now', () => {
  it.each([
    'Football tomorrow at 9.',
    'Football next week at 9.',
    'Swimming on the weekend at 3:30.',
    'Swimming tomorrow at 3:30.',
  ])('%s is time.unsupported', (text) => {
    expect(run(say(text, [text.startsWith('Football') ? foot : swim]))).toEqual([
      'time.unsupported',
    ]);
  });

  it.each([
    ['Swimming today at 3:30.', swim],
    ['Football this weekend at 9.', foot],
    ['Football on Saturday at 9, this weekend.', foot],
    ['Nana Jo’s birthday is next week, on Tuesday.', person(P.nana)],
  ])('%s passes', (text, ref) => {
    expect(run(say(text, [ref]))).toEqual([]);
  });
});

describe('I-10: people, roles and relationships come from the cited records', () => {
  it.each([
    say('Swimming at 3:30, and Alex is marked responsible.', [swim]),
    say('Swimming at 3:30 with Isla.', [swim]),
    say('Your grandad goes with Milo to football on Saturday at 9.', [foot]),
    say('Milo is marked responsible for swimming at 3:30.', [swim]),
    say('Football on Saturday at 9, with Milo and his coach.', [foot]),
  ])('%j is person.unsupported', (answer) => {
    expect(run(answer)).toContain('person.unsupported');
  });

  it('recorded people and roles pass', () => {
    expect(run(say('Swimming at 3:30 with Milo, and Sam is marked responsible.', [swim]))).toEqual(
      [],
    );
    expect(run(say('Milo is attending football on Saturday at 9.', [foot]))).toEqual([]);
    expect(run(say('Nana Jo turns 80 on Tuesday.', [person(P.nana)]))).toEqual([]);
    expect(run(say('Your nana, Nana Jo, turns 80 on Tuesday.', [person(P.nana)]))).toEqual([]);
  });
});

describe('I-11: recorded text is quoted evidence, never an exemption', () => {
  it.each([
    ['Alex is free all afternoon', say('Alex is free all afternoon.', [inj]), 'availability.claim'],
    ['Busy', say('Alex is busy on Saturday at 11.', [inj]), 'availability.claim'],
    [
      'I’ve booked the plumber',
      say('I’ve booked the plumber on Saturday at 11.', [inj]),
      'authority.claim',
    ],
    [
      'Alex is free every Saturday and should do the fence',
      say('Alex is free every Saturday and should do the fence.', [inj]),
      'availability.claim',
    ],
    [
      'Alex is free all afternoon',
      say('“Alex is free all afternoon” is on Saturday at 11.', [inj]),
      'availability.claim',
    ],
  ])('a cited title %j does not let %j through', (title, answer, code) => {
    expect(run(answer, injected(title))).toContain(code);
  });

  it('a quoted title only lifts the wording rule, and only word for word', () => {
    expect(run(say('“Busy bees” on Saturday at 11.', [inj]), injected('Busy bees'))).toEqual([]);
    expect(run(say('“Busy bees” on Saturday at 4.', [inj]), injected('Busy bees'))).toEqual([
      'time.unsupported',
    ]);
    expect(run(say('“Busy” bees on Saturday at 11.', [inj]), injected('Busy bees'))).toEqual([
      'phrase.forbidden',
    ]);
  });
});

describe('I-12: no availability, and no plan presented as made', () => {
  it.each([
    [say('Sam, you’re doing the fence on Saturday at 9.', [foot, paint]), 'commitment.unrecorded'],
    [say('Sam paints the fence on Saturday at 9.', [paint, foot]), 'commitment.unrecorded'],
    [
      say(
        'On Saturday nothing is recorded from 10 till 7:30.',
        [gap],
        [view('Sam’s painting the fence on Saturday from 10.', [gap, paint])],
      ),
      'time.unsupported',
    ],
    [say('Alex has Thursday evening to himself.', [board]), 'availability.claim'],
    [say('Alex’s Thursday evening is empty.', [board]), 'availability.claim'],
    [say('Alex can make football on Saturday at 9.', [foot]), 'availability.claim'],
    [say('Alex has no plans on Saturday.', [foot]), 'availability.claim'],
    [
      say('On Saturday nothing is recorded from 10 till 7:30, so Alex can do the fence then.', [
        gap,
        paint,
      ]),
      'availability.claim',
    ],
    [say('You’re doing the fence on Saturday.', [paint]), 'commitment.unrecorded'],
  ])('%j is refused', (answer, code) => {
    expect(run(answer)).toContain(code);
  });

  it('a recorded commitment with its people passes', () => {
    expect(run(say('Milo goes to football on Saturday at 9.', [foot]))).toEqual([]);
    expect(run(say('Alex goes to football on Saturday at 9.', [foot]))).toEqual([
      'person.unsupported',
      'commitment.unrecorded',
    ]);
  });
});

describe('I-13: a view is checked like a fact', () => {
  it('a view naming people or records needs citations, and those must carry it', () => {
    expect(
      run(
        say(
          'Swimming at 3:30.',
          [swim],
          [view('Alex is responsible for Milo’s swimming every week.')],
        ),
      ),
    ).toEqual(['cite.missing']);
    expect(
      run(
        say(
          'Swimming at 3:30.',
          [swim],
          [view('Alex is responsible for Milo’s swimming every week.', [swim])],
        ),
      ),
    ).toEqual(['time.unsupported', 'person.unsupported']);
    expect(
      run(say('Swimming at 3:30.', [swim], [view('Alex is free on Saturday.', [foot])])),
    ).toContain('availability.claim');
  });
});

describe('I-14: invisible and look-alike characters', () => {
  // Written as code points: the repository holds no literal invisible character.
  const ch = (...cp: number[]) => String.fromCodePoint(...cp);
  it.each([
    ['U+200B', `Milo is fr${ch(0x200b)}ee on Saturday at 9.`],
    ['U+2063', `Milo is fr${ch(0x2063)}ee on Saturday at 9.`],
    ['U+00AD', `Milo is fr${ch(0xad)}ee on Saturday at 9.`],
    ['Cyrillic e', `Milo is fr${ch(0x435, 0x435)} on Saturday at 9.`],
    ['U+202E', `Football on Saturday at 9 ${ch(0x202e)}with Milo.`],
  ])('%s is text.unsafe', (_label, text) => {
    expect(run(say(text, [foot]))).toContain('text.unsafe');
  });

  it('names with diacritics and NZ English pass', () => {
    const l = new Ledger();
    const zoe = id(60);
    const tane = id(61);
    const b = {
      ...bundle,
      people: [
        ...bundle.people,
        { ...bundle.people[2]!, ref: person(zoe), name: u('Zoë') },
        { ...bundle.people[2]!, ref: person(tane), name: u('Tāne') },
      ],
    };
    l.addBundle(b, [...bundleRefs, person(zoe), person(tane)]);
    l.addResult(
      'get_agenda',
      getAgenda.output.parse({
        from: '2026-10-17',
        to: '2026-10-17',
        days: [
          {
            date: '2026-10-17',
            items: [
              {
                ...reads.weekendAgenda.data.days[0]!.items[0]!,
                title: u('Kapa haka'),
                people: [
                  { ref: person(zoe), name: u('Zoë'), role: 'attending' },
                  { ref: person(tane), name: u('Tāne'), role: 'responsible' },
                ],
              },
            ],
          },
        ],
        count: 1,
        truncated: false,
      }),
      [foot],
      { from: '2026-10-17', to: '2026-10-17' },
    );
    expect(
      run(say('Kapa haka on Saturday at 9 with Zoë, and Tāne is marked responsible.', [foot]), l),
    ).toEqual([]);
  });
});

describe('I-16: legitimate answers the checker used to refuse', () => {
  it('no overlaps after an empty, covering conflicts read', () => {
    expect(
      run(
        say(
          'Football on Saturday at 9.',
          [foot],
          [fact('No overlaps are recorded for next week.')],
        ),
      ),
    ).toEqual([]);
    expect(
      run(say('HOME hasn’t marked an overlap there.'), fixtureLedger([reads.nextWeekConflicts])),
    ).toEqual([]);
    // An uncited conflict in the covered days still contradicts it (conservative).
    expect(run(say('HOME hasn’t marked an overlap there.'))).toEqual(['absence.unsupported']);
    // No conflicts read at all: no overlap absence.
    expect(
      run(say('No overlaps are recorded for next week.'), fixtureLedger([reads.tasks])),
    ).toEqual(['absence.unsupported']);
  });

  it.each([
    [say('You’re marked responsible for swimming at 3:30.', [swim]), fixtureLedger()],
    [
      say(
        'Doesn’t look like anything else is recorded for Saturday.',
        [],
        [fact('Football on Saturday at 9.', [foot])],
      ),
      fixtureLedger(),
    ],
    [
      say(
        'Nothing else is recorded for you this week.',
        [],
        [fact('Swimming today at 3:30.', [swim])],
      ),
      withThisWeek(),
    ],
    [say('Swimming at 3.30 today.', [swim]), fixtureLedger()],
    [say('Football Sat 9am.', [foot]), fixtureLedger()],
    [say('Swimming Wed 14 Oct at 3:30.', [swim]), fixtureLedger()],
    [say('Swimming at half three.', [swim]), fixtureLedger()],
    [say('Swimming at three-thirty.', [swim]), fixtureLedger()],
    [say('Swimming, from 3.30 till 4.15.', [swim]), fixtureLedger()],
    [say('I’m not seeing anything else, and swimming is at 3:30.', [swim]), fixtureLedger()],
  ])('%j passes', (answer, l) => {
    expect(run(answer, l)).toEqual([]);
  });

  it('wrong times in NZ forms still fail', () => {
    expect(run(say('Swimming at 4.30 today.', [swim]))).toEqual(['time.unsupported']);
    expect(run(say('Swimming at half four.', [swim]))).toEqual(['time.unsupported']);
    expect(run(say('Football Sun 9am.', [foot]))).toEqual(['time.unsupported']);
  });

  it.each([
    'I’ve gone ahead and booked it.',
    'I have now added paint the back fence.',
    'Done, that’s in To sort now.',
    'I just added it.',
    'I’ll keep an eye on it.',
    'I can add that for you.',
  ])('Kev’s completed or promised action %j is authority.claim', (text) => {
    expect(run(say(text, [paint]))).toContain('authority.claim');
  });
});

describe('The minors: bound times, numbers, markup and views', () => {
  it('a time said with one record cannot belong to another cited with it', () => {
    expect(run(say('Swimming at 9 and football at 3:30.', [swim, foot]))).toEqual([
      'time.unsupported',
    ]);
    expect(run(say('Swimming at 3:30 and football at 9.', [swim, foot]))).toEqual([]);
  });

  it.each([
    [say('Paint the back fence is recorded as about ninety minutes.', [paint]), 'time.unsupported'],
    [say('Nana Jo turns ninety on Tuesday.', [person(P.nana)]), 'number.unsupported'],
    [say('Nana Jo turns 79 on Tuesday.', [person(P.nana)]), 'number.unsupported'],
    [say('Saturday looks dry, a low of 17.', [sat]), 'number.unsupported'],
    [say('Saturday looks dry, gusts of 45.', [sat]), 'number.unsupported'],
    [say('Swimming at 3:30, see evil.xyz/login.', [swim]), 'markup'],
    [say('Swimming at **3:30**.', [swim]), 'markup'],
    [say('Swimming at 3:30 # today.', [swim]), 'markup'],
    [say('Swimming at 3:30, which seems tight.', [swim]), 'view.in_say'],
  ])('%j is %s', (answer, code) => {
    expect(run(answer)).toContain(code);
  });

  it('numbers that are what they say pass', () => {
    expect(run(say('Nana Jo is 79, and turns 80 on Tuesday.', [person(P.nana)]))).toEqual([]);
    expect(
      run(say('Saturday looks dry, a low of 9 and a high of 17, gusts of 30.', [sat])),
    ).toEqual([]);
    // Numbers past ninety-nine in words are not read: refused, conservatively.
    expect(
      run(say('Paint the back fence is recorded as about a hundred and eighty minutes.', [paint])),
    ).toEqual(['time.unsupported', 'number.unsupported']);
  });
});

describe('Limits on every outcome (I-15)', () => {
  it('an absence carries the coverage sentences; the fallback’s rows carry theirs', () => {
    const unhealthy = { calendarsUnhealthy: true, noCalendars: false, gapsUnknown: false };
    expect(limitsFor([], unhealthy, { absence: true })).toEqual(['calendar_stale']);
    expect(
      limitsFor(
        [],
        { ...unhealthy, calendarsUnhealthy: false, noCalendars: true },
        { absence: true },
      ),
    ).toEqual(['coverage_unknown']);
    const f = buildFallback(ledger());
    expect(limitsFor(f.cites, unhealthy)).toEqual([
      'gap_limit',
      'calendar_stale',
      'forecast_credit',
    ]);
  });

  it('a passing answer reports whether it states an absence', () => {
    const r = validateAnswer({
      raw: json(say('Nothing is recorded for Sunday.')),
      ledger: ledger(),
      now: NOW,
      timeZone: ZONE,
    });
    expect(r.ok && r.absence).toBe(true);
  });
});
