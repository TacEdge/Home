import 'server-only';

// HOME's public auth surface (M1.1 contract §1.1.3, decision D-M1.1-2): only
// the Better Auth HTTP endpoint that verifies an emailed magic link. Every
// other Better Auth path — sign-in (the server action is the only way to ask
// for a link), get-session, sign-out, update-user, list-sessions, … — is 404
// before Better Auth runs.
//
// Adding an entry here is a reviewed change. Any future endpoint that acts on
// a session must apply the household allowlist check (actorFor) before being
// forwarded, because Better Auth's own endpoints do not re-check membership
// (contract §2.1).
export const PUBLIC_AUTH_PATHS: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'GET', path: '/api/auth/magic-link/verify' },
];

export function isPublicAuthPath(method: string, pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some((p) => p.method === method && p.path === pathname);
}
