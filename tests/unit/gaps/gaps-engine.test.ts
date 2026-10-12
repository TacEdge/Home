import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgendaEventInput } from '@/domain/engines/agenda';
import {
  COVERAGE_RULES,
  GAP_FLOOR_MINUTES,
  GAP_RULES,
  GapRangeError,
  GapScopeError,
  gaps,
  HOUSEHOLD,
  type Gaps,
} from '@/domain/engines/gaps';
import { PLANNING_FROM, PLANNING_TO } from '@/domain/engines/planning';
import { insightKey } from '@/domain/insights/schema';
import { clockOf } from '@/lib/dates';
import { allDay, timed } from '../today/household';
import {
  ALL_SCOPES,
  att,
  healthy,
  ID,
  inputOf,
  keys,
  mulberry32,
  NZ,
  OUTPUTS,
  resp,
  run,
  said,
  shuffle,
  VISIBLE,
  WED_0703,
  type Run,
} from './fixture';

// The gap engine (M7 Package 2; contract §5.4–§5.5, §8.1, §8.6 G1–G25; ADR
// 0011 §22–§28) over the shared agenda, exactly as the composition runs it.
// Each matrix row is a test named with its id, its expectation written as the
// matrix writes it. Household scope unless a row says otherwise; days in
// October 2026; `now` Wednesday 14 October 07:03 unless stated.

const WEEKLY_SA = 'FREQ=WEEKLY;BYDAY=SA';
const at = (date: string, clock: string, offset = '+13:00') => `${date}T${clock}:00${offset}`;
const on = (
  id: string,
  title: string,
  date: string,
  from: string,
  to: string,
  extra: Partial<AgendaEventInput> = {},
) => timed(id, title, at(date, from), at(date, to), extra);

const football = (extra: Partial<AgendaEventInput> = {}) =>
  on('e-football', 'Football', '2026-10-17', '09:00', '10:00', {
    kind: 'activity',
    rrule: WEEKLY_SA,
    people: att(ID.isla),
    ...extra,
  });

/** Every matrix row's input, so G20 shuffles exactly what G1–G18 ran. */
const G: Record<string, Run> = {
  G1: {},
  G2: { events: [football()] },
  G3: {
    events: [
      football(),
      on('e-milo10', 'Milo thing', '2026-10-17', '10:00', '11:00', { people: att(ID.milo) }),
      on('e-isla11', 'Isla thing', '2026-10-17', '11:00', '12:00', { people: att(ID.isla) }),
    ],
  },
  G4: { events: [on('e-g4', 'Early', '2026-10-18', '08:30', '09:15', { people: att(ID.milo) })] },
  G5a: {
    events: [on('e-g5a', 'Before', '2026-10-18', '07:00', '08:00', { people: att(ID.milo) })],
  },
  G5b: { events: [on('e-g5b', 'Late', '2026-10-18', '19:00', '21:00', { people: att(ID.milo) })] },
  G6: {
    events: [
      timed('e-g6', 'Overnight', at('2026-10-16', '22:00'), at('2026-10-17', '09:30'), {
        people: att(ID.sam),
      }),
      football(),
    ],
  },
  G7: { events: [on('e-g7', 'Recorded for the house', '2026-10-18', '14:00', '15:00')] },
  G8: {
    events: [on('e-g8', 'Nana Jo visit', '2026-10-18', '14:00', '15:00', { people: att(ID.nana) })],
  },
  G9: {
    events: [allDay('e-g9', 'Away for work', '2026-10-16', '2026-10-18', { people: att(ID.sam) })],
  },
  G10: { events: [allDay('e-g10', 'Nana Jo’s birthday', '2026-10-20', '2026-10-21')] },
  G11: {
    people: VISIBLE.map((p) => (p.id === ID.milo ? { ...p, dateOfBirth: '2017-10-18' } : p)),
    projects: [{ id: 'pr-fence', title: 'Back fence', status: 'active', targetDate: '2026-10-18' }],
    tasks: [
      {
        id: 't-due',
        title: 'Sign the form',
        status: 'open',
        dueDate: '2026-10-18',
        assigneePersonId: ID.sam,
      },
    ],
  },
  G12a: {
    tasks: [
      {
        id: 't-g12',
        title: 'Clean the gutters',
        status: 'open',
        dueDate: null,
        scheduledStartsAt: new Date(at('2026-10-18', '10:00')),
        scheduledEndsAt: new Date(at('2026-10-18', '11:00')),
        assigneePersonId: ID.sam,
      },
    ],
  },
  G12b: {
    tasks: [
      {
        id: 't-g12',
        title: 'Clean the gutters',
        status: 'open',
        dueDate: null,
        scheduledStartsAt: new Date(at('2026-10-18', '10:00')),
        scheduledEndsAt: new Date(at('2026-10-18', '11:00')),
        assigneePersonId: null,
      },
    ],
  },
  G13: {
    events: [
      // Skipped on the 24th; changed on the 31st (the change is its own row,
      // with the series' people, and the original is skipped: as the read gives it).
      football({ exdates: ['2026-10-24', '2026-10-31'] }),
      on('e-football-31', 'Football', '2026-10-31', '11:00', '12:00', {
        kind: 'activity',
        people: att(ID.isla),
      }),
    ],
  },
  G14: {
    events: [
      on('e-work', 'Work', '2026-10-12', '09:00', '17:00', {
        kind: 'work',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        people: att(ID.alex),
      }),
    ],
    range: { from: '2026-10-12', to: '2026-10-31' },
  },
  G15: {
    events: [on('e-g15', 'Milo early', '2026-10-18', '09:00', '10:00', { people: att(ID.milo) })],
    now: new Date(at('2026-10-18', '10:07')),
    range: { from: '2026-10-18', to: '2026-10-18' },
  },
  G16: {
    events: [on('e-g16', 'Moment', '2026-10-18', '12:00', '12:00', { people: att(ID.milo) })],
  },
  G17a: {
    events: [
      timed('e-g17a', 'Sleepover', '2026-09-27T01:30:00+12:00', '2026-09-27T09:00:00+13:00', {
        people: att(ID.milo),
      }),
    ],
    now: new Date('2026-09-20T07:03:00+12:00'),
    range: { from: '2026-09-26', to: '2026-09-27' },
  },
  G17b: {
    events: [
      timed('e-g17b', 'Sleepover', '2027-04-04T01:30:00+13:00', '2027-04-04T09:00:00+12:00', {
        people: att(ID.milo),
      }),
    ],
    now: new Date('2027-03-28T07:03:00+13:00'),
    range: { from: '2027-04-03', to: '2027-04-04' },
  },
  G18: {
    events: [
      timed('e-g18', 'Call', '2026-10-18T08:00:00+11:00', '2026-10-18T09:00:00+11:00', {
        timeZone: 'Australia/Sydney',
        people: att(ID.milo),
      }),
    ],
  },
};

