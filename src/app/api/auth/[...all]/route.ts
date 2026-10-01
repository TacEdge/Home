import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/trust/auth';
import { isPublicAuthPath } from '@/trust/auth-surface';

export const runtime = 'nodejs';

// Only the paths in src/trust/auth-surface.ts reach Better Auth; everything
// else under /api/auth is 404 here, before any auth code runs (contract
// §1.1.3, §2.1). Built lazily so `next build` never needs runtime config.
const handler = () => toNextJsHandler(getAuth());
const notFound = () => new Response(null, { status: 404 });
const forward = (method: 'GET' | 'POST', req: Request) =>
  isPublicAuthPath(method, new URL(req.url).pathname) ? handler()[method](req) : notFound();

export const GET = (req: Request) => forward('GET', req);
export const POST = (req: Request) => forward('POST', req);
