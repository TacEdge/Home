import { describe, expect, it } from 'vitest';
import {
  compareRegularWeekEntries,
  regularWeek,
  type RegularWeekEntry,
  type RegularWeekEventInput,
} from '@/domain/engines/profile';
import { weeklyCadence } from '@/domain/engines/recurrence';

// The regular week (M4 contract §3.6, ADR 0007 §45): a person's weekly and
// fortnightly series, on the weekdays and at the home-zone times they next
// happen. Conservative: anything that is not a plain weekly rhythm is left
// out. Wednesday 14 October 2026 is the fixture family's scenario day.

const NZ = 'Pacific/Auckland';
const TODAY = '2026-10-14'; // a Wednesday
const opts = { today: TODAY, timeZone: NZ };
const milo = [{ personId: 'milo', role: 'attending' as const }];

/** A timed series, its first start given as an instant. */
const timed = (
  id: string,
  title: string,
  startsAt: string,
  rrule: string | null,
  extra: Partial<RegularWeekEventInput> = {},
): RegularWeekEventInput =>
  ({
    id,
    title,
    allDay: false,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 60 * 60_000),
    timeZone: NZ,
    rrule,
    exdates: null,
    people: milo,
    ...extra,
  }) as RegularWeekEventInput;
const allDay = (
  id: string,
  title: string,
  startDate: string,
  endDate: string,
  rrule: string | null,
): RegularWeekEventInput => ({
  id,
  title,
  allDay: true,
  startDate,
  endDate,
  rrule,
  exdates: null,
  people: milo,
});
const show = (entries: RegularWeekEntry[]) =>
  entries.map(
    (e) =>
      `${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'][e.weekday]} ${e.allDay ? 'all day' : e.time} ${e.title}${e.cadence === 'fortnightly' ? ' (fortnightly)' : ''}`,
  );

// Wednesday 14 Oct 15:30 NZDT = 02:30Z; Saturday 17 Oct 11:40 NZDT = 22:40Z on the 16th.
const swim = timed('swim', 'Swimming', '2026-10-14T02:30:00Z', 'FREQ=WEEKLY;BYDAY=WE');

describe('weeklyCadence: only plain weekly rhythms', () => {
  it('reads weekly and fortnightly, with or without weekdays, COUNT, UNTIL and WKST', () => {
    for (const r of [
      'FREQ=WEEKLY',
      'FREQ=WEEKLY;BYDAY=WE',
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261212T200000Z',
      'FREQ=WEEKLY;COUNT=10;BYDAY=TU',
      'FREQ=WEEKLY;WKST=MO;BYDAY=WE',
    ])
      expect(weeklyCadence(r), r).toBe('weekly');
    for (const r of [
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',
      'FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=TU,TH',
    ])
      expect(weeklyCadence(r), r).toBe('fortnightly');
  });

  it('leaves out everything else rather than guessing', () => {
    for (const r of [
      null,
      '',
      'FREQ=DAILY',
      'FREQ=WEEKLY;INTERVAL=3;BYDAY=WE', // every third week: not a weekly rhythm HOME can say plainly
      'FREQ=MONTHLY',
      'FREQ=MONTHLY;BYMONTHDAY=14',
      'FREQ=MONTHLY;BYDAY=2TU', // the second Tuesday
      'FREQ=WEEKLY;BYDAY=2TU',
      'FREQ=YEARLY',
      'FREQ=WEEKLY;BYDAY=WE;BYHOUR=9,10', // several times a day
      'FREQ=WEEKLY;BYDAY=WE;BYSETPOS=1',
      'FREQ=WEEKLY;BYDAY=WE;BYMONTH=1,2',
      'FREQ=SOMETIMES;BYDAY=XX', // unreadable
      'not a rule',
    ])
      expect(weeklyCadence(r), String(r)).toBeNull();
  });
});

