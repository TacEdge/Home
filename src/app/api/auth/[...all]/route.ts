import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/trust/auth';

export const runtime = 'nodejs';

// Built lazily so `next build` never needs runtime configuration.
const handler = () => toNextJsHandler(getAuth());
export const GET = (req: Request) => handler().GET(req);
export const POST = (req: Request) => handler().POST(req);
