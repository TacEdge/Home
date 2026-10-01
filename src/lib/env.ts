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
  if (env.VERCEL_ENV === 'preview') {
    if (!env.HOME_PRODUCTION_DB_HOST)
      throw new EnvError(
        ['HOME_PRODUCTION_DB_HOST'],
        'HOME_PRODUCTION_DB_HOST (required in preview deployments)',
      );
    if (dbHost === env.HOME_PRODUCTION_DB_HOST)
      throw new EnvError(
        ['DATABASE_URL'],
        'DATABASE_URL (a preview deployment must not use the production database host)',
      );
  }
  if (env.VERCEL_ENV === 'production' && env.HOME_PRODUCTION_DB_HOST) {
    if (dbHost !== env.HOME_PRODUCTION_DB_HOST)
      throw new EnvError(
        ['DATABASE_URL'],
        'DATABASE_URL (production must use the HOME_PRODUCTION_DB_HOST database host)',
      );
  }
  return env;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
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