describe('regularWeek: eligibility', () => {
  it('a weekly series on one weekday, and on several', () => {
    const run = timed('run', 'Early run', '2026-10-12T18:00:00Z', 'FREQ=WEEKLY;BYDAY=TU,TH'); // Tue 07:00 NZDT
    expect(show(regularWeek([swim, run], 'milo', opts))).toEqual([
      'Tu 07:00 Early run',
      'We 15:30 Swimming',
      'Th 07:00 Early run',
    ]);
  });

  it('fortnightly is kept as fortnightly, never flattened to weekly', () => {
    const piano = timed(
      'piano',
      'Piano',
      '2026-10-15T04:00:00Z',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH',
    ); // Thu 17:00
    const out = regularWeek([piano], 'milo', opts);
    expect(show(out)).toEqual(['Th 17:00 Piano (fortnightly)']);
    expect(out).toHaveLength(1); // one entry, not one per week
  });

  it('a fortnightly series whose next occurrence is next week still shows', () => {
    // Started Thursday 8 Oct: the next is the 22nd, eight days on.
    const piano = timed(
      'piano',
      'Piano',
      '2026-10-08T04:00:00Z',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH',
    );
    expect(show(regularWeek([piano], 'milo', opts))).toEqual(['Th 17:00 Piano (fortnightly)']);
  });

  it('leaves out one-offs, daily, monthly, ordinal, yearly, every-third-week, irregular and unreadable rules', () => {
    const rules = [
      null,
      'FREQ=DAILY',
      'FREQ=MONTHLY;BYMONTHDAY=14',
      'FREQ=MONTHLY;BYDAY=2TU',
      'FREQ=YEARLY',
      'FREQ=WEEKLY;INTERVAL=3;BYDAY=WE',
      'FREQ=WEEKLY;BYDAY=WE;BYHOUR=9,10',
      'FREQ=SOMETIMES',
    ];
    const events = rules.map((r, i) => timed(`e${i}`, `Rule ${i}`, '2026-10-14T02:30:00Z', r));
    expect(regularWeek(events, 'milo', opts)).toEqual([]);
  });

  it('a yearly birthday (all-day) is never a weekly rhythm', () => {
    expect(
      regularWeek(
        [allDay('b', 'Nana Jo’s birthday', '2026-10-20', '2026-10-21', 'FREQ=YEARLY')],
        'milo',
        opts,
      ),
    ).toEqual([]);
  });

  it('the rhythm survives skipped and cancelled dates: an EXDATE this week hides nothing', () => {
    const skipped = { ...swim, exdates: ['2026-10-14T02:30:00Z', '2026-10-21T02:30:00Z'] };
    expect(show(regularWeek([skipped], 'milo', opts))).toEqual(['We 15:30 Swimming']);
  });

  it('a moved occurrence (its own row, with no rule) makes no new rhythm', () => {
    const moved = timed('moved', 'Swimming', '2026-10-15T04:00:00Z', null);
    expect(show(regularWeek([swim, moved], 'milo', opts))).toEqual(['We 15:30 Swimming']);
  });

  it('a series that has ended, or has not begun, is not part of the week', () => {
    const ended = timed(
      'ended',
      'Old club',
      '2026-09-02T02:30:00Z',
      'FREQ=WEEKLY;BYDAY=WE;UNTIL=20261001T000000Z',
    );
    const later = timed('later', 'Summer club', '2026-12-02T02:30:00Z', 'FREQ=WEEKLY;BYDAY=WE');
    const counted = timed('counted', 'Short course', '2026-09-02T02:30:00Z', 'FREQ=WEEKLY;COUNT=3');
    expect(regularWeek([ended, later, counted], 'milo', opts)).toEqual([]);
  });

  it('only the person’s own: another person’s series, or one with nobody, is left out', () => {
    const isla = timed('isla', 'Football', '2026-10-16T22:40:00Z', 'FREQ=WEEKLY;BYDAY=SA', {
      people: [{ personId: 'isla', role: 'attending' }],
    });
    const nobody = timed('nobody', 'Bins', '2026-10-14T02:30:00Z', 'FREQ=WEEKLY', { people: [] });
    expect(show(regularWeek([swim, isla, nobody], 'milo', opts))).toEqual(['We 15:30 Swimming']);
    expect(show(regularWeek([swim, isla, nobody], 'isla', opts))).toEqual(['Sa 11:40 Football']);
  });

  it('responsible counts as well as going (contract §3.6: attends or is responsible)', () => {
    const drop = timed('drop', 'Swimming', '2026-10-14T02:30:00Z', 'FREQ=WEEKLY;BYDAY=WE', {
      people: [{ personId: 'sam', role: 'responsible' }],
    });
    expect(show(regularWeek([drop], 'sam', opts))).toEqual(['We 15:30 Swimming']);
  });
});