describe('constants and rules are the contract’s (§5.4, §5.5)', () => {
  it('planning hours, the floor, and every rule documented in §5', () => {
    expect([PLANNING_FROM, PLANNING_TO]).toEqual(['08:00', '20:00']);
    expect(GAP_FLOOR_MINUTES).toBe(60);
    const contract = readFileSync('docs/m7/M7-BUILD-CONTRACT.md', 'utf8');
    for (const rule of [...GAP_RULES, ...COVERAGE_RULES]) expect(contract, rule).toContain(rule);
  });
});

describe('G — gaps (contract §8.6)', () => {
  it('G1: Sunday 18, nothing recorded: one gap, gap:household:2026-10-18:0800-2000', () => {
    const r = run(G.G1!);
    expect(keys(r, HOUSEHOLD).filter((k) => k.includes('2026-10-18'))).toEqual([
      'gap:household:2026-10-18:0800-2000',
    ]);
  });

  it('G2: Saturday 17, Football 09:00–10:00 (Isla): 08:00–09:00 and 10:00–20:00', () => {
    expect(said(run(G.G2!), '2026-10-17')).toBe('08:00–09:00 and 10:00–20:00');
  });

  it('G3: G2 plus Milo 10:00–11:00 and Isla 11:00–12:00: 08:00–09:00 and 12:00–20:00; no gap at 10:00 or 11:00', () => {
    const r = run(G.G3!);
    expect(said(r, '2026-10-17')).toBe('08:00–09:00 and 12:00–20:00');
    // Touching commitments merge: nothing starts at 10:00 or 11:00.
    expect(keys(r, HOUSEHOLD).filter((k) => /:2026-10-17:1[01]00-/.test(k))).toEqual([]);
    // The commitments either side: Football before, then the last of the run of three.
    const [first, second] = r.gaps.filter((g) => g.scope === HOUSEHOLD && g.date === '2026-10-17');
    expect(first!.before).toBeNull();
    expect(first!.after).toEqual({ kind: 'event', id: 'e-football', occurrenceDate: '2026-10-17' });
    expect(second!.before).toEqual({ kind: 'event', id: 'e-isla11', occurrenceDate: '2026-10-17' });
    expect(second!.after).toBeNull();
  });

  it('G4: Sunday, Milo 08:30–09:15: 09:15–20:00 only (08:00–08:30 is under the floor)', () => {
    expect(said(run(G.G4!), '2026-10-18')).toBe('09:15–20:00');
  });

  it('G5: Sunday, an event 07:00–08:00 / 19:00–21:00 (Milo): 08:00–20:00 / 08:00–19:00', () => {
    const a = run(G.G5a!);
    const b = run(G.G5b!);
    expect(said(a, '2026-10-18')).toBe('08:00–20:00');
    expect(said(b, '2026-10-18')).toBe('08:00–19:00');
    // An event ending at the planning start is not the commitment before it.
    expect(a.gaps.find((g) => g.key === 'gap:household:2026-10-18:0800-2000')!.before).toBeNull();
    expect(said(a, '2026-10-18', ID.milo)).toBe('08:00–20:00');
    expect(said(b, '2026-10-18', ID.milo)).toBe('08:00–19:00');
  });

  it('G6: Sam, Friday 16 22:00 to Saturday 17 09:30, plus Football: Friday 08:00–20:00; Saturday 10:00–20:00', () => {
    const r = run(G.G6!);
    expect(said(r, '2026-10-16')).toBe('08:00–20:00');
    expect(said(r, '2026-10-17')).toBe('10:00–20:00');
    expect(said(r, '2026-10-17', ID.sam)).toBe('09:30–20:00');
  });

  it('G7: Sunday, a timed event 14:00–15:00 with no one on it: household 08:00–14:00 and 15:00–20:00; Milo 08:00–20:00, its Why naming the event', () => {
    const r = run(G.G7!);
    expect(said(r, '2026-10-18')).toBe('08:00–14:00 and 15:00–20:00');
    expect(said(r, '2026-10-18', ID.milo)).toBe('08:00–20:00');
    const milo = r.gaps.find((g) => g.key === `gap:${ID.milo}:2026-10-18:0800-2000`)!;
    const named = { kind: 'event', id: 'e-g7', occurrenceDate: '2026-10-18' };
    expect(milo.unblocking).toEqual([named]);
    expect(milo.facts).toContainEqual(named);
    // Not named on another day, nor on the household's (it blocks those).
    for (const g of r.gaps.filter((g) => g.date !== '2026-10-18' || g.scope === HOUSEHOLD))
      expect(g.unblocking).toEqual([]);
  });

  it('G8: G7 with only Nana Jo on it: as G7', () => {
    const r = run(G.G8!);
    expect(said(r, '2026-10-18')).toBe('08:00–14:00 and 15:00–20:00');
    expect(said(r, '2026-10-18', ID.milo)).toBe('08:00–20:00');
    expect(r.gaps.find((g) => g.key === `gap:${ID.milo}:2026-10-18:0800-2000`)!.unblocking).toEqual(
      [{ kind: 'event', id: 'e-g8', occurrenceDate: '2026-10-18' }],
    );
  });

  it('G9: an all-day event Friday 16 to Saturday 17 (end date 18) with Sam: no gaps on 16 or 17; 08:00–20:00 on 18; Sam the same; Milo on 16 08:00–20:00', () => {
    const r = run(G.G9!);
    for (const scope of [HOUSEHOLD, ID.sam]) {
      expect(said(r, '2026-10-16', scope)).toBe('');
      expect(said(r, '2026-10-17', scope)).toBe('');
      expect(said(r, '2026-10-18', scope)).toBe('08:00–20:00');
    }
    expect(said(r, '2026-10-16', ID.milo)).toBe('08:00–20:00');
  });

  it('G10: Tuesday 20, Nana Jo’s birthday (all-day, no one): 08:00–20:00; the day’s Why names it', () => {
    const r = run(G.G10!);
    const named = { kind: 'event', id: 'e-g10', occurrenceDate: '2026-10-20' };
    for (const scope of ALL_SCOPES) {
      expect(said(r, '2026-10-20', scope)).toBe('08:00–20:00');
      expect(r.gaps.find((g) => g.scope === scope && g.date === '2026-10-20')!.unblocking).toEqual([
        named,
      ]);
    }
    // With only Nana Jo (outside the household) on it, the same: the household filter.
    const nana = run({
      events: [
        allDay('e-g10', 'Nana Jo’s birthday', '2026-10-20', '2026-10-21', {
          people: att(ID.nana),
        }),
      ],
    });
    expect(said(nana, '2026-10-20')).toBe('08:00–20:00');
    expect(
      nana.gaps.find((g) => g.key === 'gap:household:2026-10-20:0800-2000')!.unblocking,
    ).toEqual([named]);
  });

  it('G11: Sunday, Milo’s birthday (from his record), a project target and a task due: 08:00–20:00', () => {
    const r = run(G.G11!);
    for (const scope of ALL_SCOPES) expect(said(r, '2026-10-18', scope)).toBe('08:00–20:00');
    expect(r.gaps.every((g) => g.unblocking.length === 0)).toBe(true);
  });

  it('G12: Sunday, a task scheduled 10:00–11:00 assigned to Sam / with no assignee: household 08:00–10:00 and 11:00–20:00 in both; Sam blocked / not; Milo 08:00–20:00', () => {
    const sam = run(G.G12a!);
    const none = run(G.G12b!);
    for (const r of [sam, none]) {
      expect(said(r, '2026-10-18')).toBe('08:00–10:00 and 11:00–20:00');
      expect(said(r, '2026-10-18', ID.milo)).toBe('08:00–20:00');
    }
    expect(said(sam, '2026-10-18', ID.sam)).toBe('08:00–10:00 and 11:00–20:00');
    expect(said(none, '2026-10-18', ID.sam)).toBe('08:00–20:00');
    expect(sam.gaps.find((g) => g.key === 'gap:household:2026-10-18:0800-1000')!.after).toEqual({
      kind: 'task',
      id: 't-g12',
    });
  });

  it('G13: Football skipped on 24 October / changed on 31 October to 11:00–12:00: 24th 08:00–20:00 / 31st 08:00–11:00 and 12:00–20:00', () => {
    const r = run(G.G13!);
    expect(said(r, '2026-10-17')).toBe('08:00–09:00 and 10:00–20:00');
    expect(said(r, '2026-10-24')).toBe('08:00–20:00');
    expect(said(r, '2026-10-31')).toBe('08:00–11:00 and 12:00–20:00');
  });

  it('G14: Alex’s weekly work series, weekdays 09:00–17:00 (kind work): Thursday 15 08:00–09:00 and 17:00–20:00', () => {
    const r = run(G.G14!);
    expect(said(r, '2026-10-15')).toBe('08:00–09:00 and 17:00–20:00');
    expect(said(r, '2026-10-15', ID.alex)).toBe('08:00–09:00 and 17:00–20:00');
    expect(said(r, '2026-10-17')).toBe('08:00–20:00');
  });

  it('G15: now Sunday 18 10:07; Milo 09:00–10:00: key gap:household:2026-10-18:1000-2000, shown from 10:07; at 18:30 shown 18:30–20:00, same key; at 19:05 no gap', () => {
    const r = run(G.G15!);
    const g = r.gaps.filter((x) => x.scope === HOUSEHOLD);
    expect(g.map((x) => x.key)).toEqual(['gap:household:2026-10-18:1000-2000']);
    expect(clockOf(g[0]!.shown.from, NZ)).toBe('10:07');
    expect(clockOf(g[0]!.stretch.from, NZ)).toBe('10:00');
    const later = run({ ...G.G15!, now: new Date(at('2026-10-18', '18:30')) });
    const h = later.gaps.filter((x) => x.scope === HOUSEHOLD);
    expect(h.map((x) => x.key)).toEqual(['gap:household:2026-10-18:1000-2000']);
    expect([clockOf(h[0]!.shown.from, NZ), clockOf(h[0]!.shown.to, NZ)]).toEqual([
      '18:30',
      '20:00',
    ]);
    // The key stays put however `now` moves within the day.
    for (const clock of ['10:00', '10:01', '12:00', '17:59', '19:00'])
      expect(
        keys(run({ ...G.G15!, now: new Date(at('2026-10-18', clock)) }), HOUSEHOLD),
        clock,
      ).toEqual(['gap:household:2026-10-18:1000-2000']);
    expect(keys(run({ ...G.G15!, now: new Date(at('2026-10-18', '19:05')) }))).toEqual([]);
    expect(keys(run({ ...G.G15!, now: new Date(at('2026-10-18', '19:01')) }))).toEqual([]);
  });

  it('G16: a zero-length event at 12:00: no effect', () => {
    const r = run(G.G16!);
    expect(said(r, '2026-10-18')).toBe('08:00–20:00');
    expect(said(r, '2026-10-18', ID.milo)).toBe('08:00–20:00');
    expect(r.gaps.every((g) => g.unblocking.length === 0)).toBe(true);
  });

  it('G17: 27 September 2026 (DST starts) / 4 April 2027 (ends), Milo 01:30–09:00: one gap 09:00–20:00 each; the planning day is 12 hours on both', () => {
    const start = run(G.G17a!);
    const end = run(G.G17b!);
    expect(keys(start, HOUSEHOLD)).toEqual([
      'gap:household:2026-09-26:0800-2000',
      'gap:household:2026-09-27:0900-2000',
    ]);
    expect(keys(end, HOUSEHOLD)).toEqual([
      'gap:household:2027-04-03:0800-2000',
      'gap:household:2027-04-04:0900-2000',
    ]);
    // Isla has nothing: her planning day is exactly 12 hours on the change days and the days before.
    for (const r of [start, end])
      for (const g of r.gaps.filter((x) => x.scope === ID.isla)) {
        expect(g.stretch.to.getTime() - g.stretch.from.getTime(), g.key).toBe(12 * 3_600_000);
        expect(g.key).toMatch(/:0800-2000$/);
      }
  });

  it('G18: Sunday 18, an event kept in Australia/Sydney 08:00–09:00 with Milo: 08:00–10:00 and 11:00–20:00', () => {
    const r = run(G.G18!);
    expect(said(r, '2026-10-18')).toBe('08:00–10:00 and 11:00–20:00');
    expect(said(r, '2026-10-18', ID.milo)).toBe('08:00–10:00 and 11:00–20:00');
  });

  it('G22: Sam, a timed event Friday 16 18:00 to Sunday 18 12:00: Friday 08:00–18:00; Saturday none; Sunday 12:00–20:00', () => {
    const r = run({
      events: [
        timed('e-g22', 'Away', at('2026-10-16', '18:00'), at('2026-10-18', '12:00'), {
          people: att(ID.sam),
        }),
      ],
    });
    for (const scope of [HOUSEHOLD, ID.sam]) {
      expect(said(r, '2026-10-16', scope)).toBe('08:00–18:00');
      expect(said(r, '2026-10-17', scope)).toBe('');
      expect(said(r, '2026-10-18', scope)).toBe('12:00–20:00');
    }
    expect(said(r, '2026-10-17', ID.milo)).toBe('08:00–20:00');
  });

  it('G23: an agenda covering 14–16 October asked for 17 October: refused; nothing computed', () => {
    expect(() =>
      gaps(
        inputOf({
          range: { from: '2026-10-17', to: '2026-10-17' },
          agendaRange: { from: '2026-10-14', to: '2026-10-16' },
        }),
      ),
    ).toThrow(GapRangeError);
    // A range starting before the agenda is refused too.
    expect(() =>
      gaps(
        inputOf({
          range: { from: '2026-10-13', to: '2026-10-15' },
          agendaRange: { from: '2026-10-14', to: '2026-10-16' },
        }),
      ),
    ).toThrow(GapRangeError);
  });

  it('G24: a synced event on a calendar whose usual person is Milo (as the read resolves it), Sunday 14:00–15:00: blocks Milo and the household; not Isla', () => {
    const r = run({
      events: [on('e-g24', 'Club', '2026-10-18', '14:00', '15:00', { people: att(ID.milo) })],
    });
    for (const scope of [HOUSEHOLD, ID.milo])
      expect(said(r, '2026-10-18', scope)).toBe('08:00–14:00 and 15:00–20:00');
    expect(said(r, '2026-10-18', ID.isla)).toBe('08:00–20:00');
    // On a household person's scope, so named in nobody's Why.
    expect(r.gaps.every((g) => g.unblocking.length === 0)).toBe(true);
  });

  it('G25: Sunday, Milo responsible (not attending) on an event 14:00–15:00: blocks Milo and the household', () => {
    const r = run({
      events: [on('e-g25', 'Bake sale', '2026-10-18', '14:00', '15:00', { people: resp(ID.milo) })],
    });
    for (const scope of [HOUSEHOLD, ID.milo])
      expect(said(r, '2026-10-18', scope)).toBe('08:00–14:00 and 15:00–20:00');
    expect(said(r, '2026-10-18', ID.isla)).toBe('08:00–20:00');
  });
});

