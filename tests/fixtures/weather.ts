// Synthetic weather configuration for tests (M7 contract §7; ADR 0011 §13).
// Only the two public synthetic points the owner approved, never the home's,
// and a test-only location key that no environment ever uses.

/** Wellington's Civic Square: the synthetic test and Preview point. */
export const WELLINGTON = { lat: '-41.29', lon: '174.78' } as const;
/** The same point written with more precision, to prove rounding at the boundary (W1). */
export const WELLINGTON_UNROUNDED = { lat: '-41.28664', lon: '174.77557' } as const;
/** Christchurch's Cathedral Square: the second synthetic point, for a location change (W20). */
export const CHRISTCHURCH = { lat: '-43.53', lon: '172.64' } as const;

/** 32 fixed ASCII bytes, base64: a test-only HOME_WEATHER_LOCATION_KEY. */
export const TEST_WEATHER_KEY_TEXT = 'home-test-weather-location-key32';
export const TEST_WEATHER_KEY = Buffer.from(TEST_WEATHER_KEY_TEXT).toString('base64');
/** A second test-only key, for a key rotation (W21). */
export const TEST_WEATHER_KEY_ROTATED = Buffer.from('home-test-weather-rotated-key-32b').toString(
  'base64',
);

/**
 * The committed location-fingerprint test vectors (contract §8.1), computed
 * independently with `openssl dgst -sha256 -mac HMAC -macopt key:<key text>`
 * over the canonical strings.
 */
export const FINGERPRINT_VECTORS = [
  {
    canonical: 'home-weather-location:v1|open_meteo|-41.29|174.78|none',
    point: { lat: -41.29, lon: 174.78, elevation: null },
    hex: '5d5a6025f3a649bac9f97d3209a9c2b9495f0f68883ddc6f4027c3d8ac4e179d',
  },
  {
    canonical: 'home-weather-location:v1|open_meteo|-41.29|174.78|20',
    point: { lat: -41.29, lon: 174.78, elevation: 20 },
    hex: 'e33d0374a538fb5800e573c5b90fc5f51d499e8d1efaf87fd860d33521457b88',
  },
  {
    canonical: 'home-weather-location:v1|open_meteo|-43.53|172.64|none',
    point: { lat: -43.53, lon: 172.64, elevation: null },
    hex: 'efa140131841e20974fb106207addf2636c72bd09f652db5425b48e578b34bfa',
  },
] as const;

/** Every string that would betray the location or the request (W4, W10, W23, P5). */
export const LOCATION_LEAKS = [
  '-41.29',
  '174.78',
  '-41.28664',
  '174.77557',
  '41.29',
  '-43.53',
  '172.64',
  'api.open-meteo.com/v1/forecast?',
  'open-meteo.com',
  'latitude=',
  'longitude=',
  'elevation=',
  TEST_WEATHER_KEY,
  TEST_WEATHER_KEY_TEXT,
  TEST_WEATHER_KEY_ROTATED,
  'home-weather-location:v1',
] as const;

const NUMBER = /^-?\d+(\.\d+)?$/;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * A number leak as a standalone number: not inside a longer number (no digit
 * or `.` before it, no digit after it) and not part of a clock time (no
 * `<digit>:` before it), so `…T23:34:41.295Z`, a uuid or `141.29` never
 * trips it, while `-41.29`, `41.29,`, `"lat":-41.29`, `"lon":174.78` and
 * `latitude=-41.29` all do.
 */
const standalone = (leak: string) => new RegExp(`(?<![\\d.])(?<!\\d:)${escapeRegExp(leak)}(?!\\d)`);

/**
 * The leaks a text contains (W4, W10, W18, W23, P5): numeric entries
 * (coordinates, an elevation) as standalone numbers only; every other entry
 * (the URL, parameter names, keys, the canonical prefix) as a substring.
 */
export function locationLeaksIn(text: string, leaks: readonly string[] = LOCATION_LEAKS): string[] {
  return leaks.filter((leak) =>
    NUMBER.test(leak) ? standalone(leak).test(text) : text.includes(leak),
  );
}

/** The weather variables for a configured synthetic location. */
export const weatherEnv = (
  point: { lat: string; lon: string } = WELLINGTON,
  extra: Record<string, string> = {},
): Record<string, string> => ({
  HOME_LAT: point.lat,
  HOME_LON: point.lon,
  HOME_WEATHER_LOCATION_KEY: TEST_WEATHER_KEY,
  ...extra,
});

export const WEATHER_VARIABLES = [
  'HOME_LAT',
  'HOME_LON',
  'HOME_ELEVATION',
  'HOME_WEATHER_LOCATION_KEY',
  'HOME_TEST_WEATHER',
] as const;
