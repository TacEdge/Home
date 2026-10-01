import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins/magic-link';
import { getDb } from '@/db/client';
import type { Db } from '@/db/create';
import * as schema from '@/db/schema';
import { env as processEnv, type Env } from '@/lib/env';
import { log, sanitiseMessage } from '@/lib/log';
import { systemActor } from './actor';
import { hashEmail, isAllowed } from './allowlist';
import { recordAudit } from './audit';
import { CLIENT_IP_HEADER } from './client-ip';
import { sendMail as defaultSendMail, type Mail } from './mail';

// Better Auth configuration (contract §5.1–5.2, ADR 0003 §4; M1.1 contract
// §1.1, §2.2, §2.4, §3.A).
//   - magic link only; links single-use, 15 minutes
//   - database sessions, fixed 30 days from sign-in, never extended by use
//   - household allowlist: layer 1 is the sign-in gate (./sign-in-gate.ts),
//     which runs before Better Auth; `sendMagicLink` re-checks as defence in
//     depth; layer 2 is user creation (below); layer 3 is every request
//     (./session.ts)
//   - rate limits on link requests live in the gate; Better Auth's own
//     limiter covers the one public HTTP endpoint, verify

const DAY = 60 * 60 * 24;
const LINK_WINDOW_SECONDS = 15 * 60;

export type BuildAuthOptions = {
  env?: Env;
  db?: Db;
  sendMail?: (mail: Mail) => Promise<void>;
};

/**
 * Builds the Better Auth instance. Production code uses getAuth(); tests may
 * build their own with a different environment (e.g. production-shaped, to
 * assert cookie attributes) or a stubbed mail sender.
 */
export function buildAuth(opts: BuildAuthOptions = {}) {
  const env = opts.env ?? processEnv;
  const sendMail = opts.sendMail ?? defaultSendMail;
  const isProduction = env.NODE_ENV === 'production';
  return betterAuth({
    appName: 'HOME',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(opts.db ?? getDb(), { provider: 'pg', schema }),
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      // Never forward free text: Better Auth interpolates URLs and addresses
      // into some messages. Fixed events, sanitised detail (contract §2.4).
      log: (level, message) =>
        level === 'error'
          ? log.error('auth.library_error', { detail: sanitiseMessage(message) })
          : log.warn('auth.library_warn', { detail: sanitiseMessage(message) }),
    },
    session: {
      // Fixed lifetime (M1.1 §3.A, amends M1-D3): 30 days from sign-in, not
      // extended by use. A deliberate V0.1 simplification.
      expiresIn: 30 * DAY,
      disableSessionRefresh: true,
    },
    advanced: {
      useSecureCookies: isProduction,
      cookiePrefix: 'home',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: isProduction },
      // The same single platform header HOME's gate uses (contract §2.2).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      customRules: {
        // The only public HTTP path. Generous: tokens are single-use, and a
        // household shares one IP. Link requests are limited in the gate.
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
        sendMagicLink: async ({ email, url }) => {
          // Defence in depth only: the gate has already refused outsiders.
          // Reaching here with one means the gate was bypassed — say so, send
          // nothing, and never record the address.
          if (!isAllowed(email)) {
            log.error('auth.gate_bypassed', { emailHash: hashEmail(email) });
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
