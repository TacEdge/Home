import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins/magic-link';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { systemActor } from './actor';
import { hashEmail, isAllowed } from './allowlist';
import { recordAudit } from './audit';
import { sendMail } from './mail';

// Better Auth configuration (contract §5.1–5.2, ADR 0003 §4).
//   - magic link only; links single-use, 15 minutes
//   - database sessions, 30-day rolling, refreshed daily
//   - household allowlist at link request (layer 1) and user creation (layer 2);
//     layer 3 (every request) is in ./session.ts
//   - rate limits: Better Auth's database limiter per IP, plus a per-email
//     limiter here using the same table

const DAY = 60 * 60 * 24;
const LINK_WINDOW_SECONDS = 15 * 60;
const LINK_MAX_PER_EMAIL = 5;

/**
 * Sliding-window counter in Better Auth's rate_limit table: true while `key`
 * is within `max` per window. Applied to link requests per email and per IP,
 * because server-side auth.api calls bypass Better Auth's HTTP limiter.
 */
async function withinRateLimit(key: string, max = LINK_MAX_PER_EMAIL): Promise<boolean> {
  const db = getDb();
  const now = Date.now();
  const windowStart = now - LINK_WINDOW_SECONDS * 1000;
  const [row] = await db
    .select()
    .from(schema.rateLimit)
    .where(and(eq(schema.rateLimit.key, key), gt(schema.rateLimit.lastRequest, windowStart)));
  if (row && row.count >= max) return false;
  await db
    .insert(schema.rateLimit)
    .values({ id: key, key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: schema.rateLimit.key,
      set: {
        count: sql`case when ${schema.rateLimit.lastRequest} > ${windowStart} then ${schema.rateLimit.count} + 1 else 1 end`,
        lastRequest: now,
      },
    });
  return true;
}

function buildAuth() {
  const isProduction = env.NODE_ENV === 'production';
  return betterAuth({
    appName: 'HOME',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(getDb(), { provider: 'pg', schema }),
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      // Route through the redacting logger; Better Auth's args may contain
      // request details, so only the message is kept.
      log: (level, message) =>
        log[level === 'error' ? 'error' : 'warn']('auth.' + level, { message }),
    },
    session: {
      expiresIn: 30 * DAY,
      updateAge: DAY,
    },
    advanced: {
      useSecureCookies: isProduction,
      cookiePrefix: 'home',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: isProduction },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      customRules: {
        // HTTP path: requests limited per IP. Verify is generous — tokens are
        // single-use, and a household shares one IP.
        '/sign-in/magic-link': { window: LINK_WINDOW_SECONDS, max: 5 },
        '/magic-link/verify': { window: LINK_WINDOW_SECONDS, max: 30 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Layer 2: no user record can exist for an address outside the household.
          before: async (u) => {
            if (isAllowed(u.email)) return;
            await recordAudit(systemActor, {
              event: 'auth.sign_in_denied',
              summary: 'User creation refused: not on the household allowlist',
              meta: { emailHash: hashEmail(u.email), stage: 'user_create' },
            });
            return false;
          },
        },
      },
      session: {
        create: {
          after: async (s) => {
            await recordAudit(
              { kind: 'user', userId: s.userId, email: '', via: 'ui', channel: 'web' },
              { event: 'auth.sign_in', subjectType: 'session', subjectId: s.id },
            );
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: LINK_WINDOW_SECONDS,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }, ctx) => {
          // Layer 1: same outcome for everyone; only household addresses get mail.
          if (!isAllowed(email)) {
            await recordAudit(systemActor, {
              event: 'auth.sign_in_denied',
              summary: 'Magic link requested for an address outside the household',
              meta: { emailHash: hashEmail(email), stage: 'link_request' },
            });
            return;
          }
          // Both paths (HTTP and server action): per email and per IP.
          const ip = ctx?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
          const emailOk = await withinRateLimit(`magic-link:email:${hashEmail(email)}`);
          const ipOk = await withinRateLimit(`magic-link:ip:${ip}`);
          if (!emailOk || !ipOk) {
            log.warn('auth.link_rate_limited', {
              emailHash: hashEmail(email),
              by: emailOk ? 'ip' : 'email',
            });
            return;
          }
          await recordAudit(systemActor, {
            event: 'auth.link_requested',
            meta: { emailHash: hashEmail(email) },
          });
          await sendMail({
            to: email,
            subject: 'Your HOME sign-in link',
            text: `Here's your link to sign in to HOME. It works once and expires in 15 minutes.\n\n${url}\n\nIf you didn't ask for this, you can ignore it.`,
          });
        },
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof buildAuth>;

let instance: Auth | undefined;

/** The configured Better Auth instance, built on first use (never at import). */
export function getAuth(): Auth {
  instance ??= buildAuth();
  return instance;
}
