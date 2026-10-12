import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DAY_PARTS,
  DRY_MAX_MM,
  DRY_MAX_PROBABILITY,
  FRESH_HOURS,
  HORIZON_DAYS,
  RAIN_LIKELY_MM,
  RAIN_LIKELY_PROBABILITY,
  USABLE_HOURS,
  WINDY_GUST_KMH,
  bandOf,
  dayPhrase,
  forecastAge,
  staleSentence,
  todaySentence,
  tomorrowSentence,
  windyOf,
  type Forecast,
} from '@/domain/engines/weather';
import { PLANNING_FROM, PLANNING_TO } from '@/domain/engines/planning';
import type { ForecastHour } from '@/domain/weather/provider';
import { syntheticHours, syntheticOpenMeteoBody } from '@/integrations/weather/fake';
import { normaliseOpenMeteo } from '@/integrations/weather/open-meteo';
import { addDays, wallClockOf, type IsoDate } from '@/lib/dates';

// Bands, phrases and sentences (M7 contract §5.1 freshness, §5.2, §8.1,
// §8.6 W5–W7, W14, W15). Fixture time: Wednesday 14 October 2026, 07:03 in
// Pacific/Auckland; forecast F0 fetched at 06:55.

const ZONE = 'Pacific/Auckland';
const NOW = new Date('2026-10-13T18:03:00Z'); // 07:03 NZDT, 14 October
const FETCHED = new Date('2026-10-13T17:55:00Z'); // 06:55 NZDT
const H = 3_600_000;
const MIN = 60_000;

const hour = (p: number | null, mm: number | null, gust: number | null = 20): ForecastHour => ({
  start: new Date(0),
  temperatureC: 12,
  precipitationProbability: p,
  precipitationMm: mm,
  windKmh: 10,
  gustKmh: gust,
});
const local = (d: Date) => wallClockOf(d, ZONE);