describe('regularWeek: all-day series', () => {
  it('a one-day weekly or fortnightly all-day series shows with no time; a multi-day one is left out', () => {
    const bins = allDay('bins', 'Bins out', '2026-10-12', '2026-10-13', 'FREQ=WEEKLY'); // Monday
    const market = allDay(
      'market',
      'Market day',
      '2026-10-17',
      '2026-10-18',
      'FREQ=WEEKLY;INTERVAL=2',
    );
    const weekend = allDay('weekend', 'Weekend away', '2026-10-17', '2026-10-19', 'FREQ=WEEKLY');
    expect(show(regularWeek([bins, market, weekend], 'milo', opts))).toEqual([
      'Mo all day Bins out',
      'Sa all day Market day (fortnightly)',
    ]);
  });
});

describe('regularWeek: time zones, from the recurrence engine', () => {
  it('a UTC series is placed on its home-zone weekday and time', () => {
    // Every Thursday 20:00 UTC is Friday 09:00 NZDT.
    const call = timed('utc', 'Standup', '2026-10-15T20:00:00Z', 'FREQ=WEEKLY;BYDAY=TH', {
      timeZone: 'UTC',
    });
    expect(show(regularWeek([call], 'milo', opts))).toEqual(['Fr 09:00 Standup']);
  });

  it('a New York series lands on the next home weekday, at its next home time', () => {
    // Sundays 09:00 New York: in mid-October (EDT, NZDT) that is Monday 02:00 at home.
    const ny = timed('ny', 'Call home', '2026-10-11T13:00:00Z', 'FREQ=WEEKLY;BYDAY=SU', {
      timeZone: 'America/New_York',
    });
    expect(show(regularWeek([ny], 'milo', opts))).toEqual(['Mo 02:00 Call home']);
    // After New York falls back (1 Nov), the same call is Monday 03:00 at home.
    expect(show(regularWeek([ny], 'milo', { ...opts, today: '2026-11-04' }))).toEqual([
      'Mo 03:00 Call home',
    ]);
  });

  it('across the NZ change the home wall clock holds: 07:00 before and after', () => {
    // Sundays 07:00 NZST from 20 Sept; NZDT begins 27 Sept.
    const run = timed('run', 'Early run', '2026-09-19T19:00:00Z', 'FREQ=WEEKLY;BYDAY=SU');
    expect(show(regularWeek([run], 'milo', { ...opts, today: '2026-09-16' }))).toEqual([
      'Su 07:00 Early run',
    ]);
    expect(show(regularWeek([run], 'milo', { ...opts, today: '2026-09-23' }))).toEqual([
      'Su 07:00 Early run',
    ]);
  });

  it('an event-zone weekday that differs from the home weekday is shown on the home weekday', () => {
    // Tuesdays 22:00 in London (BST) are Wednesdays 10:00 in NZ (mid-October).
    const london = timed('ldn', 'Book club', '2026-10-13T21:00:00Z', 'FREQ=WEEKLY;BYDAY=TU', {
      timeZone: 'Europe/London',
    });
    expect(show(regularWeek([london], 'milo', opts))).toEqual(['We 10:00 Book club']);
  });
});

describe('regularWeek: order', () => {
  it('Monday to Sunday, all-day first, then by time, title and id, whatever the input order', () => {
    const events = [
      timed('z', 'Zumba', '2026-10-14T02:30:00Z', 'FREQ=WEEKLY;BYDAY=WE'),
      timed('a', 'Art', '2026-10-14T02:30:00Z', 'FREQ=WEEKLY;BYDAY=WE'),
      timed('early', 'Breakfast club', '2026-10-13T19:00:00Z', 'FREQ=WEEKLY;BYDAY=WE'),
      allDay('bins', 'Bins out', '2026-10-14', '2026-10-15', 'FREQ=WEEKLY'),
      timed('mon', 'Preschool', '2026-10-11T19:30:00Z', 'FREQ=WEEKLY;BYDAY=MO'),
    ];
    const expected = [
      'Mo 08:30 Preschool',
      'We all day Bins out',
      'We 08:00 Breakfast club',
      'We 15:30 Art',
      'We 15:30 Zumba',
    ];
    expect(show(regularWeek(events, 'milo', opts))).toEqual(expected);
    expect(show(regularWeek([...events].reverse(), 'milo', opts))).toEqual(expected);
    const a = regularWeek(events, 'milo', opts);
    expect([...a].sort(compareRegularWeekEntries)).toEqual(a);
  });
});
