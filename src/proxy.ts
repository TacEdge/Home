import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from '@/lib/csp';

// Every request gets its own nonce and the policy built from it (src/lib/csp.ts).
// The policy goes on the request too: Next.js reads the nonce from it while
// rendering and puts it on its own scripts and styles (every page is dynamic,
// see the root layout). The nonce is never logged and never stored.
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  // NODE_ENV is not configuration: Next.js fixes it at build time (`next dev`
  // or `next build`). The proxy does not load @/lib/env, which is server-only
  // and validates the whole environment.
  // eslint-disable-next-line no-restricted-properties
  const dev = process.env.NODE_ENV === 'development';
  const policy = contentSecurityPolicy(nonce, { dev });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  // Everything but Next's immutable, hashed build assets, which are not documents.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
