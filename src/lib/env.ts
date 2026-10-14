import 'server-only';
import { createHmac } from 'node:crypto';
import { z } from 'zod';

// The only place HOME reads process.env (contract §5.3). Parsed once, validated
// with Zod, fails fast with the *names* of bad variables — never their values.

const bytes = (min: number) =>
  z.string().refine((v) => Buffer.byteLength(v, 'utf8') >= min, {
    message: `must be at least ${min} bytes`,
  });

const emailList = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  )
  .pipe(z.array(z.string().email()).min(1, { message: 'must list at least one email' }));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: bytes(32),
  BETTER_AUTH_URL: z.string().url(),
  HOME_ALLOWED_EMAILS: emailList,
  HOME_MAIL_TRANSPORT: z.enum(['provider', 'test']),
  MAIL_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().email().optional(),
  AUDIT_HASH_SECRET: bytes(32),
  HOME_TIMEZONE: z.string().min(1).default('Pacific/Auckland'),
  // Set by Vercel on its deployments; absent everywhere else.
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  // Host of the production database (M1.1 contract §1.4, I2). Previews must
  // never point at it; production must point at it when set.
  HOME_PRODUCTION_DB_HOST: z.string().min(1).optional(),
  // The real-data gate (ADR 0006 §2). Any string is accepted so that a wrong
  // value can never stop the app booting; only the exact value \`open\` opens
  // the gate (realDataGateOpen, below).
  HOME_REAL_DATA: z.string().optional(),
  // Calendar credential keys (M4 contract §4.1, src/trust/credentials.ts).
  // Any string is accepted here so a wrong value never stops the app booting;
  // credentials.ts validates the format, and a missing or malformed key only
  // refuses calendar credentials. Never logged.
  HOME_CREDENTIALS_KEY: z.string().optional(),
  HOME_CREDENTIALS_KEY_PREVIOUS: z.string().optional(),
  // The calendar-address fingerprint key (ADR 0007 §34): separate, stable
  // key material, never rotated with HOME_CREDENTIALS_KEY. The same rules:
  // any string here, validated by credentials.ts, never logged.
  HOME_FINGERPRINT_KEY: z.string().optional(),
  // A test-only time source (M5 contract §8.4): with \`allow\`, a request may
  // carry an \`x-home-test-now\` header and Today will read that instant as
  // now. Only the local and CI end-to-end servers set it; production and
  // Vercel deployments refuse it (parseEnv), so it can never move a real clock.
  HOME_TEST_TIME: z.enum(['allow']).optional(),
  // With the test time source on, the home-zone clock Today reads on the real
  // date when a request carries no header ("07:03"): the end-to-end suite's
  // steady morning, so a screen built from records dated today does not
  // change with the hour the suite happens to run.
  HOME_TEST_CLOCK: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  // The fake weather provider (M7 contract §7): local and CI runs only. With
  // `fake`, the weather composition root uses a synthetic forecast instead of
  // Open-Meteo. Refused on any deployed environment (parseEnv), and again by
  // the composition root itself.
  HOME_TEST_WEATHER: z.enum(['fake']).optional(),
  // Kev (M8 contract §1.3, §14; ADR 0012 §37). `on` or `off` (the default);
  // any other value stops the boot, naming the variable. Production refuses
  // Kev while the real-data gate is closed, whatever this says (kevConfig).
  HOME_KEV: z.enum(['on', 'off']).default('off'),
  // The scripted provider (contract §14): local and CI runs only. Refused on
  // any deployed environment (parseEnv), and again by kevConfig.
  HOME_TEST_KEV: z.enum(['scripted']).optional(),
  // The household's monthly cap in whole NZ dollars, 0 to 300 (contract
  // §13.4, L10); unset means NZ$100 (O2); 0 pauses Kev. Anything else, such
  // as `abc`, `301`, `12.5` or `050`, stops the boot, naming the variable.
  HOME_KEV_MONTHLY_CAP_NZD: z
    .string()
    .regex(/^(0|[1-9]\d{0,2})$/, 'must be a whole number of NZ dollars, 0 to 300')
    .transform(Number)
    .refine((n) => n <= 300, 'must be a whole number of NZ dollars, 0 to 300')
    .optional(),
  // HOME_KEV_PROVIDER_KEY is deliberately not in this schema: like the
  // weather location key, it is read only by kevConfig() below and handed
  // to the provider's composition root, never held on `env`, never logged.
  // ANTHROPIC_API_KEY and every other ANTHROPIC_* variable are never read.
  // HOME_LAT, HOME_LON, HOME_ELEVATION and HOME_WEATHER_LOCATION_KEY are
  // deliberately not in this schema: the home location and its key are read
  // only by weatherConfig() below, never held on `env`, and a wrong value
  // never stops HOME booting (it leaves weather unconfigured).
});

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {
  constructor(
    public readonly variables: string[],
    detail: string,
  ) {
    super(`Invalid environment: ${detail}`);
    this.name = 'EnvError';
  }
}

