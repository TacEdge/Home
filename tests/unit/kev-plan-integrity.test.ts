import { describe, expect, it } from 'vitest';
import { classifyMessage } from '@/kev/answer/catalogue';
import type { Ledger } from '@/kev/answer/ledger';
import { codesOf, validateAnswer, type ValidateResult } from '@/kev/answer/validate';
import type { Ref } from '@/kev/tools/types';
import { search } from '@/kev/tools/search';
import {
  busyLedger,
  dentistToday,
  foot,
  more,
  NOW,
  paint,
  party,
  swim,
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
