import { describe, expect, it } from 'vitest';
import {
  EnvError,
  parseEnv,
  weatherBootStatus,
  weatherConfig,
  weatherLocationCanonical,
  weatherLocationFingerprint,
  type WeatherConfig,
} from '@/lib/env';
import { testWeatherMode } from '@/integrations/weather/entry';
import { testEnv } from '../../env';
import {
  CHRISTCHURCH,
  FINGERPRINT_VECTORS,
  TEST_WEATHER_KEY,
  TEST_WEATHER_KEY_ROTATED,
  TEST_WEATHER_KEY_TEXT,
  WELLINGTON,
  WELLINGTON_UNROUNDED,
  weatherEnv,
} from '../../fixtures/weather';

// The home location and its key (M7 contract §5.1, §7; ADR 0011 §13, §14):
// read only by env.ts, rounded at the boundary, fingerprinted with a keyed
// HMAC, reported at boot by status only. Synthetic points and keys only.

const base = { ...testEnv };
const config = (extra: Record<string, string | undefined>) => weatherConfig({ ...base, ...extra });
const pointOf = (c: WeatherConfig) => ('point' in c ? c.point : null);

describe('the location fingerprint (contract §5.1, §8.1)', () => {
  it('the canonical string: two decimals, a negative latitude, `none` for no elevation, the elevation in metres', () => {
    for (const v of FINGERPRINT_VECTORS)
      expect(weatherLocationCanonical(v.point)).toBe(v.canonical);
    expect(weatherLocationCanonical({ lat: -41.3, lon: 174, elevation: null })).toBe(
      'home-weather-location:v1|open_meteo|-41.30|174.00|none',
    );
    expect(weatherLocationCanonical({ lat: 0, lon: -0.5, elevation: 0 })).toBe(
      'home-weather-location:v1|open_meteo|0.00|-0.50|0',
    );
  });

  it('matches the committed HMAC-SHA256 test vectors (synthetic points, a test-only key)', () => {
    const key = Buffer.from(TEST_WEATHER_KEY_TEXT);
    for (const v of FINGERPRINT_VECTORS) {
      expect(weatherLocationFingerprint(v.point, key)).toBe(v.hex);
      expect(v.hex).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('weatherConfig fingerprints the rounded point under HOME_WEATHER_LOCATION_KEY', () => {
    expect(config(weatherEnv(WELLINGTON_UNROUNDED))).toEqual({
      status: 'set',
      point: { lat: -41.29, lon: 174.78, elevation: null },
      fingerprint: FINGERPRINT_VECTORS[0].hex,
    });
    const elevated = config(weatherEnv(WELLINGTON, { HOME_ELEVATION: '23' }));
    expect(elevated).toMatchObject({ status: 'set', fingerprint: FINGERPRINT_VECTORS[1].hex });
    expect(config(weatherEnv(CHRISTCHURCH))).toMatchObject({
      fingerprint: FINGERPRINT_VECTORS[2].hex,
    });
  });

  it('W21: a rotated key, a changed elevation or a changed location each give another fingerprint', () => {
    const fp = (c: WeatherConfig) => (c.status === 'set' ? c.fingerprint : null);
    const original = fp(config(weatherEnv()));
    const others = [
      fp(config(weatherEnv(WELLINGTON, { HOME_WEATHER_LOCATION_KEY: TEST_WEATHER_KEY_ROTATED }))),
      fp(config(weatherEnv(WELLINGTON, { HOME_ELEVATION: '40' }))),
      fp(config(weatherEnv(CHRISTCHURCH))),
    ];
    expect(new Set([original, ...others]).size).toBe(4);
    for (const o of others) expect(o).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('rounding at the boundary (W1, W2)', () => {
  it('coordinates to two decimals, elevation to 10 m; the exact values are nowhere in the result', () => {
    const c = config(weatherEnv(WELLINGTON_UNROUNDED, { HOME_ELEVATION: '23' }));
    expect(pointOf(c)).toEqual({ lat: -41.29, lon: 174.78, elevation: 20 });
    const text = JSON.stringify(c);
    for (const exact of ['-41.28664', '174.77557', '23']) expect(text).not.toContain(exact);
    expect(Object.isFrozen(pointOf(c))).toBe(true);
  });

  it.each([
    ['25', 30],
    ['24.9', 20],
    ['-4', 0],
    ['-15', -10],
    ['0', 0],
    ['1234.5', 1230],
  ])('HOME_ELEVATION=%s rounds to %i', (raw, rounded) => {
    expect(pointOf(config(weatherEnv(WELLINGTON, { HOME_ELEVATION: raw })))?.elevation).toBe(
      rounded,
    );
  });

  it('no negative zero', () => {
    expect(pointOf(config(weatherEnv({ lat: '-0.001', lon: '0.004' })))).toEqual({
      lat: 0,
      lon: 0,
      elevation: null,
    });
  });
});

describe('absent, invalid, key missing (W12, W21)', () => {
  it.each([
    [{}, 'absent'],
    [{ HOME_ELEVATION: '20' }, 'absent'],
    [{ HOME_LAT: '-41.29' }, 'invalid'],
    [{ HOME_LON: '174.78' }, 'invalid'],
    [{ HOME_LAT: '95', HOME_LON: '174.78' }, 'invalid'],
    [{ HOME_LAT: '-41.29', HOME_LON: '181' }, 'invalid'],
    [{ HOME_LAT: '-41,29', HOME_LON: '174.78' }, 'invalid'],
    [{ HOME_LAT: ' -41.29', HOME_LON: '174.78' }, 'invalid'],
    [{ HOME_LAT: '1e1', HOME_LON: '174.78' }, 'invalid'],
    [{ HOME_LAT: 'NaN', HOME_LON: '174.78' }, 'invalid'],
    [{ HOME_LAT: '-41.29', HOME_LON: '174.78', HOME_ELEVATION: 'high' }, 'invalid'],
    [{ HOME_LAT: '-41.29', HOME_LON: '174.78', HOME_ELEVATION: '99999' }, 'invalid'],
  ])('%j is %s', (vars, status) => {
    expect(config({ ...vars, HOME_WEATHER_LOCATION_KEY: TEST_WEATHER_KEY }).status).toBe(status);
  });

  const KEY_CASES: [string, string | undefined][] = [
    ['unset', undefined],
    ['empty', ''],
    ['too short (31 bytes)', Buffer.alloc(31, 7).fill(9, 0, 1).toString('base64')],
    ['not base64', 'not a key, not base64 at all, but long enough'],
    ['non-canonical base64', TEST_WEATHER_KEY.replace(/=$/, '')],
    ['one repeated byte', Buffer.alloc(32, 1).toString('base64')],
    ['equal to HOME_FINGERPRINT_KEY', testEnv.HOME_FINGERPRINT_KEY],
    ['equal to HOME_CREDENTIALS_KEY', testEnv.HOME_CREDENTIALS_KEY],
    ['equal to BETTER_AUTH_SECRET', testEnv.BETTER_AUTH_SECRET],
    ['equal to AUDIT_HASH_SECRET', testEnv.AUDIT_HASH_SECRET],
  ];
  it.each(KEY_CASES)(
    'a location with its key %s: key missing, the point kept for daylight, no fingerprint',
    (_, key) => {
      const c = config({ ...weatherEnv(), HOME_WEATHER_LOCATION_KEY: key });
      expect(c).toEqual({
        status: 'key_missing',
        point: { lat: -41.29, lon: 174.78, elevation: null },
      });
      expect(weatherBootStatus(c)).toBe('set, key missing');
    },
  );

  it('equal to HOME_CREDENTIALS_KEY_PREVIOUS is refused too', () => {
    expect(
      config({ ...weatherEnv(), HOME_CREDENTIALS_KEY_PREVIOUS: TEST_WEATHER_KEY }).status,
    ).toBe('key_missing');
  });

  it('a longer key (48 bytes) is accepted', () => {
    const long = Buffer.from('a-forty-eight-byte-synthetic-weather-key-for-tst').toString('base64');
    expect(config({ ...weatherEnv(), HOME_WEATHER_LOCATION_KEY: long }).status).toBe('set');
  });

  it('the boot line names a status only: set | absent | invalid | set, key missing', () => {
    expect(weatherBootStatus(config(weatherEnv()))).toBe('set');
    expect(weatherBootStatus(config({}))).toBe('absent');
    expect(weatherBootStatus(config({ HOME_LAT: '95', HOME_LON: '1' }))).toBe('invalid');
    expect(weatherBootStatus(config({ ...weatherEnv(), HOME_WEATHER_LOCATION_KEY: '' }))).toBe(
      'set, key missing',
    );
  });

  it('the location is not on `env`: parseEnv never holds HOME_LAT, HOME_LON, HOME_ELEVATION or the key', () => {
    const parsed = parseEnv({ ...base, ...weatherEnv(WELLINGTON, { HOME_ELEVATION: '20' }) });
    for (const k of ['HOME_LAT', 'HOME_LON', 'HOME_ELEVATION', 'HOME_WEATHER_LOCATION_KEY'])
      expect(k in parsed, k).toBe(false);
    // A bad value never stops HOME booting.
    expect(() =>
      parseEnv({ ...base, HOME_LAT: '95', HOME_WEATHER_LOCATION_KEY: 'x' }),
    ).not.toThrow();
  });
});

describe('HOME_TEST_WEATHER (the fake provider) is refused when deployed', () => {
  it.each([
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: 'production' },
    { VERCEL: '1' },
    { NODE_ENV: 'production' },
  ])('parseEnv refuses it with %j, naming it', (deployed) => {
    // Otherwise valid for a deployment, so the refusal is the test variable's.
    const deployable = {
      ...base,
      BETTER_AUTH_URL: 'https://home.example.test',
      HOME_MAIL_TRANSPORT: 'provider',
      MAIL_API_KEY: 'synthetic',
      MAIL_FROM: 'home@example.test',
    };
    expect(() => parseEnv({ ...deployable, ...deployed })).not.toThrow(/HOME_TEST_WEATHER/);
    expect(() => parseEnv({ ...deployable, ...deployed, HOME_TEST_WEATHER: 'fake' })).toThrow(
      /HOME_TEST_WEATHER \(the fake weather provider is for local and CI runs only\)/,
    );
  });

  it('parseEnv accepts it locally and refuses any value but `fake`', () => {
    expect(parseEnv({ ...base, HOME_TEST_WEATHER: 'fake' }).HOME_TEST_WEATHER).toBe('fake');
    expect(() => parseEnv({ ...base, HOME_TEST_WEATHER: 'real' })).toThrow(EnvError);
  });

  it.each([
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: 'production' },
    { VERCEL_ENV: 'development' },
    { VERCEL: '1' },
    { NODE_ENV: 'production' },
  ])('the composition root refuses it with %j', (deployed) => {
    expect(() => testWeatherMode({ HOME_TEST_WEATHER: 'fake', ...deployed })).toThrow(
      /local and CI runs only/,
    );
  });

  it('the composition root: off when unset, on for `fake` locally', () => {
    expect(testWeatherMode({})).toBe(false);
    expect(testWeatherMode({ HOME_TEST_WEATHER: '', VERCEL_ENV: 'production' })).toBe(false);
    expect(testWeatherMode({ HOME_TEST_WEATHER: 'fake', NODE_ENV: 'test' })).toBe(true);
    expect(() => testWeatherMode({ HOME_TEST_WEATHER: 'real' })).toThrow();
  });
});
