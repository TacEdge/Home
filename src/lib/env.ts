import 'server-only';
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
