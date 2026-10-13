import { describe, expect, it } from 'vitest';
import { LOCATION_LEAKS, TEST_WEATHER_KEY, locationLeaksIn } from '../../fixtures/weather';

// The location-redaction scan the weather tests share (M7 W4, W10, W18, W23,
// P5; acceptance correction Q8): a coordinate is a leak only as a standalone
// number, so a timestamp, a uuid or a longer number that happens to hold its
// digits never trips it; the URL, parameter, key and canonical entries stay
// substring matches. Synthetic points only.

describe('locationLeaksIn', () => {
  it.each([
    ['a log line whose timestamp holds 41.29', '{"ts":"2026-10-13T23:34:41.295Z","event":"x"}'],
    ['a timestamp holding 174.78 after a colon', '{"at":"2026-10-13T23:59:174.789"}'],
    ['a uuid', '{"id":"0f1e4129-1747-4f00-9a00-000041291747"}'],
    ['a longer number either side', '{"n":141.29,"m":41.291,"k":2174.78,"j":174.785}'],
    ['a count and a status', '{"status":"ok","hours":191}'],
  ])('passes %s', (_n, text) => {
    expect(locationLeaksIn(text)).toEqual([]);
  });

  it.each([
    ['-41.29', 'lat -41.29 here', '-41.29'],
    ['41.29,', '[41.29,174.0]', '41.29'],
    ['"lat":-41.29', '{"lat":-41.29}', '41.29'],
    ['latitude=-41.29', '?latitude=-41.29', 'latitude='],
    ['latitude=-41.29 (the number itself)', 'q latitude=-41.29', '-41.29'],
    ['174.78', 'lon 174.78', '174.78'],
    ['174.78,', '[-41.0,174.78,23]', '174.78'],
    ['"lon":174.78', '{"lon":174.78}', '174.78'],
    ['longitude=174.78', '&longitude=174.78&', '174.78'],
    ['at the end of a text', 'x:-43.53', '-43.53'],
    ['the URL', 'https://api.open-meteo.com/v1/forecast?x', 'open-meteo.com'],
    ['the key', `key ${TEST_WEATHER_KEY}`, TEST_WEATHER_KEY],
    ['the canonical prefix', 'home-weather-location:v1|open_meteo', 'home-weather-location:v1'],
  ])('catches %s', (_n, text, leak) => {
    expect(locationLeaksIn(text)).toContain(leak);
  });

  it('an extra numeric entry (an elevation) is matched standalone too', () => {
    const extra = [...LOCATION_LEAKS, '37'];
    expect(locationLeaksIn('{"elevation":37}', extra)).toContain('37');
    expect(locationLeaksIn('{"ts":"2026-10-13T23:37:12.370Z","n":1937}', extra)).toEqual([]);
  });
});
