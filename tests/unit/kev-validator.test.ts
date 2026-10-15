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

// The grounding check (M8 contract §8.3–§8.5; matrix rows V1–V16 and V18's
// fallback; T22's answer half). Pure: a ledger built from tool outputs
// shaped exactly as the tools send them, on the contract's fixture
// (Wednesday 14 October 2026, 07:03). Synthetic only.

const NOW = new Date('2026-10-14T07:03:00+13:00');
const ZONE = 'Pacific/Auckland';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = { sam: id(1), alex: id(2), milo: id(3), isla: id(4), nana: id(5) };
const E = {
  swimming: id(10),
  football: id(11),
  board: id(12),
  interviews: id(13),
  birthday: id(14),
};
const T = { paint: id(20) };
const u = (s: string) => ({ untrusted_text: s });
const person = (pid: string): Ref => ({ type: 'person', id: pid });
const swim: Ref = { type: 'event', id: E.swimming, at: '2026-10-14T15:30:00+13:00' };
const foot: Ref = { type: 'event', id: E.football, at: '2026-10-17T09:00:00+13:00' };
const board: Ref = { type: 'event', id: E.board, at: '2026-10-15T17:30:00+13:00' };
const interviews: Ref = { type: 'event', id: E.interviews, at: '2026-10-15T18:00:00+13:00' };
const conflict: Ref = { type: 'conflict', id: 'conflict.overlap:abc' };
const paint: Ref = { type: 'task', id: T.paint };
const gap: Ref = { type: 'gap', id: 'gap:household:2026-10-17:1000' };
const sat: Ref = { type: 'forecast', id: 'forecast:2026-10-17' };

const bundle = {
  now: { weekday: 'wednesday', date: '2026-10-14', time: '07:03', zone: ZONE },
  reader: { ref: person(P.sam), name: u('Sam') },
  people: [
    {
      ref: person(P.sam),
      name: u('Sam'),
      role: 'adult',
      relationship: null,
      age: null,
      in_household: true,
    },
    {
      ref: person(P.alex),
      name: u('Alex'),
      role: 'adult',
      relationship: null,
      age: null,
      in_household: true,
    },
    {
      ref: person(P.milo),
      name: u('Milo'),
      role: 'child',
      relationship: null,
      age: 9,
      in_household: true,
    },
    {
      ref: person(P.isla),
      name: u('Isla'),
      role: 'child',
      relationship: null,
      age: 6,
      in_household: true,
    },
    {
      ref: person(P.nana),
      name: u('Nana Jo'),
      role: 'other',
      relationship: u('Grandmother'),
      age: 79,
      in_household: false,
    },
  ],
  people_count: 5,
  people_truncated: false,
  today: {
    date: '2026-10-14',
    people: [
      {
        items: [
          {
            type: 'event',
            ref: swim,
            title: u('Swimming'),
            all_day: false,
            start: '2026-10-14T15:30:00+13:00',
            end: '2026-10-14T16:15:00+13:00',
            kind: null,
            people: [
              { ref: person(P.milo), name: u('Milo'), role: 'attending' },
              { ref: person(P.sam), name: u('Sam'), role: 'responsible' },
            ],
          },
        ],
      },
    ],
  },
  freshness: {
    calendars: { healthy: 1, stale: 0, failed: 0, never: 0 },
    forecast_fetched_at: '2026-10-14T06:55:00+13:00',
  },
  to_sort: 0,
  focus: null,
};
const bundleRefs = [
  person(P.sam),
  person(P.alex),
  person(P.milo),
  person(P.isla),
  person(P.nana),
  swim,
];

function ledger(): Ledger {
  const l = new Ledger();
  l.addBundle(bundle, bundleRefs);
  l.addResult(
    'get_agenda',
    {
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
    },
    [foot, person(P.milo)],
  );
  l.addCovered('2026-10-17', '2026-10-18');
  l.addResult(
    'get_conflicts',
    {
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
    },
    [conflict, person(P.sam), board, interviews],
  );
  l.addResult(
    'get_tasks',
    {
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
    },
    [paint, person(P.sam)],
  );
  l.addResult(
    'get_gaps',
    {
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
    },
    [gap, foot],
  );
  l.addResult(
    'get_weather',
    {
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
      ],
      uncovered: [],
      credit: 'Open-Meteo',
      count: 1,
      truncated: false,
    },
    [sat],
  );
  l.addResult(
    'get_people',
    {
      people: [
        {
          ref: person(P.nana),
          name: u('Nana Jo'),
          role: 'other',
          in_household: false,
          age: 79,
          next_birthday: { date: '2026-10-20', age: 80 },
        },
      ],
      count: 1,
      truncated: false,
    },
    [person(P.nana)],
  );
  return l;
}

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
    ).toEqual(['time.unsupported']);
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

  it('a cited title containing "Free" passes', () => {
    const l = ledger();
    const freeRef: Ref = { type: 'event', id: id(40), at: '2026-10-17T11:00:00+13:00' };
    l.addResult(
      'get_agenda',
      {
        items: [
          {
            type: 'event',
            ref: freeRef,
            title: u('Free swim day'),
            all_day: false,
            start: freeRef.at,
            end: '2026-10-17T12:00:00+13:00',
            kind: null,
            people: [],
          },
        ],
      },
      [freeRef],
    );
    const r = validateAnswer({
      raw: json(say('Free swim day on Saturday at 11.', [freeRef])),
      ledger: l,
      now: NOW,
      timeZone: ZONE,
    });
    expect(r.ok).toBe(true);
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
