import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WeatherProviderError } from '@/domain/weather/provider';
import { SafeFetchError, type SafeFetchErrorCode } from '@/integrations/net/safe-fetch';
import { syntheticOpenMeteoBody, utcDayStart } from '@/integrations/weather/fake';
import {
  normaliseOpenMeteo,
  openMeteoProvider,
  openMeteoRequestUrl,
} from '@/integrations/weather/open-meteo';
import { weatherConfig } from '@/lib/env';
import { testEnv } from '../../env';
import { LOCATION_LEAKS, WELLINGTON_UNROUNDED, weatherEnv } from '../../fixtures/weather';

// The Open-Meteo adapter's contract (M7 contract §5.1, §8.1, §8.6 W1–W4,
// W10; ADR 0011 §12): the exact request, the normalisation of
// preceding-hour values, bad answers, and every failure as a closed code with
// nothing raw escaping. A fetcher stands in for the network throughout.

const POINT = { lat: -41.29, lon: 174.78, elevation: null };
const H = 3_600_000;
const FROM = new Date('2026-10-13T00:00:00Z');

/** A body from explicit rows (Unix seconds and the five arrays), for malformed cases. */
function rows(overrides: Record<string, unknown> = {}, n = 4): string {
  const time = Array.from({ length: n }, (_, i) => FROM.getTime() / 1000 + i * 3600);
  return JSON.stringify({
    latitude: -41.29,
    longitude: 174.78,
    elevation: 12,
    hourly: {
      time,
      temperature_2m: time.map((_, i) => 10 + i),
      precipitation_probability: time.map((_, i) => i * 10),
      precipitation: time.map((_, i) => i / 10),
      wind_speed_10m: time.map((_, i) => 20 + i),
      wind_gusts_10m: time.map((_, i) => 40 + i),
      ...overrides,
    },
  });
}

const capture = () => {
  const urls: string[] = [];
  const provider = openMeteoProvider({
    fetchText: async (url) => {
      urls.push(url);
      return syntheticOpenMeteoBody(FROM);
    },
  });
  return { urls, provider };
};

describe('W1, W2: the request, exactly', () => {
  it('W1: from HOME_LAT=-41.28664, HOME_LON=174.77557, no elevation, one GET with the rounded point and nothing else', async () => {
    const c = weatherConfig({ ...testEnv, ...weatherEnv(WELLINGTON_UNROUNDED) });
    if (c.status !== 'set') throw new Error('configured');
    const { urls, provider } = capture();
    await provider.fetchForecast(c.point);
    expect(urls).toEqual([
      'https://api.open-meteo.com/v1/forecast?latitude=-41.29&longitude=174.78&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m&forecast_days=8&timeformat=unixtime',
    ]);
    const u = new URL(urls[0]!);
    expect([...u.searchParams.keys()]).toEqual([
      'latitude',
      'longitude',
      'hourly',
      'forecast_days',
      'timeformat',
    ]);
    expect(u.searchParams.has('timezone')).toBe(false);
    expect(urls[0]).not.toMatch(/apikey|key=|timezone/i);
  });

  it('W2: HOME_ELEVATION=23 sends elevation=20, and never 23 or the exact coordinates', async () => {
    const c = weatherConfig({
      ...testEnv,
      ...weatherEnv(WELLINGTON_UNROUNDED, { HOME_ELEVATION: '23' }),
    });
    if (c.status !== 'set') throw new Error('configured');
    const { urls, provider } = capture();
    await provider.fetchForecast(c.point);
    expect(new URL(urls[0]!).searchParams.get('elevation')).toBe('20');
    expect(urls[0]).toContain('latitude=-41.29&longitude=174.78&elevation=20&hourly=');
    for (const exact of ['-41.28664', '174.77557', '=23']) expect(urls[0]).not.toContain(exact);
  });

  it('formats coordinates with exactly two decimals', () => {
    expect(openMeteoRequestUrl({ lat: -41.3, lon: 174, elevation: 0 })).toContain(
      'latitude=-41.30&longitude=174.00&elevation=0&',
    );
  });
});