describe('G19 — coverage (contract §5.5)', () => {
  const sunday = (calendars: Run['calendars']) => run({ calendars });
  const now = WED_0703;
  const day = 24 * 3_600_000;

  it('G19: no live calendar / all healthy / one 24:01 old / one failed / one never refreshed / only archived: unknown with no gaps / recorded / partial ×3 / unknown', () => {
    const none = sunday([]);
    expect(none).toEqual({ coverage: { rule: 'coverage.unknown', calendars: [] }, gaps: [] });

    const ok = sunday([healthy(now), healthy(now, { id: 'c-second', lastSyncStatus: 'partial' })]);
    expect(ok.coverage.rule).toBe('coverage.recorded');
    expect(ok.coverage.calendars.map((c) => [c.id, c.health])).toEqual([
      ['c-household', 'ok'],
      ['c-second', 'ok'],
    ]);
    expect(ok.gaps.length).toBeGreaterThan(0);

    const stale = sunday([
      healthy(now),
      healthy(now, {
        id: 'c-stale',
        lastSyncedAt: new Date(now.getTime() - day - 60_000),
        lastAttemptAt: new Date(now.getTime() - day - 60_000),
      }),
    ]);
    // At exactly 24 hours it is still M5's healthy (over 24 hours is stale).
    const edge = sunday([healthy(now, { lastSyncedAt: new Date(now.getTime() - day) })]);
    const failed = sunday([
      healthy(now),
      healthy(now, { id: 'c-failed', lastSyncStatus: 'unreachable' }),
    ]);
    const never = sunday([
      healthy(now),
      healthy(now, { id: 'c-new', lastSyncedAt: null, lastAttemptAt: null, lastSyncStatus: null }),
    ]);
    expect(edge.coverage.rule).toBe('coverage.recorded');
    for (const [r, id, health] of [
      [stale, 'c-stale', 'stale'],
      [failed, 'c-failed', 'failed'],
      [never, 'c-new', 'never'],
    ] as const) {
      expect(r.coverage.rule, id).toBe('coverage.partial');
      expect(r.coverage.calendars.find((c) => c.id === id)!.health).toBe(health);
      // Gaps are still returned, and each names every calendar consulted.
      expect(said(r, '2026-10-18')).toBe('08:00–20:00');
      for (const g of r.gaps)
        expect(g.facts.filter((f) => f.kind === 'calendar')).toEqual(r.coverage.calendars);
    }

    const archived = sunday([healthy(now, { archivedAt: new Date(now.getTime() - day) })]);
    expect(archived).toEqual({ coverage: { rule: 'coverage.unknown', calendars: [] }, gaps: [] });
    // An archived calendar beside a healthy one is not consulted.
    const beside = sunday([
      healthy(now),
      healthy(now, { id: 'c-old', archivedAt: new Date(0), lastSyncStatus: 'unreachable' }),
    ]);
    expect(beside.coverage).toEqual({
      rule: 'coverage.recorded',
      calendars: [ok.coverage.calendars[0]],
    });
  });
});

