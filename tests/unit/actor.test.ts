import { describe, expect, it } from 'vitest';
import { actorFor, normaliseEmail, systemActor } from '@/trust/actor';

const allow = ['sam@example.test', 'alex@example.test'];

describe('actorFor', () => {
  it('returns a user actor for an allowlisted user, normalising the email', () => {
    const a = actorFor({ id: 'u1', email: '  SAM@Example.test ' }, allow);
    expect(a).toEqual({
      kind: 'user',
      userId: 'u1',
      email: 'sam@example.test',
      via: 'ui',
      channel: 'web',
    });
  });

  it('returns null for a user not on the allowlist', () => {
    expect(actorFor({ id: 'u9', email: 'someone@example.test' }, allow)).toBeNull();
  });

  it('returns null when there is no user', () => {
    expect(actorFor(null, allow)).toBeNull();
    expect(actorFor(undefined, allow)).toBeNull();
  });

  it('can act via Kev, still as the user', () => {
    expect(actorFor({ id: 'u1', email: 'sam@example.test' }, allow, { via: 'kev' })?.via).toBe(
      'kev',
    );
  });

  it('an empty allowlist admits nobody', () => {
    expect(actorFor({ id: 'u1', email: 'sam@example.test' }, [])).toBeNull();
  });
});

describe('systemActor', () => {
  it('is frozen and has no user identity', () => {
    expect(Object.isFrozen(systemActor)).toBe(true);
    expect(systemActor).toEqual({ kind: 'system', via: 'system' });
  });
});

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  A@B.Test ')).toBe('a@b.test');
  });
});