/** Pure: validate a raw environment. Exported for tests. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${String(i.path[0] ?? '?')} (${i.message})`);
    throw new EnvError(
      result.error.issues.map((i) => String(i.path[0] ?? '?')),
      problems.join('; '),
    );
  }
  const env = result.data;

  // Production-only refusals (contract §5.3, §5.10).
  if (env.NODE_ENV === 'production') {
    const bad: string[] = [];
    if (env.HOME_TEST_TIME || env.HOME_TEST_CLOCK)
      bad.push(
        'HOME_TEST_TIME / HOME_TEST_CLOCK (the test time source is not allowed in production)',
      );
    if (env.HOME_MAIL_TRANSPORT === 'test')
      bad.push('HOME_MAIL_TRANSPORT (test transport is not allowed in production)');
    if (!env.BETTER_AUTH_URL.startsWith('https://'))
      bad.push('BETTER_AUTH_URL (must be https in production)');
    if (env.HOME_MAIL_TRANSPORT === 'provider' && (!env.MAIL_API_KEY || !env.MAIL_FROM))
      bad.push('MAIL_API_KEY / MAIL_FROM (required when HOME_MAIL_TRANSPORT=provider)');
    if (bad.length)
      throw new EnvError(
        bad.map((b) => b.split(' ')[0] ?? b),
        bad.join('; '),
      );
  }
  if (env.HOME_TEST_WEATHER && (env.VERCEL_ENV || source.VERCEL || env.NODE_ENV === 'production'))
    throw new EnvError(
      ['HOME_TEST_WEATHER'],
      'HOME_TEST_WEATHER (the fake weather provider is for local and CI runs only)',
    );
  if (env.HOME_TEST_KEV && (env.VERCEL_ENV || source.VERCEL || env.NODE_ENV === 'production'))
    throw new EnvError(
      ['HOME_TEST_KEV'],
      'HOME_TEST_KEV (the scripted Kev provider is for local and CI runs only)',
    );
  if ((env.HOME_TEST_TIME || env.HOME_TEST_CLOCK) && env.VERCEL_ENV)
    throw new EnvError(
      ['HOME_TEST_TIME'],
      'HOME_TEST_TIME / HOME_TEST_CLOCK (the test time source is not allowed on a Vercel deployment)',
    );
  // Preview/production database isolation (contract §1.4). Preview and
  // production are separate Neon projects; this is the backstop against a
  // production credential ending up in the preview environment, or vice versa.
  const dbHost = hostOf(env.DATABASE_URL);
  const prodHost = env.HOME_PRODUCTION_DB_HOST
    ? normaliseDbHost(env.HOME_PRODUCTION_DB_HOST)
    : undefined;
  if (env.VERCEL_ENV === 'preview') {
    if (!env.HOME_PRODUCTION_DB_HOST)
      throw new EnvError(
        ['HOME_PRODUCTION_DB_HOST'],
        'HOME_PRODUCTION_DB_HOST (required in preview deployments)',
      );
    if (dbHost === prodHost)
      throw new EnvError(
        ['DATABASE_URL'],
        'DATABASE_URL (a preview deployment must not use the production database host)',
      );
  }
  if (env.VERCEL_ENV === 'production' && env.HOME_PRODUCTION_DB_HOST) {
    if (dbHost !== prodHost)
      throw new EnvError(
        ['DATABASE_URL'],
        'DATABASE_URL (production must use the HOME_PRODUCTION_DB_HOST database host)',
      );
  }
  // TLS on Vercel: exactly one `sslmode=verify-full`. `pg` 8 treats `require`
  // as `verify-full`, but `pg` 9 will give it libpq semantics (no certificate
  // check), so the mode that verifies the server must be stated explicitly.
  // The report names the mode only, never any other part of the URL.
  if (env.VERCEL_ENV) {
    const tls = describeDbSsl(env.DATABASE_URL);
    if (tls.occurrences !== 1 || tls.sslmode !== 'verify-full')
      throw new EnvError(
        ['DATABASE_URL'],
        `DATABASE_URL (a Vercel deployment must carry exactly one sslmode=verify-full; found sslmode=${tls.sslmode}, ${tls.occurrences} occurrence(s))`,
      );
  }
  return env;
}

const sslModes = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify'];

export interface DbSslReport {
  /** A known libpq/node-postgres mode, or `absent`, `unrecognised`, `unparseable`. */
  sslmode: string;
  /** How many `sslmode` parameters the query string carries. */
  occurrences: number;
}

