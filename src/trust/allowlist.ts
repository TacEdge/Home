import 'server-only';
import { createHmac } from 'node:crypto';
import { env } from '@/lib/env';
import { normaliseEmail } from './actor';

// The household allowlist (contract §5.2). Comes only from HOME_ALLOWED_EMAILS,
// already normalised by lib/env. Checked at link request, at user creation and
// on every request.

export function allowlist(): readonly string[] {
  return env.HOME_ALLOWED_EMAILS;
}

export function isAllowed(email: string, list: readonly string[] = allowlist()): boolean {
  return list.includes(normaliseEmail(email));
}

/**
 * Stable, keyed fingerprint of an email for audit entries about denied
 * attempts. The address itself is never stored (contract §5.2).
 */
export function hashEmail(email: string, secret: string = env.AUDIT_HASH_SECRET): string {
  return createHmac('sha256', secret).update(normaliseEmail(email)).digest('hex').slice(0, 32);
}