describe('W3: normalisation', () => {
  it('each hour [t, t+1h): temperature and wind from row t; rain, its chance and gusts from row t+1h', () => {
    const hours = normaliseOpenMeteo(rows());
    expect(hours).toEqual(
      [0, 1, 2].map((i) => ({
        start: new Date(FROM.getTime() + i * H),
        temperatureC: 10 + i,
        windKmh: 20 + i,
        precipitationProbability: (i + 1) * 10,
        precipitationMm: (i + 1) / 10,
        gustKmh: 40 + i + 1,
      })),
    );
  });

  it('a valid 8-day answer: every complete hour, in UTC order, no gap or duplicate (192 rows → 191 hours)', () => {
    const hours = normaliseOpenMeteo(syntheticOpenMeteoBody(FROM));
    expect(hours).toHaveLength(191);
    for (let i = 1; i < hours.length; i++)
      expect(hours[i]!.start.getTime() - hours[i - 1]!.start.getTime()).toBe(H);
    expect(hours[0]!.start).toEqual(FROM);
  });

  it('the synthetic body round-trips the values described for each hour', () => {
    const hours = normaliseOpenMeteo(
      syntheticOpenMeteoBody(FROM, (start) =>
        start.getUTCHours() === 5
          ? { precipitationProbability: 70, precipitationMm: 2, gustKmh: 55 }
          : {},
      ),
    );
    const five = hours.find((h) => h.start.getUTCHours() === 5)!;
    expect(five).toMatchObject({ precipitationProbability: 70, precipitationMm: 2, gustKmh: 55 });
    expect(hours.find((h) => h.start.getUTCHours() === 6)).toMatchObject({
      precipitationProbability: 5,
      precipitationMm: 0,
      gustKmh: 30,
    });
  });

  it('nulls stay null (no band later), and nothing the provider echoes is returned', () => {
    const hours = normaliseOpenMeteo(rows({ precipitation_probability: [null, null, 5, null] }));
    expect(hours.map((h) => h.precipitationProbability)).toEqual([null, 5, null]);
    expect(JSON.stringify(hours)).not.toMatch(/-41\.29|174\.78|latitude|elevation|"12"/);
    for (const h of hours)
      expect(Object.keys(h).sort()).toEqual([
        'gustKmh',
        'precipitationMm',
        'precipitationProbability',
        'start',
        'temperatureC',
        'windKmh',
      ]);
  });

  it('DST: Unix-time hours across 27 September 2026 and 4–5 April 2027 are continuous UTC hours', () => {
    for (const day of ['2026-09-26T00:00:00Z', '2027-04-03T00:00:00Z']) {
      const hours = normaliseOpenMeteo(
        syntheticOpenMeteoBody(new Date(day), () => ({}), { days: 3 }),
      );
      expect(hours).toHaveLength(71);
      for (let i = 1; i < hours.length; i++)
        expect(hours[i]!.start.getTime() - hours[i - 1]!.start.getTime()).toBe(H);
    }
  });
});

describe('W4: a bad answer is bad_response', () => {
  const t = (i: number) => FROM.getTime() / 1000 + i * 3600;
  it.each([
    ['non-JSON', 'not json at all'],
    ['HTML', '<html>error</html>'],
    ['null', 'null'],
    ['no hourly', '{"latitude":-41.29}'],
    ['non-monotonic time', rows({ time: [t(0), t(2), t(1), t(3)] })],
    ['a duplicate hour', rows({ time: [t(0), t(1), t(1), t(2)] })],
    ['a gap', rows({ time: [t(0), t(1), t(3), t(4)] })],
    ['not on the hour', rows({ time: [t(0) + 60, t(1) + 60, t(2) + 60, t(3) + 60] })],
    ['a length mismatch', rows({ precipitation: [0, 0, 0] })],
    ['a probability of 101', rows({ precipitation_probability: [0, 101, 0, 0] })],
    ['a negative probability', rows({ precipitation_probability: [0, -1, 0, 0] })],
    ['a negative amount', rows({ precipitation: [0, 0, -0.1, 0] })],
    ['a negative gust', rows({ wind_gusts_10m: [0, 0, -1, 0] })],
    ['a negative wind', rows({ wind_speed_10m: [0, -2, 0, 0] })],
    ['61 °C', rows({ temperature_2m: [10, 61, 10, 10] })],
    ['−61 °C', rows({ temperature_2m: [10, -61, 10, 10] })],
    ['a string value', rows({ precipitation: [0, '0.1', 0, 0] })],
    ['a fractional time', rows({ time: [t(0) + 0.5, t(1), t(2), t(3)] })],
    ['one row (no complete hour)', rows({}, 1)],
    ['too many rows', rows({}, 402)],
  ])('%s', async (_name, body) => {
    const p = openMeteoProvider({ fetchText: async () => body });
    const e = await p.fetchForecast(POINT).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WeatherProviderError);
    expect((e as WeatherProviderError).code).toBe('bad_response');
    expect(JSON.stringify(e)).toBe(
      JSON.stringify({ code: 'bad_response', name: 'WeatherProviderError' }),
    );
  });
});