describe('extra edges', () => {
  const sunday = '2026-10-18';
  it('exactly 60 minutes is kept; 59 is dropped', () => {
    const r = (end: string) =>
      run({
        events: [
          on('e-a', 'Morning', sunday, '08:00', end, { people: att(ID.milo) }),
          on('e-b', 'Afternoon', sunday, '13:00', '20:00', { people: att(ID.milo) }),
        ],
      });
    expect(said(r('12:00'), sunday)).toBe('12:00–13:00');
    expect(said(r('12:01'), sunday)).toBe('');
  });

  it('overlapping and touching commitments merge; the commitment before is the last to start of those ending there', () => {
    const r = run({
      events: [
        on('e-long', 'Long', sunday, '09:00', '12:00', { people: att(ID.milo) }),
        on('e-short', 'Short', sunday, '11:00', '12:00', { people: att(ID.isla) }),
        on('e-touch', 'Touch', sunday, '12:00', '13:00', { people: att(ID.sam) }),
        on('e-inner', 'Inner', sunday, '09:30', '10:00', { people: att(ID.alex) }),
      ],
    });
    expect(said(r, sunday)).toBe('08:00–09:00 and 13:00–20:00');
    const g = r.gaps.find((x) => x.key === 'gap:household:2026-10-18:1300-2000')!;
    expect(g.before).toEqual({ kind: 'event', id: 'e-touch', occurrenceDate: sunday });
    expect(said(r, sunday, ID.milo)).toBe('08:00–09:00 and 12:00–20:00');
    expect(r.gaps.find((x) => x.key === `gap:${ID.milo}:2026-10-18:1200-2000`)!.before).toEqual({
      kind: 'event',
      id: 'e-long',
      occurrenceDate: sunday,
    });
  });

  it('the first and last days of a range: a carry-over from before it and one running past it', () => {
    const r = run({
      range: { from: '2026-10-15', to: '2026-10-16' },
      events: [
        timed('e-in', 'Carried in', at('2026-10-14', '18:00'), at('2026-10-15', '10:00'), {
          people: att(ID.milo),
        }),
        timed('e-out', 'Carried out', at('2026-10-16', '19:00'), at('2026-10-17', '09:00'), {
          people: att(ID.milo),
        }),
      ],
      tasks: [
        {
          id: 't-night',
          title: 'Overnight bake',
          status: 'open',
          dueDate: null,
          scheduledStartsAt: new Date(at('2026-10-15', '19:00')),
          scheduledEndsAt: new Date(at('2026-10-16', '09:00')),
          assigneePersonId: ID.sam,
        },
      ],
    });
    expect([...new Set(r.gaps.map((g) => g.date))]).toEqual(['2026-10-15', '2026-10-16']);
    expect(said(r, '2026-10-15')).toBe('10:00–19:00');
    expect(said(r, '2026-10-16')).toBe('09:00–19:00');
    expect(said(r, '2026-10-16', ID.sam)).toBe('09:00–20:00');
    expect(said(r, '2026-10-16', ID.milo)).toBe('08:00–19:00');
    // A task window that began the day before the range still blocks it.
    const later = run({
      range: { from: '2026-10-16', to: '2026-10-16' },
      agendaRange: { from: '2026-10-15', to: '2026-10-16' },
      tasks: [
        {
          id: 't-night',
          title: 'Overnight bake',
          status: 'open',
          dueDate: null,
          scheduledStartsAt: new Date(at('2026-10-15', '19:00')),
          scheduledEndsAt: new Date(at('2026-10-16', '09:00')),
          assigneePersonId: ID.sam,
        },
      ],
    });
    expect(said(later, '2026-10-16', ID.sam)).toBe('09:00–20:00');
    expect(said(later, '2026-10-16')).toBe('09:00–20:00');
  });

  it('a fortnightly series, through the agenda’s occurrences', () => {
    const r = run({
      events: [football({ rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA' })],
    });
    expect(said(r, '2026-10-17')).toBe('08:00–09:00 and 10:00–20:00');
    expect(said(r, '2026-10-24')).toBe('08:00–20:00');
    expect(said(r, '2026-10-31')).toBe('08:00–09:00 and 10:00–20:00');
  });

  it('a series kept in another zone, across both zones’ DST changes, blocks the home stretch its instants cover', () => {
    // Sundays 08:00–09:00 in Sydney: NZ moves on 27 September, Sydney on 4 October.
    const r = run({
      now: new Date('2026-09-19T07:03:00+12:00'),
      range: { from: '2026-09-20', to: '2026-10-04' },
      events: [
        timed('e-sydney', 'Call', '2026-09-20T08:00:00+10:00', '2026-09-20T09:00:00+10:00', {
          timeZone: 'Australia/Sydney',
          rrule: 'FREQ=WEEKLY;BYDAY=SU',
          people: att(ID.milo),
        }),
      ],
    });
    expect(said(r, '2026-09-20', ID.milo)).toBe('08:00–10:00 and 11:00–20:00');
    expect(said(r, '2026-09-27', ID.milo)).toBe('08:00–11:00 and 12:00–20:00');
    expect(said(r, '2026-10-04', ID.milo)).toBe('08:00–10:00 and 11:00–20:00');
  });

  it('an overnight repeating commitment blocks the morning after, every week', () => {
    const r = run({
      events: [
        timed('e-shift', 'Night shift', at('2026-10-16', '22:00'), at('2026-10-17', '09:30'), {
          rrule: 'FREQ=WEEKLY;BYDAY=FR',
          people: att(ID.sam),
        }),
      ],
    });
    for (const sat of ['2026-10-17', '2026-10-24', '2026-10-31'])
      expect(said(r, sat, ID.sam), sat).toBe('09:30–20:00');
    for (const fri of ['2026-10-16', '2026-10-23', '2026-10-30'])
      expect(said(r, fri, ID.sam), fri).toBe('08:00–20:00');
  });

  it('an archived event leaves the agenda and its stretch returns; restored, the keys are as before', () => {
    const before = run(G.G2!);
    const archived = run({ events: [] });
    expect(said(archived, '2026-10-17')).toBe('08:00–20:00');
    const restored = run(G.G2!);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(before));
  });

  it('a person scope the reader cannot see is refused; a repeated scope is one scope', () => {
    expect(() => run({ scopes: [HOUSEHOLD, 'p-unknown'] })).toThrow(GapScopeError);
    expect(run({ scopes: [HOUSEHOLD, HOUSEHOLD] })).toEqual(run({ scopes: [HOUSEHOLD] }));
  });

  it('days before today and today’s passed stretches are not returned', () => {
    const r = run({ range: { from: '2026-10-12', to: '2026-10-14' } });
    expect(r.gaps.map((g) => g.date)).toEqual(r.gaps.map(() => '2026-10-14'));
    // Today at 07:03: the whole planning day is ahead, so shown is the stretch.
    for (const g of r.gaps) expect(g.shown).toEqual(g.stretch);
  });
});

describe('identity (contract §5.4, §5.7 as it applies to gap keys)', () => {
  const saturday = (r: Gaps) => keys(r).filter((k) => k.includes(':2026-10-17:'));
  const base = saturday(run(G.G2!));

  it('a moved boundary moves the key', () => {
    const moved = saturday(
      run({
        events: [
          football({
            startsAt: new Date(at('2026-10-17', '09:30')),
            endsAt: new Date(at('2026-10-17', '10:30')),
          }),
        ],
      }),
    );
    expect(moved).not.toEqual(base);
    expect(moved).toContain('gap:household:2026-10-17:1030-2000');
    expect(moved).not.toContain('gap:household:2026-10-17:1000-2000');
    // Only the stretches whose bounds moved change: the household's and Isla's.
    const of = (ks: string[], scope: string) => ks.filter((k) => k.startsWith(`gap:${scope}:`));
    for (const scope of [HOUSEHOLD, ID.isla]) expect(of(moved, scope)).not.toEqual(of(base, scope));
    for (const scope of [ID.milo, ID.sam, ID.alex])
      expect(of(moved, scope)).toEqual(of(base, scope));
  });

  it('a changed title, kind or role, with the same times and blocking, keeps every key and gap', () => {
    const same = run({ events: [football({ title: 'Football (home game)', kind: 'other' })] });
    const role = run({ events: [football({ people: resp(ID.isla) })] });
    const g2 = run(G.G2!);
    expect(JSON.stringify(same.gaps)).toBe(JSON.stringify(g2.gaps));
    expect(JSON.stringify(role.gaps)).toBe(JSON.stringify(g2.gaps));
  });

  it('a person added to an event changes only that person’s keys', () => {
    const more = run({ events: [football({ people: att(ID.isla, ID.milo) })] });
    const g2 = run(G.G2!);
    for (const scope of [HOUSEHOLD, ID.isla, ID.sam, ID.alex])
      expect(keys(more, scope)).toEqual(keys(g2, scope));
    expect(keys(more, ID.milo)).not.toEqual(keys(g2, ID.milo));
  });
});

describe('G20, G21 — determinism and keys', () => {
  /** Two commitments with identical bounds and two ending together: the tie-breaks matter. */
  const TIES: Run = {
    events: [
      on('e-tie-b', 'Tie B', '2026-10-18', '10:00', '11:00', { people: att(ID.milo) }),
      on('e-tie-a', 'Tie A', '2026-10-18', '10:00', '11:00', { people: att(ID.isla) }),
      on('e-end-b', 'End B', '2026-10-18', '13:00', '15:00', { people: att(ID.sam) }),
      on('e-end-a', 'End A', '2026-10-18', '14:00', '15:00', { people: att(ID.alex) }),
      on('e-end-c', 'End C', '2026-10-18', '14:00', '15:00', { people: att(ID.alex) }),
      allDay('e-holiday-b', 'Holiday B', '2026-10-18', '2026-10-19'),
      allDay('e-holiday-a', 'Holiday A', '2026-10-18', '2026-10-19'),
      on('e-lone-b', 'Lone B', '2026-10-18', '17:00', '17:30'),
      on('e-lone-a', 'Lone A', '2026-10-18', '17:00', '17:30'),
    ],
  };

  it('the tie-breaks are explicit: the commitment after is the first by reference; before is the last to start, then the first by reference', () => {
    const r = run(TIES);
    const first = r.gaps.find((g) => g.key === 'gap:household:2026-10-18:0800-1000')!;
    expect(first.after).toEqual({ kind: 'event', id: 'e-tie-a', occurrenceDate: '2026-10-18' });
    const mid = r.gaps.find((g) => g.key === 'gap:household:2026-10-18:1100-1300')!;
    expect(mid.before).toEqual({ kind: 'event', id: 'e-tie-a', occurrenceDate: '2026-10-18' });
    const late = r.gaps.find((g) => g.key === 'gap:household:2026-10-18:1500-1700')!;
    expect(late.before).toEqual({ kind: 'event', id: 'e-end-a', occurrenceDate: '2026-10-18' });
    expect(late.unblocking.map((f) => f.id)).toEqual(['e-holiday-a', 'e-holiday-b']);
    const milo = r.gaps.find((g) => g.key === `gap:${ID.milo}:2026-10-18:1100-2000`)!;
    expect(milo.unblocking.map((f) => f.id)).toEqual([
      'e-holiday-a',
      'e-holiday-b',
      'e-lone-a',
      'e-lone-b',
    ]);
    // Across scopes, the same date and start fall back to the key.
    const at0800 = r.gaps.filter((g) => g.date === '2026-10-18' && g.key.endsWith(':0800-1000'));
    expect(at0800.map((g) => g.key)).toEqual([...at0800.map((g) => g.key)].sort());
    expect(at0800.length).toBeGreaterThan(1);
  });

  it('G20: G1–G18 inputs shuffled over eight seeds, repeated: identical gaps, keys and order, deep and byte for byte', () => {
    const SEEDS = [1, 7, 42, 2026, 31337, 65_000, 123_457, 999_983];
    const scenarios = { ...G, TIES };
    for (const [row, scenario] of Object.entries(scenarios)) {
      const plain = inputOf(scenario);
      // A second calendar, so the calendars' order is shuffled too.
      const input = {
        ...plain,
        calendars: [...plain.calendars, healthy(plain.now, { id: 'c-second' })],
      };
      const base = gaps(input);
      expect(base.gaps.length, row).toBeGreaterThan(0);
      const orders = new Set<string>();
      for (const seed of SEEDS) {
        const random = mulberry32(seed);
        const shuffled = {
          ...input,
          days: shuffle(input.days, random).map((d) => ({ ...d, items: shuffle(d.items, random) })),
          people: shuffle(input.people, random),
          tasks: shuffle(input.tasks, random),
          calendars: shuffle(input.calendars, random),
          scopes: shuffle(input.scopes, random),
        };
        orders.add(shuffled.scopes.join(','));
        const out = gaps(shuffled);
        expect(out, `${row} seed ${seed}`).toEqual(base);
        expect(JSON.stringify(out), `${row} seed ${seed}`).toBe(JSON.stringify(base));
        // Repeated: the same again.
        expect(JSON.stringify(gaps(shuffled))).toBe(JSON.stringify(out));
      }
      // The shuffles really are different orders.
      expect(orders.size, row).toBeGreaterThan(4);
      OUTPUTS.push(base);
    }
  });

  it('G21: every key from G1–G19, and a person scope, matches insightKey, fits 200 characters and carries no text', () => {
    const all = Object.values(G).flatMap((s) => keys(run(s)));
    expect(all.length).toBeGreaterThan(50);
    expect(all.some((k) => k.startsWith(`gap:${ID.milo}:`))).toBe(true);
    const uuid = '0b6c8d2e-4f1a-4c3b-9d5e-7a8f9b0c1d2e';
    const person = run({
      people: [...VISIBLE, { id: uuid, inHousehold: true }],
      scopes: [uuid],
    });
    const longest = person.gaps.map((g) => g.key);
    expect(longest).toContain(`gap:${uuid}:2026-10-18:0800-2000`);
    for (const k of [...all, ...longest]) {
      expect(insightKey.safeParse(k).success, k).toBe(true);
      expect(k.length, k).toBeLessThanOrEqual(200);
      expect(k, k).toMatch(/^gap:(household|[A-Za-z0-9-]+):\d{4}-\d{2}-\d{2}:\d{4}-\d{4}$/);
    }
  });
});

describe('purity, facts and words', () => {
  it('every gap carries its rule and facts that resolve to its inputs', () => {
    const r = run(G.G7!);
    for (const g of r.gaps) {
      expect(GAP_RULES).toContain(g.rule);
      expect(g.rule).toBe(g.scope === HOUSEHOLD ? 'gap.household' : 'gap.person');
      expect(g.facts[0]).toEqual({ kind: 'planning', from: '08:00', to: '20:00' });
      expect(g.facts[1]).toEqual({ kind: 'range', from: g.date, to: g.date });
      const people = g.facts.filter((f) => f.kind === 'person').map((f) => f.id);
      expect(people).toEqual(
        g.scope === HOUSEHOLD ? [ID.alex, ID.isla, ID.milo, ID.sam].sort() : [g.scope],
      );
      for (const f of [g.before, g.after, ...g.unblocking])
        if (f) expect(g.facts).toContainEqual(f);
      expect(g.facts.filter((f) => f.kind === 'calendar')).toEqual(r.coverage.calendars);
    }
  });

  it('the engines import no db, app, kev, ui, integrations or clock', () => {
    for (const f of ['src/domain/engines/gaps.ts', 'src/domain/engines/planning.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/@\/(db|app|kev|ui|integrations)|from '\.\.\/\.\.\/(db|app)/);
      expect(src, f).not.toMatch(/Date\.now\(|new Date\(\)/);
    }
  });

  it('no word from the M5, M6 or M7 forbidden lists in any output (keys, rules, fact kinds, health)', () => {
    const forbidden =
      /\b(needs?|needs you|nobody's down|who\?|lift|pick up|drop off|taking|driving|free|available|out|easy|busy|full|calm|covered|sorted|nothing needs|should|probably|nothing prepared|packed|steady|clear|quiet|stressful|overwhelming|away|unavailable|in two places|double-booked|can't|clash|worth deciding|nothing on|everyone can|both of you|you could|a good time|good day|good for|best|ideal|perfect|nice|great|fine|mild|lovely|chance to|opportunity|room for|fits|suitable|recommend|window|out of date|likely)\b/i;
    expect(OUTPUTS.length).toBeGreaterThan(40);
    // Everything the engine emits, with the fixture's own ids and titles removed
    // (household records shown as recorded are exempt).
    const emitted = JSON.stringify(OUTPUTS).replace(/"(id|scope)":"[^"]*"/g, '"$1":""');
    expect(emitted).not.toMatch(forbidden);
    expect(JSON.stringify(OUTPUTS)).not.toMatch(/Football|Nana Jo|Sleepover/);
  });
});
