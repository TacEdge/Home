import { describe, expect, it } from 'vitest';
import { PUBLIC_AUTH_PATHS, isPublicAuthPath } from '@/trust/auth-surface';

describe('public auth surface', () => {
  it('is exactly the magic-link verify endpoint', () => {
    expect(PUBLIC_AUTH_PATHS).toEqual([{ method: 'GET', path: '/api/auth/magic-link/verify' }]);
    expect(isPublicAuthPath('GET', '/api/auth/magic-link/verify')).toBe(true);
  });

  it.each([
    ['POST', '/api/auth/magic-link/verify'],
    ['POST', '/api/auth/sign-in/magic-link'],
    ['GET', '/api/auth/get-session'],
    ['POST', '/api/auth/update-user'],
    ['POST', '/api/auth/sign-out'],
    ['GET', '/api/auth/list-sessions'],
    ['GET', '/api/auth/magic-link/verify/'],
    ['GET', '/api/auth/magic-link/verify/extra'],
    ['GET', '/api/auth/ok'],
  ])('refuses %s %s', (method, path) => {
    expect(isPublicAuthPath(method, path)).toBe(false);
  });
});
