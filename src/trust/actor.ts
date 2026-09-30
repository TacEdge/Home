import 'server-only';

// Every operation in HOME runs under an Actor (SYSTEM-ARCHITECTURE §5.2).
// Kev never has its own identity: it is always a user actor `via: 'kev'`.
// The system actor exists only for internal jobs (sync, retention) and can
// never be produced from a request.

export type Via = 'ui' | 'kev';
export type Channel = 'web'; // later: 'voice' | 'share' | 'email'

export type UserActor = {
  kind: 'user';
  userId: string;
  email: string; // normalised, allowlisted
  via: Via;
  channel: Channel;
};

export type SystemActor = { kind: 'system'; via: 'system' };

export type Actor = UserActor | SystemActor;

export const systemActor: SystemActor = Object.freeze({ kind: 'system', via: 'system' });

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/**
 * Pure: turn a session's user into an Actor, or null if the user is not on the
 * household allowlist. Re-checked on every request so removal takes effect
 * immediately (contract §5.2, layer 3).
 */
export function actorFor(
  user: { id: string; email: string } | null | undefined,
  allowlist: readonly string[],
  opts: { via?: Via; channel?: Channel } = {},
): UserActor | null {
  if (!user) return null;
  const email = normaliseEmail(user.email);
  if (!allowlist.includes(email)) return null;
  return {
    kind: 'user',
    userId: user.id,
    email,
    via: opts.via ?? 'ui',
    channel: opts.channel ?? 'web',
  };
}

export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'NotSignedInError';
  }
}