describe('W10: every failure is one closed code, and nothing raw escapes', () => {
  const RAW_URL =
    'https://api.open-meteo.com/v1/forecast?latitude=-41.29&longitude=174.78&elevation=20';
  const cases: [string, () => unknown, string][] = [
    ['timeout', () => new SafeFetchError('timeout'), 'timeout'],
    ['429', () => new SafeFetchError('rate_limited'), 'rate_limited'],
    ['500', () => new SafeFetchError('unreachable'), 'unreachable'],
    ['over 512 KiB', () => new SafeFetchError('too_large'), 'too_large'],
    ...(
      [
        'unsupported_destination',
        'forbidden_destination',
        'redirect_refused',
        'address_rejected',
      ] as SafeFetchErrorCode[]
    ).map((c): [string, () => unknown, string] => [c, () => new SafeFetchError(c), 'unreachable']),
    ['a bad encoding', () => new SafeFetchError('bad_response'), 'bad_response'],
    [
      'an undici-style TypeError carrying the URL in its message and cause',
      () =>
        Object.assign(new TypeError(`fetch failed for ${RAW_URL}`), {
          cause: new Error(`connect ECONNREFUSED ${RAW_URL}`),
        }),
      'unreachable',
    ],
    ['a thrown string', () => RAW_URL, 'unreachable'],
    ['a thrown object', () => ({ url: RAW_URL, latitude: -41.29 }), 'unreachable'],
  ];
  it.each(cases)(
    '%s → %s, as a fresh error with no message, cause or URL',
    async (_n, make, code) => {
      const p = openMeteoProvider({
        fetchText: async () => {
          throw make();
        },
      });
      const e = (await p.fetchForecast(POINT).catch((x: unknown) => x)) as WeatherProviderError;
      expect(e).toBeInstanceOf(WeatherProviderError);
      expect(e.code).toBe(code);
      expect(e.message).toBe(code);
      expect(e.cause).toBeUndefined();
      const all = `${e.message} ${JSON.stringify(e)} ${e.stack} ${String(e)}`;
      for (const leak of LOCATION_LEAKS) expect(all, leak).not.toContain(leak);
    },
  );

  it('a point that is not a rounded location is refused without a request', async () => {
    let asked = 0;
    const p = openMeteoProvider({
      fetchText: async () => {
        asked++;
        return '';
      },
    });
    for (const bad of [
      { lat: Number.NaN, lon: 1, elevation: null },
      { lat: 91, lon: 1, elevation: null },
      { lat: 1, lon: 1, elevation: 2.5 },
    ])
      await expect(p.fetchForecast(bad)).rejects.toMatchObject({ code: 'unreachable' });
    expect(asked).toBe(0);
  });
});

describe('the adapter itself', () => {
  it('logs nothing, touches no database and reaches the network only through safe-fetch', () => {
    for (const f of ['open-meteo.ts', 'fake.ts']) {
      const src = readFileSync(`src/integrations/weather/${f}`, 'utf8');
      expect(src, f).not.toMatch(/\bfetch\s*\(|from 'node:(http|https|net|dns|tls)'|require\(/);
      expect(src, f).not.toMatch(/\bconsole\.|\blog\.(debug|info|warn|error)\(|@\/lib\/log/);
      expect(src, f).not.toMatch(/@\/db|drizzle/);
    }
    const adapter = readFileSync('src/integrations/weather/open-meteo.ts', 'utf8');
    expect(adapter).toMatch(/safeGet\(url, \{ policy: openMeteoPolicy \}\)/);
  });

  it('the synthetic provider for HOME_TEST_WEATHER=fake gives a dry week through the real normaliser', async () => {
    const { syntheticWeatherProvider } = await import('@/integrations/weather/fake');
    const now = new Date('2026-10-13T18:03:00Z');
    const hours = await syntheticWeatherProvider(() => now).fetchForecast(POINT);
    expect(hours[0]!.start).toEqual(utcDayStart(now));
    expect(hours).toHaveLength(191);
  });
});