/**
 * What `pg` will take as `sslmode` from a connection URL, and nothing else.
 * Reads only the query string's `sslmode` entries: user, password, host, port
 * and database are never touched. The value is reported only when it is one
 * of the known modes, otherwise as `unrecognised`, so the result is safe to
 * log and to put in an error. `pg-connection-string` applies the last
 * occurrence, so that is the one reported.
 */
export function describeDbSsl(url: string): DbSslReport {
  let values: string[];
  try {
    values = new URL(url).searchParams.getAll('sslmode');
  } catch {
    return { sslmode: 'unparseable', occurrences: 0 };
  }
  const last = values.at(-1);
  if (last === undefined) return { sslmode: 'absent', occurrences: 0 };
  return {
    sslmode: sslModes.includes(last) ? last : 'unrecognised',
    occurrences: values.length,
  };
}

/**
 * Hostname for the production-host comparison. Neon gives one endpoint two
 * names, `ep-x.<region>.aws.neon.tech` (direct) and `ep-x-pooler.<region>…`
 * (pooled); they are the same database, so the `-pooler` form is folded into
 * the direct one. Only that one Neon convention is normalised; any other host
 * is compared as is.
 */
function hostOf(url: string): string | null {
  try {
    return normaliseDbHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

export function normaliseDbHost(host: string): string {
  const lower = host.toLowerCase();
  if (!lower.endsWith('.neon.tech')) return lower;
  return lower.replace(/^([^.]+)-pooler\./, '$1.');
}

/**
 * The production real-data gate (ADR 0006 §2, M3 contract §6). On a Vercel
 * Production deployment family-domain writes are allowed only when
 * HOME_REAL_DATA is exactly `open`: missing, blank, padded, differently cased
 * or any other value keeps the gate closed. Everywhere else (local, CI,
 * Preview) the gate does not apply, so synthetic development continues.
 * Read from the raw environment on every call and never logged.
 */
export function realDataGateOpen(
  source: Record<string, string | undefined> = process.env,
): boolean {
  if (source.VERCEL_ENV !== 'production') return true;
  return source.HOME_REAL_DATA === 'open';
}

/**
 * The calendar key variables as they are now (M4 contract §4.1, ADR 0007
 * §34): read on each call, like the gate, so a rotation applies on the next
 * request without a restart. Raw strings; src/trust/credentials.ts validates
 * them. Never logged.
 */
export function calendarKeyEnv(source: Record<string, string | undefined> = process.env): {
  HOME_CREDENTIALS_KEY?: string;
  HOME_CREDENTIALS_KEY_PREVIOUS?: string;
  HOME_FINGERPRINT_KEY?: string;
} {
  return {
    HOME_CREDENTIALS_KEY: source.HOME_CREDENTIALS_KEY,
    HOME_CREDENTIALS_KEY_PREVIOUS: source.HOME_CREDENTIALS_KEY_PREVIOUS,
    HOME_FINGERPRINT_KEY: source.HOME_FINGERPRINT_KEY,
  };
}

/**
 * Where synthetic calendar feeds are read from in a local or CI run of the
 * screens (src/integrations/calendar/test-feeds.ts), with what the guard
 * there needs to refuse a deployed environment. Raw strings, read on each
 * call. Never set on Vercel.
 */
export function testFeedEnv(source: Record<string, string | undefined> = process.env): {
  HOME_TEST_CALENDAR_FEEDS?: string;
  VERCEL_ENV?: string;
  VERCEL?: string;
  NODE_ENV?: string;
} {
  return {
    HOME_TEST_CALENDAR_FEEDS: source.HOME_TEST_CALENDAR_FEEDS,
    VERCEL_ENV: source.VERCEL_ENV,
    VERCEL: source.VERCEL,
    NODE_ENV: source.NODE_ENV,
  };
}

// ---------------------------------------------------------------------------
// The home location for the weather (M7 contract §3.5, §5.1, §7; ADR 0011 §13,
// §14). The exact values exist only inside weatherConfig(): it reads them,
// rounds them at once (coordinates to two decimal places, elevation to 10 m)
// and lets only the rounded point out. The location key never leaves this
// module at all: it is used here for the location fingerprint and for
// nothing else. None of these values is ever logged; the boot line names a
// status only.

/** The rounded home point: what the forecast request and daylight use. */
export type WeatherPoint = Readonly<{
  /** Degrees, two decimal places. */
  lat: number;
  /** Degrees, two decimal places. */
  lon: number;
  /** Metres, to the nearest 10, or null when not configured. */
  elevation: number | null;
}>;

export type WeatherConfig =
  | { status: 'absent' }
  | { status: 'invalid' }
  /** A location, but no valid key: no request, no forecast read; daylight only. */
  | { status: 'key_missing'; point: WeatherPoint }
  | { status: 'set'; point: WeatherPoint; fingerprint: string };

/** The minimum decoded length of HOME_WEATHER_LOCATION_KEY (contract §5.1). */
export const WEATHER_KEY_MIN_BYTES = 32;

const DECIMAL = /^-?\d{1,4}(\.\d{1,12})?$/;

/** Rounds to two decimal places, with no negative zero. */
function round2(x: number): number {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
}

function parseCoordinate(raw: string, limit: number): number | null {
  if (!DECIMAL.test(raw)) return null;
  const x = Number(raw);
  if (!Number.isFinite(x) || Math.abs(x) > limit) return null;
  const r = round2(x);
  return Math.abs(r) > limit ? null : r;
}

function parseElevation(raw: string): number | null | 'invalid' {
  if (!DECIMAL.test(raw)) return 'invalid';
  const x = Number(raw);
  if (!Number.isFinite(x) || x < -500 || x > 9000) return 'invalid';
  const r = Math.round(x / 10) * 10;
  return r === 0 ? 0 : r;
}

/**
 * The location key's bytes: canonical standard base64 of at least 32 bytes,
 * not one repeated byte, and not equal to any other HOME key or secret (each
 * key has one purpose). Null when absent or invalid.
 */
function weatherKeyFrom(source: Record<string, string | undefined>): Buffer | null {
  const raw = source.HOME_WEATHER_LOCATION_KEY;
  if (!raw) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length < WEATHER_KEY_MIN_BYTES || bytes.toString('base64') !== raw) return null;
  if (bytes.every((b) => b === bytes[0])) return null;
  const others = [
    source.HOME_CREDENTIALS_KEY,
    source.HOME_CREDENTIALS_KEY_PREVIOUS,
    source.HOME_FINGERPRINT_KEY,
    source.BETTER_AUTH_SECRET,
    source.AUDIT_HASH_SECRET,
  ];
  if (others.some((other) => other !== undefined && other !== '' && other === raw)) return null;
  return bytes;
}

/**
 * The canonical string the location fingerprint is made from (contract §5.1,
 * v1): `home-weather-location:v1|open_meteo|{lat}|{lon}|{elevation|none}`,
 * the coordinates with exactly two decimals. Pure; exported for its test.
 */
export function weatherLocationCanonical(point: WeatherPoint): string {
  return [
    'home-weather-location:v1',
    'open_meteo',
    point.lat.toFixed(2),
    point.lon.toFixed(2),
    point.elevation === null ? 'none' : String(point.elevation),
  ].join('|');
}

/** Lower-case hex HMAC-SHA256 of the canonical string. Pure; exported for its test vector. */
export function weatherLocationFingerprint(point: WeatherPoint, key: Buffer): string {
  return createHmac('sha256', key).update(weatherLocationCanonical(point), 'utf8').digest('hex');
}

/**
 * The weather configuration as it is now: read on every call, like the gate
 * and the calendar keys, so a change applies on the next request. Never
 * throws. A location with only one of HOME_LAT and HOME_LON, a value out of
 * range or not a plain decimal, or a bad HOME_ELEVATION is `invalid`;
 * neither coordinate set is `absent` (HOME_ELEVATION alone is ignored).
 */
export function weatherConfig(
  source: Record<string, string | undefined> = process.env,
): WeatherConfig {
  const rawLat = source.HOME_LAT;
  const rawLon = source.HOME_LON;
  if (!rawLat && !rawLon) return { status: 'absent' };
  if (!rawLat || !rawLon) return { status: 'invalid' };
  const lat = parseCoordinate(rawLat, 90);
  const lon = parseCoordinate(rawLon, 180);
  if (lat === null || lon === null) return { status: 'invalid' };
  const elevation = source.HOME_ELEVATION ? parseElevation(source.HOME_ELEVATION) : null;
  if (elevation === 'invalid') return { status: 'invalid' };
  const point: WeatherPoint = Object.freeze({ lat, lon, elevation });
  const key = weatherKeyFrom(source);
  if (!key) return { status: 'key_missing', point };
  return { status: 'set', point, fingerprint: weatherLocationFingerprint(point, key) };
}

/** The boot line's status (contract §7): never a value. */
export function weatherBootStatus(config: WeatherConfig): string {
  return config.status === 'key_missing' ? 'set, key missing' : config.status;
}

/**
 * HOME_TEST_WEATHER with what its guard needs to refuse a deployed
 * environment (src/integrations/weather/entry.ts). Raw strings, read on each
 * call. Never set on Vercel.
 */
export function testWeatherEnv(source: Record<string, string | undefined> = process.env): {
  HOME_TEST_WEATHER?: string;
  VERCEL_ENV?: string;
  VERCEL?: string;
  NODE_ENV?: string;
} {
  return {
    HOME_TEST_WEATHER: source.HOME_TEST_WEATHER,
    VERCEL_ENV: source.VERCEL_ENV,
    VERCEL: source.VERCEL,
    NODE_ENV: source.NODE_ENV,
  };
}

// ---------------------------------------------------------------------------
// Kev (M8 contract §5.4, §14; ADR 0012 §14, §37). The provider key exists
// only inside kevConfig(): it is read here, from HOME_KEV_PROVIDER_KEY and
// nothing else, and handed to the provider's composition root
// (src/kev/providers/select.ts). It is never held on `env`, never logged,
// never in an error, and the boot line names a status only.

/** What Kev may run with now. Only `on` carries the key. */
export type KevConfig =
  | { status: 'off' }
  | { status: 'off (gate closed)' }
  | { status: 'no key' }
  | { status: 'invalid key' }
  | { status: 'scripted' }
  | { status: 'on'; key: string };

/**
 * A well-formed provider key (ADR 0012 §43, I6): printable ASCII with no
 * space or control character, 16 to 512 characters. kevConfig() and the
 * provider's constructors (src/kev/providers) apply it; nothing echoes a
 * value that fails it.
 */
export const PROVIDER_KEY_FORMAT = /^[\x21-\x7e]{16,512}$/;

const deployed = (source: Record<string, string | undefined>) =>
  Boolean(source.VERCEL_ENV || source.VERCEL || source.NODE_ENV === 'production');

/**
 * Kev's configuration as it is now, read on every call like the gate.
 * Production with the real-data gate closed is always `off (gate closed)`,
 * whatever HOME_KEV says (S10). Otherwise `off` unless HOME_KEV is exactly
 * `on`; then the scripted provider where HOME_TEST_KEV allows it (never when
 * deployed), else the key, `no key` when it is unset, empty or blank (N2),
 * or `invalid key` when it is not exactly PROVIDER_KEY_FORMAT (a control
 * character, a space, a line break, anything outside printable ASCII; never
 * trimmed or repaired). Never throws, and never echoes the value.
 */
export function kevConfig(source: Record<string, string | undefined> = process.env): KevConfig {
  if (source.VERCEL_ENV === 'production' && !realDataGateOpen(source))
    return { status: 'off (gate closed)' };
  if (source.HOME_KEV !== 'on') return { status: 'off' };
  if (source.HOME_TEST_KEV === 'scripted') {
    return deployed(source) ? { status: 'off' } : { status: 'scripted' };
  }
  const key = source.HOME_KEV_PROVIDER_KEY;
  if (key === undefined || key.trim() === '') return { status: 'no key' };
  if (!PROVIDER_KEY_FORMAT.test(key)) return { status: 'invalid key' };
  return { status: 'on', key };
}

/** HOME_KEV_MONTHLY_CAP_NZD's rule, as the schema above holds it. */
const CAP_NZD = /^(0|[1-9]\d{0,2})$/;

/**
 * The household's monthly cap setting as it is now, read on every call
 * (like kevConfig): whole NZ dollars 0 to 300; `undefined` when unset (the
 * NZ$100 default applies); `null` when invalid, which parseEnv refuses at
 * boot and a caller treats as a cap of 0 (fail closed). The bookkeeping
 * path derives the cap from this alone; no caller passes one.
 */
export function kevMonthlyCapNzd(
  source: Record<string, string | undefined> = process.env,
): number | undefined | null {
  const raw = source.HOME_KEV_MONTHLY_CAP_NZD;
  if (raw === undefined) return undefined;
  if (!CAP_NZD.test(raw)) return null;
  const n = Number(raw);
  return n <= 300 ? n : null;
}

/**
 * Whether this process is a deployed one, with what decides it, read on each
 * call: the guards that keep test seams (the scripted provider, the provider
 * test fetch) out of every deployment use it.
 */
export function deploymentEnv(source: Record<string, string | undefined> = process.env): {
  VERCEL_ENV?: string;
  VERCEL?: string;
  NODE_ENV?: string;
} {
  return { VERCEL_ENV: source.VERCEL_ENV, VERCEL: source.VERCEL, NODE_ENV: source.NODE_ENV };
}

/** The boot line's status (contract §14): never the key. */
export function kevBootStatus(config: KevConfig): string {
  return config.status;
}

let cached: Env | undefined;

/** Validated environment. Parsed on first access; throws EnvError if invalid. */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    cached ??= parseEnv(process.env);
    return cached[prop as keyof Env];
  },
  has(_target, prop) {
    cached ??= parseEnv(process.env);
    return prop in cached;
  },
  ownKeys() {
    cached ??= parseEnv(process.env);
    return Reflect.ownKeys(cached);
  },
  getOwnPropertyDescriptor(_target, prop) {
    cached ??= parseEnv(process.env);
    return Object.getOwnPropertyDescriptor(cached, prop);
  },
});