/** Eight UTC days from 13 October, valued by home wall-clock date and hour. */
function forecast(
  values: (date: IsoDate, hour: number) => Partial<ForecastHour> = () => ({}),
  fetchedAt = FETCHED,
  from = new Date('2026-10-13T00:00:00Z'),
  count = 191,
): Forecast {
  return {
    fetchedAt,
    hours: syntheticHours(from, count, (start) => {
      const w = local(start);
      const date = `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
      return values(date, w.hour);
    }) as ForecastHour[],
  };
}

describe('constants are the contract’s (§5.2, §5.1)', () => {
  it('bands, wind, freshness, horizon, planning hours, parts', () => {
    expect([DRY_MAX_PROBABILITY, DRY_MAX_MM, RAIN_LIKELY_PROBABILITY, RAIN_LIKELY_MM]).toEqual([
      20, 0.2, 60, 1.0,
    ]);
    expect(WINDY_GUST_KMH).toBe(50);
    expect([FRESH_HOURS, USABLE_HOURS, HORIZON_DAYS]).toEqual([3, 12, 7]);
    expect([PLANNING_FROM, PLANNING_TO]).toEqual(['08:00', '20:00']);
    expect(DAY_PARTS.map((p) => [p.part, p.from, p.to])).toEqual([
      ['morning', '06:00', '12:00'],
      ['afternoon', '12:00', '18:00'],
      ['evening', '18:00', '21:00'],
    ]);
  });
});

describe('W5: bands over a span', () => {
  it.each([
    ['[10%, 20%, 20%] and [0, 0.1, 0.19 mm]', [hour(10, 0), hour(20, 0.1), hour(20, 0.19)], 'dry'],
    ['one hour at 21%', [hour(10, 0), hour(21, 0)], 'showers'],
    ['one hour at 0.2 mm', [hour(10, 0), hour(10, 0.2)], 'showers'],
    ['one hour at 59%', [hour(59, 0)], 'showers'],
    ['one hour at 60%', [hour(10, 0), hour(60, 0)], 'rain'],
    ['one hour at 0.99 mm', [hour(10, 0.99)], 'showers'],
    ['one hour at 1.0 mm', [hour(10, 0), hour(10, 1.0)], 'rain'],
    ['one hour with no probability', [hour(10, 0), hour(null, 0)], null],
    ['one hour with no amount', [hour(10, 0), hour(10, null)], null],
    ['a missing value beside rain', [hour(90, 5), hour(null, 0)], null],
    ['no hours', [], null],
  ])('%s → %s', (_n, hours, band) => {
    expect(bandOf(hours)).toBe(band);
  });
});

describe('W6: wind', () => {
  it('gusts 49 km/h: no wind words; 50 km/h: windy; a missing gust is not windy', () => {
    expect(windyOf([hour(0, 0, 49)])).toBe(false);
    expect(windyOf([hour(0, 0, 49), hour(0, 0, 50)])).toBe(true);
    expect(windyOf([hour(0, 0, null)])).toBe(false);
  });
});

describe('W7: freshness', () => {
  it.each([
    [2 * 60 + 59, 'fresh'],
    [3 * 60, 'older'],
    [12 * 60, 'older'],
    [12 * 60 + 1, 'unusable'],
  ])('fetched %i minutes before now: %s', (minutes, age) => {
    expect(forecastAge(new Date(NOW.getTime() - minutes * MIN), NOW)).toBe(age);
  });
});

describe('W15: Today’s sentence', () => {
  const F0 = forecast((date, h) =>
    date === '2026-10-14' && h >= 12 ? { precipitationProbability: 40, precipitationMm: 0.1 } : {},
  );

  it('07:03: "Looks dry until midday, then showers possible." (weather.today), with its fact', () => {
    const s = todaySentence(F0, NOW, ZONE)!;
    expect(s.rule).toBe('weather.today');
    expect(s.text).toBe('Looks dry until midday, then showers possible.');
    expect(s.facts).toEqual([
      {
        kind: 'forecast',
        from: '2026-10-13T18:00:00.000Z', // 07:00, the hour 07:03 is in
        to: '2026-10-14T08:00:00.000Z', // 21:00
        fetchedAt: FETCHED.toISOString(),
      },
    ]);
    expect(s.parts.map((p) => [p.part, p.band, p.maxProbability])).toEqual([
      ['morning', 'dry', 5],
      ['afternoon', 'showers', 40],
      ['evening', 'showers', 40],
    ]);
    expect(s.windy).toBe(false);
    expect([s.lowC, s.highC]).toEqual([14, 14]);
  });

  it('19:30, evening state, Thursday rain likely all day: "Rain likely tomorrow." (weather.tomorrow)', () => {
    const evening = new Date('2026-10-14T06:30:00Z'); // 19:30 NZDT
    const f = forecast(
      (date) => (date === '2026-10-15' ? { precipitationProbability: 80, precipitationMm: 2 } : {}),
      new Date('2026-10-14T05:00:00Z'),
    );
    const s = tomorrowSentence(f, evening, ZONE)!;
    expect(s).toMatchObject({ rule: 'weather.tomorrow', text: 'Rain likely tomorrow.' });
  });

  it('one run, three runs, the evening boundary, windy', () => {
    expect(todaySentence(forecast(), NOW, ZONE)!.text).toBe('Looks dry today.');
    const three = forecast((date, h) =>
      date !== '2026-10-14'
        ? {}
        : h >= 18
          ? { precipitationProbability: 70 }
          : h >= 12
            ? { precipitationProbability: 40 }
            : {},
    );
    expect(todaySentence(three, NOW, ZONE)!.text).toBe(
      'Looks dry this morning, showers possible this afternoon, rain likely this evening.',
    );
    const evening = forecast((date, h) =>
      date === '2026-10-14' && h >= 18 ? { precipitationProbability: 40 } : {},
    );
    expect(todaySentence(evening, NOW, ZONE)!.text).toBe(
      'Looks dry until the evening, then showers possible.',
    );
    const windy = forecast((date, h) => (date === '2026-10-14' && h === 15 ? { gustKmh: 55 } : {}));
    expect(todaySentence(windy, NOW, ZONE)!.text).toBe('Looks dry today. Windy at times.');
  });

  it('only parts whose hours end after now: at 13:20 the morning is gone', () => {
    const f = forecast(
      (date, h) => (date === '2026-10-14' && h < 12 ? { precipitationProbability: 90 } : {}),
      new Date('2026-10-14T00:00:00Z'), // fetched 13:00
    );
    const at = new Date('2026-10-14T00:20:00Z'); // 13:20
    expect(todaySentence(f, at, ZONE)!.text).toBe('Looks dry today.');
    expect(todaySentence(f, at, ZONE)!.parts.map((p) => p.part)).toEqual(['afternoon', 'evening']);
    const after = new Date('2026-10-14T08:30:00Z'); // 21:30: nothing of today remains
    expect(todaySentence(f, after, ZONE)).toBeNull();
  });

  it('tomorrow’s two and three runs', () => {
    const evening = new Date('2026-10-14T06:30:00Z');
    const fetched = new Date('2026-10-14T06:00:00Z');
    const two = forecast(
      (date, h) => (date === '2026-10-15' && h >= 12 ? { precipitationProbability: 40 } : {}),
      fetched,
    );
    expect(tomorrowSentence(two, evening, ZONE)!.text).toBe(
      'Tomorrow: looks dry until midday, then showers possible.',
    );
    const three = forecast(
      (date, h) =>
        date !== '2026-10-15'
          ? {}
          : h < 12
            ? { precipitationProbability: 70 }
            : h < 18
              ? {}
              : { precipitationProbability: 30 },
      fetched,
    );
    expect(tomorrowSentence(three, evening, ZONE)!.text).toBe(
      'Tomorrow: rain likely in the morning, looks dry in the afternoon, showers possible in the evening.',
    );
  });

  it('an older forecast begins "As of {time}, " with its first band in lower case', () => {
    const lastNight = new Date('2026-10-13T08:00:00Z'); // 21:00 NZDT on the 13th, 10 h 3 min ago
    const f = forecast(
      (date, h) => (date === '2026-10-14' && h >= 12 ? { precipitationProbability: 40 } : {}),
      lastNight,
    );
    expect(todaySentence(f, NOW, ZONE)!.text).toBe(
      'As of yesterday 21:00, looks dry until midday, then showers possible.',
    );
    const thisMorning = new Date('2026-10-13T14:00:00Z'); // 03:00 today, 4 h ago
    expect(
      todaySentence(
        forecast(() => ({}), thisMorning),
        NOW,
        ZONE,
      )!.text,
    ).toBe('As of 03:00, looks dry today.');
  });

  it('no words: unusable, absent, a part with no band, a part not fully covered', () => {
    expect(
      todaySentence(
        forecast(() => ({}), new Date(NOW.getTime() - 12 * H - MIN)),
        NOW,
        ZONE,
      ),
    ).toBeNull();
    expect(todaySentence(null, NOW, ZONE)).toBeNull();
    expect(
      todaySentence(
        forecast((date, h) => (date === '2026-10-14' && h === 19 ? { precipitationMm: null } : {})),
        NOW,
        ZONE,
      ),
    ).toBeNull();
    const short = forecast(() => ({}), FETCHED, new Date('2026-10-13T00:00:00Z'), 24); // to 13:00 NZDT
    expect(todaySentence(short, NOW, ZONE)).toBeNull();
  });
});

describe('W14: Forward Week’s day phrases', () => {
  const F0 = forecast((date, h) =>
    date === '2026-10-18' && h === 11 ? { precipitationProbability: 40, precipitationMm: 0.1 } : {},
  );
  const days = Array.from({ length: 8 }, (_, i) => addDays('2026-10-14', i));

  it('phrases for 14–20 October only; none for 21 October', () => {
    const phrases = days.map((d) => dayPhrase(F0, d, NOW, ZONE)?.text ?? null);
    expect(phrases).toEqual([
      'Looks dry',
      'Looks dry',
      'Looks dry',
      'Looks dry',
      'Showers possible',
      'Looks dry',
      'Looks dry',
      null,
    ]);
    expect(dayPhrase(F0, '2026-10-13', NOW, ZONE)).toBeNull();
  });

  it('a day whose planning hours the forecast does not fully cover has none', () => {
    // Hours to 2026-10-19 02:00Z = 15:00 NZDT on the 19th.
    const short = forecast(() => ({}), FETCHED, new Date('2026-10-13T00:00:00Z'), 146);
    expect(dayPhrase(short, '2026-10-18', NOW, ZONE)?.text).toBe('Looks dry');
    expect(dayPhrase(short, '2026-10-19', NOW, ZONE)).toBeNull();
  });

  it('weather.day: the planning hours (remaining ones today), ", windy", at most four words', () => {
    const f = forecast((date, h) =>
      date === '2026-10-16' && h === 9 ? { gustKmh: 50, precipitationProbability: 65 } : {},
    );
    const p = dayPhrase(f, '2026-10-16', NOW, ZONE)!;
    expect(p).toMatchObject({ rule: 'weather.day', text: 'Rain likely, windy' });
    expect(p.facts[0]).toMatchObject({
      from: '2026-10-15T19:00:00.000Z',
      to: '2026-10-16T07:00:00.000Z',
    });
    expect(dayPhrase(f, '2026-10-14', NOW, ZONE)!.facts[0]!.from).toBe('2026-10-13T19:00:00.000Z');
    const late = new Date('2026-10-14T07:30:00Z'); // 20:30
    expect(dayPhrase(f, '2026-10-14', late, ZONE)).toBeNull();
    // A wind gust just outside planning hours does not count.
    const outside = forecast((date, h) =>
      date === '2026-10-16' && h === 21 ? { gustKmh: 90 } : {},
    );
    expect(dayPhrase(outside, '2026-10-16', NOW, ZONE)!.text).toBe('Looks dry');
    for (const d of days) {
      const t = dayPhrase(F0, d, NOW, ZONE)?.text;
      if (t) expect(t.split(/\s+/).length).toBeLessThanOrEqual(4);
    }
  });

  it('an unusable forecast says nothing', () => {
    const old = forecast(() => ({}), new Date(NOW.getTime() - 13 * H));
    for (const d of days) expect(dayPhrase(old, d, NOW, ZONE)).toBeNull();
  });
});

describe('DST: provider hours across both change days phrase their home days correctly', () => {
  it('27 September 2026 (23-hour day) and 4 April 2027 (25-hour day)', () => {
    for (const [from, day, nowIso] of [
      ['2026-09-25T00:00:00Z', '2026-09-27', '2026-09-25T20:00:00Z'],
      ['2027-04-02T00:00:00Z', '2027-04-04', '2027-04-02T20:00:00Z'],
    ] as const) {
      const fetchedAt = new Date(new Date(nowIso).getTime() - H);
      // Rain only in the hour 08:00–09:00 home time on the change day.
      const hours = normaliseOpenMeteo(
        syntheticOpenMeteoBody(
          new Date(from),
          (start) => {
            const w = local(start);
            const date = `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
            return date === day && w.hour === 8 ? { precipitationProbability: 70 } : {};
          },
          { days: 4 },
        ),
      );
      const f = { fetchedAt, hours };
      const now = new Date(nowIso);
      const phrase = dayPhrase(f, day, now, ZONE)!;
      expect(phrase.text).toBe('Rain likely');
      // The planning span is 12 home hours on both days.
      expect(Date.parse(phrase.facts[0]!.to) - Date.parse(phrase.facts[0]!.from)).toBe(12 * H);
      expect(local(new Date(phrase.facts[0]!.from))).toMatchObject({ hour: 8, minute: 0 });
      // The day before and after are dry.
      expect(dayPhrase(f, addDays(day, -1), now, ZONE)?.text).toBe('Looks dry');
      expect(dayPhrase(f, addDays(day, 1), now, ZONE)?.text).toBe('Looks dry');
      // And the tomorrow sentence, read the evening before, names the morning.
      const eveningBefore = new Date(Date.parse(nowIso) + 9 * H);
      expect(tomorrowSentence({ fetchedAt: eveningBefore, hours }, eveningBefore, ZONE)!.text).toBe(
        'Tomorrow: rain likely until midday, then looks dry.',
      );
    }
  });
});

