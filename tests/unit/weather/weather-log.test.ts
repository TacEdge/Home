import { describe, expect, it } from 'vitest';
import { REDACTED_KEYS, createLogger, redact, scrubSecrets } from '@/lib/log';

// W18 (M7 contract §3.5, §5.1): the home location is never logged, under any
// key it could travel by, and the weather request URL is scrubbed from any
// string whatever key carries it.

const LOCATION_KEYS = ['lat', 'lon', 'latitude', 'longitude', 'elevation', 'coordinates'];

describe('the location keys are redacted', () => {
  it('every new key is on the list', () => {
    for (const k of LOCATION_KEYS) expect(REDACTED_KEYS as readonly string[]).toContain(k);
  });

  it.each(LOCATION_KEYS)('%s, at any depth, any case, with a prefix', (key) => {
    expect(redact({ [key]: -41.29 })).toEqual({ [key]: '[redacted]' });
    expect(redact({ a: [{ [key.toUpperCase()]: '174.78' }] })).toEqual({
      a: [{ [key.toUpperCase()]: '[redacted]' }],
    });
    expect(redact({ [`home_${key}`]: 1 })).toEqual({ [`home_${key}`]: '[redacted]' });
  });

  it('a whole point object is redacted by its key, and its parts by theirs', () => {
    expect(redact({ coordinates: { lat: -41.29, lon: 174.78 } })).toEqual({
      coordinates: '[redacted]',
    });
    expect(redact({ point: { lat: -41.29, lon: 174.78, elevation: 20 } })).toEqual({
      point: { lat: '[redacted]', lon: '[redacted]', elevation: '[redacted]' },
    });
  });

  it('the code a failed refresh logs is kept', () => {
    expect(redact({ code: 'rate_limited' })).toEqual({ code: 'rate_limited' });
  });
});

describe('the weather request is scrubbed from any string', () => {
  const URL_TEXT =
    'https://api.open-meteo.com/v1/forecast?latitude=-41.29&longitude=174.78&elevation=20&hourly=x';
  it.each([
    URL_TEXT,
    `fetch failed: ${URL_TEXT} (ECONNRESET)`,
    'api.open-meteo.com/v1/forecast?latitude=-41.29&longitude=174.78',
    'query latitude=-41.29 longitude=174.78 elevation=20',
  ])('%s', (text) => {
    const out = scrubSecrets(text);
    for (const leak of ['open-meteo', '-41.29', '174.78', 'latitude=', 'longitude=', 'elevation='])
      expect(out).not.toContain(leak);
  });

  it('an error carrying the URL logs neither its message nor the coordinates', () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l) });
    log.error('weather_refresh_failed', {
      code: 'unexpected',
      detail: new TypeError(`fetch failed for ${URL_TEXT}`),
      at: URL_TEXT,
    });
    expect(lines).toHaveLength(1);
    for (const leak of ['open-meteo', '-41.29', '174.78']) expect(lines[0]).not.toContain(leak);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event: 'weather_refresh_failed',
      code: 'unexpected',
    });
  });
});
