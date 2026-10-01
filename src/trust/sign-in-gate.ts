import 'server-only';
import { createHmac } from 'node:crypto';
import { getDb } from '@/db/client';
import type { Db } from '@/db/create';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { systemActor } from './actor';
import { hashEmail, isAllowed } from './allowlist';
import { recordAudit } from './audit';
import { getAuth, type Auth } from './auth';
import { consumeRateLimit } from './rate-limit';

// The one gate every sign-in link request passes through *before* Better Auth
// (M1.1 contract §1.1, B1). Better Auth stores a pending token — with the
// address in plain text — before it asks us to send mail, so nothing outside
// the household and nothing over the limit may reach it at all.
//
// Order matters: the per-IP budget is spent on every request, household or
// not, so an outsider cannot probe for free; the allowlist decides; then the
// per-email budget protects a household address from being flooded.

export const LINK_WINDOW_MS = 15 * 60 * 1000;
export const LINK_MAX_PER_IP = 5;
export const LINK_MAX_PER_EMAIL = 5;
export const UNKNOWN_IP_BUCKET = 'unknown';

export type GateDeps = { db?: Db; now?: () => number };

const ipFingerprint = (bucket: string) =>
  createHmac('sha256', env.AUDIT_HASH_SECRET).update(bucket).digest('hex').slice(0, 16);

/** Decide whether a link request may proceed. Never throws for a bad address. */
export async function gateLinkRequest(
  input: { email: string; ip: string | null },
  deps: GateDeps = {},
): Promise<'send' | 'drop'> {
  const db = deps.db ?? getDb();
  const now = deps.now?.() ?? Date.now();
  const bucket = input.ip ?? UNKNOWN_IP_BUCKET;
  const limit = { max: LINK_MAX_PER_IP, windowMs: LINK_WINDOW_MS, now, db };

  if (!(await consumeRateLimit(`link:ip:${bucket}`, limit))) {
    log.warn('auth.link_rate_limited', { by: 'ip', ipHash: ipFingerprint(bucket) });
    return 'drop';
  }
  if (!isAllowed(input.email)) {
    await auditDenied(db, bucket, hashEmail(input.email), now);
    return 'drop';
  }
  const emailHash = hashEmail(input.email);
  if (!(await consumeRateLimit(`link:email:${emailHash}`, { ...limit, max: LINK_MAX_PER_EMAIL }))) {
    log.warn('auth.link_rate_limited', { by: 'email', emailHash });
    return 'drop';
  }
  return 'send';
}

/**
 * At most one `auth.sign_in_denied` row per client IP per window, so denied
 * attempts cannot flood the audit log. Repeats in the window are only logged,
 * with the IP hashed and no address.
 */
async function auditDenied(db: Db, bucket: string, emailHash: string, now: number) {
  const first = await consumeRateLimit(`denied:ip:${bucket}`, {
    max: 1,
    windowMs: LINK_WINDOW_MS,
    now,
    db,
  });
  if (first) {
    await recordAudit(
      systemActor,
      {
        event: 'auth.sign_in_denied',
        summary: 'Magic link requested for an address outside the household',
        meta: { stage: 'link_request', emailHash, count: 1 },
      },
      { db },
    );
  } else {
    log.warn('auth.sign_in_denied_repeat', { ipHash: ipFingerprint(bucket) });
  }
}

/**
 * The server action's code path, minus the Next.js adapter: gate first, and
 * only a `send` decision reaches Better Auth. Returns the decision so tests
 * can prove what happened without inspecting mail.
 */
export async function handleLinkRequest(
  input: { email: string; ip: string | null; headers: Headers },
  deps: GateDeps & { auth?: Auth } = {},
): Promise<'send' | 'drop'> {
  const decision = await gateLinkRequest(input, deps);
  if (decision === 'send') {
    await (deps.auth ?? getAuth()).api.signInMagicLink({
      body: { email: input.email, callbackURL: '/today', errorCallbackURL: '/sign-in' },
      headers: input.headers,
    });
  }
  return decision;
}