describe('weather.stale', () => {
  it.each([
    // [case, fetched, now, when]
    ['earlier today', '2026-10-13T11:30:00Z', '2026-10-14T10:00:00Z', '00:30'], // 00:30 → 23:00 on the 14th
    ['yesterday', '2026-10-12T20:00:00Z', NOW.toISOString(), 'yesterday'],
    ['within the week', '2026-10-10T20:00:00Z', NOW.toISOString(), 'Sunday'],
    ['older', '2026-10-01T20:00:00Z', NOW.toISOString(), '2 Oct'],
  ])('%s', (_n, fetched, now, when) => {
    expect(staleSentence(new Date(fetched), new Date(now), ZONE)).toMatchObject({
      rule: 'weather.stale',
      text: `The forecast hasn't updated since ${when}.`,
    });
  });
  it('only for an unusable forecast with a fetch time', () => {
    expect(staleSentence(FETCHED, NOW, ZONE)).toBeNull();
    expect(staleSentence(new Date(NOW.getTime() - 12 * H), NOW, ZONE)).toBeNull();
    expect(staleSentence(null, NOW, ZONE)).toBeNull();
  });
});

describe('determinism, purity and wording', () => {
  it('the same input and now give the same output, run after run', () => {
    const f = forecast((date, h) => (h % 5 === 0 ? { precipitationProbability: 35 } : {}));
    const run = () =>
      JSON.stringify([
        todaySentence(f, NOW, ZONE),
        tomorrowSentence(f, NOW, ZONE),
        ...Array.from({ length: 7 }, (_, i) => dayPhrase(f, addDays('2026-10-14', i), NOW, ZONE)),
      ]);
    const first = run();
    for (let i = 0; i < 5; i++) expect(run()).toBe(first);
  });

  it('the engines import no db, app, kev, ui, integrations or clock', () => {
    for (const f of ['src/domain/engines/weather.ts', 'src/domain/engines/daylight.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/@\/(db|app|kev|ui|integrations)|from '\.\.\/\.\.\/(db|app)/);
      expect(src, f).not.toMatch(/Date\.now\(|new Date\(\)/);
    }
  });

  it('no forbidden word (M5, M6, M7 lists) in any template, at any band, age or state', () => {
    const forbidden =
      /\b(needs?|free|available|nothing on|everyone can|both of you|you could|should|a good time|good day|good for|best|ideal|perfect|nice|great|fine|mild|lovely|chance to|opportunity|room for|fits|suitable|recommend|window|out|out of date|probably|clear|calm|quiet|easy|busy|error)\b/i;
    const texts: string[] = [];
    const bands = [{}, { precipitationProbability: 40 }, { precipitationProbability: 80 }];
    for (const a of bands)
      for (const b of bands)
        for (const c of bands)
          for (const gust of [20, 60])
            for (const fetchedAt of [FETCHED, new Date(NOW.getTime() - 5 * H)]) {
              const f = forecast(
                (date, h) => ({
                  ...(h < 12 ? a : h < 18 ? b : c),
                  gustKmh: h === 13 ? gust : 20,
                }),
                fetchedAt,
              );
              for (const s of [
                todaySentence(f, NOW, ZONE),
                tomorrowSentence(f, new Date(NOW.getTime() + 12 * H), ZONE),
                dayPhrase(f, '2026-10-16', NOW, ZONE),
              ])
                if (s) texts.push(s.text);
            }
    texts.push(staleSentence(new Date(NOW.getTime() - 20 * H), NOW, ZONE)!.text);
    expect(texts.length).toBeGreaterThan(200);
    for (const t of texts) expect(t, t).not.toMatch(forbidden);
    // "likely" only in "rain likely".
    for (const t of texts) expect(t.replace(/rain likely/gi, ''), t).not.toMatch(/likely/i);
  });
});
