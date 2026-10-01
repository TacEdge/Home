import 'server-only';
import { headers } from 'next/headers';
import { actorFor, NotSignedInError, type UserActor } from './actor';
import { allowlist } from './allowlist';
import { getAuth } from './auth';
import { recordAudit } from './audit';

// Layer 3 of the allowlist and the security boundary for every server
// layout, server action and route handler (contract §5.5). Middleware is
// never the boundary.

/** The signed-in, allowlisted actor for this request, or null. */
export async function getActor(): Promise<UserActor | null> {
  const auth = getAuth();
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result) return null;
  const actor = actorFor({ id: result.user.id, email: result.user.email }, allowlist());
  if (!actor) {
    // A session exists but the address is no longer allowed: revoke it.
    await auth.api.signOut({ headers: await headers() }).catch(() => undefined);
    await recordAudit(
      { kind: 'user', userId: result.user.id, email: '', via: 'ui', channel: 'web' },
      { event: 'auth.sign_in_denied', summary: 'Session revoked: no longer on the allowlist' },
    );
    return null;
  }
  return actor;
}

/** Throws if not signed in. Use in server actions and route handlers. */
export async function requireActor(): Promise<UserActor> {
  const actor = await getActor();
  if (!actor) throw new NotSignedInError();
  return actor;
}

/** Ends the current session server-side and audits it. */
export async function signOut(): Promise<void> {
  const actor = await getActor();
  await getAuth()
    .api.signOut({ headers: await headers() })
    .catch(() => undefined);
  if (actor) await recordAudit(actor, { event: 'auth.sign_out' });
}
